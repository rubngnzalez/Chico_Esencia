// Edge Function «oms-distrib-gestion» — acciones del panel sobre el programa
// de distribuidores que necesitan service_role o envío de correo:
//   · aceptar              → crea el distribuidor + cuenta de Supabase Auth
//                            (invitación) + correo de bienvenida de marca.
//   · rechazar             → marca la solicitud como rechazada (email opcional).
//   · descartar            → marca la solicitud como descartada (sin email).
//   · reenviar-verificacion→ regenera el token y reenvía el correo (banco).
//   · reenviar-invite      → nuevo enlace de activación de la zona VIP.
//   · notificar-proforma   → avisa al distribuidor de que su transferencia
//                            llegó y el pedido pasa a preparación.
//
// Requiere sesión del panel con rol admin o editor (igual que oms-enviar-campana).
// Despliegue: npx supabase functions deploy oms-distrib-gestion

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  cabeceras,
  errorJson,
  tokenNuevo,
  sha256Hex,
  sobreMarca,
  plantillaDe,
  cargarAjustesDistrib,
  enviarCorreo,
  escaparHtml,
  ipDe,
} from './correo.ts';

const CADUCIDAD_TOKEN_MS = 24 * 60 * 60 * 1000;

const DEFECTO_ACEPTACION = {
  asunto: 'Bienvenido al programa de distribuidores — SHADDAI',
  html: '<p>Hola, {{persona_contacto}}:</p><p>Nos alegra confirmarte que <strong>{{empresa}}</strong> ha sido aceptada en el programa de distribuidores de SHADDAI · Esencia de Umbral.</p><p>Tus datos de acceso a la zona privada (tienda de distribuidor, material comercial y tus pedidos):</p><ul><li><strong>Correo:</strong> {{email}}</li><li><strong>Contraseña temporal:</strong> <code>{{contrasena}}</code></li></ul><p>Entra desde este botón y, por seguridad, cambia la contraseña desde tu zona cuando quieras:</p><p style="text-align:center;margin:24px 0;"><a href="{{enlace}}" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Entrar en mi zona</a></p><p>Tu descuento de distribuidor aplicado: <strong>{{descuento}}%</strong>.</p><p>Bienvenido al Umbral.<br>SHADDAI · Esencia de Umbral</p>',
};

// Contraseña temporal de 6 dígitos numéricos (fácil de teclear); el
// distribuidor debe definir la suya en su primer acceso a la zona.
function contrasenaTemporal(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => String(b % 10)).join('');
}

const DEFECTO_RECHAZO = {
  asunto: 'Sobre tu solicitud de distribución — SHADDAI',
  html: '<p>Hola, {{persona_contacto}}:</p><p>Gracias por el tiempo dedicado a tu solicitud. Tras revisarla con atención, de momento no podemos seguir adelante con la distribución en tu zona. Guardamos tu contacto por si la situación cambia.</p><p>Gracias por tu interés en SHADDAI.</p>',
};

const DEFECTO_PROFORMA_PAGADA = {
  asunto: 'Transferencia recibida: {{numero_pedido}} en preparación — SHADDAI',
  html: '<p>Hola, {{persona_contacto}}:</p><p>Hemos recibido el importe del pedido <strong>{{numero_pedido}}</strong>. Ya está en preparación y te avisaremos cuando salga.</p><p>Gracias por confiar en SHADDAI · Esencia de Umbral.</p>',
};

interface SolicitudFila {
  id: string;
  email: string;
  estado: string;
  persona_contacto: string;
  telefono: string;
  datos: Record<string, unknown>;
}

