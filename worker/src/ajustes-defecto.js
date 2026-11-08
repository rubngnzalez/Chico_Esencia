// Valores y plantillas por defecto de los ajustes (puerto de
// servidor/src/ajustes-defecto.js). La sección smtp se conserva por
// compatibilidad; el envío real en el Worker usa Resend si hay RESEND_API_KEY.

const PLANTILLA_CONFIRMACION = `<div style="font-family:Georgia,serif;color:#16261b;max-width:560px;margin:0 auto;padding:24px;">
  <p style="letter-spacing:.3em;text-transform:uppercase;font-size:.7rem;color:#c9a45f;margin:0 0 8px;">SHADDAI · Esencia de Umbral</p>
  <h1 style="font-weight:500;font-size:1.6rem;margin:0 0 16px;">Gracias, {{nombre}}: tu pedido {{pedido}} está confirmado</h1>
  <p style="line-height:1.7;">Hemos recibido tu reserva. Prepararemos tu pedido a mano, con el cuidado de siempre, y te escribiremos cuando esté en camino.</p>
  <div style="background:#f3eee2;padding:16px 20px;margin:20px 0;border-left:3px solid #c9a45f;">
    <p style="margin:0 0 8px;"><strong>Pedido:</strong> {{pedido}}</p>
    <p style="margin:0 0 8px;"><strong>Artículos:</strong></p>
    {{articulos}}
    <p style="margin:12px 0 0;font-size:1.1rem;"><strong>Total:</strong> {{total}}</p>
  </div>
  <p style="line-height:1.7;">Inhala el origen, exhala tu esencia.</p>
  <p style="color:#6b7a6e;font-size:.85rem;">SHADDAI · Esencia de Umbral — Que nos busquen por dentro.</p>
</div>`;

const PLANTILLA_AGRADECIMIENTO = `<div style="font-family:Georgia,serif;color:#16261b;max-width:560px;margin:0 auto;padding:24px;">
  <p style="letter-spacing:.3em;text-transform:uppercase;font-size:.7rem;color:#c9a45f;margin:0 0 8px;">SHADDAI · Esencia de Umbral</p>
  <h1 style="font-weight:500;font-size:1.6rem;margin:0 0 16px;">Gracias, {{nombre}}</h1>
  <p style="line-height:1.7;">Cada frasco se prepara a mano, en pequeños lotes numerados. Gracias por honrar los tiempos de la verdadera artesanía y por buscarte por dentro.</p>
  <p style="line-height:1.7;">Cuando tu pedido {{pedido}} llegue a tus manos, detente un momento: inhala, exhala, y vuelve a tu umbral.</p>
  <p style="color:#6b7a6e;font-size:.85rem;">SHADDAI · Esencia de Umbral — Inhala · Exhala</p>
</div>`;

