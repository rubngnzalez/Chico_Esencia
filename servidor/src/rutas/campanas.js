'use strict';

const express = require('express');
const { Coleccion, Ajustes } = require('../almacen');
const { requerirRol } = require('../seguridad');
const { validar, error404, error400, nuevoId, ahora } = require('../utilidades');
const { enviarCorreo, guardarEml } = require('../correo');
const { smptActivo } = require('../ajustes-defecto');

const campanas = new Coleccion('campanas');
const suscriptores = new Coleccion('suscriptores');
const almacenAjustes = new Ajustes();

function destinatariosDe(campana) {
  const lista = suscriptores.leer().filter((s) => s.activo !== false);
  if (campana.destinatarios && campana.destinatarios.tipo === 'segmento' && campana.destinatarios.etiqueta) {
    const etiqueta = String(campana.destinatarios.etiqueta).toLowerCase();
    return lista.filter((s) => (s.etiquetas || []).some((e) => String(e).toLowerCase() === etiqueta));
  }
  return lista;
}

const enrutador = express.Router();

enrutador.get('/', requerirRol('admin', 'editor'), (req, res) => {
  const datos = campanas
    .todo()
    .sort((a, b) => String(b.creadaEn || '').localeCompare(String(a.creadaEn || '')));
  res.json({ datos, total: datos.length });
});

enrutador.get('/:id', requerirRol('admin', 'editor'), (req, res) => {
  const campana = campanas.porId(req.params.id);
  if (!campana) return error404(res, 'Campaña no encontrada.');
  res.json({ dato: campana, destinatariosEstimados: destinatariosDe(campana).length });
});

enrutador.post('/', requerirRol('admin', 'editor'), (req, res) => {
  const comprobacion = validar(
    {
      asunto: { tipo: 'texto', requerido: true, min: 1, max: 200, etiqueta: 'el asunto' },
      html: { tipo: 'texto', requerido: true, min: 1, max: 500000, etiqueta: 'el contenido HTML' },
      destinatarios: { tipo: 'objeto', defecto: { tipo: 'todos' } },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const destino = comprobacion.datos.destinatarios;
  if (destino.tipo && !['todos', 'segmento'].includes(destino.tipo)) {
    return error400(res, 'Los destinatarios deben ser de tipo «todos» o «segmento».');
  }
  if (destino.tipo === 'segmento' && !destino.etiqueta) {
    return error400(res, 'Para un segmento debes indicar la etiqueta de los suscriptores.');
  }
  const campana = {
    id: nuevoId('cam'),
    asunto: comprobacion.datos.asunto,
    html: comprobacion.datos.html,
    destinatarios: destino,
    estado: 'borrador',
    estadisticas: null,
    bounces: [],
    creadaEn: ahora(),
    enviadaEn: null,
  };
  campanas.insertar(campana);
  res.status(201).json({ dato: campana, destinatariosEstimados: destinatariosDe(campana).length });
});

enrutador.put('/:id', requerirRol('admin', 'editor'), (req, res) => {
  const campana = campanas.porId(req.params.id);
  if (!campana) return error404(res, 'Campaña no encontrada.');
  if (campana.estado === 'enviada') {
    return error400(res, 'No puedes editar una campaña ya enviada.');
  }
  const comprobacion = validar(
    {
      asunto: { tipo: 'texto', min: 1, max: 200, etiqueta: 'el asunto' },
      html: { tipo: 'texto', min: 1, max: 500000, etiqueta: 'el contenido HTML' },
      destinatarios: { tipo: 'objeto' },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const actualizado = campanas.modificar(campana.id, comprobacion.datos);
  res.json({ dato: actualizado });
});

enrutador.delete('/:id', requerirRol('admin'), (req, res) => {
  const campana = campanas.porId(req.params.id);
  if (!campana) return error404(res, 'Campaña no encontrada.');
  campanas.quitar(campana.id);
  res.json({ ok: true });
});

enrutador.post('/:id/enviar', requerirRol('admin', 'editor'), async (req, res, siguiente) => {
  try {
    const campana = campanas.porId(req.params.id);
    if (!campana) return error404(res, 'Campaña no encontrada.');
    if (campana.estado === 'enviada') {
      return error400(res, 'Esta campaña ya fue enviada.');
    }

    const ajustes = almacenAjustes.leer();
    const destinatarios = destinatariosDe(campana);
    if (destinatarios.length === 0) {
      return error400(res, 'No hay suscriptores en el destinatario elegido.');
    }

    if (!smptActivo(ajustes.smtp)) {
      const archivo = guardarEml({
        para: destinatarios.map((s) => s.email),
        asunto: campana.asunto,
        html: campana.html,
        desde: ajustes.smtp.desde || 'SHADDAI <sin-configurar@omshaddai.com>',
      });
      const actualizada = campanas.modificar(campana.id, {
        estado: 'pendiente',
        notaPendiente: 'SMTP sin configurar: la campaña se guardó en servidor/datos/bandeja-salida/. Configura el SMTP y reenvía.',
        estadisticas: { total: destinatarios.length, enviados: 0, fallidos: 0, pendientes: destinatarios.length },
      });
      return res.json({ dato: actualizada, pendiente: true, archivo });
    }

    let enviados = 0;
    let fallidos = 0;
    const bounces = [];
    for (const suscriptor of destinatarios) {
      const resultado = await enviarCorreo(ajustes, {
        para: suscriptor.email,
        asunto: campana.asunto,
        html: campana.html,
      });
      if (resultado.enviado) {
        enviados++;
      } else {
        fallidos++;
        if (resultado.rechazados && resultado.rechazados.length > 0) {
          bounces.push(...resultado.rechazados);
        } else {
          bounces.push(suscriptor.email);
        }
      }
    }

    const actualizada = campanas.modificar(campana.id, {
      estado: 'enviada',
      enviadaEn: new Date().toISOString(),
      estadisticas: { total: destinatarios.length, enviados, fallidos, pendientes: 0 },
      bounces: Array.from(new Set(bounces)),
    });
    res.json({ dato: actualizada });
  } catch (error) {
    siguiente(error);
  }
});

enrutador.coleccion = campanas;

module.exports = enrutador;
