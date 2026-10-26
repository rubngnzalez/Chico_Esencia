// /api/categorias (puerto de rutas/categorias.js)

import { crearCrud } from './crud.js';
import { requerirSesion } from '../seguridad.js';

export function registrar(enrutador, cx) {
  const crud = crearCrud({
    coleccion: cx.coleccionCategorias,
    esquema: {
      nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
      slug: { tipo: 'texto', defecto: '', max: 90 },
      descripcion: { tipo: 'texto', defecto: '', max: 2000 },
      orden: { tipo: 'entero', defecto: 0, min: 0, max: 9999 },
    },
    campoSlug: 'nombre',
    rolEscritura: ['admin', 'editor'],
    ordenarPor: 'orden',
  });

  enrutador.get('/api/categorias', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.listar();
  });
  enrutador.get('/api/categorias/:id', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.obtener(c.params.id);
  });
  enrutador.post('/api/categorias', (c) => crud.crear(c));
  enrutador.put('/api/categorias/:id', (c) => crud.modificar(c, c.params.id));
  enrutador.delete('/api/categorias/:id', (c) => crud.eliminar(c, c.params.id));
}
