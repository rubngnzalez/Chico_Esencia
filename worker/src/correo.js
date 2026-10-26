// Correo: envío real con Resend si existe env.RESEND_API_KEY; si no (o si
// falla), guarda el .eml completo en la tabla outbox con estado «pendiente»,
// igual que el servidor Node guardaba en datos/bandeja-salida/.

import { ahora, nuevoId } from './utilidades.js';
import { envioDisponible, direccionDesde } from './ajustes-defecto.js';

export function generarEml(mensaje) {
  const cabeceras = [
    `From: ${mensaje.desde}`,
    `To: ${Array.isArray(mensaje.para) ? mensaje.para.join(', ') : mensaje.para}`,
    `Subject: ${mensaje.asunto}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
    'X-SHADDAI-Estado: pendiente',
    '',
  ];
  return cabeceras.join('\r\n') + mensaje.html + '\r\n';
}

export async function guardarEnOutbox(db, mensaje, extra = {}) {
  const id = nuevoId('out');
  const datos = { ...mensaje, eml: generarEml(mensaje) };
  await db
    .prepare(
      'INSERT INTO outbox (id, estado, pedido, campana, creadoEn, datos) VALUES (?1, ?2, ?3, ?4, ?5, ?6)'
    )
    .bind(id, 'pendiente', extra.pedido || null, extra.campana || null, ahora(), JSON.stringify(datos))
    .run();
  return id;
}

async function enviarConResend(env, mensaje) {
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: mensaje.desde,
      to: Array.isArray(mensaje.para) ? mensaje.para : [mensaje.para],
      subject: mensaje.asunto,
      html: mensaje.html,
      ...(mensaje.responderA ? { reply_to: mensaje.responderA } : {}),
    }),
  });
  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => '');
    throw new Error(`Resend respondió ${respuesta.status}: ${detalle.slice(0, 200)}`);
  }
  const datos = await respuesta.json().catch(() => ({}));
  return datos.id || '';
}

// Devuelve { enviado, pendiente, id?, archivo?, error? } como el Node.
// `extra` etiqueta el correo (p. ej. { pedido } o { campana }) para que el
// panel pueda ofrecer «Descargar .eml».
export async function enviarCorreo(db, env, ajustes, { para, asunto, html, responderA }, extra = {}) {
  const mensaje = {
    para,
    asunto,
    html,
    desde: direccionDesde(ajustes),
    ...(responderA ? { responderA } : {}),
  };

  if (envioDisponible(env)) {
    try {
      const id = await enviarConResend(env, mensaje);
      return { enviado: true, pendiente: false, messageId: id, aceptados: para, rechazados: [] };
    } catch (error) {
      const archivo = await guardarEnOutbox(db, mensaje, extra);
      return { enviado: false, pendiente: true, archivo, error: error.message };
    }
  }

  const archivo = await guardarEnOutbox(db, mensaje, extra);
  return { enviado: false, pendiente: true, archivo };
}

export function reemplazarVariables(plantilla, variables) {
  let texto = String(plantilla || '');
  for (const [clave, valor] of Object.entries(variables || {})) {
    texto = texto.split(`{{${clave}}}`).join(valor == null ? '' : String(valor));
  }
  return texto;
}

export function listaArticulosHtml(articulos) {
  const lineas = (articulos || [])
    .map((a) => `<li>${a.cantidad} × ${a.nombre} — ${Number(a.precioUnitario || 0).toFixed(2)} €</li>`)
    .join('');
  return `<ul style="padding-left:18px;margin:8px 0;">${lineas}</ul>`;
}
