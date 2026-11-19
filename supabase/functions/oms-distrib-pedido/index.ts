// Edge Function «oms-distrib-pedido» — proforma por transferencia bancaria
// para distribuidores aceptados (zona VIP). Crea el pedido «pendiente» con
// método «transferencia» (sin pasar por Redsys), calcula los importes con el
// % de descuento del distribuidor EN SERVIDOR y envía el correo de marca con
// los datos de transferencia.
//
// El pago se marca desde el panel (Pedidos → estado «pagado»): el trigger
// existente descuenta el stock y asigna el número público; el guard de
// seguimientos evita los correos post-venta de clientes para este canal.
//
// Despliegue: npx supabase functions deploy oms-distrib-pedido

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cabeceras, errorJson, sobreMarca, plantillaDe, cargarAjustesDistrib, enviarCorreo, escaparHtml, ipDe } from './correo.ts';

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

// Número de proforma: DIST + fecha compacta + 4 dígitos aleatorios
function numeroProforma(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  const fecha = `${String(d.getFullYear()).slice(2)}${dos(d.getMonth() + 1)}${dos(d.getDate())}`;
  const azar = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `DIST${fecha}${azar}`;
}

async function distribuidorDeSesion(db: any, token: string, urlSupabase: string, claveServicio: string) {
  const anon = createClient(urlSupabase, Deno.env.get('SUPABASE_ANON_KEY') || claveServicio, {
    auth: { persistSession: false },
  });
  const { data: datosUsuario, error: errorToken } = await anon.auth.getUser(token);
  if (errorToken || !datosUsuario?.user) return null;
  const { data: filas } = await db
    .from('oms_distribuidores')
    .select('id, empresa, email, persona_contacto, descuento_pct, acceso_habilitado')
    .eq('user_id', datosUsuario.user.id)
    .limit(1);
  const distribuidor = (filas || [])[0] as
    | { id: string; empresa: string; email: string; persona_contacto: string; descuento_pct: number; acceso_habilitado: boolean }
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

  let cuerpo: { articulos?: unknown; envio?: Record<string, unknown>; comentario?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const articulos = Array.isArray(cuerpo.articulos) ? cuerpo.articulos : [];
  if (articulos.length === 0 || articulos.length > 100) {
    return errorJson('El pedido debe incluir entre 1 y 100 artículos.', 400, request);
  }

  const { data: filaAjustes, error: errorAjustes } = await db
    .from('oms_ajustes')
    .select('envio')
    .eq('id', 'general')
    .single();
  if (errorAjustes || !filaAjustes) {
    return errorJson('La tienda todavía no tiene ajustes configurados.', 500, request);
  }

  const { data: productos, error: errorProductos } = await db
    .from('oms_productos')
    .select('id, codigo, slug, nombre, precio, precio_oferta, activo, zonas_envio');
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

  const envioAjustes = (filaAjustes.envio || {}) as Record<string, unknown>;
  const datosEnvio = (cuerpo.envio || {}) as Record<string, unknown>;
  const zonaEnvio = zonaDePais(String(datosEnvio.pais || 'España'), envioAjustes.paises);
  const descuentoPct = Math.min(100, Math.max(0, Number(distribuidor.descuento_pct) || 0));
  const factorDistribuidor = 1 - descuentoPct / 100;

  const lineas: Array<{ codigo: string; nombre: string; cantidad: number; precioUnitario: number }> = [];
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
    if (!producto || producto.activo === false) {
      return errorJson(`El artículo «${buscado || String(articulo.nombre || '?')}» no está disponible.`, 400, request);
    }
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
      codigo: String(producto.codigo || ''),
      nombre: String(producto.nombre),
      cantidad,
      precioUnitario: Math.round(precio * factorDistribuidor * 100) / 100,
    });
  }

  const subtotal = Math.round(lineas.reduce((suma, l) => suma + l.precioUnitario * l.cantidad, 0) * 100) / 100;

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
  const faltan = [
    ['nombre', cliente.nombre],
    ['dirección', cliente.direccion],
    ['código postal', cliente.cp],
    ['población', cliente.poblacion],
    ['provincia', cliente.provincia],
  ].filter(([, valor]) => !valor).map(([campo]) => campo);
  if (faltan.length > 0) {
    return errorJson(`Faltan datos para el envío: ${faltan.join(', ')}.`, 400, request);
  }

  // Número único de proforma (reintentos ante colisión)
  let numero = '';
  for (let intento = 0; intento < 5; intento++) {
    const candidato = numeroProforma();
    const { data: choca } = await db.from('oms_pedidos').select('id').eq('numero', candidato).limit(1);
    if (!choca || choca.length === 0) {
      numero = candidato;
      break;
    }
  }
  if (!numero) return errorJson('No se pudo generar el número de pedido. Inténtalo de nuevo.', 500, request);

  const { data: pedidoCreado, error: errorPedido } = await db
    .from('oms_pedidos')
    .insert({
      numero,
      cliente,
      subtotal,
      envio: costeEnvio,
      total,
      metodo: 'transferencia',
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
  await db.from('oms_pedidos_lineas').insert(
    lineas.map((l) => ({
      pedido: pedidoCreado.id,
      codigo: l.codigo,
      nombre: l.nombre,
      cantidad: l.cantidad,
      precio_unitario: l.precioUnitario,
    }))
  );

  // Correo de marca con los datos de transferencia
  const ajustes = await cargarAjustesDistrib(db);
  const distribucion = ajustes.distribucion as Record<string, unknown>;
  const iban = String(distribucion.iban || '');
  const infoTransferencia = String(distribucion.transferenciaInfo || '');
  const datosTransferencia = [
    iban ? `<p><strong>IBAN / cuenta:</strong> ${escaparHtml(iban)}</p>` : '',
    infoTransferencia ? `<p>${escaparHtml(infoTransferencia)}</p>` : '',
  ].join('');
  const listaArticulos = `<ul>${lineas
    .map(
      (l) =>
        `<li>${l.cantidad} × ${escaparHtml(l.nombre)} — ${l.precioUnitario.toFixed(2).replace('.', ',')} €</li>`
    )
    .join('')}</ul>`;
  const totalTexto = `${total.toFixed(2).replace('.', ',')} €`;

  const plantilla = plantillaDe(ajustes.distribucion, 'proformaCreada', {
    persona_contacto: escaparHtml(distribuidor.persona_contacto || cliente.nombre),
    numero_pedido: escaparHtml(numero),
    articulos: listaArticulos,
    descuento: String(descuentoPct),
    total: totalTexto,
    transferencia: datosTransferencia || '<p>Te enviaremos los datos de transferencia por correo.</p>',
  }, {
    asunto: 'Tu pedido por transferencia {{numero_pedido}} — SHADDAI',
    html: '<p>Hola, {{persona_contacto}}:</p><p>Hemos registrado tu pedido <strong>{{numero_pedido}}</strong> pendiente de transferencia.</p><ul>{{articulos}}</ul><p><strong>Total con tu descuento ({{descuento}}%): {{total}}</strong></p><p>{{transferencia}}</p><p>SHADDAI · Esencia de Umbral</p>',
  });

  await enviarCorreo(
    db,
    Deno.env.get('RESEND_API_KEY'),
    ajustes.desde,
    cliente.email,
    plantilla.asunto,
    sobreMarca(plantilla.html, ajustes.logotipo),
    ajustes.responderA,
    numero
  );

  return new Response(
    JSON.stringify({
      ok: true,
      numeroPedido: numero,
      pedidoId: pedidoCreado.id,
      resumen: { subtotal, envio: costeEnvio, total, descuento: descuentoPct, articulos: lineas },
      transferencia: { iban, info: infoTransferencia },
      mensaje: 'Proforma registrada. El pedido se prepara al confirmarse la transferencia.',
    }),
    { headers: cabeceras(request) }
  );
});
