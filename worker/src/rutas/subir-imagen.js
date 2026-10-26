// /api/subir-imagen → guarda en D1 (tabla recursos) y devuelve la URL pública
// relativa /recursos/<clave>. Igual que el Node: base64 (acepta data URL),
// tipo real detectado por bytes mágicos (JPEG/PNG/WebP). Límite 2 MB
// (tamaño máximo de BLOB en D1).

import { requerirRol, requerirSesion } from '../seguridad.js';
import { respuestaJson } from '../utilidades.js';

const LIMITE_BYTES = 2 * 1024 * 1024 - 20000;

const FORMATOS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function detectarTipoImagen(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  )
    return 'image/webp';
  return null;
}

export function registrar(enrutador, cx) {
  enrutador.post('/api/subir-imagen', async (c) => {
    let guard = requerirSesion(c);
    if (guard) return guard;
    guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;

    const cuerpo = c.cuerpo || {};
    const datos = typeof cuerpo.datos === 'string' ? cuerpo.datos : '';
    if (!datos) {
      return respuestaJson({ error: 'Faltan los datos de la imagen (campo «datos» en base64).' }, 400);
    }

    const base64 = datos.includes(',') ? datos.slice(datos.indexOf(',') + 1) : datos;
    let bytes;
    try {
      const binario = atob(base64.replace(/\s+/g, ''));
      bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    } catch {
      return respuestaJson({ error: 'Los datos de la imagen no son un base64 válido.' }, 400);
    }
    if (bytes.length === 0) {
      return respuestaJson({ error: 'La imagen está vacía.' }, 400);
    }
    if (bytes.length > LIMITE_BYTES) {
      return respuestaJson({ error: 'La imagen supera el límite de 2 MB.' }, 400);
    }

    const tipo = detectarTipoImagen(bytes);
    if (!tipo) {
      return respuestaJson({ error: 'Formato de imagen no admitido: usa JPEG, PNG o WebP.' }, 400);
    }

    const aleatorio = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const clave = `${Date.now().toString(36)}-${aleatorio}.${FORMATOS[tipo]}`;
    await c.env.DB.prepare('INSERT INTO recursos (clave, tipo, bytes, creado) VALUES (?, ?, ?, ?)')
      .bind(clave, tipo, bytes, new Date().toISOString())
      .run();

    return respuestaJson(
      {
        ok: true,
        ruta: `recursos/${clave}`,
        url: `/recursos/${clave}`,
        tipo,
        bytes: bytes.length,
      },
      201
    );
  });
}

// GET /recursos/:clave — sirve el BLOB de D1 con caché pública larga
export async function servirRecurso(env, clave) {
  if (!clave || clave.includes('..')) {
    return new Response('Recurso no encontrado.', { status: 404 });
  }
  const fila = await env.DB.prepare('SELECT tipo, bytes FROM recursos WHERE clave = ?')
    .bind(clave)
    .first();
  if (!fila || !fila.bytes) {
    return new Response('Recurso no encontrado.', { status: 404 });
  }
  const binario = typeof fila.bytes === 'string' ? atob(fila.bytes) : null;
  const cuerpo = binario
    ? Uint8Array.from(binario, (ch) => ch.charCodeAt(0))
    : new Uint8Array(fila.bytes);
  return new Response(cuerpo, {
    status: 200,
    headers: {
      'Content-Type': fila.tipo || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
