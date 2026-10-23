'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { requerirRol } = require('../seguridad');
const { publicarArticulo, retirarArticulo } = require('../blog-estatico');
const { validar, slugificar, nuevoId, ahora, error404 } = require('../utilidades');

const coleccion = new Coleccion('articulos');

const ESQUEMA = {
  titulo: { tipo: 'texto', requerido: true, min: 1, max: 200, etiqueta: 'el título' },
  slug: { tipo: 'texto', defecto: '', max: 100 },
  extracto: { tipo: 'texto', defecto: '', max: 600 },
  contenido: { tipo: 'texto', defecto: '', max: 300000 },
  imagenPortada: { tipo: 'texto', defecto: '', max: 500 },
  etiquetas: { tipo: 'matriz', tipoItems: 'texto', defecto: [] },
  estado: { tipo: 'texto', defecto: 'borrador', opciones: ['borrador', 'programado', 'publicado'], etiqueta: 'el estado' },
  fechaPublicacion: { tipo: 'fecha', etiqueta: 'la fecha de publicación' },
  autor: { tipo: 'texto', defecto: 'SHADDAI', max: 120 },
};

function validarArticulo(entrada, existente) {
  const comprobacion = validar(ESQUEMA, entrada);
  if (!comprobacion.ok) return comprobacion;
  const datos = comprobacion.datos;
  if (!datos.fechaPublicacion) {
    datos.fechaPublicacion = (existente && existente.fechaPublicacion) || ahora();
  }
  datos.slug = slugificar(datos.slug || datos.titulo);
  const duplicado = coleccion
    .leer()
    .find((a) => a.slug === datos.slug && (!existente || a.id !== existente.id));
  if (duplicado) {
    return { ok: false, errores: [`Ya existe un artículo con el slug «${datos.slug}».`] };
  }
  return { ok: true, datos };
}

function refrescarProgramados() {
  const instante = Date.now();
  for (const articulo of coleccion.leer()) {
    if (
      articulo.estado === 'programado' &&
      articulo.fechaPublicacion &&
      Date.parse(articulo.fechaPublicacion) <= instante
    ) {
      const actualizado = coleccion.modificar(articulo.id, { estado: 'publicado' });
      publicarArticulo(actualizado);
    }
  }
}

function gestionarPublicacion(actualizado, anterior) {
  const estabaPublicado = anterior && anterior.estado === 'publicado';
  const estaPublicado = actualizado.estado === 'publicado';

  if (estabaPublicado && !estaPublicado) {
    retirarArticulo(anterior.slug);
    return;
  }
  if (estaPublicado && estabaPublicado && anterior.slug !== actualizado.slug) {
    retirarArticulo(anterior.slug);
  }
  if (estaPublicado) {
    publicarArticulo(actualizado);
  }
}

const enrutador = express.Router();

enrutador.get('/', requerirRol('admin', 'editor', 'lector'), (req, res) => {
  refrescarProgramados();
  const datos = coleccion
    .todo()
    .sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
  res.json({ datos, total: datos.length });
});

enrutador.get('/:id', requerirRol('admin', 'editor', 'lector'), (req, res) => {
  const articulo = coleccion.porId(req.params.id);
  if (!articulo) return error404(res, 'Artículo no encontrado.');
  res.json({ dato: articulo });
});

enrutador.post('/', requerirRol('admin', 'editor'), (req, res) => {
  const comprobacion = validarArticulo(req.body || {}, null);
  if (!comprobacion.ok) return res.status(400).json({ error: comprobacion.errores.join(' ') });
  const articulo = {
    id: nuevoId('art'),
    ...comprobacion.datos,
    creadoEn: ahora(),
    actualizadoEn: ahora(),
  };
  coleccion.insertar(articulo);
  try {
    if (articulo.estado === 'publicado') publicarArticulo(articulo);
  } catch (error) {
    return res.status(500).json({ error: 'El artículo se guardó, pero no se pudo generar su página estática: ' + error.message });
  }
  res.status(201).json({ dato: articulo });
});

enrutador.put('/:id', requerirRol('admin', 'editor'), (req, res) => {
  const existente = coleccion.porId(req.params.id);
  if (!existente) return error404(res, 'Artículo no encontrado.');
  const comprobacion = validarArticulo({ ...existente, ...req.body }, existente);
  if (!comprobacion.ok) return res.status(400).json({ error: comprobacion.errores.join(' ') });
  const actualizado = coleccion.modificar(existente.id, comprobacion.datos);
  try {
    gestionarPublicacion(actualizado, existente);
  } catch (error) {
    return res.status(500).json({ error: 'El artículo se guardó, pero no se pudo actualizar su página estática: ' + error.message });
  }
  res.json({ dato: actualizado });
});

enrutador.post('/:id/publicar', requerirRol('admin', 'editor'), (req, res) => {
  const existente = coleccion.porId(req.params.id);
  if (!existente) return error404(res, 'Artículo no encontrado.');
  const fecha =
    existente.fechaPublicacion && Date.parse(existente.fechaPublicacion) <= Date.now()
      ? existente.fechaPublicacion
      : ahora();
  const actualizado = coleccion.modificar(existente.id, {
    estado: 'publicado',
    fechaPublicacion: fecha,
  });
  try {
    publicarArticulo(actualizado);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo generar la página estática: ' + error.message });
  }
  res.json({ dato: actualizado, url: `/news/articulo/${actualizado.slug}/` });
});

enrutador.post('/:id/despublicar', requerirRol('admin', 'editor'), (req, res) => {
  const existente = coleccion.porId(req.params.id);
  if (!existente) return error404(res, 'Artículo no encontrado.');
  const actualizado = coleccion.modificar(existente.id, { estado: 'borrador' });
  retirarArticulo(existente.slug);
  res.json({ dato: actualizado });
});

enrutador.delete('/:id', requerirRol('admin', 'editor'), (req, res) => {
  const existente = coleccion.porId(req.params.id);
  if (!existente) return error404(res, 'Artículo no encontrado.');
  coleccion.quitar(existente.id);
  retirarArticulo(existente.slug);
  res.json({ ok: true });
});

enrutador.coleccion = coleccion;

module.exports = enrutador;
