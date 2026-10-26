// /api/productos (puerto de rutas/productos.js) + /api/productos/publico

import { Coleccion } from '../db.js';
import { crearCrud } from './crud.js';
import { requerirSesion } from '../seguridad.js';
import { calcularPrecioEfectivo } from '../precios.js';
import { respuestaJson } from '../utilidades.js';

export const esquemaProducto = {
  nombre: { tipo: 'texto', requerido: true, min: 1, max: 160, etiqueta: 'el nombre' },
  slug: { tipo: 'texto', defecto: '', max: 90 },
  descripcion: { tipo: 'texto', defecto: '', max: 3000 },
  historia: { tipo: 'texto', defecto: '', max: 12000 },
  precio: { tipo: 'numero', requerido: true, min: 0, max: 100000, etiqueta: 'el precio' },
  precioOferta: { tipo: 'numero', min: 0, max: 100000, nulable: true, etiqueta: 'el precio de oferta' },
  stock: { tipo: 'entero', defecto: 0, min: 0, max: 1000000, etiqueta: 'el stock' },
  categoria: { tipo: 'texto', defecto: '' },
  imagenes: { tipo: 'matriz', tipoItems: 'texto', defecto: [] },
  destacado: { tipo: 'booleano', defecto: false },
  activo: { tipo: 'booleano', defecto: true },
  codigo: { tipo: 'texto', defecto: '', max: 60 },
};

export function registrar(enrutador, cx) {
  const crud = crearCrud({
    coleccion: cx.coleccionProductos,
    esquema: esquemaProducto,
    campoSlug: 'nombre',
    rolEscritura: ['admin', 'editor'],
    ordenarPor: 'creadoEn',
  });

  enrutador.get('/api/productos/publico', async () => {
    const ahoraMs = Date.now();
    const activos = (await cx.coleccionProductos.leer()).filter((p) => p.activo);
    const ofertas = await cx.coleccionOfertas.leer();
    const datos = activos.map((p) => ({ ...p, precioEfectivo: calcularPrecioEfectivo(p, ofertas, ahoraMs) }));
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/productos', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.listar();
  });
  enrutador.get('/api/productos/:id', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.obtener(c.params.id);
  });
  enrutador.post('/api/productos', (c) => crud.crear(c));
  enrutador.put('/api/productos/:id', (c) => crud.modificar(c, c.params.id));
  enrutador.delete('/api/productos/:id', (c) => crud.eliminar(c, c.params.id));
}