// Verifica el JWT del panel y que el perfil tenga rol admin o editor
async function verificarPanel(
  urlSupabase: string,
  claveServicio: string,
  token: string
): Promise<{ ok: true; db: any } | { ok: false; respuesta: Response }> {
  const respuesta = (mensaje: string, estado: number) =>
    new Response(JSON.stringify({ error: mensaje }), { status: estado, headers: cabeceras() });
  const anon = createClient(urlSupabase, Deno.env.get('SUPABASE_ANON_KEY') || claveServicio, {
    auth: { persistSession: false },
  });
  const { data: datosUsuario, error: errorToken } = await anon.auth.getUser(token);
  if (errorToken || !datosUsuario?.user) return { ok: false, respuesta: respuesta('Sesión no válida.', 401) };

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });
  const { data: perfil } = await db
    .from('oms_usuarios')
    .select('id, rol, activo')
    .eq('id', datosUsuario.user.id)
    .maybeSingle();
  const perfilInfo = perfil as { rol: string; activo: boolean } | null;
  if (!perfilInfo || perfilInfo.activo === false) return { ok: false, respuesta: respuesta('Tu cuenta no está activa.', 403) };
  if (!['admin', 'editor'].includes(perfilInfo.rol)) {
    return { ok: false, respuesta: respuesta('Solo administración y edición pueden gestionar distribuidores.', 403) };
  }
  return { ok: true, db };
}

function sanearZonas(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((z) => String(z).trim().slice(0, 60))
    .filter(Boolean)
    .filter((z, i, lista) => lista.indexOf(z) === i)
    .slice(0, 12);
}

