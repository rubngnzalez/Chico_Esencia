'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { requerirSesion, requerirRol } = require('../seguridad');
const { validar, error404, error400 } = require('../utilidades');

const pedidos = new Coleccion('pedidos');

const ESTADOS = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];

const enrutador = express.Router();

enrutador.get('/', requerirSesion, (req, res) => {
  const filtro = req.query.estado;
  let datos = pedidos.todo();
  if (filtro && ESTADOS.includes(filtro)) datos = datos.filter((p) => p.estado === filtro);
  datos.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  res.json({ datos, total: datos.length });
});

enrutador.get('/:id', requerirSesion, (req, res) => {
  const pedido = pedidos
    .leer()
    .find((p) => p.id === req.params.id || p.numero === req.params.id);
  if (!pedido) return error404(res, 'Pedido no encontrado.');
  res.json({ dato: pedido });
});

enrutador.put('/:id/estado', requerirRol('admin'), (req, res) => {
  const pedido = pedidos.leer().find((p) => p.id === req.params.id || p.numero === req.params.id);
  if (!pedido) return error404(res, 'Pedido no encontrado.');
  const comprobacion = validar(
    { estado: { tipo: 'texto', requerido: true, opciones: ESTADOS, etiqueta: 'el estado' } },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const actualizado = pedidos.modificar(pedido.id, {
    estado: comprobacion.datos.estado,
    estadoActualizadoEn: new Date().toISOString(),
  });
  res.json({ dato: actualizado });
});

enrutador.coleccion = pedidos;
enrutador.ESTADOS = ESTADOS;

module.exports = enrutador;
