// Edge Function «oms-gestion-distribuidores» — altas y contraseñas de las
// cuentas de DISTRIBUIDOR desde el panel (sección Distribuidores → Cuentas).
// Solo un admin activo puede invocarla (JWT verificado por el gateway y rol
// re-verificado aquí contra oms_usuarios con el cliente service_role).
// Acciones:
//   crear    { email, empresa, contacto?, telefono?, ciudad?, descuento?, contrasena? }
//            → alta en auth.users + ficha en oms_distribuidores, devuelve contraseña
//   resetear { id }  → nueva contraseña temporal del distribuidor
//   eliminar { id }  → baja definitiva (auth.users; la ficha cae en cascada)
// Las contraseñas NUNCA se pueden consultar: solo se generan o sustituyen.
// A diferencia de oms-gestion-usuarios, NO se crea fila en oms_usuarios: un
// distribuidor no entra al panel de gestión, solo al área privada de la web.

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
    .select('id, nombre, rol, activo')
    .eq('id', quien.user.id)
    .single();
  if (!perfil || perfil.rol !== 'admin' || perfil.activo === false) {
    return new Response(JSON.stringify({ error: 'Solo la administración puede gestionar distribuidores.' }), { status: 403, headers: cabeceras(request) });
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
    const empresa = String(cuerpo.empresa || '').trim().slice(0, 120);
    const contacto = String(cuerpo.contacto || '').trim().slice(0, 120);
    const telefono = String(cuerpo.telefono || '').trim().slice(0, 40);
    const ciudad = String(cuerpo.ciudad || '').trim().slice(0, 120);
    const descuento = Math.min(100, Math.max(0, Number(cuerpo.descuento) || 0));
    let contrasena = String(cuerpo.contrasena || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return new Response(JSON.stringify({ error: 'El email no parece válido.' }), { status: 400, headers: cabeceras(request) });
    }
    if (!empresa) {
      return new Response(JSON.stringify({ error: 'Falta el nombre de la empresa.' }), { status: 400, headers: cabeceras(request) });
    }
    if (contrasena && contrasena.length < 8) {
      return new Response(JSON.stringify({ error: 'La contraseña debe tener al menos 8 caracteres.' }), { status: 400, headers: cabeceras(request) });
    }
    if (!contrasena) contrasena = generarContrasena();

    const alta = await db.auth.admin.createUser({
      email,
      password: contrasena,
      email_confirm: true,
      user_metadata: { empresa, contacto },
    });
    if (alta.error) {
      const yaExiste = (alta.error.message || '').toLowerCase().includes('already') || (alta.error as unknown as { code?: string }).code === 'email_exists';
      return new Response(
        JSON.stringify({ error: yaExiste ? 'Ese email ya tiene una cuenta.' : `No se pudo crear: ${alta.error.message}` }),
        { status: 400, headers: cabeceras(request) }
      );
    }
    const { error: errorFicha } = await db.from('oms_distribuidores').insert({
      id: alta.data.user!.id,
      email,
      empresa,
      contacto,
      telefono,
      ciudad,
      descuento,
      notas,
    });
    if (errorFicha) {
      // La cuenta no puede quedarse a medias: se deshace el alta de auth
      await db.auth.admin.deleteUser(alta.data.user!.id);
      return new Response(JSON.stringify({ error: `No se pudo guardar la ficha: ${errorFicha.message}` }), { status: 400, headers: cabeceras(request) });
    }
    return new Response(JSON.stringify({ ok: true, email, contrasena }), { headers: cabeceras(request) });
  }

  // ─── RESETEAR (contraseña temporal nueva para el distribuidor) ──────────
  if (accion === 'resetear') {
    const id = String(cuerpo.id || '');
    const { data: objetivo } = await db.from('oms_distribuidores').select('id, email, empresa').eq('id', id).maybeSingle();
    if (!objetivo) {
      return new Response(JSON.stringify({ error: 'Distribuidor no encontrado.' }), { status: 404, headers: cabeceras(request) });
    }
    const contrasena = generarContrasena();
    const cambio = await db.auth.admin.updateUserById(id, { password: contrasena });
    if (cambio.error) {
      return new Response(JSON.stringify({ error: `No se pudo cambiar: ${cambio.error.message}` }), { status: 400, headers: cabeceras(request) });
    }
    return new Response(JSON.stringify({ ok: true, contrasena }), { headers: cabeceras(request) });
  }

  // ─── ELIMINAR (baja definitiva del distribuidor) ────────────────────────
  if (accion === 'eliminar') {
    const id = String(cuerpo.id || '');
    if (!id) {
      return new Response(JSON.stringify({ error: 'Falta el distribuidor a eliminar.' }), { status: 400, headers: cabeceras(request) });
    }
    const { data: objetivo } = await db.from('oms_distribuidores').select('id, email, empresa').eq('id', id).maybeSingle();
    if (!objetivo) {
      return new Response(JSON.stringify({ error: 'Distribuidor no encontrado.' }), { status: 404, headers: cabeceras(request) });
    }
    const baja = await db.auth.admin.deleteUser(id);
    if (baja.error) {
      return new Response(JSON.stringify({ error: `No se pudo eliminar: ${baja.error.message}` }), { status: 400, headers: cabeceras(request) });
    }
    return new Response(JSON.stringify({ ok: true }), { headers: cabeceras(request) });
  }

  return new Response(JSON.stringify({ error: 'Acción desconocida.' }), { status: 400, headers: cabeceras(request) });
});
