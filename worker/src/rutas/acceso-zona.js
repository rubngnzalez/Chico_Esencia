// /api/acceso-zona — público: envía el enlace de acceso DE MARCA SHADDAI para
// la zona de clientes y la zona de distribuidores.
//
// Por qué existe: el proyecto Supabase es compartido y sus plantillas de
// correo de Auth (invitación, magic link, recuperación, OTP) están
// personalizadas con otra marca. Este endpoint genera el enlace de sesión con
// la service key (recuperación, que sí crea sesión con autoconfirmación
// activa) y lo envía envuelto en un correo SHADDAI con el logotipo vía Resend.
// La RLS ya limita lo que cada destinatario ve a lo suyo.

import { respuestaJson } from '../utilidades.js';
import { limitar, ipDeRequest, respuestaLimitador } from '../seguridad.js';
import { enviarCorreo, reemplazarVariables } from '../correo.js';
import { Ajustes } from '../db.js';

const URL_SUPABASE = 'https://zjzqbugpdpfuttdwagai.supabase.co';
const LOGO = 'https://omshaddai.com/img/shin-logo.png';

const DESTINOS = {
  cliente: 'https://omshaddai.com/zona-cliente.html?acceso=1',
  distribuidor: 'https://omshaddai.com/zona-distribuidor.html?invite=1',
};

const PLANTILLAS = {
  cliente: {
    asunto: 'Acceso a tu zona de clientes — OMSHADDAI',
    titulo: 'Acceso a tu zona de clientes',
    textoBoton: 'Ver mis pedidos',
    cuerpo:
      '<p>Hola:</p>' +
      '<p>Pulsa el botón para entrar en tu zona de clientes y ver el estado de tus pedidos de OMSHADDAI · Esencia de Umbral. El enlace es personal y caduca en una hora.</p>' +
      '{{BOTON}}' +
      '<p style="margin-top:14px;">Si tú no solicitaste este acceso, ignora este mensaje.</p>' +
      '<p>OMSHADDAI · Esencia de Umbral</p>',
  },
  distribuidor: {
    asunto: 'Define tu contraseña de distribuidor — OMSHADDAI',
    titulo: 'Tu acceso de distribuidor',
    textoBoton: 'Definir mi contraseña',
    cuerpo:
      '<p>Hola:</p>' +
      '<p>Pulsa el botón para definir la contraseña de tu zona privada de distribuidor (tienda B2B, material comercial y tus pedidos). El enlace es personal y de un solo uso.</p>' +
      '{{BOTON}}' +
      '<p style="margin-top:14px;">Si tú no solicitaste este acceso, ignora este mensaje.</p>' +
      '<p>OMSHADDAI · Esencia de Umbral</p>',
  },
};

function sobreMarca(titulo, htmlInterno) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#e9e3d3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9e3d3;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#f3eee2;border:1px solid rgba(201,164,95,.45);">
    <tr><td align="center" style="padding:28px 24px 10px;">
      <img src="${LOGO}" alt="SHADDAI · Esencia de Umbral" width="72" height="72" style="display:inline-block;border:0;outline:none;text-decoration:none;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:6px;color:#c9a45f;text-transform:uppercase;margin-top:10px;">OMSHADDAI · ${titulo}</div>
    </td></tr>
    <tr><td style="padding:6px 34px 30px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.75;color:#2b332c;">
      ${htmlInterno}
    </td></tr>
    <tr><td style="padding:16px 34px 26px;border-top:1px solid rgba(201,164,95,.35);font-family:Verdana,Arial,sans-serif;font-size:11px;color:#7d7466;text-align:center;">
      OMSHADDAI · Esencia de Umbral — Inhala · Exhala™<br>
      <a href="https://omshaddai.com" style="color:#8a6d3b;">omshaddai.com</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

