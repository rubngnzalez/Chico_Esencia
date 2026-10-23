'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { requerirRol, requerirSinCambioPendiente } = require('../seguridad');

const RAIZ_WEB = path.join(__dirname, '..', '..', '..', 'shaddai-web');
const CARPETA_SUBIDAS = path.join(RAIZ_WEB, 'img', 'subidas');
const LIMITE_BYTES = 5 * 1024 * 1024;

// Formatos admitidos: se guarda el original, sin conversión
const FORMATOS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// Detecta el tipo real del archivo por sus bytes mágicos (no se confía en el nombre)
function detectarTipo(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.length >= 12 && buffer.slice(0, 4).toString('latin1') === 'RIFF' && buffer.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const enrutador = express.Router();

enrutador.post('/', requerirRol('admin', 'editor'), requerirSinCambioPendiente, (req, res) => {
  const cuerpo = req.body || {};
  const datos = typeof cuerpo.datos === 'string' ? cuerpo.datos : '';
  if (!datos) {
    return res.status(400).json({ error: 'Faltan los datos de la imagen (campo «datos» en base64).' });
  }

  const base64 = datos.includes(',') ? datos.slice(datos.indexOf(',') + 1) : datos;
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Los datos de la imagen no son un base64 válido.' });
  }
  if (buffer.length === 0) {
    return res.status(400).json({ error: 'La imagen está vacía.' });
  }
  if (buffer.length > LIMITE_BYTES) {
    return res.status(400).json({ error: 'La imagen supera el límite de 5 MB.' });
  }

  const tipo = detectarTipo(buffer);
  if (!tipo) {
    return res.status(400).json({ error: 'Formato de imagen no admitido: usa JPEG, PNG o WebP.' });
  }

  fs.mkdirSync(CARPETA_SUBIDAS, { recursive: true });
  const nombre = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${FORMATOS[tipo]}`;
  fs.writeFileSync(path.join(CARPETA_SUBIDAS, nombre), buffer);

  res.status(201).json({
    ok: true,
    ruta: `img/subidas/${nombre}`,
    url: `/img/subidas/${nombre}`,
    tipo,
    bytes: buffer.length,
  });
});

module.exports = enrutador;
