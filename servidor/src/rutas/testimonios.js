'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { crearCrud } = require('./crud');
const { ahora } = require('../utilidades');

const coleccionTestimonios = new Coleccion('testimonios');

const enrutador = express.Router();

enrutador.use(
  crearCrud({
    coleccion: coleccionTestimonios,
    esquema: {
      nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
      texto: { tipo: 'texto', requerido: true, min: 1, max: 4000, etiqueta: 'el texto' },
      estrellas: { tipo: 'entero', requerido: true, min: 1, max: 5, etiqueta: 'las estrellas' },
      ciudad: { tipo: 'texto', defecto: '', max: 120 },
      producto: { tipo: 'texto', defecto: '', max: 160 },
      fecha: { tipo: 'fecha', defecto: undefined },
      aprobado: { tipo: 'booleano', defecto: false },
    },
    rolEscritura: ['admin', 'editor'],
    ordenarPor: 'fecha',
    alCrear: (testimonio) => {
      if (!testimonio.fecha) testimonio.fecha = ahora();
    },
  })
);

enrutador.coleccion = coleccionTestimonios;

module.exports = enrutador;
