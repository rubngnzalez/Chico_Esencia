// Edge Function «oms-distrib-pagos-firma» — firma de pago Redsys SOLO para
// distribuidores aceptados (zona VIP). Flujo PARALELO al de clientes:
// «oms-pagos-firma» no se toca y no comparte código en runtime (redsys.ts es
// una copia por carpeta, patrón del repo).
//
// Diferencias respecto al flujo de clientes:
//   · Requiere sesión de Supabase Auth de un distribuidor con acceso habilitado.
//   · El importe se recalcula en servidor con el % de descuento del distribuidor
//     sobre el precio efectivo (precio_oferta / ofertas activas).
//   · El pedido se crea con canal='distribuidor', distribuidor_id y
//     descuento_pct (las columnas nuevas con DEFAULT no afectan al flujo cliente).
//   · Sin cupones: el descuento del distribuidor es el del programa.
//
// Despliegue: npx supabase functions deploy oms-distrib-pagos-firma

import { createClient } from 'npm:@supabase/supabase-js@2';
import { firmarParametros, generarNumeroPedido } from './redsys.ts';
import { cabeceras, errorJson, ipDe } from './correo.ts';

const URLS_REDSYS: Record<string, string> = {
  test: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  produccion: 'https://sis.redsys.es/sis/realizarPago',
};

const PAIS_ZONAS_DEFECTO: Record<string, string[]> = {
  unionEuropea: ['Portugal', 'Francia', 'Andorra', 'Alemania', 'Italia', 'Reino Unido', 'Países Bajos', 'Bélgica'],
  latinoamerica: ['México', 'Argentina', 'Colombia', 'Chile'],
  resto: ['Estados Unidos', 'Otro país'],
};

function zonaDePais(pais: string, paises?: unknown): string {
  const destino = String(pais || 'España').trim();
  if (!destino || destino.toLowerCase() === 'españa' || destino.toLowerCase() === 'espana') return 'espana';
  const listas = {
    ...PAIS_ZONAS_DEFECTO,
    ...(paises && typeof paises === 'object' ? (paises as Record<string, string[]>) : {}),
  };
  for (const clave of ['unionEuropea', 'latinoamerica', 'resto']) {
    const lista = Array.isArray(listas[clave]) ? listas[clave] : [];
    if (lista.some((x) => String(x).toLowerCase() === destino.toLowerCase())) return clave;
  }
  return 'resto';
}

