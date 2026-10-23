'use strict';

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { CARPETA_SALIDA } = require('./almacen');
const { smptActivo } = require('./ajustes-defecto');

const slugAsunto = (asunto) =>
  String(asunto || 'sin-asunto')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

function guardarEml(mensaje) {
  const nombre = `${Date.now()}-${slugAsunto(mensaje.asunto)}.eml`;
  const ruta = path.join(CARPETA_SALIDA, nombre);
  const cabeceras = [
    `From: ${mensaje.desde}`,
    `To: ${Array.isArray(mensaje.para) ? mensaje.para.join(', ') : mensaje.para}`,
    `Subject: ${mensaje.asunto}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
    `X-SHADDAI-Estado: pendiente`,
    '',
  ];
  fs.mkdirSync(CARPETA_SALIDA, { recursive: true });
  fs.writeFileSync(ruta, cabeceras.join('\r\n') + mensaje.html + '\r\n', 'utf8');
  return ruta;
}

function transporterDesdeAjustes(smtp) {
  const puerto = Number(smtp.puerto) || 587;
  return nodemailer.createTransport({
    host: smtp.host,
    port: puerto,
    secure: puerto === 465,
    auth: { user: smtp.usuario, pass: smtp.contraseña },
  });
}

async function enviarCorreo(ajustes, { para, asunto, html, responderA }) {
  const smtp = ajustes.smtp;
  if (!smptActivo(smtp)) {
    const archivo = guardarEml({ para, asunto, html, desde: smtp.desde || 'SHADDAI <sin-configurar@omshaddai.com>' });
    return { enviado: false, pendiente: true, archivo };
  }
  try {
    const transporter = transporterDesdeAjustes(smtp);
    const resultado = await transporter.sendMail({
      from: smtp.desde,
      to: Array.isArray(para) ? para.join(', ') : para,
      subject: asunto,
      html,
      replyTo: responderA || undefined,
    });
    const rechazados = (resultado.rejected || []).map((r) => (typeof r === 'string' ? r : r.address));
    return {
      enviado: rechazados.length === 0,
      pendiente: false,
      messageId: resultado.messageId,
      aceptados: resultado.accepted || [],
      rechazados,
    };
  } catch (error) {
    const archivo = guardarEml({ para, asunto, html, desde: smtp.desde });
    return { enviado: false, pendiente: true, archivo, error: error.message };
  }
}

function reemplazarVariables(plantilla, variables) {
  let texto = String(plantilla || '');
  for (const [clave, valor] of Object.entries(variables || {})) {
    texto = texto.split(`{{${clave}}}`).join(valor == null ? '' : String(valor));
  }
  return texto;
}

function listaArticulosHtml(articulos) {
  const lineas = (articulos || [])
    .map((a) => `<li>${a.cantidad} × ${a.nombre} — ${a.precioUnitario.toFixed(2)} €</li>`)
    .join('');
  return `<ul style="padding-left:18px;margin:8px 0;">${lineas}</ul>`;
}

module.exports = { enviarCorreo, reemplazarVariables, listaArticulosHtml, guardarEml };
