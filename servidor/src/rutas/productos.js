'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { crearCrud } = require('./crud');

const productos = new Coleccion('productos');
const ofertas = new Coleccion('ofertas');

function ofertaActiva(oferta, ahoraMs) {
  if (!oferta.activa) return false;
  const inicio = oferta.inicio ? Date.parse(oferta.inicio) : 0;
  const fin = oferta.fin ? Date.parse(oferta.fin) : Infinity;
  return inicio <= ahoraMs && ahoraMs <= fin;
}

function precioEfectivo(producto, ahoraMs = Date.now()) {
  let precio = Number(producto.precioOferta) > 0 ? Number(producto.precioOferta) : Number(producto.precio);
  const activas = ofertas
    .leer()
    .filter((o) => o.producto === producto.id && ofertaActiva(o, ahoraMs));
  for (const oferta of activas) {
    const base = Number(producto.precio) || 0;
    const valor = Number(oferta.valor) || 0;
    const candidato = oferta.tipo === 'porcentaje' ? base * (1 - valor / 100) : valor;
    if (candidato >= 0 && candidato < precio) precio = Math.round(candidato * 100) / 100;
  }
  return Math.round(precio * 100) / 100;
}

const esquemaProducto = {
  nombre: { tipo: 'texto', requerido: true, min: 1, max: 160, etiqueta: 'el nombre' },
  slug: { tipo: 'texto', defecto: '', max: 90 },
  descripcion: { tipo: 'texto', defecto: '', max: 3000 },
  historia: { tipo: 'texto', defecto: '', max: 12000 },
  precio: { tipo: 'numero', requerido: true, min: 0, max: 100000, etiqueta: 'el precio' },
  precioOferta: { tipo: 'numero', min: 0, max: 100000, nulable: true, etiqueta: 'el precio de oferta' },
  stock: { tipo: 'entero', defecto: 0, min: 0, max: 1000000, etiqueta: 'el stock' },
  categoria: { tipo: 'texto', defecto: '' },
  imagenes: { tipo: 'matriz', tipoItems: 'texto', defecto: [] },
  destacado: { tipo: 'booleano', defecto: false },
  activo: { tipo: 'booleano', defecto: true },
  codigo: { tipo: 'texto', defecto: '', max: 60 },
};

const enrutador = express.Router();

enrutador.get('/publico', (req, res) => {
  const ahoraMs = Date.now();
  const datos = productos
    .leer()
    .filter((p) => p.activo)
    .map((p) => ({ ...p, precioEfectivo: precioEfectivo(p, ahoraMs) }));
  res.json({ datos, total: datos.length });
});

enrutador.use(crearCrud({
  coleccion: productos,
  esquema: esquemaProducto,
  campoSlug: 'nombre',
  rolEscritura: ['admin', 'editor'],
  ordenarPor: 'creadoEn',
}));

enrutador.ofertaActiva = ofertaActiva;
enrutador.precioEfectivo = precioEfectivo;
enrutador.coleccion = productos;

module.exports = enrutador;
