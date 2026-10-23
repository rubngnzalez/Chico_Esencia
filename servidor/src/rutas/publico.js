'use strict';

const express = require('express');
const { Coleccion, Ajustes } = require('../almacen');
const { limitador } = require('../seguridad');
const { validar, error400, nuevoId, ahora, formatearEuro } = require('../utilidades');
const { enviarCorreo, reemplazarVariables, listaArticulosHtml } = require('../correo');
const { verificarNotificacion } = require('../redsys');

const mensajes = new Coleccion('mensajes');
const suscriptores = new Coleccion('suscriptores');
const pedidos = new Coleccion('pedidos');
const testimonios = new Coleccion('testimonios');
const almacenAjustes = new Ajustes();

function redesPublicas(redes) {
  const limpias = {};
  for (const [red, url] of Object.entries(redes || {})) {
    if (typeof url === 'string' && url.trim()) limpias[red] = url.trim();
  }
  return limpias;
}

function datosPublicos(ajustes) {
  return {
    nombreComercio: (ajustes.redsys && ajustes.redsys.nombreComercio) || 'SHADDAI Â· Esencia de Umbral',
    entornoPago: (ajustes.redsys && ajustes.redsys.entorno) || 'test',
    metodosPago: {
      tarjeta: Boolean(ajustes.redsys && ajustes.redsys.metodoTarjeta !== false),
      bizum: Boolean(ajustes.redsys && ajustes.redsys.metodoBizum !== false),
    },
    envio: {
      activo: Boolean(ajustes.envio && ajustes.envio.activo !== false),
      coste: Number(ajustes.envio && ajustes.envio.coste) || 0,
      gratisDesde: Number(ajustes.envio && ajustes.envio.gratisDesde) || 0,
      plazos: (ajustes.envio && ajustes.envio.plazos) || '',
    },
    contacto: {
      email: (ajustes.contacto && ajustes.contacto.emailsDestino && ajustes.contacto.emailsDestino[0]) || '',
      telefono: (ajustes.contacto && ajustes.contacto.telefono) || '',
      direccion: (ajustes.contacto && ajustes.contacto.direccion) || '',
      horario: (ajustes.contacto && ajustes.contacto.horario) || '',
    },
    redes: redesPublicas(ajustes.redes),
  };
}

const enrutador = express.Router();

enrutador.get('/config', (req, res) => {
  res.json({ datos: datosPublicos(almacenAjustes.leer()) });
});

// Testimonios aprobados para la web pública
enrutador.get('/testimonios', (req, res) => {
  const datos = testimonios
    .leer()
    .filter((t) => t.aprobado === true)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  res.json({ datos, total: datos.length });
});

enrutador.post(
  '/contacto',
  limitador(10, 60 * 1000, 10 * 60 * 1000),
  (req, res) => {
    const cuerpo = req.body || {};
    if (typeof cuerpo.web === 'string' && cuerpo.web.trim() !== '') {
      return res.json({ ok: true, mensaje: 'Mensaje recibido. Te responderemos con la calma que mereces.' });
    }
    const comprobacion = validar(
      {
        nombre: { tipo: 'texto', requerido: true, min: 2, max: 120, etiqueta: 'el nombre' },
        email: { tipo: 'email', requerido: true, etiqueta: 'el email' },
        mensaje: { tipo: 'texto', requerido: true, min: 5, max: 5000, etiqueta: 'el mensaje' },
        telefono: { tipo: 'texto', defecto: '', max: 30 },
      },
      cuerpo
    );
    if (!comprobacion.ok) return error400(res, comprobacion.errores);

    const mensaje = {
      id: nuevoId('msg'),
      nombre: comprobacion.datos.nombre,
      email: comprobacion.datos.email,
      telefono: comprobacion.datos.telefono,
      texto: comprobacion.datos.mensaje,
      leido: false,
      archivado: false,
      respuesta: '',
      respondidoEn: null,
      recibidoEn: ahora(),
      origen: 'formulario-contacto',
    };
    mensajes.insertar(mensaje);

    const ajustes = almacenAjustes.leer();
    const notificaciones = ajustes.notificaciones || {};
    const destinos = (ajustes.contacto && ajustes.contacto.emailsDestino) || [];
    if (notificaciones.nuevoContacto !== false && destinos.length > 0) {
      enviarCorreo(ajustes, {
        para: destinos,
        asunto: `Nuevo mensaje de contacto â€” ${mensaje.nombre}`,
        html: `<div style="font-family:Georgia,serif;color:#16261b;line-height:1.7;">
          <p><strong>Nombre:</strong> ${mensaje.nombre}</p>
          <p><strong>Email:</strong> ${mensaje.email}</p>
          ${mensaje.telefono ? `<p><strong>TelÃ©fono:</strong> ${mensaje.telefono}</p>` : ''}
          <p><strong>Mensaje:</strong></p>
          <p style="white-space:pre-wrap;">${mensaje.texto.replace(/</g, '&lt;')}</p>
        </div>`,
        responderA: mensaje.email,
      });
    }

    res.status(201).json({ ok: true, mensaje: 'Mensaje recibido. Te responderemos con la calma que mereces.' });
  }
);

