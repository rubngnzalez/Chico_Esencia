'use strict';

const crypto = require('crypto');

function claveDeOperacion(claveBase64, numeroPedido) {
  let clave = Buffer.from(String(claveBase64 || ''), 'base64');
  if (clave.length === 0) {
    throw new Error('La clave secreta de Redsys no está configurada.');
  }
  if (clave.length > 24) clave = clave.subarray(0, 24);
  if (clave.length < 24) {
    const completa = Buffer.alloc(24);
    clave.copy(completa, 0);
    if (clave.length === 16) {
      clave.copy(completa, 16, 0, 8);
    } else {
      completa.fill(0, clave.length);
    }
    clave = completa;
  }
  const cifrador = crypto.createCipheriv('des-ede3', clave, null);
  cifrador.setAutoPadding(true);
  return Buffer.concat([cifrador.update(String(numeroPedido), 'utf8'), cifrador.final()]);
}

function firmarParametros(parametrosB64, numeroPedido, claveBase64) {
  const derivada = claveDeOperacion(claveBase64, numeroPedido);
  return crypto
    .createHmac('sha256', derivada)
    .update(String(parametrosB64) + String(numeroPedido), 'utf8')
    .digest('base64');
}

function normalizarFirma(firma) {
  return String(firma || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
}

function verificarNotificacion(cuerpo, claveBase64) {
  const parametrosRecibidos = cuerpo.Ds_Merchant_Parameters || cuerpo.DS_MERCHANT_PARAMETERS;
  const firmaRecibida = normalizarFirma(cuerpo.Ds_Signature || cuerpo.DS_MERCHANT_SIGNATURE);
  const version = cuerpo.Ds_Signature_Version || cuerpo.DS_MERCHANT_SIGNATUREVERSION;

  if (!parametrosRecibidos || !firmaRecibida) {
    return { ok: false, motivo: 'Faltan parámetros de la notificación.' };
  }
  if (version && version !== 'HMAC_SHA256_V1') {
    return { ok: false, motivo: 'Versión de firma no soportada.' };
  }

  let datos;
  try {
    datos = JSON.parse(Buffer.from(parametrosRecibidos, 'base64').toString('utf8'));
  } catch {
    return { ok: false, motivo: 'Los parámetros recibidos no son válidos.' };
  }

  const pedido = datos.Ds_Order || datos.DS_MERCHANT_ORDER || '';
  if (!pedido) {
    return { ok: false, motivo: 'La notificación no incluye número de pedido.' };
  }

  const firmaEsperada = firmarParametros(parametrosRecibidos, pedido, claveBase64);
  const bufA = Buffer.from(normalizarFirma(firmaEsperada));
  const bufB = Buffer.from(firmaRecibida);
  const valida = bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

  if (!valida) {
    return { ok: false, motivo: 'La firma de la notificación no es válida.' };
  }

  const respuesta = parseInt(String(datos.Ds_Response ?? datos.DS_RESPONSE ?? '99999'), 10);
  return {
    ok: true,
    datos,
    autorizado: Number.isFinite(respuesta) && respuesta >= 0 && respuesta < 100,
    respuesta,
    pedido,
    importe: parseInt(String(datos.Ds_Amount ?? '0'), 10) || 0,
    autorizacion: datos.Ds_AuthorisationCode || '',
  };
}

function generarNumeroPedido() {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return (
    String(d.getFullYear()).slice(2) +
    dos(d.getMonth() + 1) +
    dos(d.getDate()) +
    dos(d.getHours()) +
    dos(d.getMinutes()) +
    dos(d.getSeconds())
  );
}

module.exports = { claveDeOperacion, firmarParametros, verificarNotificacion, generarNumeroPedido };