export const ajustesPorDefecto = {
  contacto: {
    emailsDestino: ['hola@shaddai.es'],
    telefono: '',
    direccion: '',
    horario: 'Respondemos en 24–48 h laborables.',
  },
  redes: {
    instagram: '',
    tiktok: '',
    pinterest: '',
    facebook: '',
    youtube: '',
    whatsapp: '',
  },
  smtp: {
    host: '',
    puerto: 587,
    usuario: '',
    contraseña: '',
    desde: 'SHADDAI · Esencia de Umbral <hola@shaddai.es>',
    activo: false,
  },
  redsys: {
    fuc: '999008889',
    terminal: '1',
    moneda: '978',
    entorno: 'test',
    clave: 'sq7HjrUOBf2m7spUjazlA',
    nombreComercio: 'SHADDAI · Esencia de Umbral',
    urlOk: '',
    urlKo: '',
    urlNotificacion: '',
    metodoTarjeta: true,
    metodoBizum: true,
  },
  envio: {
    activo: true,
    plazos: 'Preparación artesanal por orden de solicitud. Envío peninsular en las semanas siguientes a cada lote.',
    zonas: {
      espana: { coste: 5.9, gratisDesde: 100 },
      unionEuropea: { coste: 7.9, gratisDesde: 0 },
      latinoamerica: { coste: 9.9, gratisDesde: 0 },
      resto: { coste: 9.9, gratisDesde: 0 },
    },
    paises: {
      unionEuropea: ['Portugal', 'Francia', 'Andorra', 'Alemania', 'Italia', 'Reino Unido', 'Países Bajos', 'Bélgica'],
      latinoamerica: ['México', 'Argentina', 'Colombia', 'Chile'],
      resto: ['Estados Unidos', 'Otro país'],
    },
    disponibilidad: {
      espana: [],
      unionEuropea: ['esencia-umbral-50', 'duo-ritual', 'Balsamo-solido'],
      latinoamerica: ['Balsamo-solido', 'perfume-solido', 'Balsamo-solido-natural-12-g'],
      resto: [],
    },
  },
  'emails-automaticos': {
    confirmacionCompra: {
      activo: true,
      asunto: 'Pedido {{pedido}} confirmado — SHADDAI · Esencia de Umbral',
      html: PLANTILLA_CONFIRMACION,
    },
    agradecimiento: {
      activo: true,
      asunto: 'Gracias por tu compra, {{nombre}}',
      html: PLANTILLA_AGRADECIMIENTO,
    },
  },
  notificaciones: {
    email: 'hola@shaddai.es',
    nuevoPedido: true,
    nuevoContacto: true,
    nuevoMensaje: true,
  },
  // Inventario de la configuración hardcodeada en el repo (pestaña Sistema,
  // solo admin). Es copia de consulta: la fuente real están los ficheros.
  sistema: {
    supabaseUrl: 'https://zjzqbugpdpfuttdwagai.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqenFidWdwZHBmdXR0ZHdhZ2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTUxOTIsImV4cCI6MjA5NzE3MTE5Mn0.Z9yr-0aBTwQyyurC-V4-hJ01nRxpbhz-MTkW7pVDZDA',
    supabaseRef: 'zjzqbugpdpfuttdwagai',
    apiWorkerUrl: 'https://shaddai-panel.redes-301dpi.workers.dev',
    dominioWeb: 'omshaddai.com',
    d1Database: 'shaddai · 892de753-37a5-4361-bfa2-84d62b46689b',
    secretosWorker: 'SECRETO_SESION · RESEND_API_KEY (solo con «npx wrangler secret put …»)',
    redsysComercio: '372022558',
    redsysTerminal: '1',
    redsysMoneda: '978',
    redsysEntorno: 'test',
    redsysClave: 'sq7HjrUOBfKmC576ILgskD5srU870gJ7',
    redsysUrlTest: 'https://sis-t.redsys.es:25443/sis/realizarPago',
    redsysUrlProduccion: 'https://sis.redsys.es/sis/realizarPago',
    redsysFucPruebas: '999008889',
    redsysClavePruebas: 'sq7HjrUOBf2m7spUjazlA',
    githubRepo: 'https://github.com/rubngnzalez/Chico_Esencia',
    githubRama: 'main',
    despliegue: 'GitHub Pages (web + /admin) · Cloudflare Worker (API + /panel)',
    emailGeneral: 'hola@shaddai.es',
    emailPedidos: 'Pedidos@shaddai.es',
  },
};

export function ajustesIniciales() {
  return JSON.parse(JSON.stringify(ajustesPorDefecto));
}

// En el Worker, «SMTP activo» significa que hay RESEND_API_KEY configurada
// como secreto; la sección smtp se guarda para futura compatibilidad.
export function envioDisponible(env) {
  return Boolean(env && env.RESEND_API_KEY);
}

export function direccionDesde(ajustes) {
  return (
    (ajustes.smtp && ajustes.smtp.desde) ||
    'SHADDAI · Esencia de Umbral <sin-configurar@omshaddai.com>'
  );
}
