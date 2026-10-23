'use strict';

const express = require('express');
const { Coleccion, Ajustes } = require('../almacen');
const { limitador } = require('../seguridad');
const { validar, error400, ahora, formatearEuro, nuevoId } = require('../utilidades');
const { firmarParametros, generarNumeroPedido } = require('../redsys');

const productos = new Coleccion('productos');
const ofertas = new Coleccion('ofertas');
const pedidos = new Coleccion('pedidos');
const almacenAjustes = new Ajustes();

const URLS_REDSYS = {
  test: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  produccion: 'https://sis.redsys.es/sis/realizarPago',
};

function ofertaAplicable(oferta, ahoraMs) {
  if (!oferta.activa) return false;
  const inicio = oferta.inicio ? Date.parse(oferta.inicio) : 0;
  const fin = oferta.fin ? Date.parse(oferta.fin) : Infinity;
  return inicio <= ahoraMs && ahoraMs <= fin;
}

function precioConOferta(producto, ahoraMs) {
  const base = Number(producto.precio) || 0;
  let precio = Number(producto.precioOferta) > 0 ? Number(producto.precioOferta) : base;
  for (const oferta of ofertas.leer()) {
    if (oferta.producto !== producto.id || !ofertaAplicable(oferta, ahoraMs)) continue;
    const valor = Number(oferta.valor) || 0;
    const candidato = oferta.tipo === 'porcentaje' ? base * (1 - valor / 100) : valor;
    if (candidato >= 0 && candidato < precio) precio = Math.round(candidato * 100) / 100;
  }
  return Math.round(precio * 100) / 100;
}

function calcularEnvio(subtotal, ajustesEnvio) {
  if (!ajustesEnvio || ajustesEnvio.activo === false) return 0;
  const coste = Number(ajustesEnvio.coste) || 0;
  const gratisDesde = Number(ajustesEnvio.gratisDesde) || 0;
  if (subtotal === 0) return 0;
  if (gratisDesde > 0 && subtotal >= gratisDesde) return 0;
  return Math.round(coste * 100) / 100;
}

const enrutador = express.Router();

enrutador.post('/firma', limitador(30, 60 * 1000, 5 * 60 * 1000), (req, res) => {
  const comprobacion = validar(
    {
      articulos: { tipo: 'matriz', tipoItems: 'objeto', requerido: true, etiqueta: 'los artículos' },
      metodo: { tipo: 'texto', defecto: 'tarjeta', opciones: ['tarjeta', 'bizum'] },
      numeroPedido: { tipo: 'texto', max: 12 },
      envio: { tipo: 'objeto', defecto: {} },
    },
    req.body
  );
  if (!comprobacion.ok) return error400(res, comprobacion.errores);

  const { articulos, metodo } = comprobacion.datos;
  const datosEnvio = comprobacion.datos.envio || {};

  if (articulos.length === 0 || articulos.length > 50) {
    return error400(res, 'El pedido debe incluir entre 1 y 50 artículos.');
  }

  const ajustes = almacenAjustes.leer();
  const redsys = ajustes.redsys || {};
  if (!redsys.clave) {
    return res.status(500).json({ error: 'El pago no está configurado todavía. Contacta con la tienda.' });
  }

  const ahoraMs = Date.now();
  const lineas = [];
  for (const articulo of articulos) {
    const cantidad = Number(articulo.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
      return error400(res, 'Cada artículo debe tener una cantidad entre 1 y 99.');
    }
    const buscado = String(articulo.codigo || articulo.slug || articulo.id || '').trim();
    const producto = productos
      .leer()
      .find(
        (p) =>
          (buscado && (p.codigo === buscado || p.slug === buscado || p.id === buscado)) ||
          (articulo.nombre && p.nombre === articulo.nombre)
      );
    if (!producto) {
      return error400(res, `No reconocemos el artículo «${buscado || articulo.nombre || '?'}».`);
    }
    if (producto.activo === false) {
      return error400(res, `El artículo «${producto.nombre}» no está disponible ahora mismo.`);
    }
    const precioUnitario = precioConOferta(producto, ahoraMs);
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
    return error400(res, 'El número de pedido debe tener entre 4 y 12 caracteres alfanuméricos.');
  }
  if (pedidos.leer().some((p) => p.numero === numero)) {
    return error400(res, 'Ese número de pedido ya existe. Genera uno nuevo.');
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

  const origen = `${req.protocol}://${req.get('host')}`;
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
    parametrosB64 = Buffer.from(JSON.stringify(parametros), 'utf8').toString('base64');
    firma = firmarParametros(parametrosB64, numero, redsys.clave);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo firmar el pedido: ' + error.message });
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
  pedidos.insertar(pedido);

  res.json({
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

enrutador.coleccionPedidos = pedidos;

module.exports = enrutador;