enrutador.post('/suscribirse', limitador(10, 60 * 1000, 10 * 60 * 1000), (req, res) => {
  const comprobacion = validar(
    {
      email: { tipo: 'email', requerido: true, etiqueta: 'el email' },
      nombre: { tipo: 'texto', defecto: '', max: 120 },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);

  const existente = suscriptores.leer().find((s) => s.email === comprobacion.datos.email);
  if (existente) {
    return res.json({ ok: true, mensaje: 'Ya estabas en la lista: bienvenido de nuevo al Umbral.' });
  }
  suscriptores.insertar({
    id: nuevoId('sus'),
    email: comprobacion.datos.email,
    nombre: comprobacion.datos.nombre,
    etiquetas: [],
    activo: true,
    fechaAlta: ahora(),
  });
  res.status(201).json({ ok: true, mensaje: 'Bienvenido al Umbral: recibirÃ¡s las prÃ³ximas reflexiones y aperturas de lotes.' });
});

enrutador.post('/redsys-notificacion', express.urlencoded({ extended: false }), (req, res) => {
  const ajustes = almacenAjustes.leer();
  const clave = ajustes.redsys && ajustes.redsys.clave;
  if (!clave) {
    return res.status(500).json({ error: 'Pago no configurado.' });
  }

  const verificacion = verificarNotificacion(req.body, clave);
  if (!verificacion.ok) {
    return res.status(400).json({ error: verificacion.motivo });
  }

  const pedido = pedidos.leer().find((p) => p.numero === verificacion.pedido);
  if (!pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado para esta notificaciÃ³n.' });
  }

  if (pedido.estado === 'pagado') {
    return res.json({ ok: true, mensaje: 'Pedido ya marcado como pagado.' });
  }

  if (!verificacion.autorizado) {
    pedidos.modificar(pedido.id, {
      estado: 'cancelado',
      respuestaRedsys: { respuesta: verificacion.respuesta, autorizacion: verificacion.autorizacion, importe: verificacion.importe },
    });
    return res.json({ ok: true, mensaje: 'Pago no autorizado: pedido cancelado.' });
  }

  if (verificacion.importe && Math.round(pedido.total * 100) !== verificacion.importe) {
    return res.status(400).json({ error: 'El importe notificado no coincide con el pedido.' });
  }

  pedidos.modificar(pedido.id, {
    estado: 'pagado',
    pagadoEn: ahora(),
    respuestaRedsys: {
      respuesta: verificacion.respuesta,
      autorizacion: verificacion.autorizacion,
      importe: verificacion.importe,
    },
  });

  const pedidoActualizado = pedidos.porId(pedido.id);
  const emails = ajustes['emails-automaticos'] || {};
  const nombre = pedidoActualizado.cliente.nombre || 'alma buscadora';
  const variables = {
    nombre,
    pedido: pedidoActualizado.numero,
    total: formatearEuro(pedidoActualizado.total),
    articulos: listaArticulosHtml(pedidoActualizado.articulos),
  };

  (async () => {
    for (const clavePlantilla of ['confirmacionCompra', 'agradecimiento']) {
      const plantilla = emails[clavePlantilla];
      if (!plantilla || plantilla.activo === false || !pedidoActualizado.cliente.email) continue;
      await enviarCorreo(ajustes, {
        para: pedidoActualizado.cliente.email,
        asunto: reemplazarVariables(plantilla.asunto, variables),
        html: reemplazarVariables(plantilla.html, variables),
      });
    }
    const notificaciones = ajustes.notificaciones || {};
    const destinos = (ajustes.contacto && ajustes.contacto.emailsDestino) || [];
    if (notificaciones.nuevoPedido !== false && destinos.length > 0) {
      await enviarCorreo(ajustes, {
        para: destinos,
        asunto: `Nuevo pedido pagado â€” ${pedidoActualizado.numero}`,
        html: `<div style="font-family:Georgia,serif;color:#16261b;line-height:1.7;">
          <p><strong>Pedido:</strong> ${pedidoActualizado.numero}</p>
          <p><strong>Cliente:</strong> ${nombre} (${pedidoActualizado.cliente.email})</p>
          <p><strong>Total:</strong> ${formatearEuro(pedidoActualizado.total)}</p>
          ${listaArticulosHtml(pedidoActualizado.articulos)}
        </div>`,
      });
    }
  })();

  res.json({ ok: true, mensaje: 'NotificaciÃ³n procesada: pedido marcado como pagado.' });
});

enrutador.datosPublicos = datosPublicos;

module.exports = enrutador;
