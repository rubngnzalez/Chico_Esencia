// /api/instalacion: primer arranque sin servidor local.
// GET  → { pendiente: true|false }  (true si aún no hay usuarios)
// POST → crea el administrador con nombre/email/contraseña elegidos,
//        SOLO si no existe ningún usuario.

import { hashContrasena } from '../contrasenas.js';
import {
  validar,
  ahora,
  nuevoId,
  error400,
  respuestaJson,
} from '../utilidades.js';

export async function registrar(enrutador, { coleccionUsuarios }) {
  enrutador.get('/api/instalacion', async ({ coleccionUsuarios: usuarios }) => {
    const hay = (await usuarios.leer()).length > 0;
    return respuestaJson({ pendiente: !hay });
  });

  enrutador.post('/api/instalacion', async (cx) => {
    const existentes = await cx.coleccionUsuarios.leer();
    if (existentes.length > 0) {
      return respuestaJson(
        { error: 'La instalación ya se completó: ya existe una cuenta de administración.' },
        403
      );
    }

    const comprobacion = validar(
      {
        nombre: { tipo: 'texto', requerido: true, min: 1, max: 120, etiqueta: 'el nombre' },
        email: { tipo: 'email', requerido: true, etiqueta: 'el email' },
        contrasena: { tipo: 'texto', requerido: true, min: 8, max: 128, etiqueta: 'la contraseña' },
      },
      cx.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const { nombre, email, contrasena } = comprobacion.datos;

    const admin = {
      id: nuevoId('usr'),
      nombre,
      email,
      hashContrasena: await hashContrasena(contrasena),
      rol: 'admin',
      activo: true,
      debeCambiarContrasena: false,
      creadoEn: ahora(),
      ultimoAcceso: null,
    };
    await cx.coleccionUsuarios.insertar(admin);
    return respuestaJson(
      { ok: true, usuario: { id: admin.id, nombre: admin.nombre, email: admin.email, rol: admin.rol } },
      201
    );
  });
}