async function generarEnlaceRecuperacion(claveServicio, email, destinoUrl) {
  const respuesta = await fetch(`${URL_SUPABASE}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: claveServicio,
      Authorization: `Bearer ${claveServicio}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'recovery', email, redirect_to: destinoUrl }),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (respuesta.ok && datos.action_link) return { enlace: String(datos.action_link) };
  const codigo = datos.error_code || datos.code || '';
  const mensaje = datos.msg || datos.message || datos.error_description || '';
  // Cliente o distribuidor que aún no tiene cuenta en Supabase Auth:
  // se crea confirmada y se reintenta una vez.
  if (codigo === 'user_not_found' || /not found/i.test(mensaje)) {
    const creacion = await fetch(`${URL_SUPABASE}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: claveServicio,
        Authorization: `Bearer ${claveServicio}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, email_confirm: true }),
    });
    if (!creacion.ok) {
      const detalleCreacion = await creacion.text().catch(() => '');
      return { error: `No se pudo crear la cuenta de acceso (${detalleCreacion.slice(0, 120)})` };
    }
    const reintento = await fetch(`${URL_SUPABASE}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        apikey: claveServicio,
        Authorization: `Bearer ${claveServicio}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'recovery', email, redirect_to: destinoUrl }),
    });
    const datosReintento = await reintento.json().catch(() => ({}));
    if (reintento.ok && datosReintento.action_link) return { enlace: String(datosReintento.action_link) };
    return { error: 'No se pudo generar el enlace de acceso tras crear la cuenta.' };
  }
  return { error: `Supabase respondió ${respuesta.status}: ${mensaje || codigo || 'error desconocido'}` };
}

