// /api/auth: login/logout/me/cambiar-contrasena (puerto de rutas/auth.js)

import {
  cabeceraSetCookie,
  CABECERA_BORRAR_COOKIE,
  obtenerSecreto,
  requerirSesion,
  limitar,
  ipDeRequest,
  respuestaLimitador,
  quitarHash,
} from '../seguridad.js';
import { hashContrasena, verificarContrasena } from '../contrasenas.js';
import { validar, limpiarTexto, ahora, error400, respuestaJson } from '../utilidades.js';

export async function registrar(enrutador, { coleccionUsuarios }) {
  enrutador.post('/api/auth/login', async (cx) => {
    const resultado = await limitar(cx.db, `login|${ipDeRequest(cx.request)}`, 8, 15 * 60 * 1000, 15 * 60 * 1000);
    if (resultado.bloqueado) return respuestaLimitador(resultado);

    const cuerpo = cx.cuerpo || {};
    const email = limpiarTexto(cuerpo.email).toLowerCase();
    const contrasena = typeof cuerpo.contrasena === 'string' ? cuerpo.contrasena : '';

    if (!email || !contrasena) {
      return error400('Introduce tu correo y tu contraseña.');
    }

    const usuario = await coleccionUsuarios.buscarPor('email', email);
    const coincide =
      usuario &&
      usuario.activo !== false &&
      (await verificarContrasena(contrasena, usuario.hashContrasena));
    if (!coincide) {
      return respuestaJson({ error: 'Correo o contraseña incorrectos.' }, 401);
    }

    const conAcceso = await coleccionUsuarios.modificar(usuario.id, { ultimoAcceso: ahora() });
    return respuestaJson(
      { ok: true, usuario: quitarHash(conAcceso) },
      200,
      { 'Set-Cookie': await cabeceraSetCookie(obtenerSecreto(cx.env), usuario.id) }
    );
  });

  enrutador.post('/api/auth/logout', async () => {
    return respuestaJson({ ok: true }, 200, { 'Set-Cookie': CABECERA_BORRAR_COOKIE });
  });

  enrutador.get('/api/auth/me', async (cx) => {
    const guard = requerirSesion(cx);
    if (guard) return guard;
    return respuestaJson({ usuario: quitarHash(cx.usuario) });
  });

  enrutador.post('/api/auth/cambiar-contrasena', async (cx) => {
    const guard = requerirSesion(cx);
    if (guard) return guard;

    const comprobacion = validar(
      {
        contrasenaActual: { tipo: 'texto', etiqueta: 'la contraseña actual' },
        contrasenaNueva: { tipo: 'texto', requerido: true, min: 8, max: 128, etiqueta: 'la contraseña nueva' },
      },
      cx.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);

    const usuario = await coleccionUsuarios.porId(cx.usuario.id);
    if (!usuario) return respuestaJson({ error: 'Sesión no válida.' }, 401);

    if (!(await verificarContrasena(comprobacion.datos.contrasenaActual, usuario.hashContrasena))) {
      return respuestaJson({ error: 'La contraseña actual no es correcta.' }, 400);
    }

    await coleccionUsuarios.modificar(usuario.id, {
      hashContrasena: await hashContrasena(comprobacion.datos.contrasenaNueva),
      debeCambiarContrasena: false,
    });

    return respuestaJson({ ok: true, mensaje: 'Contraseña actualizada correctamente.' });
  });
}
