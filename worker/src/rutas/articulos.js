// /api/articulos (puerto de rutas/articulos.js). La publicación NO genera
// archivos: el Worker sirve el HTML en vivo en /news/articulo/<slug>.
// Los programados se publican solos al listar si llegó su fecha.

import { requerirRol } from '../seguridad.js';
import { validar, slugificar, nuevoId, ahora, error404, respuestaJson } from '../utilidades.js';

const ESQUEMA = {
  titulo: { tipo: 'texto', requerido: true, min: 1, max: 200, etiqueta: 'el título' },
  slug: { tipo: 'texto', defecto: '', max: 100 },
  extracto: { tipo: 'texto', defecto: '', max: 600 },
  contenido: { tipo: 'texto', defecto: '', max: 300000 },
  imagenPortada: { tipo: 'texto', defecto: '', max: 500 },
  etiquetas: { tipo: 'matriz', tipoItems: 'texto', defecto: [] },
  estado: { tipo: 'texto', defecto: 'borrador', opciones: ['borrador', 'programado', 'publicado'], etiqueta: 'el estado' },
  fechaPublicacion: { tipo: 'fecha', etiqueta: 'la fecha de publicación' },
  autor: { tipo: 'texto', defecto: 'SHADDAI', max: 120 },
};

export function registrar(enrutador, cx) {
  async function validarArticulo(entrada, existente) {
    const comprobacion = validar(ESQUEMA, entrada);
    if (!comprobacion.ok) return comprobacion;
    const datos = comprobacion.datos;
    if (!datos.fechaPublicacion) {
      datos.fechaPublicacion = (existente && existente.fechaPublicacion) || ahora();
    }
    datos.slug = slugificar(datos.slug || datos.titulo);
    const duplicado = (await cx.coleccionArticulos.leer()).find(
      (a) => a.slug === datos.slug && (!existente || a.id !== existente.id)
    );
    if (duplicado) {
      return { ok: false, errores: [`Ya existe un artículo con el slug «${datos.slug}».`] };
    }
    return { ok: true, datos };
  }

  async function refrescarProgramados() {
    const instante = Date.now();
    for (const articulo of await cx.coleccionArticulos.leer()) {
      if (
        articulo.estado === 'programado' &&
        articulo.fechaPublicacion &&
        Date.parse(articulo.fechaPublicacion) <= instante
      ) {
        await cx.coleccionArticulos.modificar(articulo.id, { estado: 'publicado' });
      }
    }
  }

  enrutador.get('/api/articulos', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor', 'lector');
    if (guard) return guard;
    await refrescarProgramados();
    const datos = (await cx.coleccionArticulos.todo()).sort((a, b) =>
      String(b.creadoEn || '').localeCompare(String(a.creadoEn || ''))
    );
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.post('/api/articulos', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const comprobacion = await validarArticulo(c.cuerpo || {}, null);
    if (!comprobacion.ok) return respuestaJson({ error: comprobacion.errores.join(' ') }, 400);
    const articulo = {
      id: nuevoId('art'),
      ...comprobacion.datos,
      creadoEn: ahora(),
      actualizadoEn: ahora(),
    };
    await cx.coleccionArticulos.insertar(articulo, { slug: articulo.slug, estado: articulo.estado });
    return respuestaJson({ dato: articulo }, 201);
  });

  enrutador.post('/api/articulos/:id/publicar', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const existente = await cx.coleccionArticulos.porId(c.params.id);
    if (!existente) return error404('Artículo no encontrado.');
    const fecha =
      existente.fechaPublicacion && Date.parse(existente.fechaPublicacion) <= Date.now()
        ? existente.fechaPublicacion
        : ahora();
    const actualizado = await cx.coleccionArticulos.modificar(existente.id, {
      estado: 'publicado',
      fechaPublicacion: fecha,
    });
    return respuestaJson({ dato: actualizado, url: `/news/articulo/${actualizado.slug}/` });
  });

  enrutador.post('/api/articulos/:id/despublicar', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const existente = await cx.coleccionArticulos.porId(c.params.id);
    if (!existente) return error404('Artículo no encontrado.');
    const actualizado = await cx.coleccionArticulos.modificar(existente.id, { estado: 'borrador' });
    return respuestaJson({ dato: actualizado });
  });

  enrutador.put('/api/articulos/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const existente = await cx.coleccionArticulos.porId(c.params.id);
    if (!existente) return error404('Artículo no encontrado.');
    const comprobacion = await validarArticulo({ ...existente, ...c.cuerpo }, existente);
    if (!comprobacion.ok) return respuestaJson({ error: comprobacion.errores.join(' ') }, 400);
    const actualizado = await cx.coleccionArticulos.modificar(existente.id, comprobacion.datos);
    return respuestaJson({ dato: actualizado });
  });

  enrutador.get('/api/articulos/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor', 'lector');
    if (guard) return guard;
    const articulo = await cx.coleccionArticulos.porId(c.params.id);
    if (!articulo) return error404('Artículo no encontrado.');
    return respuestaJson({ dato: articulo });
  });

  enrutador.delete('/api/articulos/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const existente = await cx.coleccionArticulos.porId(c.params.id);
    if (!existente) return error404('Artículo no encontrado.');
    await cx.coleccionArticulos.quitar(existente.id);
    return respuestaJson({ ok: true });
  });
}
