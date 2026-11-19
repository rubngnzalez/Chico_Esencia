// Edge Function «oms-distrib-completar» — paso 2 de "Hazte distribuidor".
// Recibe el formulario completo (datos de empresa + cuestionario) junto con
// el token de verificación y las aceptaciones legales. Guarda todo en la
// solicitud, la pasa a «completada» (pendiente de aceptación), invalida el
// token y envía: confirmación al interesado + aviso interno al equipo.
//
// Despliegue: npx supabase functions deploy oms-distrib-completar

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  cabeceras,
  errorJson,
  dentroDelLimite,
  sha256Hex,
  sobreMarca,
  plantillaDe,
  cargarAjustesDistrib,
  enviarCorreo,
  escaparHtml,
  ipDe,
} from './correo.ts';

const DEFECTO_RECIBIDA = {
  asunto: 'Hemos recibido tu solicitud de distribución — SHADDAI',
  html: '<p>Hola, {{persona_contacto}}:</p><p>Tu solicitud del programa de distribuidores quedó <strong>completada y en revisión</strong>. Nuestro equipo la estudiará con calma y te escribiremos de vuelta para contarte los siguientes pasos.</p><p>Gracias por querer llevar el Umbral más lejos.</p><p>SHADDAI · Esencia de Umbral</p>',
};

const DEFECTO_AVISO = {
  asunto: 'Nueva solicitud de distribuidor: {{empresa}}',
  html: '<p>Nueva solicitud completada en la web:</p><ul><li><strong>Empresa:</strong> {{empresa}}</li><li><strong>Persona de contacto:</strong> {{persona_contacto}}</li><li><strong>Email:</strong> {{email}}</li><li><strong>Teléfono:</strong> {{telefono}}</li></ul><p>Revísala en el panel: Distribuidores → Solicitudes (pendiente de aceptación).</p>',
};

const CAMPOS_TEXTO: Array<[string, number]> = [
  ['empresa', 120],
  ['razonSocial', 160],
  ['cif', 24],
  ['personaContacto', 120],
  ['telefono', 40],
  ['web', 200],
  ['territorio', 120],
  ['comentarios', 1000],
];

const CLAVES_CUESTIONARIO = [
  'tipoEstablecimiento',
  'actividad',
  'experiencia',
  'motivaciones',
  'canales',
  'comoNosConociste',
];

