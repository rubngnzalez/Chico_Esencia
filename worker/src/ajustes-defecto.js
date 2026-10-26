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
    coste: 5.9,
    gratisDesde: 80,
    plazos: 'Preparación artesanal por orden de solicitud. Envío peninsular en las semanas siguientes a cada lote.',
    activo: true,
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
