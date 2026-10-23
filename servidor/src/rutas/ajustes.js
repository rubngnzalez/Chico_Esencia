'use strict';

const express = require('express');
const { Ajustes } = require('../almacen');
const { requerirRol } = require('../seguridad');
const { validar, error400 } = require('../utilidades');

const almacenAjustes = new Ajustes();

const MASCARA = '••••••••';
const SECCIONES = [
  'contacto',
  'redes',
  'smtp',
  'redsys',
  'envio',
  'emails-automaticos',
  'notificaciones',
];

const ESQUEMAS = {
  contacto: {
    emailsDestino: { tipo: 'matriz', tipoItems: 'texto', requerido: true, etiqueta: 'los emails de destino' },
    telefono: { tipo: 'texto', defecto: '', max: 60 },
    direccion: { tipo: 'texto', defecto: '', max: 300 },
    horario: { tipo: 'texto', defecto: '', max: 300 },
  },
  redes: {
    instagram: { tipo: 'texto', defecto: '', max: 300 },
    tiktok: { tipo: 'texto', defecto: '', max: 300 },
    pinterest: { tipo: 'texto', defecto: '', max: 300 },
    facebook: { tipo: 'texto', defecto: '', max: 300 },
    youtube: { tipo: 'texto', defecto: '', max: 300 },
    whatsapp: { tipo: 'texto', defecto: '', max: 300 },
  },
  smtp: {
    host: { tipo: 'texto', defecto: '', max: 200 },
    puerto: { tipo: 'entero', defecto: 587, min: 1, max: 65535 },
    usuario: { tipo: 'texto', defecto: '', max: 200 },
    contraseña: { tipo: 'texto', defecto: '', max: 200 },
    desde: { tipo: 'texto', defecto: '', max: 200 },
    activo: { tipo: 'booleano', defecto: false },
  },
  redsys: {
    fuc: { tipo: 'texto', defecto: '', max: 20 },
    terminal: { tipo: 'texto', defecto: '1', max: 5 },
    moneda: { tipo: 'texto', defecto: '978', max: 3 },
    entorno: { tipo: 'texto', defecto: 'test', opciones: ['test', 'produccion'] },
    clave: { tipo: 'texto', defecto: '', max: 200 },
    nombreComercio: { tipo: 'texto', defecto: 'SHADDAI · Esencia de Umbral', max: 60 },
    urlOk: { tipo: 'texto', defecto: '', max: 500 },
    urlKo: { tipo: 'texto', defecto: '', max: 500 },
    urlNotificacion: { tipo: 'texto', defecto: '', max: 500 },
    metodoTarjeta: { tipo: 'booleano', defecto: true },
    metodoBizum: { tipo: 'booleano', defecto: true },
  },
  envio: {
    coste: { tipo: 'numero', defecto: 0, min: 0, max: 10000 },
    gratisDesde: { tipo: 'numero', defecto: 0, min: 0, max: 1000000 },
    plazos: { tipo: 'texto', defecto: '', max: 2000 },
    activo: { tipo: 'booleano', defecto: true },
  },
  'emails-automaticos': {
    confirmacionCompra: {
      tipo: 'objeto',
      defecto: undefined,
      etiqueta: 'la plantilla de confirmación de compra',
    },
    agradecimiento: {
      tipo: 'objeto',
      defecto: undefined,
      etiqueta: 'la plantilla de agradecimiento',
    },
  },
  notificaciones: {
    email: { tipo: 'texto', defecto: '', max: 200 },
    nuevoPedido: { tipo: 'booleano', defecto: true },
    nuevoContacto: { tipo: 'booleano', defecto: true },
    nuevoMensaje: { tipo: 'booleano', defecto: true },
  },
};

function enmascararPublicacion(ajustes) {
  const copia = JSON.parse(JSON.stringify(ajustes));
  if (copia.smtp && copia.smtp.contraseña) copia.smtp.contraseña = MASCARA;
  if (copia.redsys && copia.redsys.clave) copia.redsys.clave = MASCARA;
  return copia;
}

function validarPlantillaEmail(nombre, plantilla) {
  if (!plantilla || typeof plantilla !== 'object' || Array.isArray(plantilla)) {
    return `La plantilla «${nombre}» debe ser un objeto con asunto, html y activo.`;
  }
  if (typeof plantilla.activo !== 'boolean') {
    return `La plantilla «${nombre}» debe indicar «activo» (verdadero o falso).`;
  }
  if (typeof plantilla.asunto !== 'string' || !plantilla.asunto.trim()) {
    return `La plantilla «${nombre}» debe tener asunto.`;
  }
  if (typeof plantilla.html !== 'string' || !plantilla.html.trim()) {
    return `La plantilla «${nombre}» debe tener contenido HTML.`;
  }
  return null;
}

const enrutador = express.Router();

enrutador.get('/', requerirRol('admin'), (req, res) => {
  res.json({ datos: enmascararPublicacion(almacenAjustes.leer()) });
});

enrutador.put('/:seccion', requerirRol('admin'), (req, res) => {
  const seccion = req.params.seccion;
  if (!SECCIONES.includes(seccion)) {
    return error400(res, `Sección de ajustes desconocida. Secciones válidas: ${SECCIONES.join(', ')}.`);
  }

  if (seccion === 'emails-automaticos') {
    const cuerpo = req.body || {};
    const actuales = almacenAjustes.leer()[seccion] || {};
    const cambios = {};
    for (const nombre of ['confirmacionCompra', 'agradecimiento']) {
      if (cuerpo[nombre] === undefined) continue;
      const error = validarPlantillaEmail(nombre, cuerpo[nombre]);
      if (error) return error400(res, error);
      cambios[nombre] = {
        activo: cuerpo[nombre].activo,
        asunto: cuerpo[nombre].asunto.trim().slice(0, 300),
        html: String(cuerpo[nombre].html).slice(0, 200000),
      };
    }
    if (Object.keys(cambios).length === 0) {
      return error400(res, 'No hay plantillas que actualizar.');
    }
    const resultado = almacenAjustes.fusionar(seccion, { ...actuales, ...cambios });
    return res.json({ datos: enmascararPublicacion(resultado)[seccion] });
  }

  const comprobacion = validar(ESQUEMAS[seccion], req.body);
  if (!comprobacion.ok) return error400(res, comprobacion.errores);
  let datos = comprobacion.datos;

  if (seccion === 'contacto') {
    const emails = datos.emailsDestino.filter((e) => e.length > 0);
    if (emails.length === 0) return error400(res, 'Debes indicar al menos un email de destino.');
    datos.emailsDestino = emails;
  }

  if (seccion === 'smtp' || seccion === 'redsys') {
    const actuales = almacenAjustes.leer()[seccion] || {};
    const campo = seccion === 'smtp' ? 'contraseña' : 'clave';
    const entrada = req.body || {};
    if (entrada[campo] === undefined || entrada[campo] === MASCARA || entrada[campo] === '') {
      datos[campo] = actuales[campo] || '';
    }
  }

  const resultado = almacenAjustes.fusionar(seccion, datos);
  res.json({ datos: enmascararPublicacion(resultado)[seccion] });
});

enrutador.almacen = almacenAjustes;
enrutador.SECCIONES = SECCIONES;

module.exports = enrutador;
