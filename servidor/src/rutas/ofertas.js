'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { crearCrud } = require('./crud');
const { requerirSesion } = require('../seguridad');

const coleccionOfertas = new Coleccion('ofertas');
const coleccionProductos = new Coleccion('productos');

const estaActiva = (oferta, ahoraMs = Date.now()) => {
  if (!oferta.activa) return false;
  const inicio = oferta.inicio ? Date.parse(oferta.inicio) : 0;
  const fin = oferta.fin ? Date.parse(oferta.fin) : Infinity;
  return inicio <= ahoraMs && ahoraMs <= fin;
};

const enrutador = express.Router();

enrutador.get('/', requerirSesion, (req, res) => {
  const ahoraMs = Date.now();
  const datos = coleccionOfertas.todo().map((oferta) => {
    const producto = coleccionProductos.porId(oferta.producto);
    return {
      ...oferta,
      activaAhora: estaActiva(oferta, ahoraMs),
      productoNombre: producto ? producto.nombre : '(producto eliminado)',
    };
  });
  datos.sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
  res.json({ datos, total: datos.length });
});

enrutador.use(
  crearCrud({
    coleccion: coleccionOfertas,
    esquema: {
      producto: { tipo: 'texto', requerido: true, etiqueta: 'el producto' },
      tipo: { tipo: 'texto', requerido: true, opciones: ['precio', 'porcentaje'], etiqueta: 'el tipo de oferta' },
      valor: { tipo: 'numero', requerido: true, min: 0, max: 1000000, etiqueta: 'el valor' },
      inicio: { tipo: 'fecha', etiqueta: 'la fecha de inicio' },
      fin: { tipo: 'fecha', etiqueta: 'la fecha de fin' },
      activa: { tipo: 'booleano', defecto: true },
    },
    rolEscritura: ['admin', 'editor'],
    alCrear: (oferta) => {
      if (!coleccionProductos.porId(oferta.producto)) {
        const error = new Error('El producto indicado no existe.');
        error.estado = 400;
        throw error;
      }
    },
  })
);

enrutador.coleccion = coleccionOfertas;
enrutador.estaActiva = estaActiva;

module.exports = enrutador;
