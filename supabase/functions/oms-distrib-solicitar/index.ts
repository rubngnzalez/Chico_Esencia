// Edge Function «oms-distrib-solicitar» — paso 1 de "Hazte distribuidor".
// Recibe email + persona de contacto + teléfono (obligatorios) + captcha
// matemático firmado; crea o renueva la solicitud en el banco de emails y
// envía el correo de verificación (24 h) con enlace a la web.
//
// Respuestas siempre genéricas: no se revela el estado real de un email ya
// registrado (ni si está completado, aceptado o en revisión).
//
// Despliegue: npx supabase functions deploy oms-distrib-solicitar

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  cabeceras,
  errorJson,
  captchaValido,
  dentroDelLimite,
  tokenNuevo,
  sha256Hex,
  sobreMarca,
  plantillaDe,
  enviarCorreo,
  cargarAjustesDistrib,
  escaparHtml,
  EMAIL_RE,
  ipDe,
} from './correo.ts';

const CADUCIDAD_TOKEN_MS = 24 * 60 * 60 * 1000;
const PAUSA_REENVIO_MS = 10 * 60 * 1000; // entre reenvíos
const MAX_REENVIOS = 6;

const DEFECTO_VERIFICACION = {
  asunto: 'Confirma tu correo para ser distribuidor de SHADDAI',
  html: '<p>Hola, {{persona_contacto}}:</p><p>Hemos recibido tu interés en el programa de distribuidores de <strong>SHADDAI · Esencia de Umbral</strong>. Para continuar, confirma que este correo es tuyo pulsando el botón (el enlace caduca en 24 horas):</p><p style="text-align:center;margin:24px 0;"><a href="{{enlace}}" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Confirmar mi correo y continuar</a></p><p>Si tú no solicitaste esto, ignora este mensaje y no se creará ninguna solicitud.</p><p>Con aprecio,<br>SHADDAI · Esencia de Umbral</p>',
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
    return errorJson('Has intentado demasiadas veces. Espera un rato antes de volver a enviarlo.', 429, request);
  }

  let cuerpo: {
    email?: unknown;
    personaContacto?: unknown;
    telefono?: unknown;
    captcha?: { datos?: unknown; firma?: unknown; respuesta?: unknown };
    web?: unknown; // honeypot anti-spam
  };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  // Honeypot: los bots rellenan el campo oculto «web» → respuesta OK sin guardar
  if (String(cuerpo.web || '') !== '') {
    return new Response(JSON.stringify({ ok: true }), { headers: cabeceras(request) });
  }

  const email = String(cuerpo.email || '').trim().toLowerCase().slice(0, 160);
  const persona = String(cuerpo.personaContacto || '').trim().slice(0, 120);
  const telefono = String(cuerpo.telefono || '').trim().slice(0, 40);

  if (!email || !persona || !telefono) {
    return errorJson('El correo, la persona de contacto y el teléfono son obligatorios.', 400, request);
  }
  if (!EMAIL_RE.test(email)) {
    return errorJson('El correo electrónico indicado no es válido.', 400, request);
  }
  if (!/^[+()\d\s.-]{6,}$/.test(telefono)) {
    return errorJson('El teléfono indicado no parece válido.', 400, request);
  }
  if (!(await captchaValido(cuerpo.captcha, claveServicio))) {
    return errorJson('La comprobación de seguridad no es correcta. Vuelve a resolverla.', 400, request);
  }

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // ¿Ya hay un registro activo para este email?
  const { data: existentes } = await db
    .from('oms_distrib_solicitudes')
    .select('id, estado, token_hash, token_expira, reenvios, ultimo_reenvio, origen_ip')
    .ilike('email', email)
    .order('creado_en', { ascending: false })
    .limit(1);
  const existente = (existentes || [])[0] as {
    id: string;
    estado: string;
    token_hash: string | null;
    token_expira: string | null;
    reenvios: number;
    ultimo_reenvio: string | null;
    origen_ip: string | null;
  } | null;

  const activa = existente && !['rechazada', 'descartada'].includes(existente.estado);
  const puedeRelanzar = activa && ['pendiente_verificacion', 'verificada'].includes(existente.estado);

  if (activa && !puedeRelanzar) {
    // Completada o aceptada: respuesta genérica, sin email nuevo (no filtra estado)
    return new Response(
      JSON.stringify({ ok: true, mensaje: 'Si este correo corresponde a una solicitud, te hemos enviado un mensaje para continuar.' }),
      { headers: cabeceras(request) }
    );
  }

  if (activa && existente.ultimo_reenvio) {
    const desdeUltimo = Date.now() - Date.parse(existente.ultimo_reenvio);
    if (desdeUltimo < PAUSA_REENVIO_MS) {
      return errorJson('Acabamos de enviarte un correo hace poco. Revisa tu bandeja (y la carpeta de spam) antes de reenviar.', 429, request);
    }
    if (Number(existente.reenvios) >= MAX_REENVIOS) {
      return errorJson('Se han enviado demasiados correos para este correo. Escríbenos desde la página de contacto.', 429, request);
    }
  }

  // Token nuevo de un uso (solo se guarda el hash)
  const token = tokenNuevo();
  const tokenHash = await sha256Hex(token);
  const expira = new Date(Date.now() + CADUCIDAD_TOKEN_MS).toISOString();

  let solicitudId: string;
  if (activa && existente) {
    const { data: actualizada, error } = await db
      .from('oms_distrib_solicitudes')
      .update({
        token_hash: tokenHash,
        token_expira: expira,
        reenvios: Number(existente.reenvios) + 1,
        ultimo_reenvio: new Date().toISOString(),
        persona_contacto: persona,
        telefono,
        origen_ip: existente.origen_ip || ip,
      })
      .eq('id', existente.id)
      .select('id')
      .single();
    if (error || !actualizada) return errorJson('No se pudo registrar la solicitud.', 500, request);
    solicitudId = actualizada.id;
  } else {
    const { data: creada, error } = await db
      .from('oms_distrib_solicitudes')
      .insert({
        email,
        persona_contacto: persona,
        telefono,
        estado: 'pendiente_verificacion',
        token_hash: tokenHash,
        token_expira: expira,
        reenvios: 1,
        ultimo_reenvio: new Date().toISOString(),
        origen_ip: ip,
      })
      .select('id')
      .single();
    if (error || !creada) {
      // Índice único de email activo: si choca, es una carrera; respuesta genérica
      return errorJson('No se pudo registrar la solicitud. Comprueba los datos e inténtalo de nuevo.', 400, request);
    }
    solicitudId = creada.id;
  }

  // Correo de verificación con plantilla de marca (logo incluido)
  const ajustes = await cargarAjustesDistrib(db);
  const enlace = `https://omshaddai.com/distribuidores.html?verificar=${token}`;
  const plantilla = plantillaDe(ajustes.distribucion, 'verificacion', {
    persona_contacto: escaparHtml(persona),
    enlace,
  }, DEFECTO_VERIFICACION);
  const html = sobreMarca(plantilla.html, ajustes.logotipo);
  await enviarCorreo(db, Deno.env.get('RESEND_API_KEY'), ajustes.desde, email, plantilla.asunto, html, ajustes.responderA);

  return new Response(
    JSON.stringify({
      ok: true,
      mensaje: 'Te hemos enviado un correo para confirmar tu dirección. Revisa la bandeja de entrada y la carpeta de spam.',
    }),
    { headers: cabeceras(request) }
  );
});
