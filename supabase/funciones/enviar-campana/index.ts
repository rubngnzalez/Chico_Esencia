// Edge Function «enviar-campana» — envío real de campañas (fase 2, opcional).
// Sustituye a POST /api/campanas/:id/enviar del Worker:
//  1. Verifica el JWT del llamador (Authorization: Bearer …) y comprueba que
//     su perfil en la tabla usuarios tiene rol «admin».
//  2. Con RESEND_API_KEY configurada: envía la campaña con Resend por lotes
//     y guarda estadísticas en la campaña.
//  3. Sin RESEND_API_KEY: deja un .eml por destinatario en outbox y marca la
//     campaña «pendiente» (el panel ofrece la descarga).
//
// Despliegue: npx supabase functions deploy enviar-campana

import { createClient } from 'npm:@supabase/supabase-js@2';

function json(respuesta: Record<string, unknown>, estado = 200): Response {
  return new Response(JSON.stringify(respuesta), {
    status: estado,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function generarEml(desde: string, para: string, asunto: string, html: string, responderA?: string): string {
  const cabeceras = [
    `From: ${desde}`,
    `To: ${para}`,
    `Subject: ${asunto}`,
    ...(responderA ? [`Reply-To: ${responderA}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
    'X-SHADDAI-Estado: pendiente',
    '',
  ];
  return cabeceras.join('\r\n') + html + '\r\n';
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) return json({ error: 'Función sin configurar.' }, 500);

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // 1 · Verificación del JWT y del rol admin
  const autorizacion = request.headers.get('Authorization') || '';
  const token = autorizacion.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Falta el token de sesión.' }, 401);

  const clienteAuth = createClient(urlSupabase, Deno.env.get('SUPABASE_ANON_KEY') || claveServicio, {
    auth: { persistSession: false },
  });
  const { data: datosUsuario, error: errorToken } = await clienteAuth.auth.getUser(token);
  if (errorToken || !datosUsuario?.user) return json({ error: 'Sesión no válida.' }, 401);

  const { data: perfil } = await db
    .from('usuarios')
    .select('id, rol, activo, email')
    .eq('id', datosUsuario.user.id)
    .single();
  if (!perfil || perfil.activo === false) return json({ error: 'Tu cuenta no está activa.' }, 403);
  if (perfil.rol !== 'admin') {
    return json({ error: 'Solo la administración puede enviar campañas.' }, 403);
  }

  // 2 · Campaña a enviar
  let cuerpo: { campanaId?: string };
  try {
    cuerpo = await request.json();
  } catch {
    return json({ error: 'El cuerpo de la petición no es JSON válido.' }, 400);
  }
  const campanaId = String(cuerpo.campanaId || '');
  if (!campanaId) return json({ error: 'Falta el identificador de la campaña.' }, 400);

  const { data: campana } = await db
    .from('campanas')
    .select('id, asunto, html, estado, destinatarios')
    .eq('id', campanaId)
    .single();
  if (!campana) return json({ error: 'Campaña no encontrada.' }, 404);
  const campanaInfo = campana as {
    id: string;
    asunto: string;
    html: string;
    estado: string;
    destinatarios: { tipo?: string; etiqueta?: string };
  };
  if (campanaInfo.estado === 'enviada') return json({ error: 'La campaña ya fue enviada.' }, 400);

  // 3 · Destinatarios (todos o segmento por etiqueta)
  const { data: listaSuscriptores, error: errorSuscriptores } = await db
    .from('suscriptores')
    .select('email, etiquetas');
  if (errorSuscriptores) return json({ error: `No se pudo leer la lista de suscriptores: ${errorSuscriptores.message}` }, 500);

  const segmento = campanaInfo.destinatarios?.tipo === 'segmento'
    ? String(campanaInfo.destinatarios.etiqueta || '').trim().toLowerCase()
    : '';
  const destinatarios = (listaSuscriptores || [])
    .map((s: { email: string; etiquetas: string[] | null }) => ({
      email: String(s.email || '').trim(),
      etiquetas: (s.etiquetas || []).map((e) => String(e).toLowerCase()),
    }))
    .filter((s: { email: string }) => s.email)
    .filter((s: { etiquetas: string[] }) => !segmento || s.etiquetas.includes(segmento))
    .map((s: { email: string }) => s.email);

  if (destinatarios.length === 0) return json({ error: 'No hay destinatarios para esta campaña.' }, 400);

  const { data: filaAjustes } = await db
    .from('ajustes')
    .select('contacto, smtp')
    .eq('id', 'general')
    .single();
  const ajustes = (filaAjustes || {}) as { contacto?: Record<string, unknown>; smtp?: Record<string, unknown> };
  const desde = String(ajustes.smtp?.desde || 'SHADDAI · Esencia de Umbral <sin-configurar@omshaddai.com>');
  const emailsContacto = Array.isArray(ajustes.contacto?.emailsDestino)
    ? (ajustes.contacto!.emailsDestino as string[])
    : [];
  const responderA = emailsContacto[0] || undefined;

  const claveResend = Deno.env.get('RESEND_API_KEY');

  // 4 · Envío o bandeja de salida
  if (!claveResend) {
    for (const para of destinatarios) {
      await db.from('outbox').insert({
        para,
        asunto: campanaInfo.asunto,
        html: campanaInfo.html,
        eml: generarEml(desde, para, campanaInfo.asunto, campanaInfo.html, responderA),
        estado: 'pendiente',
        ref_campana: campanaInfo.id,
      });
    }
    await db
      .from('campanas')
      .update({
        estado: 'pendiente',
        estadisticas: { total: destinatarios.length, enviados: 0, fallidos: 0, pendientes: destinatarios.length },
      })
      .eq('id', campanaInfo.id);
    return json({
      pendiente: true,
      mensaje: 'No hay envío configurado (falta el secreto RESEND_API_KEY): la campaña queda pendiente y los correos se guardan en la bandeja de salida.',
      estadisticas: { total: destinatarios.length, enviados: 0, fallidos: 0 },
    });
  }

  // Envío real por lotes con retraso para no saturar la API
  const TAMANO_LOTE = 10;
  const PAUSA_MS = 1000;
  let enviados = 0;
  let fallidos = 0;
  for (let inicio = 0; inicio < destinatarios.length; inicio += TAMANO_LOTE) {
    const lote = destinatarios.slice(inicio, inicio + TAMANO_LOTE);
    for (const para of lote) {
      try {
        const respuesta = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${claveResend}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: desde,
            to: [para],
            subject: campanaInfo.asunto,
            html: campanaInfo.html,
            ...(responderA ? { reply_to: responderA } : {}),
          }),
        });
        if (respuesta.ok) enviados++;
        else fallidos++;
      } catch {
        fallidos++;
      }
    }
    if (inicio + TAMANO_LOTE < destinatarios.length) await esperar(PAUSA_MS);
  }

  await db
    .from('campanas')
    .update({
      estado: 'enviada',
      enviada_en: new Date().toISOString(),
      estadisticas: { total: destinatarios.length, enviados, fallidos },
    })
    .eq('id', campanaInfo.id);

  return json({
    pendiente: false,
    mensaje: `Campaña enviada: ${enviados} de ${destinatarios.length} correos entregados.`,
    estadisticas: { total: destinatarios.length, enviados, fallidos },
  });
});