export function registrar(enrutador) {
  enrutador.post('/api/acceso-zona', async (c) => {
    const limite = await limitar(c.db, 'acceso-zona:' + ipDeRequest(c.request), 6, 60 * 60 * 1000, 30 * 60 * 1000);
    if (limite.bloqueado) return respuestaLimitador(limite);

    // Honeypot anti-spam
    if (String(c.cuerpo.web || '') !== '') return respuestaJson({ ok: true });

    const email = String(c.cuerpo.email || '').trim().toLowerCase();
    const destino = String(c.cuerpo.destino || 'cliente');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !DESTINOS[destino]) {
      return respuestaJson({ error: 'Datos de acceso no válidos.' }, 400);
    }
    if (!c.env.SUPABASE_SERVICE_ROLE_KEY) {
      return respuestaJson(
        { error: 'El acceso por correo no está configurado todavía en el servidor. Contacta con SHADDAI.' },
        500
      );
    }

    let resultado;
    try {
      resultado = await generarEnlaceRecuperacion(c.env.SUPABASE_SERVICE_ROLE_KEY, email, DESTINOS[destino]);
    } catch (error) {
      return respuestaJson({ error: `No se pudo preparar el acceso: ${error.message}` }, 502);
    }
    if (resultado.error) {
      return respuestaJson({ error: `No se pudo preparar el acceso: ${resultado.error}` }, 502);
    }

    const config = PLANTILLAS[destino];
    const boton = `<a href="${resultado.enlace}" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">${config.textoBoton}</a>`;
    const html = sobreMarca(config.titulo, reemplazarVariables(config.cuerpo, { BOTON: boton }));

    const ajustes = await new Ajustes(c.db).leer();
    // Remitente SIEMPRE en el dominio verificado de Resend (omshaddai.com):
    // el ajuste smtp.desde del panel puede apuntar a otro dominio (shaddai.es)
    // que Resend rechazaría.
    const ajustesEnvio = {
      ...ajustes,
      smtp: { ...(ajustes.smtp || {}), desde: 'SHADDAI · Esencia de Umbral <accesos@omshaddai.com>' },
    };
    const envio = await enviarCorreo(
      c.db,
      c.env,
      ajustesEnvio,
      { para: email, asunto: config.asunto, html, responderA: undefined },
      { campana: 'acceso-zona' }
    );

    if (!envio.enviado && envio.error) {
      return respuestaJson({ error: `El correo de acceso no pudo enviarse: ${envio.error}` }, 502);
    }

    return respuestaJson({
      ok: true,
      mensaje: envio.enviado
        ? 'Te hemos enviado un correo con el enlace de acceso. Caduca en una hora; revisa también la carpeta de spam.'
        : 'El correo de acceso quedó en cola de envío del panel (sin envío real configurado).',
    });
  });

  // ─── PERFIL DEL DISTRIBUIDOR ────────────────────────────────────────────
  // Con la sesión de Supabase del distribuidor: devuelve su ficha y permite
  // actualizar sus datos personales y de empresa (nunca descuento, territorios
  // ni acceso: eso lo gestiona el panel).
  const CAMPOS_PERFIL = {
    empresa: 120,
    razon_social: 160,
    cif: 24,
    persona_contacto: 120,
    telefono: 40,
  };

  enrutador.post('/api/distribuidor-perfil', async (c) => {
    const limite = await limitar(c.db, 'perfil-dist:' + ipDeRequest(c.request), 30, 60 * 60 * 1000, 15 * 60 * 1000);
    if (limite.bloqueado) return respuestaLimitador(limite);

    const token = (c.request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return respuestaJson({ error: 'Entra en tu zona para ver tu perfil.' }, 401);
    const clave = c.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!clave) return respuestaJson({ error: 'El perfil no está configurado todavía en el servidor.' }, 500);

    let userId = '';
    try {
      const r = await fetch(`${URL_SUPABASE}/auth/v1/user`, {
        headers: { apikey: clave, Authorization: `Bearer ${token}` },
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok || !datos?.id) return respuestaJson({ error: 'Tu sesión ha caducado. Vuelve a entrar.' }, 401);
      userId = String(datos.id);
    } catch {
      return respuestaJson({ error: 'No se pudo validar la sesión.' }, 502);
    }

    const filaResp = await fetch(
      `${URL_SUPABASE}/rest/v1/oms_distribuidores?user_id=eq.${encodeURIComponent(userId)}&select=*`,
      { headers: { apikey: clave, Authorization: `Bearer ${clave}` } }
    );
    const filas = await filaResp.json().catch(() => []);
    const fila = (filas || [])[0];
    if (!fila) return respuestaJson({ error: 'Distribuidor no encontrado.' }, 404);

    // Guardado (solo campos permitidos; descuento, territorios y acceso los
    // gestiona el panel)
    if (c.cuerpo && c.cuerpo.guardar) {
      const campos = c.cuerpo.campos || {};
      const direccion = (campos.direccion && typeof campos.direccion === 'object') ? campos.direccion : {};
      const cambios = {
        empresa: String(campos.empresa ?? fila.empresa ?? '').trim().slice(0, CAMPOS_PERFIL.empresa),
        razon_social: String(campos.razon_social ?? fila.razon_social ?? '').trim().slice(0, CAMPOS_PERFIL.razon_social),
        cif: String(campos.cif ?? fila.cif ?? '').trim().slice(0, CAMPOS_PERFIL.cif),
        persona_contacto: String(campos.persona_contacto ?? fila.persona_contacto ?? '').trim().slice(0, CAMPOS_PERFIL.persona_contacto),
        telefono: String(campos.telefono ?? fila.telefono ?? '').trim().slice(0, CAMPOS_PERFIL.telefono),
        direccion: {
          calle: String(direccion.calle ?? '').trim().slice(0, 200),
          cp: String(direccion.cp ?? '').trim().slice(0, 12),
          poblacion: String(direccion.poblacion ?? '').trim().slice(0, 100),
          provincia: String(direccion.provincia ?? '').trim().slice(0, 100),
          pais: String(direccion.pais ?? '').trim().slice(0, 60),
        },
      };
      const patch = await fetch(
        `${URL_SUPABASE}/rest/v1/oms_distribuidores?user_id=eq.${encodeURIComponent(userId)}`,
        {
          method: 'PATCH',
          headers: {
            apikey: clave,
            Authorization: `Bearer ${clave}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(cambios),
        }
      );
      const actualizadas = await patch.json().catch(() => []);
      if (!patch.ok || !(actualizadas || [])[0]) {
        return respuestaJson({ error: 'No se pudieron guardar tus datos. Inténtalo de nuevo.' }, 502);
      }
      Object.assign(fila, (actualizadas || [])[0]);
    }

    return respuestaJson({
      ok: true,
      perfil: {
        empresa: fila.empresa,
        razon_social: fila.razon_social,
        cif: fila.cif,
        persona_contacto: fila.persona_contacto,
        email: fila.email,
        telefono: fila.telefono,
        direccion: fila.direccion || {},
        descuento_pct: Number(fila.descuento_pct) || 0,
        zonas_territorio: fila.zonas_territorio || [],
        acceso_habilitado: fila.acceso_habilitado,
      },
    });
  });
}
