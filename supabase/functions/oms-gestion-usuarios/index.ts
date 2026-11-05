// Edge Function «gestion-usuarios» — alta y contraseñas desde el panel.
// Solo un admin activo puede invocarla (JWT verificado por el gateway y rol
// re-verificado aquí contra la tabla usuarios con el cliente service_role).
// Acciones:
//   crear    { email, nombre, rol?, contrasena? }  → alta + devolver contraseña
//   resetear { id }                                → nueva contraseña temporal
//   cambiar  { contrasenaNueva }                   → cambia la del propio admin
//   eliminar { id }                                → baja definitiva del usuario
// Las contraseñas NUNCA se pueden consultar: solo se generan o sustituyen.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGENES = ['https://omshaddai.com', 'https://rubngnzalez.github.io'];
function cabeceras(request?: Request): Record<string, string> {
  const origen = request?.headers.get('origin') || '';
  const permitido = ORIGENES.some((o) => origen === o) || origen.endsWith('.omshaddai.com') ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen);
  return {
    'Access-Control-Allow-Origin': permitido ? origen : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function generarContrasena(): string {
  const grupo = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const tam = 14;
  const aleatorio = crypto.getRandomValues(new Uint32Array(tam));
  let texto = '';
  for (let i = 0; i < tam; i++) texto += grupo[aleatorio[i] % grupo.length];
  return texto;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido.' }), { status: 405, headers: cabeceras(request) });
  }

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return new Response(JSON.stringify({ error: 'Función sin configurar.' }), { status: 500, headers: cabeceras(request) });
  }

  // Rol del que llama (JWT del panel, ya validado por el gateway)
  const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });
  const { data: quien } = await db.auth.getUser(jwt);
  if (!quien?.user) {
    return new Response(JSON.stringify({ error: 'Sesión no válida.' }), { status: 401, headers: cabeceras(request) });
  }
  const { data: perfil } = await db
    .from('oms_usuarios')
    .select('id, nombre, rol, activo, email')
    .eq('id', quien.user.id)
    .single();
  if (!perfil || perfil.rol !== 'admin' || perfil.activo === false) {
    return new Response(JSON.stringify({ error: 'Solo la administración puede gestionar usuarios.' }), { status: 403, headers: cabeceras(request) });
  }

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Cuerpo no válido.' }), { status: 400, headers: cabeceras(request) });
  }
  const accion = String(cuerpo.accion || '');

  // ─── CREAR ──────────────────────────────────────────────────────────────
  if (accion === 'crear') {
    const email = String(cuerpo.email || '').trim().toLowerCase();
    const nombre = String(cuerpo.nombre || '').trim().slice(0, 120);
    const rol = ['admin', 'editor', 'lector'].includes(String(cuerpo.rol)) ? String(cuerpo.rol) : 'lector';
    let contrasena = String(cuerpo.contrasena || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'El email no parece válido.' }), { status: 400, headers: cabeceras(request) });
    }
    if (!nombre) {
      return new Response(JSON.stringify({ error: 'Falta el nombre.' }), { status: 400, headers: cabeceras(request) });
    }
    if (contrasena && contrasena.length < 8) {
      return new Response(JSON.stringify({ error: 'La contraseña debe tener al menos 8 caracteres.' }), { status: 400, headers: cabeceras(request) });
    }
    if (!contrasena) contrasena = generarContrasena();

    const alta = await db.auth.admin.createUser({
      email,
      password: contrasena,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (alta.error) {
      const yaExiste = (alta.error.message || '').toLowerCase().includes('already') || (alta.error as unknown as { code?: string }).code === 'email_exists';
      return new Response(
        JSON.stringify({ error: yaExiste ? 'Ese email ya tiene una cuenta.' : `No se pudo crear: ${alta.error.message}` }),
        { status: 400, headers: cabeceras(request) }
      );
    }
    // Sin trigger sobre auth.users (proyecto compartido): el perfil se crea
    // aquí de forma explícita con el rol elegido.
    await db.from('oms_usuarios').insert({ id: alta.data.user!.id, email, nombre, rol });
    return new Response(JSON.stringify({ ok: true, email, contrasena, rol }), { headers: cabeceras(request) });
  }

  // ─── RESETEAR (contraseña temporal nueva para un usuario) ───────────────
  if (accion === 'resetear') {
    const id = String(cuerpo.id || '');
    const { data: objetivo } = await db.from('oms_usuarios').select('id, email, nombre').eq('id', id).maybeSingle();
    if (!objetivo) {
      return new Response(JSON.stringify({ error: 'Usuario no encontrado.' }), { status: 404, headers: cabeceras(request) });
    }
    const contrasena = generarContrasena();
    const cambio = await db.auth.admin.updateUserById(id, { password: contrasena });
    if (cambio.error) {
      return new Response(JSON.stringify({ error: `No se pudo cambiar: ${cambio.error.message}` }), { status: 400, headers: cabeceras(request) });
    }
    return new Response(JSON.stringify({ ok: true, contrasena }), { headers: cabeceras(request) });
  }

  // ─── CAMBIAR (la propia contraseña, verificando la actual) ──────────────
  if (accion === 'cambiar') {
    const contrasenaNueva = String(cuerpo.contrasenaNueva || '');
    const contrasenaActual = String(cuerpo.contrasenaActual || '');
    if (contrasenaNueva.length < 8) {
      return new Response(JSON.stringify({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' }), { status: 400, headers: cabeceras(request) });
    }
    const comprobar = await db.auth.signInWithPassword({ email: perfil.email, password: contrasenaActual });
    if (comprobar.error) {
      return new Response(JSON.stringify({ error: 'La contraseña actual no es correcta.' }), { status: 400, headers: cabeceras(request) });
    }
    const cambio = await db.auth.admin.updateUserById(quien.user.id, { password: contrasenaNueva });
    if (cambio.error) {
      return new Response(JSON.stringify({ error: `No se pudo cambiar: ${cambio.error.message}` }), { status: 400, headers: cabeceras(request) });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: cabeceras(request) });
  }

  // ─── ELIMINAR (baja definitiva; no se permite dejar el panel sin admin) ──
  if (accion === 'eliminar') {
    const id = String(cuerpo.id || '');
    if (!id) {
      return new Response(JSON.stringify({ error: 'Falta el usuario a eliminar.' }), { status: 400, headers: cabeceras(request) });
    }
    if (id === perfil.id) {
      return new Response(JSON.stringify({ error: 'No puedes eliminar tu propio usuario.' }), { status: 400, headers: cabeceras(request) });
    }
    const { data: objetivo } = await db.from('oms_usuarios').select('id, email, nombre, rol, activo').eq('id', id).maybeSingle();
    if (!objetivo) {
      return new Response(JSON.stringify({ error: 'Usuario no encontrado.' }), { status: 404, headers: cabeceras(request) });
    }
    if (objetivo.rol === 'admin') {
      const { count: otrosAdmins } = await db
        .from('oms_usuarios')
        .select('id', { count: 'exact', head: true })
        .eq('rol', 'admin')
        .eq('activo', true)
        .neq('id', id);
      if (!otrosAdmins || otrosAdmins < 1) {
        return new Response(JSON.stringify({ error: 'No puede quedarse el panel sin ninguna administración activa.' }), { status: 400, headers: cabeceras(request) });
      }
    }
    const baja = await db.auth.admin.deleteUser(id);
    if (baja.error) {
      return new Response(JSON.stringify({ error: `No se pudo eliminar: ${baja.error.message}` }), { status: 400, headers: cabeceras(request) });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: cabeceras(request) });
  }

  return new Response(JSON.stringify({ error: 'Acción desconocida.' }), { status: 400, headers: cabeceras(request) });
});
