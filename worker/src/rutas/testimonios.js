// /api/testimonios (puerto de rutas/testimonios.js)

import { crearCrud } from './crud.js';
import { requerirSesion } from '../seguridad.js';
import { ahora, respuestaJson } from '../utilidades.js';

export function registrar(enrutador, cx) {
  const crud = crearCrud({
    coleccion: cx.coleccionTestimonios,
    esquema: {
      nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
      texto: { tipo: 'texto', requerido: true, min: 1, max: 4000, etiqueta: 'el texto' },
      estrellas: { tipo: 'entero', requerido: true, min: 1, max: 5, etiqueta: 'las estrellas' },
      ciudad: { tipo: 'texto', defecto: '', max: 120 },
      producto: { tipo: 'texto', defecto: '', max: 160 },
      fecha: { tipo: 'fecha', defecto: undefined },
      aprobado: { tipo: 'booleano', defecto: false },
    },
    rolEscritura: ['admin', 'editor'],
    ordenarPor: 'fecha',
    alCrear: async (testimonio) => {
      if (!testimonio.fecha) testimonio.fecha = ahora();
    },
  });

  enrutador.get('/api/testimonios', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.listar();
  });
  enrutador.get('/api/testimonios/:id', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    return crud.obtener(c.params.id);
  });
  enrutador.post('/api/testimonios', (c) => crud.crear(c));
  enrutador.put('/api/testimonios/:id', (c) => crud.modificar(c, c.params.id));
  enrutador.delete('/api/testimonios/:id', (c) => crud.eliminar(c, c.params.id));
}