// Distribuidor de la sesión: usuario con fila en oms_distribuidores y acceso
// habilitado. Si no, el pago se rechaza.
async function distribuidorDeSesion(db: any, token: string, urlSupabase: string, claveServicio: string) {
  const anon = createClient(urlSupabase, Deno.env.get('SUPABASE_ANON_KEY') || claveServicio, {
    auth: { persistSession: false },
  });
  const { data: datosUsuario, error: errorToken } = await anon.auth.getUser(token);
  if (errorToken || !datosUsuario?.user) return null;
  const { data: filas } = await db
    .from('oms_distribuidores')
    .select('id, empresa, email, descuento_pct, acceso_habilitado')
    .eq('user_id', datosUsuario.user.id)
    .limit(1);
  const distribuidor = (filas || [])[0] as
    | { id: string; empresa: string; email: string; descuento_pct: number; acceso_habilitado: boolean }
    | undefined;
  if (!distribuidor || distribuidor.acceso_habilitado !== true) return null;
  return distribuidor;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') return errorJson('Método no permitido.', 405, request);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return errorJson('La función no está configurada (faltan secretos del proyecto).', 500, request);
  }
  ipDe(request);

  const autorizacion = request.headers.get('Authorization') || '';
  const token = autorizacion.replace(/^Bearer\s+/i, '').trim();
  if (!token) return errorJson('Entra en tu zona de distribuidor para realizar el pedido.', 401);

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });
  const distribuidor = await distribuidorDeSesion(db, token, urlSupabase, claveServicio);
  if (!distribuidor) {
    return errorJson('Tu acceso a la zona de distribuidores no está disponible. Contacta con SHADDAI.', 403, request);
  }

  let cuerpo: { articulos?: unknown; metodo?: string; numeroPedido?: string; envio?: Record<string, unknown> };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const articulos = Array.isArray(cuerpo.articulos) ? cuerpo.articulos : [];
  if (articulos.length === 0 || articulos.length > 100) {
    return errorJson('El pedido debe incluir entre 1 y 100 artículos.', 400, request);
  }
  const metodo = cuerpo.metodo === 'bizum' ? 'bizum' : 'tarjeta';

  // 1 · Ajustes (envío + redsys)
  const { data: filaAjustes, error: errorAjustes } = await db
    .from('oms_ajustes')
    .select('redsys, envio')
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

  // 2 · Catálogo real y ofertas activas (igual que el flujo de clientes)
  const { data: productos, error: errorProductos } = await db
    .from('oms_productos')
    .select('id, codigo, slug, nombre, precio, precio_oferta, stock, activo, zonas_envio');
  if (errorProductos || !productos) {
    return errorJson('No se pudo leer el catálogo.', 500, request);
  }
  const { data: ofertas } = await db
    .from('oms_ofertas')
    .select('producto, tipo, valor, inicio, fin, activa');

  const ahoraMs = Date.now();
  const ofertaActiva = (o: { activa: boolean; inicio: string | null; fin: string | null }) =>
    Boolean(o.activa) &&
    (!o.inicio || Date.parse(o.inicio) <= ahoraMs) &&
    (!o.fin || ahoraMs <= Date.parse(o.fin));

  // 3 · Líneas con precio efectivo + descuento del distribuidor EN SERVIDOR
  const envioAjustes = (filaAjustes.envio || {}) as Record<string, unknown>;
  const datosEnvio = (cuerpo.envio || {}) as Record<string, unknown>;
  const zonaEnvio = zonaDePais(String(datosEnvio.pais || 'España'), envioAjustes.paises);
  const ETIQUETA_ZONA: Record<string, string> = {
    espana: 'España',
    unionEuropea: 'la Unión Europea',
    latinoamerica: 'Latinoamérica',
    resto: 'Resto del mundo',
  };
  const descuentoPct = Math.min(100, Math.max(0, Number(distribuidor.descuento_pct) || 0));
  const factorDistribuidor = 1 - descuentoPct / 100;

  const lineas: Array<{ id: string; codigo: string; nombre: string; cantidad: number; precioUnitario: number }> = [];
  for (const articulo of articulos as Array<Record<string, unknown>>) {
    const cantidad = Number(articulo.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
      return errorJson('Cada artículo debe tener una cantidad entre 1 y 999.', 400, request);
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
    const zonasProducto = Array.isArray(producto.zonas_envio)
      ? (producto.zonas_envio as unknown[]).map((z) => String(z).toLowerCase())
      : [];
    if (zonasProducto.length > 0 && !zonasProducto.includes(zonaEnvio)) {
      return errorJson(
        `«${producto.nombre}» no está disponible para envío a ${ETIQUETA_ZONA[zonaEnvio] || zonaEnvio}. Quita el artículo del carrito o elige otro destino.`,
        400,
        request
      );
    }
    // Precio efectivo de cliente (ofertas incluidas) y, sobre él, el
    // descuento del distribuidor. Redondeo a céntimos por línea.
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
    const precioDistribuidor = Math.round(precio * factorDistribuidor * 100) / 100;
    lineas.push({
      id: String(producto.id),
      codigo: String(producto.codigo || ''),
      nombre: String(producto.nombre),
      cantidad,
      precioUnitario: precioDistribuidor,
    });
  }

  const subtotal = Math.round(lineas.reduce((suma, l) => suma + l.precioUnitario * l.cantidad, 0) * 100) / 100;

  // 4 · Envío por zona (mismos ajustes que la tienda de clientes)
  const zonasAjustes = (envioAjustes.zonas || {}) as Record<string, Record<string, unknown>>;
  const zonaCfg = zonasAjustes[zonaEnvio] || {};
  let costeEnvio = 0;
  if (envioAjustes.activo !== false && subtotal > 0) {
    const reservaCoste =
      zonaEnvio === 'espana' ? envioAjustes.coste : (envioAjustes.costeInternacional ?? envioAjustes.coste);
    const reservaGratis =
      zonaEnvio === 'espana' ? envioAjustes.gratisDesde : envioAjustes.gratisDesdeInternacional;
    const costeZona = Number(zonaCfg.coste ?? reservaCoste) || 0;
    const gratisDesde = Number(zonaCfg.gratisDesde ?? reservaGratis) || 0;
    if (gratisDesde > 0 && subtotal >= gratisDesde) costeEnvio = 0;
    else costeEnvio = costeZona;
  }
  const total = Math.max(0, Math.round((subtotal + costeEnvio) * 100) / 100);

  // 5 · Número de pedido único
  let numero = String(cuerpo.numeroPedido || generarNumeroPedido())
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (numero.length < 4 || numero.length > 12) {
    return errorJson('El número de pedido debe tener entre 4 y 12 caracteres alfanuméricos.', 400, request);
  }
  const { data: duplicado } = await db.from('oms_pedidos').select('id').eq('numero', numero).limit(1);
  if (duplicado && duplicado.length > 0) {
    return errorJson('Ese número de pedido ya existe. Genera uno nuevo.', 400, request);
  }

  const texto = (campo: string, max: number) => String(datosEnvio[campo] || '').trim().slice(0, max);
  const cliente = {
    nombre: texto('nombre', 60),
    apellidos: texto('apellidos', 60),
    email: texto('email', 120) || distribuidor.email,
    telefono: texto('telefono', 30),
    direccion: texto('direccion', 200),
    cp: texto('cp', 10),
    poblacion: texto('poblacion', 100),
    provincia: texto('provincia', 100),
    pais: texto('pais', 60) || 'España',
  };

  const obligatorios: Array<[string, string]> = [
    ['nombre', cliente.nombre],
    ['dirección', cliente.direccion],
    ['código postal', cliente.cp],
    ['población', cliente.poblacion],
    ['provincia', cliente.provincia],
  ];
  const faltan = obligatorios.filter(([, valor]) => !valor).map(([campo]) => campo);
  if (faltan.length > 0) {
    return errorJson(`Faltan datos para el envío: ${faltan.join(', ')}.`, 400, request);
  }

  // 6 · URLs de retorno (página de confirmación de la zona distribuidor)
  const origenWeb = request.headers.get('origin') || 'https://omshaddai.com';
  const urlOk = String(redsys.urlOk || '') || `${origenWeb}/pago-ok.html`;
  const urlKo = String(redsys.urlKo || '') || `${origenWeb}/pago-ko.html`;
  const urlNotificacion = String(redsys.urlNotificacion || '') ||
    `${Deno.env.get('SUPABASE_URL')}/functions/v1/oms-redsys-notificacion`;

  // 7 · Parámetros y firma HMAC_SHA256_V1 (mismo módulo Redsys)
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

  // 8 · Pedido del distribuidor (canal='distribuidor'; sin tocar el flujo cliente)
  const { data: pedidoCreado, error: errorPedido } = await db
    .from('oms_pedidos')
    .insert({
      numero,
      cliente,
      subtotal,
      envio: costeEnvio,
      total,
      metodo,
      estado: 'pendiente',
      cupon: null,
      canal: 'distribuidor',
      distribuidor_id: distribuidor.id,
      descuento_pct: descuentoPct,
    })
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
  await db.from('oms_pedidos_lineas').insert(lineasInsert);

  return new Response(
    JSON.stringify({
      numeroPedido: numero,
      url: URLS_REDSYS[String(redsys.entorno || 'test')] || URLS_REDSYS.test,
      version: 'HMAC_SHA256_V1',
      parametrosB64,
      firma,
      parametros,
      resumen: {
        subtotal,
        envio: costeEnvio,
        total,
        descuento: descuentoPct,
        articulos: lineas,
      },
      pedidoId: pedidoCreado.id,
    }),
    { headers: cabeceras(request) }
  );
});
