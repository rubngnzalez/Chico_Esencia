// Edge Function «oms-cliente-acceso» — acceso de clientes a su zona.
// El cliente escribe su correo en zona-cliente.html; aquí se genera un enlace
// mágico de Supabase (signIn por email) y se envía por correo DE MARCA con el
// logotipo. Al pulsarlo, Supabase entrega la sesión en la propia página de la
// zona de clientes y la RLS solo le enseña SUS pedidos (los comprados con ese
// email). Crea la cuenta automáticamente si el cliente es nuevo.
//
// Despliegue: npx supabase functions deploy oms-cliente-acceso

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  cabeceras,
  errorJson,
  dentroDelLimite,
  sobreMarca,
  plantillaDe,
  cargarAjustesDistrib,
  enviarCorreo,
  escaparHtml,
  EMAIL_RE,
  ipDe,
} from './correo.ts';

const DEFECTO_ACCESO = {
  asunto: 'Acceso a tu zona de clientes — SHADDAI',
  html: '<p>Hola:</p><p>Pulsa el botón para entrar en tu zona de clientes y ver el estado de tus pedidos de SHADDAI · Esencia de Umbral. El enlace es personal y caduca en una hora.</p><p style="text-align:center;margin:24px 0;"><a href="{{enlace}}" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Ver mis pedidos</a></p><p>Si tú no solicitaste este acceso, ignora este mensaje.</p><p>SHADDAI · Esencia de Umbral</p>',
};

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') return errorJson('Método no permitido.', 405, request);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return errorJson('La función no está configurada (faltan secretos del proyecto).', 500, request);
  }

  const ip = ipDe(request);
  if (!dentroDelLimite(ip)) {
    return errorJson('Has pedido demasiados accesos. Espera un rato antes de volver a intentarlo.', 429, request);
  }

  let cuerpo: { email?: unknown; web?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  // Honeypot anti-spam
  if (String(cuerpo.web || '') !== '') {
    return new Response(JSON.stringify({ ok: true }), { headers: cabeceras(request) });
  }

  const email = String(cuerpo.email || '').trim().toLowerCase().slice(0, 160);
  if (!email || !EMAIL_RE.test(email)) {
    return errorJson('Escribe un correo electrónico válido.', 400, request);
  }

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });
  const admin = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  let enlaceAccion = '';
  try {
    // «magiclink»: al pulsar el enlace, Supabase entrega la sesión en la
    // página de la zona de clientes. Crea la cuenta si el cliente es nuevo.
    const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo: 'https://omshaddai.com/zona-cliente.html?acceso=1' },
    });
    if (errorEnlace || !enlace?.properties?.action_link) {
      return errorJson(`No se pudo generar el acceso: ${errorEnlace?.message || 'error desconocido'}`, 500, request);
    }
    enlaceAccion = String(enlace.properties.action_link);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return errorJson(`No se pudo preparar el acceso: ${mensaje}`, 500, request);
  }

  // Correo de marca (logo incluido); si un cliente nuevo aún no existe en
  // auth, generateLink ya lo creó, así que el enlace siempre es válido.
  const ajustes = await cargarAjustesDistrib(db);
  const plantilla = plantillaDe(ajustes.distribucion, 'accesoCliente', {
    enlace: enlaceAccion,
    email: escaparHtml(email),
  }, DEFECTO_ACCESO);
  await enviarCorreo(
    db,
    Deno.env.get('RESEND_API_KEY'),
    ajustes.desde,
    email,
    plantilla.asunto,
    sobreMarca(plantilla.html, ajustes.logotipo),
    ajustes.responderA
  );

  return new Response(
    JSON.stringify({
      ok: true,
      mensaje: 'Te hemos enviado un correo con el enlace para entrar en tu zona. Caduca en una hora; revisa también la carpeta de spam.',
    }),
    { headers: cabeceras(request) }
  );
});
