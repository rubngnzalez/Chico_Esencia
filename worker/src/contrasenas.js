// Contraseñas con PBKDF2-SHA256 vía Web Crypto (bcrypt excede los límites de
// CPU del plan gratis de Workers). Formato almacenado:
//   pbkdf2$<iteraciones>$<salt base64>$<hash base64>

const ITERACIONES = 200000;
const LONGITUD_HASH = 256; // bits

const codificador = new TextEncoder();

function aBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario);
}

function deBase64(texto) {
  const binario = atob(texto);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

async function derivar(contrasena, salt, iteraciones) {
  const claveMaterial = await crypto.subtle.importKey('raw', codificador.encode(contrasena), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteraciones },
    claveMaterial,
    LONGITUD_HASH
  );
}

export async function hashContrasena(contrasena) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivar(String(contrasena), salt, ITERACIONES);
  return `pbkdf2$${ITERACIONES}$${aBase64(salt)}$${aBase64(hash)}`;
}

export async function verificarContrasena(contrasena, almacenado) {
  if (typeof almacenado !== 'string' || !almacenado.startsWith('pbkdf2$')) return false;
  const partes = almacenado.split('$');
  if (partes.length !== 4) return false;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1 || iteraciones > 10000000) return false;
  let salt;
  let hashGuardado;
  try {
    salt = deBase64(partes[2]);
    hashGuardado = deBase64(partes[3]);
  } catch {
    return false;
  }
  const hash = new Uint8Array(await derivar(String(contrasena), salt, iteraciones));
  if (hash.length !== hashGuardado.length) return false;
  let diferencia = 0;
  for (let i = 0; i < hash.length; i++) diferencia |= hash[i] ^ hashGuardado[i];
  return diferencia === 0;
}
