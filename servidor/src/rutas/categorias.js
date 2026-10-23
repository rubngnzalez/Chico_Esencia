'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { crearCrud } = require('./crud');

const enrutador = express.Router();

enrutador.use(
  crearCrud({
    coleccion: new Coleccion('categorias'),
    esquema: {
      nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
      slug: { tipo: 'texto', defecto: '', max: 90 },
      descripcion: { tipo: 'texto', defecto: '', max: 2000 },
      orden: { tipo: 'entero', defecto: 0, min: 0, max: 9999 },
    },
    campoSlug: 'nombre',
    rolEscritura: ['admin', 'editor'],
    ordenarPor: 'orden',
  })
);

module.exports = enrutador;
