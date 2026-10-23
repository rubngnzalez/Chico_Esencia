'use strict';

const express = require('express');
const { requerirSesion, requerirRol } = require('../seguridad');
const { validar, slugificar, nuevoId, ahora, error400, error404 } = require('../utilidades');

function slugUnico(coleccion, base, idExcluido) {
  let slug = base || 'elemento';
  const existentes = new Set(
    coleccion
      .leer()
      .filter((item) => item.id !== idExcluido)
      .map((item) => item.slug)
  );
  if (!existentes.has(slug)) return slug;
  let numero = 2;
  while (existentes.has(`${slug}-${numero}`)) numero++;
  return `${slug}-${numero}`;
}

function crearCrud({ coleccion, esquema, campoSlug, rolEscritura = ['admin', 'editor'], alCrear, alModificar, alEliminar, ordenarPor }) {
  const enrutador = express.Router();

  enrutador.get('/', requerirSesion, (req, res) => {
    let lista = coleccion.todo();
    if (ordenarPor) {
      lista.sort((a, b) => {
        const va = a[ordenarPor] ?? 0;
        const vb = b[ordenarPor] ?? 0;
        if (typeof va === 'number' && typeof vb === 'number') return va - vb;
        return String(va).localeCompare(String(vb), 'es');
      });
    }
    res.json({ datos: lista, total: lista.length });
  });

  enrutador.get('/:id', requerirSesion, (req, res) => {
    const elemento = coleccion.porId(req.params.id);
    if (!elemento) return error404(res);
    res.json({ dato: elemento });
  });

  enrutador.post('/', requerirRol(...rolEscritura), (req, res) => {
    const comprobacion = validar(esquema, req.body);
    if (!comprobacion.ok) return error400(res, comprobacion.errores);
    const datos = comprobacion.datos;
    if (campoSlug) {
      datos.slug = slugUnico(coleccion, slugificar(datos.slug || datos[campoSlug]), null);
    }
    const elemento = {
      id: nuevoId(coleccion.nombre.slice(0, 3)),
      ...datos,
      creadoEn: ahora(),
      actualizadoEn: ahora(),
    };
    if (alCrear) alCrear(elemento, req);
    coleccion.insertar(elemento);
    res.status(201).json({ dato: elemento });
  });

  enrutador.put('/:id', requerirRol(...rolEscritura), (req, res) => {
    const existente = coleccion.porId(req.params.id);
    if (!existente) return error404(res);
    const comprobacion = validar(esquema, { ...existente, ...req.body });
    if (!comprobacion.ok) return error400(res, comprobacion.errores);
    const datos = comprobacion.datos;
    for (const [campo, regla] of Object.entries(esquema)) {
      if (regla.nulable && req.body && req.body[campo] === null) {
        datos[campo] = null;
      }
    }
    if (campoSlug) {
      datos.slug = slugUnico(coleccion, slugificar(datos.slug || datos[campoSlug]), existente.id);
    }
    const anterior = { ...existente };
    const actualizado = coleccion.modificar(existente.id, datos);
    if (alModificar) alModificar(actualizado, anterior, req);
    res.json({ dato: actualizado });
  });

  enrutador.delete('/:id', requerirRol(...rolEscritura), (req, res) => {
    const existente = coleccion.porId(req.params.id);
    if (!existente) return error404(res);
    coleccion.quitar(existente.id);
    if (alEliminar) alEliminar(existente, req);
    res.json({ ok: true });
  });

  return enrutador;
}

module.exports = { crearCrud, slugUnico };
