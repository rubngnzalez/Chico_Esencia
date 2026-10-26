// /api/usuarios (solo admin). Las respuestas nunca incluyen el hash.

import { requerirRol, quitarHash } from '../seguridad.js';
import { validar, error400, error404, respuestaJson, ahora, nuevoId } from '../utilidades.js';
import { hashContrasena } from '../contrasenas.js';

const ROLES = ['admin', 'editor', 'lector'];

export function registrar(enrutador, cx) {
  enrutador.get('/api/usuarios', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const datos = (await cx.coleccionUsuarios.todo()).map(quitarHash);
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/usuarios/:id', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const usuario = await cx.coleccionUsuarios.porId(c.params.id);
    if (!usuario) return error404('Usuario no encontrado.');
    return respuestaJson({ dato: quitarHash(usuario) });
  });

  enrutador.post('/api/usuarios', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const comprobacion = validar(
      {
        nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
        email: { tipo: 'email', requerido: true, etiqueta: 'el email' },
        contrasena: { tipo: 'texto', requerido: true, min: 8, max: 128, etiqueta: 'la contraseña' },
        rol: { tipo: 'texto', requerido: true, opciones: ROLES, etiqueta: 'el rol' },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const datos = comprobacion.datos;
    if ((await cx.coleccionUsuarios.leer()).some((u) => u.email.toLowerCase() === datos.email)) {
      return error400('Ya existe un usuario con ese correo electrónico.');
    }
    const usuario = {
      id: nuevoId('usr'),
      nombre: datos.nombre,
      email: datos.email,
      hashContrasena: await hashContrasena(datos.contrasena),
      rol: datos.rol,
      activo: true,
      debeCambiarContrasena: false,
      creadoEn: ahora(),
      ultimoAcceso: null,
    };
    await cx.coleccionUsuarios.insertar(usuario, { email: usuario.email });
    return respuestaJson({ dato: quitarHash(usuario) }, 201);
  });

  enrutador.put('/api/usuarios/:id', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const usuario = await cx.coleccionUsuarios.porId(c.params.id);
    if (!usuario) return error404('Usuario no encontrado.');
    const comprobacion = validar(
      {
        nombre: { tipo: 'texto', min: 1, max: 120, etiqueta: 'el nombre' },
        rol: { tipo: 'texto', opciones: ROLES, etiqueta: 'el rol' },
        activo: { tipo: 'booleano' },
        contrasena: { tipo: 'texto', min: 8, max: 128, etiqueta: 'la contraseña' },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const datos = comprobacion.datos;

    if (usuario.rol === 'admin' && ((datos.rol && datos.rol !== 'admin') || datos.activo === false)) {
      const adminsActivos = (await cx.coleccionUsuarios.leer()).filter(
        (u) => u.rol === 'admin' && u.activo !== false && u.id !== usuario.id
      );
      if (adminsActivos.length === 0) {
        return error400('No puede dejar de haber al menos un administrador activo.');
      }
    }

    const cambios = {};
    if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
    if (datos.rol !== undefined) cambios.rol = datos.rol;
    if (datos.activo !== undefined) cambios.activo = datos.activo;
    if (datos.contrasena) {
      cambios.hashContrasena = await hashContrasena(datos.contrasena);
      cambios.debeCambiarContrasena = false;
    }
    const actualizado = await cx.coleccionUsuarios.modificar(usuario.id, cambios);
    return respuestaJson({ dato: quitarHash(actualizado) });
  });

  enrutador.delete('/api/usuarios/:id', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const usuario = await cx.coleccionUsuarios.porId(c.params.id);
    if (!usuario) return error404('Usuario no encontrado.');
    if (usuario.id === c.usuario.id) {
      return error400('No puedes eliminar tu propio usuario.');
    }
    if (usuario.rol === 'admin') {
      const otrosAdmins = (await cx.coleccionUsuarios.leer()).filter(
        (u) => u.rol === 'admin' && u.id !== usuario.id
      );
      if (otrosAdmins.length === 0) {
        return error400('No puede dejar de haber al menos un administrador.');
      }
    }
    await cx.coleccionUsuarios.quitar(usuario.id);
    return respuestaJson({ ok: true });
  });
}
