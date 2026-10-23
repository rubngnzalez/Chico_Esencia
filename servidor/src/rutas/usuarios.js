'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { Coleccion } = require('../almacen');
const { requerirRol, quitarHash } = require('../seguridad');
const { validar, error400, error404, error403, ahora, nuevoId } = require('../utilidades');

const usuarios = new Coleccion('usuarios');
const ROLES = ['admin', 'editor', 'lector'];

const enrutador = express.Router();

enrutador.use(requerirRol('admin'));

enrutador.get('/', (req, res) => {
  const datos = usuarios.todo().map(quitarHash);
  res.json({ datos, total: datos.length });
});

enrutador.get('/:id', (req, res) => {
  const usuario = usuarios.porId(req.params.id);
  if (!usuario) return error404(res, 'Usuario no encontrado.');
  res.json({ dato: quitarHash(usuario) });
});

enrutador.post('/', (req, res) => {
  const comprobacion = validar(
    {
      nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
      email: { tipo: 'email', requerido: true, etiqueta: 'el email' },
      contrasena: { tipo: 'texto', requerido: true, min: 8, max: 128, etiqueta: 'la contraseña' },
      rol: { tipo: 'texto', requerido: true, opciones: ROLES, etiqueta: 'el rol' },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const datos = comprobacion.datos;
  if (usuarios.leer().some((u) => u.email.toLowerCase() === datos.email)) {
    return error400(res, 'Ya existe un usuario con ese correo electrónico.');
  }
  const usuario = {
    id: nuevoId('usr'),
    nombre: datos.nombre,
    email: datos.email,
    hashContrasena: bcrypt.hashSync(datos.contrasena, 10),
    rol: datos.rol,
    activo: true,
    debeCambiarContrasena: false,
    creadoEn: ahora(),
    ultimoAcceso: null,
  };
  usuarios.insertar(usuario);
  res.status(201).json({ dato: quitarHash(usuario) });
});

enrutador.put('/:id', (req, res) => {
  const usuario = usuarios.porId(req.params.id);
  if (!usuario) return error404(res, 'Usuario no encontrado.');
  const comprobacion = validar(
    {
      nombre: { tipo: 'texto', min: 1, max: 120, etiqueta: 'el nombre' },
      rol: { tipo: 'texto', opciones: ROLES, etiqueta: 'el rol' },
      activo: { tipo: 'booleano' },
      contrasena: { tipo: 'texto', min: 8, max: 128, etiqueta: 'la contraseña' },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const datos = comprobacion.datos;

  if (usuario.rol === 'admin' && (datos.rol && datos.rol !== 'admin' || datos.activo === false)) {
    const adminsActivos = usuarios
      .leer()
      .filter((u) => u.rol === 'admin' && u.activo !== false && u.id !== usuario.id);
    if (adminsActivos.length === 0) {
      return error400(res, 'No puede dejar de haber al menos un administrador activo.');
    }
  }

  const cambios = {};
  if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
  if (datos.rol !== undefined) cambios.rol = datos.rol;
  if (datos.activo !== undefined) cambios.activo = datos.activo;
  if (datos.contrasena) {
    cambios.hashContrasena = bcrypt.hashSync(datos.contrasena, 10);
    cambios.debeCambiarContrasena = false;
  }
  const actualizado = usuarios.modificar(usuario.id, cambios);
  res.json({ dato: quitarHash(actualizado) });
});

enrutador.delete('/:id', (req, res) => {
  const usuario = usuarios.porId(req.params.id);
  if (!usuario) return error404(res, 'Usuario no encontrado.');
  if (usuario.id === req.usuario.id) {
    return error400(res, 'No puedes eliminar tu propio usuario.');
  }
  if (usuario.rol === 'admin') {
    const otrosAdmins = usuarios.leer().filter((u) => u.rol === 'admin' && u.id !== usuario.id);
    if (otrosAdmins.length === 0) {
      return error400(res, 'No puede dejar de haber al menos un administrador.');
    }
  }
  usuarios.quitar(usuario.id);
  res.json({ ok: true });
});

module.exports = enrutador;
