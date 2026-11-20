// Utilidades comunes de las funciones del programa de distribuidores:
// verificación de captcha, hashing de tokens, plantillas de correo de marca
// (cabecera con el logotipo de la empresa) y envío con Resend o bandeja
// de salida (.eml) cuando no hay clave de envío.
//
// Cada carpeta de función lleva su copia (patrón redsys.ts): las funciones
// se despliegan de forma independiente.

// ─── CORS ──────────────────────────────────────────────────────────────────

const ORIGENES = ['https://omshaddai.com', 'https://rubngnzalez.github.io', 'https://shaddai-panel.redes-301dpi.workers.dev'];
const ORIGENES_EXTRA = (Deno.env.get('CORS_ORIGENES_EXTRA') || '').split(',').map((o) => o.trim()).filter(Boolean);

export function cabeceras(request?: Request): Record<string, string> {
  const origen = request?.headers.get('origin') || '';
  const permitido = [...ORIGENES, ...ORIGENES_EXTRA].some((o) => origen === o || origen.endsWith('.omshaddai.com')) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origen) ||
    origen.endsWith('.githubpreview.com');
  return {
    'Access-Control-Allow-Origin': permitido ? origen : ORIGENES[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export function errorJson(mensaje: string, estado = 400, request?: Request): Response {
  return new Response(JSON.stringify({ error: mensaje, ok: false }), { status: estado, headers: cabeceras(request) });
}

// ─── CAPTCHA: misma firma que «oms-distrib-captcha» ────────────────────────

export async function hmacBase64url(clave: string, datos: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(clave),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(datos));
  const bytes = new Uint8Array(firma);
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

// Verifica el reto del captcha: { datos: "a+b.expira", firma, respuesta }
export async function captchaValido(
  captcha: { datos?: unknown; firma?: unknown; respuesta?: unknown } | null | undefined,
  claveServicio: string
): Promise<boolean> {
  if (!captcha) return false;
  const datos = String(captcha.datos || '');
  const firma = String(captcha.firma || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const respuesta = String(captcha.respuesta ?? '').trim();
  if (!datos || !firma || !respuesta) return false;
  const partes = datos.split('.');
  if (partes.length !== 2) return false;
  const expira = Number(partes[1]);
  if (!Number.isFinite(expira) || expira < Date.now()) return false;
  const esperada = await hmacBase64url(claveServicio + 'captcha', datos);
  if (!comparacionSegura(esperada, firma)) return false;
  const operacion = partes[0];
  const suma = operacion.indexOf('+');
  const resta = operacion.indexOf('-');
  const mult = operacion.indexOf('*');
  let esperado: number;
  try {
    if (suma > 0) esperado = Number(operacion.slice(0, suma)) + Number(operacion.slice(suma + 1));
    else if (resta > 0) esperado = Number(operacion.slice(0, resta)) - Number(operacion.slice(resta + 1));
    else if (mult > 0) esperado = Number(operacion.slice(0, mult)) * Number(operacion.slice(mult + 1));
    else return false;
  } catch {
    return false;
  }
  return Number.isFinite(esperado) && respuesta === String(esperado);
}

// Rate-limit ligero en memoria por IP (se reinicia al rotar el isolate;
// suficiente como barrera contra spam masivo).
const VENTANA_MS = 60 * 60 * 1000;
const MAXIMO = 8;
const registro = new Map<string, number[]>();

export function dentroDelLimite(ip: string): boolean {
  const ahora = Date.now();
  const marcas = (registro.get(ip) || []).filter((m) => ahora - m < VENTANA_MS);
  if (marcas.length >= MAXIMO) {
    registro.set(ip, marcas);
    return false;
  }
  marcas.push(ahora);
  registro.set(ip, marcas);
  if (registro.size > 5000) registro.clear(); // higiene de memoria
  return true;
}

// ─── TOKENS de verificación (hash sha256, nunca el token en claro) ─────────

export async function sha256Hex(texto: string): Promise<string> {
  const resumen = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  const bytes = new Uint8Array(resumen);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function tokenNuevo(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── CORREO de marca (cabecera con el logotipo de la empresa) ──────────────

export function escaparHtml(texto: string): string {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Sobre de marca: tabla compatible con clientes de correo, logo arriba,
// paleta crema/verde/dorado y pie de marca. El logo tiene texto alternativo:
// si algún cliente no carga imágenes, la marca sigue presente en texto.
export function sobreMarca(htmlInterno: string, logotipo: string, titulo = ''): string {
  const logo = String(logotipo || 'https://omshaddai.com/img/shin-logo.png');
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#e9e3d3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9e3d3;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#f3eee2;border:1px solid rgba(201,164,95,.45);">
    <tr><td align="center" style="padding:28px 24px 10px;">
      <img src="${escaparHtml(logo)}" alt="SHADDAI · Esencia de Umbral" width="72" height="72" style="display:inline-block;border:0;outline:none;text-decoration:none;">
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;letter-spacing:6px;color:#c9a45f;text-transform:uppercase;margin-top:10px;">SHADDAI${titulo ? ` · ${escaparHtml(titulo)}` : ''}</div>
    </td></tr>
    <tr><td style="padding:6px 34px 30px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.75;color:#2b332c;">
      ${htmlInterno}
    </td></tr>
    <tr><td style="padding:16px 34px 26px;border-top:1px solid rgba(201,164,95,.35);font-family:Verdana,Arial,sans-serif;font-size:11px;color:#7d7466;text-align:center;">
      SHADDAI · Esencia de Umbral — Inhala · Exhala™<br>
      Programa de distribuidores · <a href="https://omshaddai.com" style="color:#8a6d3b;">omshaddai.com</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

export interface PlantillaCorreo {
  asunto?: string;
  html?: string;
}

export function plantillaDe(
  ajustesDistrib: Record<string, unknown>,
  clave: string,
  variables: Record<string, string>,
  defecto: { asunto: string; html: string }
): { asunto: string; html: string } {
  const plantillas = (ajustesDistrib.plantillas || {}) as Record<string, PlantillaCorreo>;
  const guardada = plantillas[clave] || {};
  let asunto = String(guardada.asunto || defecto.asunto);
  let html = String(guardada.html || defecto.html);
  for (const [claveVar, valor] of Object.entries(variables)) {
    const aguja = `{{${claveVar}}}`;
    asunto = asunto.split(aguja).join(valor);
    html = html.split(aguja).join(valor);
  }
  return { asunto, html };
}

// Envío real con Resend si hay clave; si no (o si Resend rechaza el envío),
// fila en oms_outbox (el panel la ofrece como .eml descargable) — igual que
// «oms-enviar-campana». Devuelve SIEMPRE por qué no se envió realmente, para
// que el panel pueda decirle al admin el motivo exacto en vez de un genérico.
export async function enviarCorreo(
  db: { from: (t: string) => any },
  claveResend: string | undefined,
  desde: string,
  para: string,
  asunto: string,
  html: string,
  responderA?: string,
  refPedido?: string
): Promise<{ enviado: boolean; detalle?: string }> {
  let detalle = claveResend ? '' : 'falta la clave RESEND_API_KEY del proyecto';
  if (claveResend) {
    try {
      const respuesta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${claveResend}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: desde,
          to: [para],
          subject: asunto,
          html,
          ...(responderA ? { reply_to: responderA } : {}),
        }),
      });
      if (respuesta.ok) return { enviado: true };
      detalle = `Resend rechazó el envío (HTTP ${respuesta.status})`;
      try {
        const cuerpo = await respuesta.json();
        if (cuerpo?.message) detalle += `: ${cuerpo.message}`;
      } catch {
        // respuesta sin cuerpo JSON legible
      }
    } catch (error) {
      detalle = `no se pudo conectar con Resend: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
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
  try {
    const { error } = await db.from('oms_outbox').insert({
      para,
      asunto,
      html,
      eml: cabeceras.join('\r\n') + html + '\r\n',
      estado: 'pendiente',
      ...(refPedido ? { ref_pedido: refPedido } : {}),
    });
    // supabase-js v2 no lanza con fallos de PostgREST: devuelve { error }
    if (error) detalle += `; además falló la Bandeja de salida: ${error.message}`;
  } catch (error) {
    detalle += `; además falló la Bandeja de salida: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { enviado: false, detalle };
}

// Ajustes del programa (sección distribucion) + remitente de SMTP
export async function cargarAjustesDistrib(db: { from: (t: string) => any }) {
  const { data: fila } = await db
    .from('oms_ajustes')
    .select('distribucion, smtp, contacto')
    .eq('id', 'general')
    .maybeSingle();
  const filaInfo = (fila || {}) as { distribucion?: Record<string, unknown>; smtp?: Record<string, unknown>; contacto?: Record<string, unknown> };
  const distribucion = filaInfo.distribucion || {};
  const desde = String(filaInfo.smtp?.desde || 'SHADDAI · Esencia de Umbral <sin-configurar@omshaddai.com>');
  const emailsContacto = Array.isArray(filaInfo.contacto?.emailsDestino)
    ? (filaInfo.contacto!.emailsDestino as string[])
    : [];
  const emailsDistrib = Array.isArray(distribucion.emailsDestino) ? (distribucion.emailsDestino as string[]) : [];
  return {
    distribucion,
    desde,
    logotipo: String(distribucion.logotipo || 'https://omshaddai.com/img/shin-logo.png'),
    responderA: emailsContacto[0] || undefined,
    emailsAviso: emailsDistrib.length > 0 ? emailsDistrib : emailsContacto,
    textos: (distribucion.textos || {}) as Record<string, unknown>,
    textosVersion: Number(distribucion.textosVersion) || 1,
  };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ipDe(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    'desconocida'
  );
}
