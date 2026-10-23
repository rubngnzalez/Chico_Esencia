'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const { Coleccion } = require('../almacen');
const {
  establecerCookieSesion,
  borrarCookieSesion,
  requerirSesion,
  limitador,
  quitarHash,
} = require('../seguridad');
const { validar, limpiarTexto, ahora, error400 } = require('../utilidades');

const usuarios = new Coleccion('usuarios');
const enrutador = express.Router();

enrutador.post('/login', limitador(8, 15 * 60 * 1000, 15 * 60 * 1000), (req, res) => {
  const cuerpo = req.body || {};
  const email = limpiarTexto(cuerpo.email).toLowerCase();
  const contrasena = typeof cuerpo.contrasena === 'string' ? cuerpo.contrasena : '';

  if (!email || !contrasena) {
    return error400(res, 'Introduce tu correo y tu contraseña.');
  }

  const usuario = usuarios.leer().find((u) => u.email.toLowerCase() === email);
  if (!usuario || usuario.activo === false || !bcrypt.compareSync(contrasena, usuario.hashContrasena)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  usuarios.modificar(usuario.id, { ultimoAcceso: ahora() });
  establecerCookieSesion(res, usuario.id);
  res.json({ ok: true, usuario: quitarHash({ ...usuario, ultimoAcceso: ahora() }) });
});

enrutador.post('/logout', (req, res) => {
  borrarCookieSesion(res);
  res.json({ ok: true });
});

enrutador.get('/me', requerirSesion, (req, res) => {
  res.json({ usuario: quitarHash(req.usuario) });
});

enrutador.post('/cambiar-contrasena', requerirSesion, (req, res) => {
  const comprobacion = validar(
    {
      contrasenaActual: { tipo: 'texto', etiqueta: 'la contraseña actual' },
      contrasenaNueva: { tipo: 'texto', requerido: true, min: 8, max: 128, etiqueta: 'la contraseña nueva' },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);

  const usuario = usuarios.porId(req.usuario.id);
  if (!usuario) return res.status(401).json({ error: 'Sesión no válida.' });

  if (!bcrypt.compareSync(comprobacion.datos.contrasenaActual, usuario.hashContrasena)) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }

  usuarios.modificar(usuario.id, {
    hashContrasena: bcrypt.hashSync(comprobacion.datos.contrasenaNueva, 10),
    debeCambiarContrasena: false,
  });

  res.json({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
});

module.exports = enrutador;
