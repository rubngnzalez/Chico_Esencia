// Fábrica de CRUD genérico (puerto de rutas/crud.js): listado {datos,total},
// detalle {dato}, alta 201, modificación y borrado, con slug único.

import { requerirSesion, requerirRol } from '../seguridad.js';
import { validar, slugificar, nuevoId, ahora, error400, error404, respuestaJson, ErrorEstado } from '../utilidades.js';

export async function slugUnico(coleccion, base, idExcluido) {
  let slug = base || 'elemento';
  const existentes = new Set(
    (await coleccion.leer())
      .filter((item) => item.id !== idExcluido)
      .map((item) => item.slug)
  );
  if (!existentes.has(slug)) return slug;
  let numero = 2;
  while (existentes.has(`${slug}-${numero}`)) numero++;
  return `${slug}-${numero}`;
}

export function crearCrud({
  coleccion,
  esquema,
  campoSlug,
  rolEscritura = ['admin', 'editor'],
  alCrear,
  alModificar,
  alEliminar,
  ordenarPor,
}) {
  return {
    async listar() {
      let lista = await coleccion.todo();
      if (ordenarPor) {
        lista.sort((a, b) => {
          const va = a[ordenarPor] ?? 0;
          const vb = b[ordenarPor] ?? 0;
          if (typeof va === 'number' && typeof vb === 'number') return va - vb;
          return String(va).localeCompare(String(vb), 'es');
        });
      }
      return respuestaJson({ datos: lista, total: lista.length });
    },

    async obtener(id) {
      const elemento = await coleccion.porId(id);
      if (!elemento) return error404();
      return respuestaJson({ dato: elemento });
    },

    async crear(cx) {
      const guard = requerirRol(cx, ...rolEscritura);
      if (guard) return guard;
      const comprobacion = validar(esquema, cx.cuerpo);
      if (!comprobacion.ok) return error400(comprobacion.errores);
      const datos = comprobacion.datos;
      if (campoSlug) {
        datos.slug = await slugUnico(coleccion, slugificar(datos.slug || datos[campoSlug]), null);
      }
      const elemento = {
        id: nuevoId(coleccion.nombre.slice(0, 3)),
        ...datos,
        creadoEn: ahora(),
        actualizadoEn: ahora(),
      };
      try {
        if (alCrear) await alCrear(elemento, cx);
        await coleccion.insertar(elemento);
      } catch (error) {
        if (error instanceof ErrorEstado) return respuestaJson({ error: error.message }, error.estado);
        throw error;
      }
      return respuestaJson({ dato: elemento }, 201);
    },

    async modificar(cx, id) {
      const guard = requerirRol(cx, ...rolEscritura);
      if (guard) return guard;
      const existente = await coleccion.porId(id);
      if (!existente) return error404();
      const comprobacion = validar(esquema, { ...existente, ...cx.cuerpo });
      if (!comprobacion.ok) return error400(comprobacion.errores);
      const datos = comprobacion.datos;
      for (const [campo, regla] of Object.entries(esquema)) {
        if (regla.nulable && cx.cuerpo && cx.cuerpo[campo] === null) {
          datos[campo] = null;
        }
      }
      if (campoSlug) {
        datos.slug = await slugUnico(coleccion, slugificar(datos.slug || datos[campoSlug]), existente.id);
      }
      const anterior = { ...existente };
      let actualizado;
      try {
        actualizado = await coleccion.modificar(existente.id, datos);
        if (alModificar) await alModificar(actualizado, anterior, cx);
      } catch (error) {
        if (error instanceof ErrorEstado) return respuestaJson({ error: error.message }, error.estado);
        throw error;
      }
      return respuestaJson({ dato: actualizado });
    },

    async eliminar(cx, id) {
      const guard = requerirRol(cx, ...rolEscritura);
      if (guard) return guard;
      const existente = await coleccion.porId(id);
      if (!existente) return error404();
      await coleccion.quitar(existente.id);
      if (alEliminar) await alEliminar(existente, cx);
      return respuestaJson({ ok: true });
    },
  };
}
