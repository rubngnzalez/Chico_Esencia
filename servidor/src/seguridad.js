'use strict';

const crypto = require('crypto');
const { cargarOCrearSecreto } = require('./almacen');

const NOMBRE_COOKIE = 'shaddai_sesion';
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

let secreto = null;
function obtenerSecreto() {
  if (!secreto) secreto = cargarOCrearSecreto();
  return secreto;
}

const base64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const deBase64url = (texto) =>
  Buffer.from(texto.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function firmarValor(valor) {
  const firma = crypto
    .createHmac('sha256', obtenerSecreto())
    .update(String(valor))
    .digest('base64');
  return base64url(firma);
}

function crearToken(uid) {
  const payload = base64url(
    JSON.stringify({ uid, exp: Date.now() + DURACION_MS })
  );
  return `${payload}.${firmarValor(payload)}`;
}

function verificarToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  const esperada = firmarValor(payload);
  const bufA = Buffer.from(firma);
  const bufB = Buffer.from(esperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;
  try {
    const datos = JSON.parse(deBase64url(payload).toString('utf8'));
    if (!datos.uid || typeof datos.exp !== 'number' || datos.exp < Date.now()) return null;
    return datos;
  } catch {
    return null;
  }
}

function leerCookies(req) {
  const cabecera = req.headers.cookie;
  const cookies = {};
  if (!cabecera) return cookies;
  for (const parte of cabecera.split(';')) {
    const indice = parte.indexOf('=');
    if (indice === -1) continue;
    const nombre = parte.slice(0, indice).trim();
    const valor = parte.slice(indice + 1).trim();
    if (nombre) cookies[nombre] = decodeURIComponent(valor);
  }
  return cookies;
}

function establecerCookieSesion(res, uid) {
  const token = crearToken(uid);
  res.setHeader(
    'Set-Cookie',
    `${NOMBRE_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(DURACION_MS / 1000)}`
  );
}

function borrarCookieSesion(res) {
  res.setHeader('Set-Cookie', `${NOMBRE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function usuarioDePeticion(req) {
  const cookies = leerCookies(req);
  const token = cookies[NOMBRE_COOKIE];
  if (!token) return null;
  return verificarToken(token);
}

function adjuntarUsuario(usuarios) {
  return (req, res, next) => {
    const sesion = usuarioDePeticion(req);
    if (sesion) {
      const usuario = usuarios.porId(sesion.uid);
      if (usuario && usuario.activo !== false) {
        req.usuario = usuario;
      }
    }
    next();
  };
}

function requerirSesion(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Debes iniciar sesión para realizar esta acción.' });
  }
  next();
}

function cambioPendienteBloquea(req) {
  return Boolean(req.usuario && req.usuario.debeCambiarContrasena);
}

function requerirSinCambioPendiente(req, res, next) {
  if (cambioPendienteBloquea(req)) {
    return res.status(403).json({
      error: 'Debes cambiar tu contraseña temporal antes de continuar.',
      debeCambiarContrasena: true,
    });
  }
  next();
}

function bloquearCambioPendiente() {
  return (req, res, next) => {
    if (req.usuario && req.usuario.debeCambiarContrasena && !req.path.startsWith('/auth/')) {
      return res.status(403).json({
        error: 'Debes cambiar tu contraseña temporal antes de continuar.',
        debeCambiarContrasena: true,
      });
    }
    next();
  };
}

function requerirRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario) {
      return res.status(401).json({ error: 'Debes iniciar sesión para realizar esta acción.' });
    }
    if (!roles.includes(req.usuario.rol)) {
      return res
        .status(403)
        .json({ error: 'No tienes permisos para realizar esta acción.' });
    }
    next();
  };
}

function limitador(intentosMaximos, ventanaMs, bloqueoMs) {
  const registro = new Map();
  const limpiarPeriodico = setInterval(() => {
    const limite = Date.now() - Math.max(ventanaMs, bloqueoMs) * 2;
    for (const [clave, dato] of registro) {
      if (dato.ultimo < limite) registro.delete(clave);
    }
  }, ventanaMs);
  if (limpiarPeriodico.unref) limpiarPeriodico.unref();

  return (req, res, next) => {
    const clave = `${req.ip || 'desconocida'}`;
    const instante = Date.now();
    let dato = registro.get(clave);
    if (!dato) {
      dato = { intentos: [], bloqueadoHasta: 0, ultimo: instante };
      registro.set(clave, dato);
    }
    if (dato.bloqueadoHasta > instante) {
      const segundos = Math.ceil((dato.bloqueadoHasta - instante) / 1000);
      res.setHeader('Retry-After', String(segundos));
      return res.status(429).json({
        error: `Demasiados intentos. Espera ${segundos} segundos antes de volver a intentarlo.`,
      });
    }
    dato.intentos = dato.intentos.filter((t) => instante - t < ventanaMs);
    dato.intentos.push(instante);
    dato.ultimo = instante;
    if (dato.intentos.length > intentosMaximos) {
      dato.bloqueadoHasta = instante + bloqueoMs;
      return res.status(429).json({
        error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.',
      });
    }
    next();
  };
}

function quitarHash(usuario) {
  if (!usuario) return null;
  const { hashContrasena, ...resto } = usuario;
  return resto;
}

module.exports = {
  NOMBRE_COOKIE,
  crearToken,
  verificarToken,
  leerCookies,
  establecerCookieSesion,
  borrarCookieSesion,
  usuarioDePeticion,
  adjuntarUsuario,
  requerirSesion,
  requerirSinCambioPendiente,
  bloquearCambioPendiente,
  requerirRol,
  limitador,
  quitarHash,
};
