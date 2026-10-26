// Sesión con cookie firmada HMAC-SHA256, roles y rate-limit persistente en D1.
// Puerto de servidor/src/seguridad.js: mismos nombres de cookie, mensajes y
// formatos de respuesta. El secreto vive en env.SECRETO_SESION (en desarrollo
// local, sin ese secreto, se usa uno fijo de desarrollo).

import { respuestaJson, comparacionSegura } from './utilidades.js';

export const NOMBRE_COOKIE = 'shaddai_sesion';
export const DURACION_MS = 7 * 24 * 60 * 60 * 1000;
const SECRETO_DESARROLLO = 'shaddai-secreto-desarrollo-local-solo-pruebas';

const codificador = new TextEncoder();

const base64url = (texto) =>
  btoa(String(texto)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmacSha256(secreto, valor) {
  const clave = await crypto.subtle.importKey(
    'raw',
    codificador.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', clave, codificador.encode(String(valor)));
  return new Uint8Array(firma);
}

async function firmarValor(secreto, valor) {
  const bytes = await hmacSha256(secreto, valor);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return base64url(btoa(binario));
}

export async function crearToken(secreto, uid) {
  const payload = base64url(JSON.stringify({ uid, exp: Date.now() + DURACION_MS }));
  return `${payload}.${await firmarValor(secreto, payload)}`;
}

export async function verificarToken(secreto, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = await firmarValor(secreto, payload);
  if (!comparacionSegura(firma, esperada)) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const datos = JSON.parse(json);
    if (!datos.uid || typeof datos.exp !== 'number' || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

export function leerCookies(request) {
  const cabecera = request.headers.get('Cookie');
  const cookies = {};
  if (!cabecera) return cookies;
  for (const parte of cabecera.split(';')) {
    const indice = parte.indexOf('=');
    if (indice === -1) continue;
    const nombre = parte.slice(0, indice).trim();
    const valor = parte.slice(indice + 1).trim();
    if (nombre) {
      try {
        cookies[nombre] = decodeURIComponent(valor);
      } catch {
        cookies[nombre] = valor;
      }
    }
  }
  return cookies;
}

export function obtenerSecreto(env) {
  return env.SECRETO_SESION || SECRETO_DESARROLLO;
}

export async function adjuntarUsuario(coleccionUsuarios, env, request) {
  const cookies = leerCookies(request);
  const token = cookies[NOMBRE_COOKIE];
  if (!token) return null;
  const sesion = await verificarToken(obtenerSecreto(env), token);
  if (!sesion) return null;
  const usuario = await coleccionUsuarios.porId(sesion.uid);
  if (!usuario || usuario.activo === false) return null;
  return usuario;
}

export async function cabeceraSetCookie(secreto, uid) {
  const token = await crearToken(secreto, uid);
  return `${NOMBRE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}`;
}

export const CABECERA_BORRAR_COOKIE = `${NOMBRE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

// ─── Guardas de sesión y rol (devuelven una Response o null) ────────────────

export function requerirSesion(cx) {
  if (!cx.usuario) return error401();
  return null;
}

export function requerirRol(cx, ...roles) {
  if (!cx.usuario) return error401();
  if (!roles.includes(cx.usuario.rol)) return error403();
  return null;
}

function error401() {
  return respuestaJson({ error: 'Debes iniciar sesión para realizar esta acción.' }, 401);
}

function error403(extra = {}) {
  return respuestaJson({ error: 'No tienes permisos para realizar esta acción.' , ...extra}, 403);
}

export function quitarHash(usuario) {
  if (!usuario) return null;
  const { hashContrasena, ...resto } = usuario;
  return resto;
}

// Bloqueo idéntico al Node: usuario con debeCambiarContrasena no puede usar
// ninguna ruta de la API salvo /api/auth/*.
export function requerirSinCambio(cx, rutaApi) {
  if (cx.usuario && cx.usuario.debeCambiarContrasena && !rutaApi.startsWith('/api/auth/')) {
    return respuestaJson(
      {
        error: 'Debes cambiar tu contraseña temporal antes de continuar.',
        debeCambiarContrasena: true,
      },
      403
    );
  }
  return null;
}

// ─── Rate-limit persistente en D1 (ventana por IP + ruta) ───────────────────
// Igual que el limitador del Node: cuenta intentos en una ventana; al superar
// el máximo bloquea; mientras bloquea responde 429 con Retry-After.

let ultimaLimpieza = 0;

async function limpiarAntiguos(db) {
  const instante = Date.now();
  if (instante - ultimaLimpieza < 60000) return;
  ultimaLimpieza = instante;
  try {
    await db
      .prepare('DELETE FROM rate_limit WHERE ultimo < ?1')
      .bind(instante - 30 * 60 * 1000)
      .run();
  } catch {}
}

export async function limitar(db, clave, intentosMaximos, ventanaMs, bloqueoMs) {
  await limpiarAntiguos(db);
  const instante = Date.now();
  const fila = await db
    .prepare('SELECT intentos, ventanaInicio, bloqueadoHasta FROM rate_limit WHERE clave = ?1')
    .bind(clave)
    .first();

  if (fila && fila.bloqueadoHasta > instante) {
    const segundos = Math.ceil((fila.bloqueadoHasta - instante) / 1000);
    return { bloqueado: true, segundos };
  }

  let intentos = 1;
  let ventanaInicio = instante;
  if (fila && instante - fila.ventanaInicio < ventanaMs) {
    intentos = (fila.intentos || 0) + 1;
    ventanaInicio = fila.ventanaInicio;
  }

  const bloqueadoHasta = intentos > intentosMaximos ? instante + bloqueoMs : fila?.bloqueadoHasta || 0;
  await db
    .prepare(
      `INSERT INTO rate_limit (clave, intentos, ventanaInicio, bloqueadoHasta, ultimo)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(clave) DO UPDATE SET intentos = ?2, ventanaInicio = ?3, bloqueadoHasta = ?4, ultimo = ?5`
    )
    .bind(clave, intentos, ventanaInicio, bloqueadoHasta, instante)
    .run();

  if (intentos > intentosMaximos) return { bloqueado: true, segundos: null };
  return { bloqueado: false };
}

export function ipDeRequest(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'desconocida';
}

// Responde 429 como el Node (dos mensajes posibles, cabecera Retry-After)
export function respuestaLimitador(resultado) {
  if (resultado.segundos !== null && resultado.segundos !== undefined) {
    return respuestaJson(
      { error: `Demasiados intentos. Espera ${resultado.segundos} segundos antes de volver a intentarlo.` },
      429,
      { 'Retry-After': String(resultado.segundos) }
    );
  }
  return respuestaJson(
    { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' },
    429
  );
}