// Defensa del enlace de activación: si Supabase devolviera un redirect_to
// fuera de la zona VIP (p. ej. el Site URL por no estar en la lista blanca),
// se reescribe siempre al de la zona VIP en producción.
function enlazarActivacion(actionLink: string): string {
  const destino = encodeURIComponent('https://omshaddai.com/zona-distribuidor.html?invite=1');
  if (/redirect_to=[^&]*omshaddai\.com/.test(actionLink)) return actionLink;
  if (!/redirect_to=/.test(actionLink)) return actionLink;
  return actionLink.replace(/redirect_to=[^&]*/, `redirect_to=${destino}`);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST') return errorJson('Método no permitido.', 405, request);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) {
    return errorJson('La función no está configurada (faltan secretos del proyecto).', 500, request);
  }
  ipDe(request); // (log de origen disponible si se necesita auditoría)

  const autorizacion = request.headers.get('Authorization') || '';
  const token = autorizacion.replace(/^Bearer\s+/i, '').trim();
  if (!token) return errorJson('Falta el token de sesión.', 401);

  const panel = await verificarPanel(urlSupabase, claveServicio, token);
  if (!panel.ok) return panel.respuesta;
  const db = panel.db;

  // Cliente admin (service_role): necesario para las operaciones auth.admin
  const admin = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  let cuerpo: {
    accion?: string;
    solicitudId?: unknown;
    distribuidorId?: unknown;
    pedidoId?: unknown;
    descuentoPct?: unknown;
    zonasTerritorio?: unknown;
    enviarCorreo?: unknown;
  };
  try {
    cuerpo = await request.json();
  } catch {
    return errorJson('El cuerpo de la petición no es JSON válido.', 400, request);
  }

  const accion = String(cuerpo.accion || '');
  const ajustes = await cargarAjustesDistrib(db);
  const claveResend = Deno.env.get('RESEND_API_KEY');

  // ─── ACEPTAR ────────────────────────────────────────────────────────────
  if (accion === 'aceptar') {
    const solicitudId = String(cuerpo.solicitudId || '');
    const descuento = Math.min(100, Math.max(0, Number(cuerpo.descuentoPct) || 0));
    const zonas = sanearZonas(cuerpo.zonasTerritorio);

    const { data: encontradas, error: errorSol } = await db
      .from('oms_distrib_solicitudes')
      .select('id, email, estado, persona_contacto, telefono, datos')
      .eq('id', solicitudId)
      .limit(1);
    if (errorSol) return errorJson('No se pudo leer la solicitud.', 500, request);
    const solicitud = (encontradas || [])[0] as SolicitudFila | undefined;
    if (!solicitud) return errorJson('Solicitud no encontrada.', 404);
    if (solicitud.estado !== 'completada') {
      return errorJson('Solo se pueden aceptar solicitudes completadas (pendientes de aceptación).', 400, request);
    }

    const datosForm = solicitud.datos || {};
    const empresa = String(datosForm.empresa || solicitud.email);
    const razonSocial = String(datosForm.razonSocial || '');
    const cif = String(datosForm.cif || '');
    const persona = String(datosForm.personaContacto || solicitud.persona_contacto || '');
    const telefono = String(datosForm.telefono || solicitud.telefono || '');
    const direccion = (datosForm.direccion && typeof datosForm.direccion === 'object')
      ? (datosForm.direccion as Record<string, unknown>)
      : {};

    // ¿Ya existe un distribuidor para este email?
    const { data: duplicados } = await db
      .from('oms_distribuidores')
      .select('id, user_id')
      .ilike('email', solicitud.email)
      .limit(1);
    const duplicado = (duplicados || [])[0] as { id: string; user_id: string | null } | undefined;

    // Cuenta de zona VIP (invitación con enlace para definir contraseña)
    let userId: string | null = duplicado?.user_id || null;
    let enlaceActivacion = '';
    try {
      // Las operaciones admin (generateLink) exigen service_role; el cliente
      // «anon» solo vale para auth.getUser de sesiones.
      const { data: existenteAuth } = await admin.auth.admin.listUsers();
      const yaExiste = (existenteAuth?.users || []).find((u: { email?: string }) =>
        String(u.email || '').toLowerCase() === solicitud.email.toLowerCase()
      );
      if (yaExiste) {
        // ¿Es personal del panel? entonces no se puede convertir en distribuidor
        const { data: perfilPanel } = await db
          .from('oms_usuarios')
          .select('rol, activo')
          .eq('id', yaExiste.id)
          .maybeSingle();
        const perfil = perfilPanel as { rol: string; activo: boolean } | null;
        if (perfil && perfil.activo) {
          return errorJson('Ese correo pertenece a una cuenta del panel: no puede ser distribuidor a la vez.', 400, request);
        }
        userId = yaExiste.id;
        const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({
          type: 'invite',
          email: solicitud.email,
          options: { redirectTo: 'https://omshaddai.com/zona-distribuidor.html?invite=1' },
        });
        if (errorEnlace || !enlace?.properties?.action_link) {
          return errorJson(`No se pudo generar el enlace de activación: ${errorEnlace?.message || 'error desconocido'}`, 500, request);
        }
        enlaceActivacion = enlazarActivacion(String(enlace.properties.action_link));
        // Su perfil queda INACTIVO: no es personal del panel (el proyecto no
        // tiene trigger sobre auth.users; el perfil se crea explícitamente).
        await db
          .from('oms_usuarios')
          .upsert({ id: yaExiste.id, email: solicitud.email, nombre: persona, rol: 'lector', activo: false, ambito: 'distribuidor' }, { onConflict: 'id' });
      } else {
        const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({
          type: 'invite',
          email: solicitud.email,
          options: { redirectTo: 'https://omshaddai.com/zona-distribuidor.html?invite=1' },
        });
        if (errorEnlace || !enlace?.properties?.action_link) {
          return errorJson(`No se pudo crear la cuenta de la zona VIP: ${errorEnlace?.message || 'error desconocido'}`, 500, request);
        }
        userId = enlace.user?.id || null;
        enlaceActivacion = enlazarActivacion(String(enlace.properties.action_link));
        if (userId) {
          await db
            .from('oms_usuarios')
            .upsert({ id: userId, email: solicitud.email, nombre: persona, rol: 'lector', activo: false, ambito: 'distribuidor' }, { onConflict: 'id' });
        }
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      return errorJson(`No se pudo crear la cuenta de la zona VIP: ${mensaje}`, 500, request);
    }

    // Contraseña temporal: con la autoconfirmación activa, el enlace de
    // invitación NO crea sesión, así que entregamos una contraseña por correo
    // y el distribuidor la cambia desde su zona. Se confirma también el correo
    // del usuario: generateLink(invite) deja la cuenta sin confirmar y el
    // signInWithPassword fallaría con «email_not_confirmed» aunque la
    // contraseña fuera correcta.
    let contrasenaTemporalTexto = '';
    if (userId) {
      try {
        contrasenaTemporalTexto = contrasenaTemporal();
        const cambio = await admin.auth.admin.updateUserById(userId, {
          password: contrasenaTemporalTexto,
          email_confirm: true,
        });
        if (cambio.error) throw new Error(cambio.error.message);
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        return errorJson(`La cuenta se creó, pero no se pudo fijar su contraseña temporal: ${mensaje}`, 500, request);
      }
    }

    let distribuidorId: string;
    if (duplicado) {
      const { data: actualizado, error: errorUpd } = await db
        .from('oms_distribuidores')
        .update({
          empresa,
          razon_social: razonSocial,
          cif,
          persona_contacto: persona,
          telefono,
          direccion,
          descuento_pct: descuento,
          acceso_habilitado: true,
          zonas_territorio: zonas,
          user_id: userId,
          solicitud_id: solicitud.id,
        })
        .eq('id', duplicado.id)
        .select('id')
        .single();
      if (errorUpd || !actualizado) return errorJson(`No se pudo actualizar el distribuidor: ${errorUpd?.message || ''}`, 500, request);
      distribuidorId = actualizado.id;
    } else {
      const { data: creado, error: errorCrear } = await db
        .from('oms_distribuidores')
        .insert({
          user_id: userId,
          solicitud_id: solicitud.id,
          empresa,
          razon_social: razonSocial,
          cif,
          persona_contacto: persona,
          email: solicitud.email,
          telefono,
          direccion,
          descuento_pct: descuento,
          acceso_habilitado: true,
          zonas_territorio: zonas,
        })
        .select('id')
        .single();
      if (errorCrear || !creado) {
        return errorJson(`No se pudo crear el distribuidor: ${errorCrear?.message || ''}`, 500, request);
      }
      distribuidorId = creado.id;
    }

    await db
      .from('oms_distrib_solicitudes')
      .update({ estado: 'aceptada', distribuidor_id: distribuidorId })
      .eq('id', solicitud.id);

    const correo = plantillaDe(ajustes.distribucion, 'aceptacion', {
      persona_contacto: escaparHtml(persona),
      empresa: escaparHtml(empresa),
      email: escaparHtml(solicitud.email),
      contrasena: escaparHtml(contrasenaTemporalTexto || '(ver correo anterior)'),
      enlace: 'https://omshaddai.com/zona-distribuidor.html',
      descuento: String(descuento),
    }, DEFECTO_ACEPTACION);
    const envio = await enviarCorreo(
      db,
      claveResend,
      ajustes.desde,
      solicitud.email,
      correo.asunto,
      sobreMarca(correo.html, ajustes.logotipo),
      ajustes.responderA
    );

    return new Response(
      JSON.stringify({
        ok: true,
        distribuidorId,
        mensaje: envio.enviado
          ? 'Distribuidor aceptado: cuenta creada y correo de activación enviado.'
          : `Distribuidor aceptado y cuenta creada, pero el correo NO se envió (${envio.detalle}); queda en la Bandeja de salida (.eml).`,
      }),
      { headers: cabeceras(request) }
    );
  }

  // ─── RECHAZAR / DESCARTAR ───────────────────────────────────────────────
  if (accion === 'rechazar' || accion === 'descartar') {
    const solicitudId = String(cuerpo.solicitudId || '');
    const { data: encontradas, error: errorSol } = await db
      .from('oms_distrib_solicitudes')
      .select('id, email, estado, persona_contacto, datos')
      .eq('id', solicitudId)
      .limit(1);
    if (errorSol) return errorJson('No se pudo leer la solicitud.', 500, request);
    const solicitud = (encontradas || [])[0] as SolicitudFila | undefined;
    if (!solicitud) return errorJson('Solicitud no encontrada.', 404);
    if (solicitud.estado === 'aceptada') {
      return errorJson('Esta solicitud ya fue aceptada: gestiona al distribuidor desde su ficha.', 400, request);
    }

    const nuevoEstado = accion === 'rechazar' ? 'rechazada' : 'descartada';
    const { error: errorUpd } = await db
      .from('oms_distrib_solicitudes')
      .update({ estado: nuevoEstado, token_hash: null, token_expira: null })
      .eq('id', solicitud.id);
    if (errorUpd) return errorJson('No se pudo actualizar la solicitud.', 500, request);

    if (accion === 'rechazar' && cuerpo.enviarCorreo === true) {
      const persona = String(solicitud.persona_contacto || solicitud.datos?.personaContacto || '');
      const correo = plantillaDe(ajustes.distribucion, 'rechazo', {
        persona_contacto: escaparHtml(persona),
      }, DEFECTO_RECHAZO);
      const envio = await enviarCorreo(
        db,
        claveResend,
        ajustes.desde,
        solicitud.email,
        correo.asunto,
        sobreMarca(correo.html, ajustes.logotipo),
        ajustes.responderA
      );
      return new Response(
        JSON.stringify({
          ok: true,
          estado: nuevoEstado,
          mensaje: envio.enviado
            ? 'Solicitud rechazada y correo de aviso enviado.'
            : `Solicitud rechazada, pero el correo NO se envió (${envio.detalle}); queda en la Bandeja de salida (.eml).`,
        }),
        { headers: cabeceras(request) }
      );
    }
    return new Response(JSON.stringify({ ok: true, estado: nuevoEstado }), { headers: cabeceras(request) });
  }

  // ─── REENVIAR VERIFICACIÓN (banco de emails) ────────────────────────────
  if (accion === 'reenviar-verificacion') {
    const solicitudId = String(cuerpo.solicitudId || '');
    const { data: encontradas, error: errorSol } = await db
      .from('oms_distrib_solicitudes')
      .select('id, email, estado, persona_contacto, telefono, reenvios')
      .eq('id', solicitudId)
      .limit(1);
    if (errorSol) return errorJson('No se pudo leer la solicitud.', 500, request);
    const solicitud = (encontradas || [])[0] as
      | (SolicitudFila & { reenvios: number })
      | undefined;
    if (!solicitud) return errorJson('Solicitud no encontrada.', 404);
    if (!['pendiente_verificacion', 'verificada'].includes(solicitud.estado)) {
      return errorJson('Solo se puede reenviar el enlace a solicitudes sin verificar o sin formulario.', 400, request);
    }
    if (Number(solicitud.reenvios) >= 12) {
      return errorJson('Demasiados reenvíos para este interesado.', 429, request);
    }

    const token = tokenNuevo();
    const tokenHash = await sha256Hex(token);
    await db
      .from('oms_distrib_solicitudes')
      .update({
        token_hash: tokenHash,
        token_expira: new Date(Date.now() + CADUCIDAD_TOKEN_MS).toISOString(),
        reenvios: Number(solicitud.reenvios) + 1,
        ultimo_reenvio: new Date().toISOString(),
      })
      .eq('id', solicitud.id);

    const enlace = `https://omshaddai.com/distribuidores.html?verificar=${token}`;
    const plantillas = (ajustes.distribucion.plantillas || {}) as Record<string, { asunto?: string; html?: string }>;
    const guardada = plantillas.verificacion || {};
    const persona = escaparHtml(String(solicitud.persona_contacto || ''));
    const asunto = String(guardada.asunto || 'Confirma tu correo para ser distribuidor de SHADDAI');
    const html = String(
      guardada.html ||
        '<p>Hola, {{persona_contacto}}:</p><p>Confirma que este correo es tuyo para continuar con tu solicitud de distribuidor de SHADDAI (el enlace caduca en 24 horas):</p><p style="text-align:center;margin:24px 0;"><a href="{{enlace}}" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Confirmar mi correo y continuar</a></p><p>SHADDAI · Esencia de Umbral</p>'
    )
      .split('{{persona_contacto}}').join(persona)
      .split('{{enlace}}').join(enlace);
    const envio = await enviarCorreo(
      db,
      claveResend,
      ajustes.desde,
      solicitud.email,
      asunto,
      sobreMarca(html, ajustes.logotipo),
      ajustes.responderA
    );
    return new Response(
      JSON.stringify({
        ok: true,
        mensaje: envio.enviado
          ? 'Correo de verificación reenviado.'
          : `El correo NO se envió (${envio.detalle}); queda en la Bandeja de salida (.eml).`,
      }),
      { headers: cabeceras(request) }
    );
  }

  // ─── REENVIAR INVITACIÓN DE LA ZONA VIP ─────────────────────────────────
  // Genera una contraseña temporal nueva y la envía por correo de marca
  // (el acceso ya no depende de enlaces de sesión: funciona con la
  // autoconfirmación activa del proyecto).
  if (accion === 'reenviar-invite') {
    const distribuidorId = String(cuerpo.distribuidorId || '');
    const { data: encontrados, error: errorDist } = await db
      .from('oms_distribuidores')
      .select('id, email, empresa, persona_contacto, descuento_pct, user_id')
      .eq('id', distribuidorId)
      .limit(1);
    if (errorDist) return errorJson('No se pudo leer el distribuidor.', 500, request);
    const distribuidor = (encontrados || [])[0] as
      | { id: string; email: string; empresa: string; persona_contacto: string; descuento_pct: number; user_id: string | null }
      | undefined;
    if (!distribuidor) return errorJson('Distribuidor no encontrado.', 404);

    let userId = distribuidor.user_id;
    try {
      if (!userId) {
        // Cuenta nunca creada (aceptar anterior a este flujo): se crea ahora
        const { data: enlace, error: errorEnlace } = await admin.auth.admin.generateLink({
          type: 'invite',
          email: distribuidor.email,
          options: { redirectTo: 'https://omshaddai.com/zona-distribuidor.html?invite=1' },
        });
        if (errorEnlace || !enlace?.user?.id) {
          return errorJson(`No se pudo crear la cuenta: ${errorEnlace?.message || 'error desconocido'}`, 500, request);
        }
        userId = enlace.user.id;
        await db.from('oms_distribuidores').update({ user_id: userId }).eq('id', distribuidor.id);
      }

      // Contraseña temporal nueva (la anterior deja de servir). Se confirma
      // también el correo: sin confirmación el login devolvería
      // «email_not_confirmed» aunque la contraseña fuera correcta.
      const temporal = contrasenaTemporal();
      const cambio = await admin.auth.admin.updateUserById(userId, {
        password: temporal,
        email_confirm: true,
      });
      if (cambio.error) {
        return errorJson(`No se pudo fijar la contraseña temporal: ${cambio.error.message}`, 500, request);
      }

      // El perfil se crea en «aceptar»; aquí solo se asegura el estado inactivo
      // sin pisar perfiles del panel (admin/editor activos).
      const { data: perfilExistente } = await db
        .from('oms_usuarios')
        .select('rol, activo')
        .eq('id', userId)
        .maybeSingle();
      const perfil = perfilExistente as { rol: string; activo: boolean } | null;
      if (!perfil) {
        await db
          .from('oms_usuarios')
          .upsert(
            { id: userId, email: distribuidor.email, nombre: distribuidor.persona_contacto || distribuidor.empresa, rol: 'lector', activo: false, ambito: 'distribuidor' },
            { onConflict: 'id' }
          );
      } else if (!['admin', 'editor'].includes(perfil.rol)) {
        await db.from('oms_usuarios').update({ activo: false }).eq('id', userId);
      }

      const correo = plantillaDe(ajustes.distribucion, 'aceptacion', {
        persona_contacto: escaparHtml(distribuidor.persona_contacto || ''),
        empresa: escaparHtml(distribuidor.empresa || ''),
        email: escaparHtml(distribuidor.email),
        contrasena: escaparHtml(temporal),
        enlace: 'https://omshaddai.com/zona-distribuidor.html',
        descuento: String(Number(distribuidor.descuento_pct) || 0),
      }, DEFECTO_ACEPTACION);
      const envio = await enviarCorreo(
        db,
        claveResend,
        ajustes.desde,
        distribuidor.email,
        correo.asunto,
        sobreMarca(correo.html, ajustes.logotipo),
        ajustes.responderA
      );
      return new Response(
        JSON.stringify({
          ok: true,
          mensaje: envio.enviado
            ? 'Correo de acceso enviado (con contraseña temporal nueva).'
            : `El correo NO se envió (${envio.detalle}); queda en la Bandeja de salida (.eml).`,
        }),
        { headers: cabeceras(request) }
      );
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      return errorJson(`No se pudo preparar el acceso: ${mensaje}`, 500, request);
    }
  }

  // ─── NOTIFICAR PROFORMA PAGADA ──────────────────────────────────────────
  if (accion === 'notificar-proforma') {
    const pedidoId = String(cuerpo.pedidoId || '');
    const { data: encontrados, error: errorPedido } = await db
      .from('oms_pedidos')
      .select('id, numero, numero_publico, total, canal, metodo, distribuidor_id')
      .eq('id', pedidoId)
      .limit(1);
    if (errorPedido) return errorJson('No se pudo leer el pedido.', 500, request);
    const pedido = (encontrados || [])[0] as
      | { id: string; numero: string; numero_publico: string | null; total: number; canal: string; metodo: string; distribuidor_id: string | null }
      | undefined;
    if (!pedido) return errorJson('Pedido no encontrado.', 404);
    if (pedido.canal !== 'distribuidor' || pedido.metodo !== 'transferencia') {
      return errorJson('Solo se notifican proformas de distribuidores.', 400, request);
    }
    if (!pedido.distribuidor_id) {
      return errorJson('El pedido no tiene distribuidor asociado.', 400, request);
    }

    const { data: distRows } = await db
      .from('oms_distribuidores')
      .select('id, email, persona_contacto, descuento_pct')
      .eq('id', pedido.distribuidor_id)
      .limit(1);
    const distribuidor = (distRows || [])[0] as
      | { id: string; email: string; persona_contacto: string; descuento_pct: number }
      | undefined;
    if (!distribuidor) return errorJson('Distribuidor no encontrado.', 404);

    const correo = plantillaDe(ajustes.distribucion, 'proformaPagada', {
      persona_contacto: escaparHtml(distribuidor.persona_contacto || ''),
      numero_pedido: escaparHtml(pedido.numero_publico || pedido.numero),
    }, DEFECTO_PROFORMA_PAGADA);
    const envio = await enviarCorreo(
      db,
      claveResend,
      ajustes.desde,
      distribuidor.email,
      correo.asunto,
      sobreMarca(correo.html, ajustes.logotipo),
      ajustes.responderA,
      pedido.numero
    );
    return new Response(
      JSON.stringify({
        ok: true,
        mensaje: envio.enviado
          ? 'Correo de transferencia recibida enviado.'
          : `El correo NO se envió (${envio.detalle}); queda en la Bandeja de salida (.eml).`,
      }),
      { headers: cabeceras(request) }
    );
  }

  return errorJson('Acción no reconocida.', 400, request);
});
