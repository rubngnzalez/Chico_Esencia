// Semilla inicial del Worker (sin usuarios): ajustes por defecto, categoría
// «Esencias» y catálogo inicial, igual que servidor/src/semilla.js.
// El administrador NO se siembra: se crea con /api/instalacion.

import { Ajustes, Coleccion } from './db.js';
import { ajustesIniciales } from './ajustes-defecto.js';
import { ahora, nuevoId, slugificar } from './utilidades.js';

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

// Se ejecuta como mucho una vez por aislado: una consulta barata y, si la
// base está vacía, se siembran ajustes, categoría y catálogo.
let sembradoEnEsteAislado = false;

export async function asegurarSemilla(db) {
  if (sembradoEnEsteAislado) return;
  sembradoEnEsteAislado = true;
  try {
    const ajustes = new Ajustes(db);
    const actuales = await ajustes.leer();
    if (Object.keys(actuales).length === 0) {
      await ajustes.guardar(ajustesIniciales());
    }

    const categorias = new Coleccion(db, 'categorias', [['slug', 'slug']]);
    if ((await categorias.leer()).length === 0) {
      await categorias.insertar({
        id: nuevoId('cat'),
        nombre: 'Esencias',
        slug: 'esencias',
        descripcion:
          'Las piezas del Umbral: eau de parfum neurosensorial y perfume sólido, elaborados a mano en lotes numerados.',
        orden: 1,
        creadoEn: ahora(),
      });
    }

    const productos = new Coleccion(db, 'productos', [
      ['codigo', 'codigo'],
      ['slug', 'slug'],
    ]);
    if ((await productos.leer()).length === 0) {
      for (const plantilla of PRODUCTOS_SEMILLA) {
        await productos.insertar({
          id: nuevoId('pro'),
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
  } catch {
    sembradoEnEsteAislado = false;
  }
}
