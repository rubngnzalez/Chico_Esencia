// /api/ofertas (puerto de rutas/ofertas.js): listado con activaAhora y
// productoNombre; alta valida que el producto exista.

import { crearCrud } from './crud.js';
import { requerirSesion } from '../seguridad.js';
import { ofertaActiva } from '../precios.js';
import { ErrorEstado, respuestaJson } from '../utilidades.js';

export function registrar(enrutador, cx) {
  const crud = crearCrud({
    coleccion: cx.coleccionOfertas,
    esquema: {
      producto: { tipo: 'texto', requerido: true, etiqueta: 'el producto' },
      tipo: { tipo: 'texto', requerido: true, opciones: ['precio', 'porcentaje'], etiqueta: 'el tipo de oferta' },
      valor: { tipo: 'numero', requerido: true, min: 0, max: 1000000, etiqueta: 'el valor' },
      inicio: { tipo: 'fecha', etiqueta: 'la fecha de inicio' },
      fin: { tipo: 'fecha', etiqueta: 'la fecha de fin' },
      activa: { tipo: 'booleano', defecto: true },
    },
    rolEscritura: ['admin', 'editor'],
    alCrear: async (oferta) => {
      if (!(await cx.coleccionProductos.porId(oferta.producto))) {
        throw new ErrorEstado('El producto indicado no existe.', 400);
      }
    },
  });

  enrutador.get('/api/ofertas', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    const ahoraMs = Date.now();
    const productos = await cx.coleccionProductos.leer();
    const mapaProductos = new Map(productos.map((p) => [p.id, p]));
    const datos = (await cx.coleccionOfertas.todo()).map((oferta) => {
      const producto = mapaProductos.get(oferta.producto);
      return {
        ...oferta,
        activaAhora: ofertaActiva(oferta, ahoraMs),
        productoNombre: producto ? producto.nombre : '(producto eliminado)',
      };
    });
    datos.sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/ofertas/:id', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.obtener(c.params.id);
  });
  enrutador.post('/api/ofertas', (c) => crud.crear(c));
  enrutador.put('/api/ofertas/:id', (c) => crud.modificar(c, c.params.id));
  enrutador.delete('/api/ofertas/:id', (c) => crud.eliminar(c, c.params.id));
}
