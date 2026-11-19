// Edge Function «oms-distrib-verificar» — confirma el correo del interesado
// con el token del enlace (un uso, 24 h; solo se guarda el hash). Pasa la
// solicitud a «verificada» y devuelve el email enmascarado para pintar el
// formulario completo del paso 2.
//
// El mismo token se reutiliza para ENVIAR el formulario completo
// («oms-distrib-completar»), que invalida el token al terminar.
//
// Despliegue: npx supabase functions deploy oms-distrib-verificar

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cabeceras, errorJson, dentroDelLimite, sha256Hex, ipDe } from './correo.ts';

function emailEnmascarado(email: string): string {
  const [usuario, dominio] = String(email || '').split('@');
  if (!dominio) return '···';
  const visible = usuario.slice(0, Math.min(2, usuario.length));
  return `${visible}${'·'.repeat(Math.max(3, usuario.length - visible.length))}@${dominio}`;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') return errorJson('Método no permitido.', 405, request);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return errorJson('La función no está configurada (faltan secretos del proyecto).', 500, request);
  }

  let cuerpo: { token?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const token = String(cuerpo.token || '').trim();
  if (!token || token.length !== 64) {
    return errorJson('El enlace de verificación no es válido. Solicita un nuevo correo desde la página de distribuidores.', 400, request);
  }

  const ip = ipDe(request);
  if (!dentroDelLimite(ip)) {
    return errorJson('Demasiados intentos. Espera un rato antes de volver a probarlo.', 429, request);
  }

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });
  const tokenHash = await sha256Hex(token);

  const { data: encontradas, error } = await db
    .from('oms_distrib_solicitudes')
    .select('id, email, estado, token_expira')
    .eq('token_hash', tokenHash)
    .order('creado_en', { ascending: false })
    .limit(1);
  if (error) return errorJson('No se pudo comprobar el enlace.', 500, request);

  const solicitud = (encontradas || [])[0] as
    | { id: string; email: string; estado: string; token_expira: string | null }
    | undefined;

  if (!solicitud) {
    return errorJson('El enlace no es válido o ya se utilizó. Solicita un nuevo correo desde la página de distribuidores.', 400, request);
  }
  if (['rechazada', 'descartada', 'aceptada'].includes(solicitud.estado)) {
    return errorJson('Esta solicitud ya no está en curso. Escríbenos desde la página de contacto si tienes dudas.', 400, request);
  }
  if (!solicitud.token_expira || Date.parse(solicitud.token_expira) < Date.now()) {
    return errorJson('El enlace ha caducado (dura 24 horas). Solicita un nuevo correo desde la página de distribuidores.', 400, request);
  }
  if (solicitud.estado === 'completada') {
    return errorJson('Esta solicitud ya se envió completa. Te avisaremos por correo con la respuesta.', 400, request);
  }

  if (solicitud.estado === 'pendiente_verificacion') {
    const { error: errorUpdate } = await db
      .from('oms_distrib_solicitudes')
      .update({ estado: 'verificada', verificado_en: new Date().toISOString() })
      .eq('id', solicitud.id);
    if (errorUpdate) return errorJson('No se pudo confirmar el correo.', 500, request);
  }

  return new Response(
    JSON.stringify({ ok: true, email: emailEnmascarado(solicitud.email) }),
    { headers: cabeceras(request) }
  );
});
