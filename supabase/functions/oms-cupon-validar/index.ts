// Edge Function «cupon-validar» — comprueba un código de descuento SIN crear
// pedido ni consumir uso. La llama el checkout antes de pagar para mostrar el
// descuento real. La misma validación la repite «oms-pagos-firma» al firmar,
// así que el importe cobrado siempre está recalculado en servidor.
//
// Recibe:  { cupon: "PRIMAVERA10", articulos: [{codigo|slug|id, nombre?, cantidad}], pais: "España" }
// Devuelve { ok: true, cupon: {codigo, tipo, valor, importe}, resumen: {subtotal, envio, descuento, total} }
//          o { error: "motivo" } con HTTP 400/500.
//
// Despliegue: npx supabase functions deploy oms-cupon-validar

import { createClient } from 'npm:@supabase/supabase-js@2';

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

function errorJson(mensaje: string, estado = 400, request?: Request): Response {
  return new Response(JSON.stringify({ error: mensaje, ok: false }), { status: estado, headers: cabeceras(request) });
}

// Zonas de envío (Ajustes → Envío): país del checkout → clave de zona.
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

function costeDeEnvio(subtotal: number, envioAjustes: Record<string, unknown>, zona: string): number {
  if (envioAjustes.activo === false || subtotal <= 0) return 0;
  const zonas = (envioAjustes.zonas || {}) as Record<string, Record<string, unknown>>;
  const zonaCfg = zonas[zona] || {};
  const reservaCoste = zona === 'espana' ? envioAjustes.coste : (envioAjustes.costeInternacional ?? envioAjustes.coste);
  const reservaGratis = zona === 'espana' ? envioAjustes.gratisDesde : envioAjustes.gratisDesdeInternacional;
  const costeZona = Number(zonaCfg.coste ?? reservaCoste) || 0;
  const gratisDesde = Number(zonaCfg.gratisDesde ?? reservaGratis) || 0;
  if (gratisDesde > 0 && subtotal >= gratisDesde) return 0;
  return Math.round(costeZona * 100) / 100;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') return errorJson('Método no permitido.', 405, request);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return errorJson('La función no está configurada (faltan secretos del proyecto).', 500, request);
  }

  let cuerpo: { cupon?: unknown; articulos?: unknown; pais?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const codigo = String(cuerpo.cupon || '').trim().toUpperCase().slice(0, 40);
  if (!codigo) return errorJson('Escribe el código de descuento.', 400, request);
  const articulos = Array.isArray(cuerpo.articulos) ? cuerpo.articulos : [];
  if (articulos.length === 0) return errorJson('El carrito está vacío.', 400, request);

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // 1 · Ajustes de envío (zonas y costes reales del panel)
  const { data: filaAjustes, error: errorAjustes } = await db
    .from('oms_ajustes')
    .select('envio')
    .eq('id', 'general')
    .single();
  if (errorAjustes || !filaAjustes) {
    return errorJson('La tienda todavía no tiene ajustes configurados.', 500, request);
  }
  const envioAjustes = (filaAjustes.envio || {}) as Record<string, unknown>;

  // 2 · Cupón desde la base de datos (service_role ignora RLS)
  const { data: cupon, error: errorCupon } = await db
    .from('oms_cupones')
    .select('codigo, tipo, valor, minimo_subtotal, inicio, fin, usos_maximos, usos, activo')
    .eq('codigo', codigo)
    .maybeSingle();
  if (errorCupon) return errorJson('No se pudo comprobar el cupón.', 500, request);
  if (!cupon) return errorJson('El cupón no existe. Revisa el código.', 400, request);
  const cuponInfo = cupon as {
    codigo: string;
    tipo: string;
    valor: number;
    minimo_subtotal: number;
    inicio: string | null;
    fin: string | null;
    usos_maximos: number | null;
    usos: number;
    activo: boolean;
  };

  // 3 · Vigencia y límites
  if (!cuponInfo.activo) return errorJson('Este cupón no está activo.', 400, request);
  const ahoraMs = Date.now();
  if (cuponInfo.inicio && Date.parse(cuponInfo.inicio) > ahoraMs) {
    return errorJson('Este cupón aún no está disponible.', 400, request);
  }
  if (cuponInfo.fin && ahoraMs > Date.parse(cuponInfo.fin)) {
    return errorJson('Este cupón ha caducado.', 400, request);
  }
  if (cuponInfo.usos_maximos != null && cuponInfo.usos >= cuponInfo.usos_maximos) {
    return errorJson('Este cupón ha agotado sus usos.', 400, request);
  }

  // 4 · Subtotal real EN SERVIDOR (mismo cálculo que la firma del pago)
  const { data: productos, error: errorProductos } = await db
    .from('oms_productos')
    .select('id, codigo, slug, nombre, precio, precio_oferta, stock, activo');
  if (errorProductos || !productos) return errorJson('No se pudo leer el catálogo.', 500, request);
  const { data: ofertas } = await db
    .from('oms_ofertas')
    .select('producto, tipo, valor, inicio, fin, activa');

  const ofertaActiva = (o: { activa: boolean; inicio: string | null; fin: string | null }) =>
    Boolean(o.activa) &&
    (!o.inicio || Date.parse(o.inicio) <= ahoraMs) &&
    (!o.fin || ahoraMs <= Date.parse(o.fin));

  let subtotal = 0;
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
    if (!producto || producto.activo === false) continue;
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
    subtotal += precio * cantidad;
  }
  subtotal = Math.round(subtotal * 100) / 100;
  if (subtotal <= 0) return errorJson('No hay artículos válidos para aplicar el cupón.', 400, request);

  // 5 · Mínimo de subtotal exigido por el cupón
  if (Number(cuponInfo.minimo_subtotal) > 0 && subtotal < Number(cuponInfo.minimo_subtotal)) {
    return errorJson(
      `Este cupón necesita un subtotal mínimo de ${Number(cuponInfo.minimo_subtotal).toFixed(2)} €.`,
      400,
      request
    );
  }

  // 6 · Envío y descuento
  const zona = zonaDePais(String(cuerpo.pais || 'España'), envioAjustes.paises);
  const envio = costeDeEnvio(subtotal, envioAjustes, zona);

  let descuento = 0;
  if (cuponInfo.tipo === 'envio') {
    descuento = envio;
  } else if (cuponInfo.tipo === 'porcentaje') {
    descuento = Math.round(subtotal * (Number(cuponInfo.valor) / 100) * 100) / 100;
  } else {
    descuento = Math.min(Number(cuponInfo.valor) || 0, subtotal);
  }
  descuento = Math.max(0, Math.round(descuento * 100) / 100);
  const total = Math.max(0, Math.round((subtotal + envio - descuento) * 100) / 100);

  return new Response(
    JSON.stringify({
      ok: true,
      cupon: {
        codigo: cuponInfo.codigo,
        tipo: cuponInfo.tipo,
        valor: Number(cuponInfo.valor),
        importe: descuento,
      },
      resumen: { subtotal, envio, descuento, total },
    }),
    { headers: cabeceras(request) }
  );
});