function sanear(datos: Record<string, unknown>): Record<string, unknown> {
  const limpio: Record<string, unknown> = {};
  for (const [campo, max] of CAMPOS_TEXTO) {
    if (datos[campo] != null) limpio[campo] = String(datos[campo]).trim().slice(0, max);
  }
  for (const campo of CLAVES_CUESTIONARIO) {
    const valor = datos[campo];
    if (Array.isArray(valor)) {
      limpio[campo] = valor.map((v) => String(v).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
    } else if (valor != null && valor !== '') {
      limpio[campo] = String(valor).trim().slice(0, 80);
    }
  }
  const direccion = (datos.direccion || {}) as Record<string, unknown>;
  if (direccion && typeof direccion === 'object') {
    limpio.direccion = {
      calle: String(direccion.calle || '').trim().slice(0, 200),
      cp: String(direccion.cp || '').trim().slice(0, 12),
      poblacion: String(direccion.poblacion || '').trim().slice(0, 100),
      provincia: String(direccion.provincia || '').trim().slice(0, 100),
      pais: String(direccion.pais || '').trim().slice(0, 60),
    };
  }
  return limpio;
}

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
    return errorJson('Demasiados intentos. Espera un rato antes de volver a enviarlo.', 429, request);
  }

  let cuerpo: {
    token?: unknown;
    datos?: Record<string, unknown>;
    legalAceptado?: unknown;
    privacidadAceptado?: unknown;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const token = String(cuerpo.token || '').trim();
  if (!token || token.length !== 64) {
    return errorJson('El enlace de verificación no es válido. Vuelve a abrirlo desde tu correo o solicita uno nuevo.', 400, request);
  }

  const datos = sanear(cuerpo.datos || {});
  const dir = (datos.direccion || {}) as Record<string, string>;

  const faltan: string[] = [];
  if (!datos.empresa) faltan.push('empresa');
  if (!datos.personaContacto) faltan.push('persona de contacto');
  if (!datos.telefono) faltan.push('teléfono');
  if (!dir.pais) faltan.push('país');
  if (faltan.length > 0) {
    return errorJson(`Faltan campos obligatorios: ${faltan.join(', ')}.`, 400, request);
  }
  if (cuerpo.legalAceptado !== true || cuerpo.privacidadAceptado !== true) {
    return errorJson('Debes aceptar los avisos legales y la protección de datos para enviar la solicitud.', 400, request);
  }

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });
  const tokenHash = await sha256Hex(token);

  const { data: encontradas, error } = await db
    .from('oms_distrib_solicitudes')
    .select('id, email, estado, token_expira, persona_contacto, telefono')
    .eq('token_hash', tokenHash)
    .order('creado_en', { ascending: false })
    .limit(1);
  if (error) return errorJson('No se pudo comprobar el enlace.', 500, request);

  const solicitud = (encontradas || [])[0] as
    | { id: string; email: string; estado: string; token_expira: string | null; persona_contacto: string; telefono: string }
    | undefined;
  if (!solicitud) {
    return errorJson('El enlace no es válido o ya se utilizó.', 400, request);
  }
  if (!solicitud.token_expira || Date.parse(solicitud.token_expira) < Date.now()) {
    return errorJson('El enlace ha caducado (dura 24 horas). Solicita un nuevo correo desde la página de distribuidores.', 400, request);
  }
  if (solicitud.estado !== 'verificada') {
    return errorJson('Esta solicitud ya no admite el formulario. Escríbenos desde la página de contacto si tienes dudas.', 400, request);
  }

  const ajustes = await cargarAjustesDistrib(db);
  const ahora = new Date().toISOString();

  const { error: errorUpdate } = await db
    .from('oms_distrib_solicitudes')
    .update({
      estado: 'completada',
      datos,
      persona_contacto: String(datos.personaContacto || solicitud.persona_contacto),
      telefono: String(datos.telefono || solicitud.telefono),
      legal_aceptado_en: ahora,
      privacidad_aceptado_en: ahora,
      textos_version: ajustes.textosVersion,
      aceptacion_ip: ip,
      token_hash: null,
      token_expira: null,
    })
    .eq('id', solicitud.id);
  if (errorUpdate) return errorJson('No se pudo guardar la solicitud. Inténtalo de nuevo en unos minutos.', 500, request);

  const persona = String(datos.personaContacto || solicitud.persona_contacto);
  const empresa = String(datos.empresa || '');

  // 1 · Confirmación al interesado
  const recibida = plantillaDe(ajustes.distribucion, 'solicitudRecibida', {
    persona_contacto: escaparHtml(persona),
    empresa: escaparHtml(empresa),
  }, DEFECTO_RECIBIDA);
  await enviarCorreo(
    db,
    Deno.env.get('RESEND_API_KEY'),
    ajustes.desde,
    solicitud.email,
    recibida.asunto,
    sobreMarca(recibida.html, ajustes.logotipo),
    ajustes.responderA
  );

  // 2 · Aviso interno al equipo (emailsDestino de Distribución; si está vacío,
  // los de contacto). Nunca bloquea la respuesta al interesado.
  try {
    const aviso = plantillaDe(ajustes.distribucion, 'avisoInterno', {
      empresa: escaparHtml(empresa),
      persona_contacto: escaparHtml(persona),
      email: escaparHtml(solicitud.email),
      telefono: escaparHtml(String(datos.telefono || solicitud.telefono)),
    }, DEFECTO_AVISO);
    for (const destino of ajustes.emailsAviso.slice(0, 5)) {
      await enviarCorreo(
        db,
        Deno.env.get('RESEND_API_KEY'),
        ajustes.desde,
        String(destino),
        aviso.asunto,
        sobreMarca(aviso.html, ajustes.logotipo),
        solicitud.email
      );
    }
  } catch {
    // el aviso interno no debe romper la solicitud del interesado
  }

  return new Response(
    JSON.stringify({ ok: true, mensaje: 'Solicitud enviada. Te avisaremos por correo con la respuesta.' }),
    { headers: cabeceras(request) }
  );
});
