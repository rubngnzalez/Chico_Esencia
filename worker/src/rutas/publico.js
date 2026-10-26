// /api/pagos/firma (público) y /api/public/* — puertos de rutas/pagos.js y
// rutas/publico.js. El importe SIEMPRE se calcula en servidor con las ofertas
// activas; la clave Redsys nunca sale de la API.

import { requerirRol } from '../seguridad.js';
import { limitar, ipDeRequest, respuestaLimitador } from '../seguridad.js';
import { validar, error400, respuestaJson, ahora, formatearEuro, nuevoId } from '../utilidades.js';
import { firmarParametros, generarNumeroPedido, verificarNotificacion } from '../redsys.js';
import { calcularPrecioEfectivo, ofertaActiva } from '../precios.js';
import { Ajustes } from '../db.js';
import { enviarCorreo, reemplazarVariables, listaArticulosHtml } from '../correo.js';
import { insertarSuscriptor } from './suscriptores.js';
import { nuevoId as idNueva } from '../utilidades.js';

const URLS_REDSYS = {
  test: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  produccion: 'https://sis.redsys.es/sis/realizarPago',
};

function redesPublicas(redes) {
  const limpias = {};
  for (const [red, url] of Object.entries(redes || {})) {
    if (typeof url === 'string' && url.trim()) limpias[red] = url.trim();
  }
  return limpias;
}

