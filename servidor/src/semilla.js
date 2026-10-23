'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const { CARPETA_DATOS, Coleccion, escribirAtomico } = require('./almacen');
const { ajustesIniciales } = require('./ajustes-defecto');
const { ahora, nuevoId, slugificar, tokenAleatorio } = require('./utilidades');

const usuarios = new Coleccion('usuarios');
const categorias = new Coleccion('categorias');
const productos = new Coleccion('productos');

const PRODUCTOS_SEMILLA = [
  {
    codigo: 'esencia-umbral-50',
    nombre: 'Esencia de Umbral · 50 ml',
    descripcion: 'El Eau de Parfum Neurosensorial original, 1ª Edición especial.',
    historia:
      'Inhala el Origen — el aroma invisible que abre el encuentro y te devuelve al interior. Exhala tu Esencia — libera el peso, aclara la mente y reconócete en este umbral.',
    precio: 55,
    precioOferta: null,
    stock: 25,
    imagen: 'img/esencia-50.webp',
    destacado: true,
  },
  {
    codigo: 'perfume-solido',
    nombre: 'Perfume Sólido Natural · 12 g',
    descripcion: 'La Esencia de Umbral en bálsamo: el umbral que cabe en el bolsillo y despierta despacio.',
    historia:
      'Fragancia sólida — se funde con la piel y libera su aroma al ritmo de tu pulso. Frasco de 12 g para llevar el ritual en el bolsillo, sin pulverizar. Misma alma: inhala el origen, exhala tu esencia, estés donde estés.',
    precio: 25,
    precioOferta: null,
    stock: 25,
    imagen: 'img/perfume-solido.webp',
    destacado: false,
  },
  {
    codigo: 'duo-ritual',
    nombre: 'Dúo Ritual · Esencia + Perfume Sólido',
    descripcion: 'La Esencia de Umbral y el Perfume Sólido Natural juntos, con precio de lanzamiento.',
    historia:
      'Las dos piezas del umbral: el Eau de Parfum Neurosensorial original de 50 ml y el Perfume Sólido Natural de 12 g. Ahorro especial: 75 € en lugar de 80 € por separado.',
    precio: 80,
    precioOferta: 75,
    stock: 25,
    imagen: 'img/duo-esencial.webp',
    destacado: false,
  },
];

function crearAdminInicial() {
  if (usuarios.leer().length > 0) return null;
  const contraseña = 'Shaddai-' + tokenAleatorio(10);
  const admin = {
    id: nuevoId('usr'),
    nombre: 'Administración',
    email: 'admin@omshaddai.com',
    hashContrasena: bcrypt.hashSync(contraseña, 10),
    rol: 'admin',
    activo: true,
    debeCambiarContrasena: true,
    creadoEn: ahora(),
    ultimoAcceso: null,
  };
  usuarios.insertar(admin);
  return { email: admin.email, contraseña };
}

function anunciarAdmin(credenciales) {
  const linea = '='.repeat(64);
  console.log('');
  console.log(linea);
  console.log('  PRIMER ARRANQUE · usuario administrador creado');
  console.log('');
  console.log(`  Email:      ${credenciales.email}`);
  console.log(`  Contraseña: ${credenciales.contraseña}`);
  console.log('');
  console.log('  Esta contraseña temporal SOLO se muestra esta vez.');
  console.log('  El panel pedirá cambiarla en el primer acceso.');
  console.log(linea);
  console.log('');
  try {
    escribirAtomico(
      path.join(CARPETA_DATOS, `creado-${new Date().toISOString().slice(0, 10)}.txt`),
      [
        'Credenciales del administrador inicial (solo locales, no subir al repositorio).',
        `Generado: ${ahora()}`,
        `Email: ${credenciales.email}`,
        `Contraseña temporal: ${credenciales.contraseña}`,
        'Se pedirá cambiarla en el primer inicio de sesión.',
        '',
      ].join('\n')
    );
  } catch {}
}

function sembrarCatalogo() {
  if (categorias.leer().length === 0) {
    categorias.insertar({
      id: nuevoId('cat'),
      nombre: 'Esencias',
      slug: 'esencias',
      descripcion: 'Las piezas del Umbral: eau de parfum neurosensorial y perfume sólido, elaborados a mano en lotes numerados.',
      orden: 1,
      creadoEn: ahora(),
    });
  }

  if (productos.leer().length === 0) {
    for (const plantilla of PRODUCTOS_SEMILLA) {
      productos.insertar({
        id: nuevoId('prd'),
        nombre: plantilla.nombre,
        slug: slugificar(plantilla.nombre),
        descripcion: plantilla.descripcion,
        historia: plantilla.historia,
        precio: plantilla.precio,
        precioOferta: plantilla.precioOferta,
        stock: plantilla.stock,
        categoria: 'esencias',
        imagenes: [plantilla.imagen],
        destacado: plantilla.destacado,
        activo: true,
        codigo: plantilla.codigo,
        creadoEn: ahora(),
        actualizadoEn: ahora(),
      });
    }
  }
}

function sembrarAjustes(almacenAjustes) {
  const actuales = almacenAjustes.leer();
  if (Object.keys(actuales).length === 0) {
    almacenAjustes.guardar(ajustesIniciales());
  }
}

function ejecutar(almacenAjustes) {
  const credenciales = crearAdminInicial();
  if (credenciales) anunciarAdmin(credenciales);
  sembrarCatalogo();
  sembrarAjustes(almacenAjustes);
  return credenciales;
}

module.exports = { ejecutar };
