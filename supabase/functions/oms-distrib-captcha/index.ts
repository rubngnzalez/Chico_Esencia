// Edge Function «oms-distrib-captcha» — reto matemático sencillo para el
// formulario "Hazte distribuidor" (suma, resta o multiplicación fácil).
//
// Devuelve una operación con firma HMAC y caducidad: «oms-distrib-solicitar»
// verifica la firma y la respuesta antes de crear la solicitud. Sin estado en
// base de datos. La clave de firma se deriva del service_role del proyecto
// (nunca sale de las funciones); no hay que configurar ningún secreto nuevo.
//
// Recibe:  POST vacío (o GET)
// Devuelve { ok, pregunta, datos, firma, expira }
//
// Despliegue: npx supabase functions deploy oms-distrib-captcha

import { createClient } from 'npm:@supabase/supabase-js@2';

const ORIGENES = ['https://omshaddai.com', 'https://rubngnzalez.github.io', 'https://shaddai-panel.redes-301dpi.workers.dev'];
const ORIGENES_EXTRA = (Deno.env.get('CORS_ORIGENES_EXTRA') || '').split(',').map((o) => o.trim()).filter(Boolean);

function cabeceras(request?: Request): Record<string, string> {
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

function errorJson(mensaje: string, estado = 400, request?: Request): Response {
  return new Response(JSON.stringify({ error: mensaje, ok: false }), { status: estado, headers: cabeceras(request) });
}

const VIDA_MS = 10 * 60 * 1000; // el reto caduca en 10 minutos

function aleatorio(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function hmacBase64url(clave: string, datos: string): Promise<string> {
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

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cabeceras(request) });
  if (request.method !== 'POST' && request.method !== 'GET') {
    return errorJson('Método no permitido.', 405, request);
  }

  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!claveServicio) return errorJson('La función no está configurada.', 500, request);

  // Operación sencilla: suma, resta (nunca negativa) o multiplicación pequeña
  const operaciones = ['+', '-', '*'] as const;
  const op = operaciones[aleatorio(0, 2)];
  let a: number;
  let b: number;
  if (op === '+') {
    a = aleatorio(2, 9);
    b = aleatorio(1, 9);
  } else if (op === '-') {
    a = aleatorio(4, 9);
    b = aleatorio(1, a - 1);
  } else {
    a = aleatorio(2, 6);
    b = aleatorio(2, 5);
  }
  const expira = Date.now() + VIDA_MS;
  const datos = `${a}${op}${b}.${expira}`;
  const firma = await hmacBase64url(claveServicio + 'captcha', datos);
  const bonito = op === '*' ? '×' : op === '-' ? '−' : '+';

  // Textos legales públicos (Ajustes → Distribución → textos): los pinta el
  // formulario para que el interesado los lea antes de aceptar.
  let textos: Record<string, unknown> = {};
  let textosVersion = 1;
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL') || '', claveServicio, { auth: { persistSession: false } });
    const { data: fila } = await db.from('oms_ajustes').select('distribucion').eq('id', 'general').maybeSingle();
    const distribucion = ((fila as { distribucion?: Record<string, unknown> } | null)?.distribucion || {}) as Record<string, unknown>;
    if (distribucion.textos && typeof distribucion.textos === 'object') textos = distribucion.textos as Record<string, unknown>;
    textosVersion = Number(distribucion.textosVersion) || 1;
  } catch {
    // sin textos guardados: la web usa los suyos de reserva
  }

  return new Response(
    JSON.stringify({
      ok: true,
      pregunta: `¿Cuánto es ${a} ${bonito} ${b}?`,
      datos,
      firma,
      expira: new Date(expira).toISOString(),
      textos,
      textosVersion,
    }),
    { headers: cabeceras(request) }
  );
});