function datosPublicos(ajustes) {
  return {
    nombreComercio: (ajustes.redsys && ajustes.redsys.nombreComercio) || 'SHADDAI · Esencia de Umbral',
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

function calcularEnvio(subtotal, ajustesEnvio) {
  if (!ajustesEnvio || ajustesEnvio.activo === false) return 0;
  const coste = Number(ajustesEnvio.coste) || 0;
  const gratisDesde = Number(ajustesEnvio.gratisDesde) || 0;
  if (subtotal === 0) return 0;
  if (gratisDesde > 0 && subtotal >= gratisDesde) return 0;
  return Math.round(coste * 100) / 100;
}

export function registrar(enrutador, cx) {
  // ── Públicos simples ─────────────────────────────────────────────────────
  enrutador.get('/api/public/config', async (c) => {
    const ajustes = await new Ajustes(c.db).leer();
    return respuestaJson({ datos: datosPublicos(ajustes) });
  });

  enrutador.get('/api/public/testimonios', async (c) => {
    const datos = (await cx.coleccionTestimonios.leer())
      .filter((t) => t.aprobado === true)
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    return respuestaJson({ datos, total: datos.length });
  });

  // ── Contacto público (honeypot «web» + rate-limit 10/min) ────────────────
  enrutador.post('/api/public/contacto', async (c) => {
    const resultado = await limitar(c.db, `contacto|${ipDeRequest(c.request)}`, 10, 60 * 1000, 10 * 60 * 1000);
    if (resultado.bloqueado) return respuestaLimitador(resultado);

    const cuerpo = c.cuerpo || {};
    if (typeof cuerpo.web === 'string' && cuerpo.web.trim() !== '') {
      return respuestaJson({ ok: true, mensaje: 'Mensaje recibido. Te responderemos con la calma que mereces.' });
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
    if (!comprobacion.ok) return error400(comprobacion.errores);

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
    await cx.coleccionMensajes.insertar(mensaje);

    const ajustes = await new Ajustes(c.db).leer();
    const notificaciones = ajustes.notificaciones || {};
    const destinos = (ajustes.contacto && ajustes.contacto.emailsDestino) || [];
    if (notificaciones.nuevoContacto !== false && destinos.length > 0) {
      c.ctx.waitUntil(
        (async () => {
          try {
            await enviarCorreo(c.db, c.env, ajustes, {
              para: destinos,
              asunto: `Nuevo mensaje de contacto — ${mensaje.nombre}`,
              html: `<div style="font-family:Georgia,serif;color:#16261b;line-height:1.7;">
          <p><strong>Nombre:</strong> ${mensaje.nombre}</p>
          <p><strong>Email:</strong> ${mensaje.email}</p>
          ${mensaje.telefono ? `<p><strong>Teléfono:</strong> ${mensaje.telefono}</p>` : ''}
          <p><strong>Mensaje:</strong></p>
          <p style="white-space:pre-wrap;">${mensaje.texto.replace(/</g, '&lt;')}</p>
        </div>`,
              responderA: mensaje.email,
            });
          } catch {}
        })()
      );
    }

    return respuestaJson(
      { ok: true, mensaje: 'Mensaje recibido. Te responderemos con la calma que mereces.' },
      201
    );
  });

  // ── Suscripción pública (duplicados ignorados) ───────────────────────────
  enrutador.post('/api/public/suscribirse', async (c) => {
    const resultado = await limitar(c.db, `suscribirse|${ipDeRequest(c.request)}`, 10, 60 * 1000, 10 * 60 * 1000);
    if (resultado.bloqueado) return respuestaLimitador(resultado);

    const comprobacion = validar(
      {
        email: { tipo: 'email', requerido: true, etiqueta: 'el email' },
        nombre: { tipo: 'texto', defecto: '', max: 120 },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);

    const existente = (await cx.coleccionSuscriptores.leer()).find(
      (s) => s.email === comprobacion.datos.email
    );
    if (existente) {
      return respuestaJson({ ok: true, mensaje: 'Ya estabas en la lista: bienvenido de nuevo al Umbral.' });
    }
    await insertarSuscriptor(cx.coleccionSuscriptores, comprobacion.datos);
    return respuestaJson(
      { ok: true, mensaje: 'Bienvenido al Umbral: recibirás las próximas reflexiones y aperturas de lotes.' },
      201
    );
  });

  // ── Firma de pagos Redsys (público, rate-limit 30/min) ───────────────────
  enrutador.post('/api/pagos/firma', async (c) => {
    const resultado = await limitar(c.db, `pagos|${ipDeRequest(c.request)}`, 30, 60 * 1000, 5 * 60 * 1000);
    if (resultado.bloqueado) return respuestaLimitador(resultado);

    const comprobacion = validar(
      {
        articulos: { tipo: 'matriz', tipoItems: 'objeto', requerido: true, etiqueta: 'los artículos' },
        metodo: { tipo: 'texto', defecto: 'tarjeta', opciones: ['tarjeta', 'bizum'] },
        numeroPedido: { tipo: 'texto', max: 12 },
        envio: { tipo: 'objeto', defecto: {} },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);

    const { articulos, metodo } = comprobacion.datos;
    const datosEnvio = comprobacion.datos.envio || {};

    if (articulos.length === 0 || articulos.length > 50) {
      return error400('El pedido debe incluir entre 1 y 50 artículos.');
    }

    const ajustes = await new Ajustes(c.db).leer();
    const redsys = ajustes.redsys || {};
    if (!redsys.clave) {
      return respuestaJson({ error: 'El pago no está configurado todavía. Contacta con la tienda.' }, 500);
    }

    const ahoraMs = Date.now();
    const lineas = [];
    const todosProductos = await cx.coleccionProductos.leer();
    const todasOfertas = await cx.coleccionOfertas.leer();
    for (const articulo of articulos) {
      const cantidad = Number(articulo.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
        return error400('Cada artículo debe tener una cantidad entre 1 y 99.');
      }
      const buscado = String(articulo.codigo || articulo.slug || articulo.id || '').trim();
      const producto = todosProductos.find(
        (p) =>
          (buscado && (p.codigo === buscado || p.slug === buscado || p.id === buscado)) ||
          (articulo.nombre && p.nombre === articulo.nombre)
      );
      if (!producto) {
        return error400(`No reconocemos el artículo «${buscado || articulo.nombre || '?'}».`);
      }
      if (producto.activo === false) {
        return error400(`El artículo «${producto.nombre}» no está disponible ahora mismo.`);
      }
      const precioUnitario = calcularPrecioEfectivo(producto, todasOfertas, ahoraMs);
      lineas.push({
        id: producto.id,
        codigo: producto.codigo,
        nombre: producto.nombre,
        cantidad,
        precioUnitario,
      });
    }

    const subtotal = Math.round(lineas.reduce((suma, l) => suma + l.precioUnitario * l.cantidad, 0) * 100) / 100;
    const costeEnvio = calcularEnvio(subtotal, ajustes.envio);
    const total = Math.round((subtotal + costeEnvio) * 100) / 100;

    let numero = comprobacion.datos.numeroPedido || generarNumeroPedido();
    numero = String(numero).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (numero.length < 4 || numero.length > 12) {
      return error400('El número de pedido debe tener entre 4 y 12 caracteres alfanuméricos.');
    }
    if ((await cx.coleccionPedidos.leer()).some((p) => p.numero === numero)) {
      return error400('Ese número de pedido ya existe. Genera uno nuevo.');
    }

    const cliente = {
      nombre: String(datosEnvio.nombre || '').trim().slice(0, 60),
      apellidos: String(datosEnvio.apellidos || '').trim().slice(0, 60),
      email: String(datosEnvio.email || '').trim().slice(0, 120),
      telefono: String(datosEnvio.telefono || '').trim().slice(0, 30),
      direccion: String(datosEnvio.direccion || '').trim().slice(0, 200),
      cp: String(datosEnvio.cp || '').trim().slice(0, 10),
      poblacion: String(datosEnvio.poblacion || '').trim().slice(0, 100),
      provincia: String(datosEnvio.provincia || '').trim().slice(0, 100),
    };

    const origen = c.url.origin;
    const urlOk = redsys.urlOk || `${origen}/pago-ok.html`;
    const urlKo = redsys.urlKo || `${origen}/pago-ko.html`;
    const urlNotificacion = redsys.urlNotificacion || `${origen}/api/public/redsys-notificacion`;

    const importe = String(Math.round(total * 100));
    const descripcion = lineas
      .map((l) => `${l.cantidad}× ${l.nombre}`)
      .join(' · ')
      .slice(0, 120);

    const parametros = {
      DS_MERCHANT_AMOUNT: importe,
      DS_MERCHANT_ORDER: numero,
      DS_MERCHANT_MERCHANTCODE: String(redsys.fuc || ''),
      DS_MERCHANT_CURRENCY: String(redsys.moneda || '978'),
      DS_MERCHANT_TRANSACTIONTYPE: '0',
      DS_MERCHANT_TERMINAL: String(redsys.terminal || '1'),
      DS_MERCHANT_MERCHANTNAME: String(redsys.nombreComercio || '').slice(0, 60),
      DS_MERCHANT_PRODUCTDESCRIPTION: descripcion,
      DS_MERCHANT_TITULAR: [cliente.nombre, cliente.apellidos].filter(Boolean).join(' ').slice(0, 60),
      DS_MERCHANT_CONSUMERLANGUAGE: '001',
      DS_MERCHANT_URLOK: urlOk,
      DS_MERCHANT_URLKO: urlKo,
      DS_MERCHANT_MERCHANTURL: urlNotificacion,
      DS_MERCHANT_PAYMETHODS: metodo === 'bizum' ? 'z' : 'C',
    };

    let parametrosB64;
    let firma;
    try {
      parametrosB64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(parametros))));
      firma = await firmarParametros(parametrosB64, numero, redsys.clave);
    } catch (error) {
      return respuestaJson({ error: 'No se pudo firmar el pedido: ' + error.message }, 500);
    }

    const pedido = {
      id: nuevoId('ped'),
      numero,
      fecha: ahora(),
      estado: 'pendiente',
      metodo,
      articulos: lineas,
      cliente,
      subtotal,
      envio: costeEnvio,
      total,
      moneda: String(redsys.moneda || '978'),
      origen,
      pagadoEn: null,
      respuestaRedsys: null,
    };
    await cx.coleccionPedidos.insertar(pedido, { numero: pedido.numero, estado: pedido.estado });
    for (const linea of lineas) {
      await c.db
        .prepare('INSERT INTO pedidos_lineas (id, pedido, datos) VALUES (?1, ?2, ?3)')
        .bind(idNueva('lin'), pedido.id, JSON.stringify(linea))
        .run();
    }

    return respuestaJson({
      numeroPedido: numero,
      url: URLS_REDSYS[redsys.entorno] || URLS_REDSYS.test,
      version: 'HMAC_SHA256_V1',
      parametrosB64,
      firma,
      parametros,
      resumen: {
        subtotal,
        envio: costeEnvio,
        total,
        totalTexto: formatearEuro(total),
        articulos: lineas,
      },
      pedidoId: pedido.id,
    });
  });

  // ── Notificación de Redsys (urlencoded) ──────────────────────────────────
  enrutador.post('/api/public/redsys-notificacion', async (c) => {
    const ajustes = await new Ajustes(c.db).leer();
    const clave = ajustes.redsys && ajustes.redsys.clave;
    if (!clave) {
      return respuestaJson({ error: 'Pago no configurado.' }, 500);
    }

    const verificacion = await verificarNotificacion(c.cuerpoFormulario, clave);
    if (!verificacion.ok) {
      return respuestaJson({ error: verificacion.motivo }, 400);
    }

    const pedido = (await cx.coleccionPedidos.leer()).find((p) => p.numero === verificacion.pedido);
    if (!pedido) {
      return respuestaJson({ error: 'Pedido no encontrado para esta notificación.' }, 404);
    }

    if (pedido.estado === 'pagado') {
      return respuestaJson({ ok: true, mensaje: 'Pedido ya marcado como pagado.' });
    }

    if (!verificacion.autorizado) {
      await cx.coleccionPedidos.modificar(pedido.id, {
        estado: 'cancelado',
        respuestaRedsys: {
          respuesta: verificacion.respuesta,
          autorizacion: verificacion.autorizacion,
          importe: verificacion.importe,
        },
      });
      return respuestaJson({ ok: true, mensaje: 'Pago no autorizado: pedido cancelado.' });
    }

    if (verificacion.importe && Math.round(pedido.total * 100) !== verificacion.importe) {
      return respuestaJson({ error: 'El importe notificado no coincide con el pedido.' }, 400);
    }

    await cx.coleccionPedidos.modificar(pedido.id, {
      estado: 'pagado',
      pagadoEn: ahora(),
      respuestaRedsys: {
        respuesta: verificacion.respuesta,
        autorizacion: verificacion.autorizacion,
        importe: verificacion.importe,
      },
    });

    const pedidoActualizado = await cx.coleccionPedidos.porId(pedido.id);
    const emails = ajustes['emails-automaticos'] || {};
    const nombre = pedidoActualizado.cliente.nombre || 'alma buscadora';
    const variables = {
      nombre,
      pedido: pedidoActualizado.numero,
      total: formatearEuro(pedidoActualizado.total),
      articulos: listaArticulosHtml(pedidoActualizado.articulos),
    };

    c.ctx.waitUntil(
      (async () => {
        try {
          for (const clavePlantilla of ['confirmacionCompra', 'agradecimiento']) {
            const plantilla = emails[clavePlantilla];
            if (!plantilla || plantilla.activo === false || !pedidoActualizado.cliente.email) continue;
            await enviarCorreo(
              c.db,
              c.env,
              ajustes,
              {
                para: pedidoActualizado.cliente.email,
                asunto: reemplazarVariables(plantilla.asunto, variables),
                html: reemplazarVariables(plantilla.html, variables),
              },
              { pedido: pedidoActualizado.numero }
            );
          }
          const notificaciones = ajustes.notificaciones || {};
          const destinos = (ajustes.contacto && ajustes.contacto.emailsDestino) || [];
          if (notificaciones.nuevoPedido !== false && destinos.length > 0) {
            await enviarCorreo(
              c.db,
              c.env,
              ajustes,
              {
                para: destinos,
                asunto: `Nuevo pedido pagado — ${pedidoActualizado.numero}`,
                html: `<div style="font-family:Georgia,serif;color:#16261b;line-height:1.7;">
          <p><strong>Pedido:</strong> ${pedidoActualizado.numero}</p>
          <p><strong>Cliente:</strong> ${nombre} (${pedidoActualizado.cliente.email})</p>
          <p><strong>Total:</strong> ${formatearEuro(pedidoActualizado.total)}</p>
          ${listaArticulosHtml(pedidoActualizado.articulos)}
        </div>`,
              },
              { pedido: pedidoActualizado.numero }
            );
          }
        } catch {}
      })()
    );

    return respuestaJson({ ok: true, mensaje: 'Notificación procesada: pedido marcado como pagado.' });
  });
}
