'use strict';

const express = require('express');
const { Coleccion } = require('../almacen');
const { requerirRol, requerirSesion } = require('../seguridad');
const { validar, error404, error400 } = require('../utilidades');

const mensajes = new Coleccion('mensajes');

const enrutador = express.Router();

enrutador.get('/', requerirSesion, (req, res) => {
  const filtro = req.query.estado || 'todos';
  let datos = mensajes.todo();
  if (filtro === 'noleidos') datos = datos.filter((m) => !m.leido && !m.archivado);
  else if (filtro === 'leidos') datos = datos.filter((m) => m.leido && !m.archivado);
  else if (filtro === 'archivados') datos = datos.filter((m) => m.archivado);
  else datos = datos.filter((m) => !m.archivado);
  datos.sort((a, b) => String(b.recibidoEn || '').localeCompare(String(a.recibidoEn || '')));
  const totalNoLeidos = mensajes.leer().filter((m) => !m.leido && !m.archivado).length;
  res.json({ datos, total: datos.length, totalNoLeidos });
});

enrutador.get('/:id', requerirSesion, (req, res) => {
  const mensaje = mensajes.porId(req.params.id);
  if (!mensaje) return error404(res, 'Mensaje no encontrado.');
  res.json({ dato: mensaje });
});

enrutador.put('/:id', requerirRol('admin', 'editor', 'lector'), (req, res) => {
  const mensaje = mensajes.porId(req.params.id);
  if (!mensaje) return error404(res, 'Mensaje no encontrado.');
  const comprobacion = validar(
    {
      leido: { tipo: 'booleano' },
      archivado: { tipo: 'booleano' },
      respuesta: { tipo: 'texto', max: 8000 },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const cambios = {};
  if (comprobacion.datos.leido !== undefined) cambios.leido = comprobacion.datos.leido;
  if (comprobacion.datos.archivado !== undefined) cambios.archivado = comprobacion.datos.archivado;
  if (comprobacion.datos.respuesta !== undefined) {
    cambios.respuesta = comprobacion.datos.respuesta;
    cambios.respondidoEn = comprobacion.datos.respuesta ? new Date().toISOString() : null;
  }
  const actualizado = mensajes.modificar(mensaje.id, cambios);
  res.json({ dato: actualizado });
});

enrutador.post('/:id/responder', requerirRol('admin', 'editor'), async (req, res) => {
  const mensaje = mensajes.porId(req.params.id);
  if (!mensaje) return error404(res, 'Mensaje no encontrado.');
  const comprobacion = validar(
    {
      respuesta: { tipo: 'texto', requerido: true, min: 1, max: 20000, etiqueta: 'la respuesta' },
      enviar: { tipo: 'booleano', defecto: false },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  const { respuesta, enviar } = comprobacion.datos;
  const actualizado = mensajes.modificar(mensaje.id, {
    respuesta,
    respondidoEn: new Date().toISOString(),
  });

  let envio = null;
  if (enviar) {
    const ajustesAlmacen = require('../almacen').Ajustes;
    const ajustes = new ajustesAlmacen().leer();
    const { enviarCorreo } = require('../correo');
    envio = await enviarCorreo(ajustes, {
      para: mensaje.email,
      asunto: 'Re: tu mensaje a SHADDAI · Esencia de Umbral',
      html: `<div style="font-family:Georgia,serif;line-height:1.7;color:#16261b;">${respuesta.replace(/\n/g, '<br>')}</div>`,
      responderA: (ajustes.contacto && ajustes.contacto.emailsDestino && ajustes.contacto.emailsDestino[0]) || undefined,
    });
    mensajes.modificar(mensaje.id, {
      respuestaEnviada: Boolean(envio && envio.enviado),
      respuestaPendiente: Boolean(envio && envio.pendiente),
    });
  }

  res.json({ dato: mensajes.porId(mensaje.id), envio });
});

enrutador.delete('/:id', requerirRol('admin'), (req, res) => {
  const mensaje = mensajes.porId(req.params.id);
  if (!mensaje) return error404(res, 'Mensaje no encontrado.');
  mensajes.quitar(mensaje.id);
  res.json({ ok: true });
});

enrutador.coleccion = mensajes;

module.exports = enrutador;
