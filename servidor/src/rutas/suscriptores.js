'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { requerirRol } = require('../seguridad');
const { ahora, nuevoId } = require('../utilidades');

const suscriptores = new Coleccion('suscriptores');

const enrutador = express.Router();

const aCsv = (lista) => {
  const escapar = (valor) => `"${String(valor == null ? '' : valor).replace(/"/g, '""')}"`;
  const cabecera = ['email', 'nombre', 'etiquetas', 'fechaAlta', 'activo'].join(',');
  const filas = lista.map((s) =>
    [s.email, s.nombre || '', (s.etiquetas || []).join(' | '), s.fechaAlta || '', s.activo === false ? 'no' : 'si']
      .map(escapar)
      .join(',')
  );
  return '\uFEFF' + [cabecera, ...filas].join('\r\n');
};

enrutador.get('/', requerirRol('admin', 'editor'), (req, res) => {
  const datos = suscriptores
    .todo()
    .sort((a, b) => String(b.fechaAlta || '').localeCompare(String(a.fechaAlta || '')));
  res.json({ datos, total: datos.length });
});

enrutador.get('/exportar', requerirRol('admin', 'editor'), (req, res) => {
  const datos = suscriptores.todo();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="suscriptores-shaddai-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(aCsv(datos));
});

enrutador.delete('/:id', requerirRol('admin', 'editor'), (req, res) => {
  const suscriptor = suscriptores.porId(req.params.id);
  if (!suscriptor) return res.status(404).json({ error: 'Suscriptor no encontrado.' });
  suscriptores.quitar(suscriptor.id);
  res.json({ ok: true });
});

enrutador.insertar = (datos) => {
  const existente = suscriptores.leer().find((s) => s.email === datos.email);
  if (existente) return existente;
  return suscriptores.insertar({
    id: nuevoId('sus'),
    email: datos.email,
    nombre: datos.nombre || '',
    etiquetas: datos.etiquetas || [],
    activo: true,
    fechaAlta: ahora(),
  });
};

enrutador.coleccion = suscriptores;

module.exports = enrutador;
