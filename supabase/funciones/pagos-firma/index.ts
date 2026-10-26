// Edge Function «pagos-firma» — sustituye a POST /api/pagos/firma del Worker.
// Recibe artículos + datos de cliente, calcula el importe EN SERVIDOR desde la
// base de datos (precio efectivo = min entre precio_oferta y ofertas activas,
// más el coste de envío de los ajustes), crea el pedido «pendiente» con el
// cliente service_role y devuelve los parámetros DS_MERCHANT_* + firma
// HMAC_SHA256_V1 y la URL del banco, igual que el Worker.
//
// Despliegue (fase 2, opcional): npx supabase functions deploy pagos-firma

import { createClient } from 'npm:@supabase/supabase-js@2';
import { firmarParametros, generarNumeroPedido } from './redsys.ts';

// Orígenes permitidos para CORS (la web pública llama desde el navegador)
const ORIGENES = ['https://omshaddai.com', 'https://rubngnzalez.github.io', 'https://shaddai-panel.redes-301dpi.workers.dev'];
const ORIGENES_EXTRA = (Deno.env.get('CORS_ORIGENES_EXTRA') || '').split(',').map((o) => o.trim()).filter(Boolean);

function cabeceras(request?: Request): Record<string, string> {
  const origen = request?.headers.get('origin') || '';
  const permitido = [...ORIGENES, ...ORIGENES_EXTRA].some((o) => origen === o || origen.endsWith('.omshaddai.com')) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen) ||
    origen.endsWith('.githubpreview.com');
  return {
    'Access-Control-Allow-Origin': permitido ? origen : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

const URLS_REDSYS: Record<string, string> = {
  test: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  produccion: 'https://sis.redsys.es/sis/realizarPago',
};

function errorJson(mensaje: string, estado = 400, request?: Request): Response {
  return new Response(JSON.stringify({ error: mensaje }), { status: estado, headers: cabeceras(request) });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') return errorJson('Método no permitido.', 405, request);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return errorJson('La función no está configurada (faltan secretos del proyecto).', 500, request);
  }

  let cuerpo: { articulos?: unknown; metodo?: string; numeroPedido?: string; envio?: Record<string, unknown> };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const articulos = Array.isArray(cuerpo.articulos) ? cuerpo.articulos : [];
  if (articulos.length === 0 || articulos.length > 50) {
    return errorJson('El pedido debe incluir entre 1 y 50 artículos.', 400, request);
  }
  const metodo = cuerpo.metodo === 'bizum' ? 'bizum' : 'tarjeta';

  // Cliente service_role: solo dentro de la función, nunca en el navegador
  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // 1 · Ajustes (envío + redsys)
  const { data: filaAjustes, error: errorAjustes } = await db
    .from('ajustes')
    .select('contacto, redsys, envio')
    .eq('id', 'general')
    .single();
  if (errorAjustes || !filaAjustes) {
    return errorJson('La tienda todavía no tiene ajustes configurados.', 500, request);
  }
  const redsys = (filaAjustes.redsys || {}) as Record<string, unknown>;
  const clave = String(redsys.clave || '');
  if (!clave) {
    return errorJson('El pago no está configurado todavía. Contacta con la tienda.', 500, request);
  }

  // 2 · Catálogo real y ofertas activas
  const { data: productos, error: errorProductos } = await db
    .from('productos')
    .select('id, codigo, nombre, slug, precio, precio_oferta, stock, activo');
  if (errorProductos || !productos) {
    return errorJson('No se pudo leer el catálogo.', 500, request);
  }
  const { data: ofertas } = await db
    .from('ofertas')
    .select('producto, tipo, valor, inicio, fin, activa');

  const ahoraMs = Date.now();
  const ofertaActiva = (o: { activa: boolean; inicio: string | null; fin: string | null }) =>
    Boolean(o.activa) &&
    (!o.inicio || Date.parse(o.inicio) <= ahoraMs) &&
    (!o.fin || ahoraMs <= Date.parse(o.fin));

  // 3 · Líneas del pedido con precio efectivo EN SERVIDOR
  const lineas: Array<{ id: string; codigo: string; nombre: string; cantidad: number; precioUnitario: number }> = [];
  for (const articulo of articulos as Array<Record<string, unknown>>) {
    const cantidad = Number(articulo.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
      return errorJson('Cada artículo debe tener una cantidad entre 1 y 99.', 400, request);
    }
    const buscado = String(articulo.codigo || articulo.slug || articulo.id || '').trim();
    const producto = productos.find(
      (p: Record<string, unknown>) =>
        (buscado && (p.codigo === buscado || p.slug === buscado || p.id === buscado)) ||
        (articulo.nombre && p.nombre === articulo.nombre)
    );
    if (!producto) {
      return errorJson(`No reconocemos el artículo «${buscado || String(articulo.nombre || '?')}».`, 400, request);
    }
    if (producto.activo === false) {
      return errorJson(`El artículo «${producto.nombre}» no está disponible ahora mismo.`, 400, request);
    }
    // Precio efectivo: min entre precio_oferta y las ofertas activas ahora
    let precio = Number(producto.precio_oferta) > 0 ? Number(producto.precio_oferta) : Number(producto.precio);
    const activas = (ofertas || []).filter(
      (o: Record<string, unknown>) => o.producto === producto.id && ofertaActiva(o as never)
    );
    for (const oferta of activas as Array<Record<string, unknown>>) {
      const base = Number(producto.precio) || 0;
      const valor = Number(oferta.valor) || 0;
      const candidato = oferta.tipo === 'porcentaje' ? base * (1 - valor / 100) : valor;
      if (candidato >= 0 && candidato < precio) precio = Math.round(candidato * 100) / 100;
    }
    lineas.push({
      id: String(producto.id),
      codigo: String(producto.codigo || ''),
      nombre: String(producto.nombre),
      cantidad,
      precioUnitario: Math.round(precio * 100) / 100,
    });
  }

  const subtotal = Math.round(lineas.reduce((suma, l) => suma + l.precioUnitario * l.cantidad, 0) * 100) / 100;

  // 4 · Envío desde ajustes (gratis desde el umbral)
  const envioAjustes = (filaAjustes.envio || {}) as Record<string, unknown>;
  let costeEnvio = 0;
  if (envioAjustes.activo !== false && subtotal > 0) {
    const coste = Number(envioAjustes.coste) || 0;
    const gratisDesde = Number(envioAjustes.gratisDesde) || 0;
    if (gratisDesde <= 0 || subtotal < gratisDesde) costeEnvio = coste;
  }
  const total = Math.round((subtotal + costeEnvio) * 100) / 100;

  // 5 · Número de pedido único
  let numero = String(cuerpo.numeroPedido || generarNumeroPedido())
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (numero.length < 4 || numero.length > 12) {
    return errorJson('El número de pedido debe tener entre 4 y 12 caracteres alfanuméricos.', 400, request);
  }
  const { data: duplicado } = await db.from('pedidos').select('id').eq('numero', numero).limit(1);
  if (duplicado && duplicado.length > 0) {
    return errorJson('Ese número de pedido ya existe. Genera uno nuevo.', 400, request);
  }

  const datosEnvio = cuerpo.envio || {};
  const texto = (campo: string, max: number) => String(datosEnvio[campo] || '').trim().slice(0, max);
  const cliente = {
    nombre: texto('nombre', 60),
    apellidos: texto('apellidos', 60),
    email: texto('email', 120),
    telefono: texto('telefono', 30),
    direccion: texto('direccion', 200),
    cp: texto('cp', 10),
    poblacion: texto('poblacion', 100),
    provincia: texto('provincia', 100),
  };

  // 6 · URLs de retorno (ajustes o la propia web)
  const origenWeb = request.headers.get('origin') || 'https://omshaddai.com';
  const urlOk = String(redsys.urlOk || '') || `${origenWeb}/pago-ok.html`;
  const urlKo = String(redsys.urlKo || '') || `${origenWeb}/pago-ko.html`;
  const urlNotificacion = String(redsys.urlNotificacion || '') ||
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/redsys-notificacion`;

  // 7 · Parámetros y firma HMAC_SHA256_V1
  const parametros = {
    DS_MERCHANT_AMOUNT: String(Math.round(total * 100)),
    DS_MERCHANT_ORDER: numero,
    DS_MERCHANT_MERCHANTCODE: String(redsys.fuc || ''),
    DS_MERCHANT_CURRENCY: String(redsys.moneda || '978'),
    DS_MERCHANT_TRANSACTIONTYPE: '0',
    DS_MERCHANT_TERMINAL: String(redsys.terminal || '1'),
    DS_MERCHANT_MERCHANTNAME: String(redsys.nombreComercio || '').slice(0, 60),
    DS_MERCHANT_PRODUCTDESCRIPTION: lineas.map((l) => `${l.cantidad}× ${l.nombre}`).join(' · ').slice(0, 120),
    DS_MERCHANT_TITULAR: [cliente.nombre, cliente.apellidos].filter(Boolean).join(' ').slice(0, 60),
    DS_MERCHANT_CONSUMERLANGUAGE: '001',
    DS_MERCHANT_URLOK: urlOk,
    DS_MERCHANT_URLKO: urlKo,
    DS_MERCHANT_MERCHANTURL: urlNotificacion,
    DS_MERCHANT_PAYMETHODS: metodo === 'bizum' ? 'z' : 'C',
  };

  const bytesJson = new TextEncoder().encode(JSON.stringify(parametros));
  let binario = '';
  for (const b of bytesJson) binario += String.fromCharCode(b);
  const parametrosB64 = btoa(binario);

  let firma: string;
  try {
    firma = await firmarParametros(parametrosB64, numero, clave);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return errorJson(`No se pudo firmar el pedido: ${mensaje}`, 500, request);
  }

  // 8 · Pedido pendiente + líneas (service_role: es la única vía de escritura)
  const { data: pedidoCreado, error: errorPedido } = await db
    .from('pedidos')
    .insert({ numero, cliente, subtotal, envio: costeEnvio, total, metodo, estado: 'pendiente' })
    .select('id')
    .single();
  if (errorPedido || !pedidoCreado) {
    return errorJson(`No se pudo registrar el pedido: ${errorPedido?.message || 'error desconocido'}`, 500, request);
  }
  const lineasInsert = lineas.map((l) => ({
    pedido: pedidoCreado.id,
    codigo: l.codigo,
    nombre: l.nombre,
    cantidad: l.cantidad,
    precio_unitario: l.precioUnitario,
  }));
  await db.from('pedidos_lineas').insert(lineasInsert);

  return new Response(
    JSON.stringify({
      numeroPedido: numero,
      url: URLS_REDSYS[String(redsys.entorno || 'test')] || URLS_REDSYS.test,
      version: 'HMAC_SHA256_V1',
      parametrosB64,
      firma,
      parametros,
      resumen: { subtotal, envio: costeEnvio, total, articulos: lineas },
      pedidoId: pedidoCreado.id,
    }),
    { headers: cabeceras(request) }
  );
});
