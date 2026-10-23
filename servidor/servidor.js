'use strict';

const path = require('path');
const express = require('express');

const almacen = require('./src/almacen');
const semilla = require('./src/semilla');
const seguridad = require('./src/seguridad');
const { Coleccion, Ajustes } = require('./src/almacen');
const { refrescarProgramados } = require('./src/blog-estatico');

const RAIZ_WEB = path.join(__dirname, '..', 'shaddai-web');

function crearAplicacion() {
  almacen.asegurarCarpetas();

  const ajustesAlmacen = new Ajustes();
  semilla.ejecutar(ajustesAlmacen);
  try {
    refrescarProgramados();
  } catch {}

  const aplicacion = express();
  aplicacion.disable('x-powered-by');

  const usuarios = new Coleccion('usuarios');
  aplicacion.use(seguridad.adjuntarUsuario(usuarios));

  // La subida de imágenes lleva su propio límite (el base64 de 5 MB pesa ~7 MB)
  // y va antes del límite global de 2 MB para que este no rechace el cuerpo.
  aplicacion.use('/api/subir-imagen', express.json({ limit: '9mb' }), require('./src/rutas/subir-imagen'));
  aplicacion.use(express.json({ limit: '2mb' }));

  aplicacion.use('/api', seguridad.bloquearCambioPendiente());

  aplicacion.use('/api/auth', require('./src/rutas/auth'));
  aplicacion.use('/api/productos', require('./src/rutas/productos'));
  aplicacion.use('/api/categorias', require('./src/rutas/categorias'));
  aplicacion.use('/api/ofertas', require('./src/rutas/ofertas'));
  aplicacion.use('/api/testimonios', require('./src/rutas/testimonios'));
  aplicacion.use('/api/articulos', require('./src/rutas/articulos'));
  aplicacion.use('/api/mensajes', require('./src/rutas/mensajes'));
  aplicacion.use('/api/suscriptores', require('./src/rutas/suscriptores'));
  aplicacion.use('/api/campanas', require('./src/rutas/campanas'));
  aplicacion.use('/api/ajustes', require('./src/rutas/ajustes'));
  aplicacion.use('/api/pedidos', require('./src/rutas/pedidos'));
  aplicacion.use('/api/pagos', require('./src/rutas/pagos'));
  aplicacion.use('/api/usuarios', require('./src/rutas/usuarios'));
  aplicacion.use('/api/public', require('./src/rutas/publico'));

  aplicacion.use('/api', (req, res) => {
    res.status(404).json({ error: 'Ruta de la API no encontrada.' });
  });

  aplicacion.use('/panel', express.static(path.join(__dirname, 'panel'), { index: 'index.html' }));
  aplicacion.use('/panel', (req, res) => {
    res.sendFile(path.join(__dirname, 'panel', 'index.html'));
  });

  aplicacion.use(express.static(RAIZ_WEB, { extensions: ['html'] }));
  aplicacion.use((req, res) => {
    res.status(404).sendFile(path.join(RAIZ_WEB, '404.html'));
  });

  aplicacion.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const estado = error.estado || error.status || 500;
    if (estado >= 500) {
      console.error('Error inesperado:', error);
    }
    res.status(estado).json({ error: error.message || 'Error interno del servidor.' });
  });

  return aplicacion;
}

function arrancar() {
  const puerto = Number(process.env.PUERTO) || 3000;
  const aplicacion = crearAplicacion();
  const servidor = aplicacion.listen(puerto, () => {
    console.log('');
    console.log('  SHADDAI · Esencia de Umbral — servidor del panel');
    console.log(`  Web pública:   http://localhost:${puerto}/`);
    console.log(`  Panel:         http://localhost:${puerto}/panel`);
    console.log(`  API:           http://localhost:${puerto}/api/public/config`);
    console.log('');
  });
  return servidor;
}

if (require.main === module) {
  arrancar();
}

module.exports = { crearAplicacion, arrancar };
