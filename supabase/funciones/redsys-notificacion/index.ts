// Edge Function «redsys-notificacion» — webhook de Redsys (fase 2, opcional).
// Sustituye a POST /api/public/redsys-notificacion del Worker:
//  1. Recibe el POST urlencoded de Redsys.
//  2. Valida la firma HMAC_SHA256_V1 con la clave guardada en ajustes.
//  3. Marca el pedido «pagado» (o «cancelado» si no se autoriza).
//  4. Dispara los emails automáticos (plantillas de ajustes) → outbox y,
//     si existe el secreto RESEND_API_KEY, envío real con Resend.
//
// Despliegue: npx supabase functions deploy redsys-notificacion
// URL pública: https://TU_REF.supabase.co/functions/v1/redsys-notificacion

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verificarNotificacion } from './redsys.ts';

function textoPlano(mensaje: string, estado = 200): Response {
  // Redsys solo comprueba el código HTTP: respondemos texto breve
  return new Response(mensaje, {
    status: estado,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function reemplazarVariables(plantilla: string, variables: Record<string, string>): string {
  let texto = String(plantilla || '');
  for (const [clave, valor] of Object.entries(variables)) {
    texto = texto.split(`{{${clave}}}`).join(valor == null ? '' : String(valor));
  }
  return texto;
}

function listaArticulosHtml(lineas: Array<Record<string, unknown>>): string {
  const items = (lineas || [])
    .map((l) => `<li>${l.cantidad} × ${l.nombre} — ${Number(l.precio_unitario || 0).toFixed(2)} €</li>`)
    .join('');
  return `<ul style="padding-left:18px;margin:8px 0;">${items}</ul>`;
}

function generarEml(desde: string, para: string | string[], asunto: string, html: string): string {
  const cabeceras = [
    `From: ${desde}`,
    `To: ${Array.isArray(para) ? para.join(', ') : para}`,
    `Subject: ${asunto}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date().toUTCString()}`,
    'X-SHADDAI-Estado: pendiente',
    '',
  ];
  return cabeceras.join('\r\n') + html + '\r\n';
}

async function enviarCorreo(
  db: ReturnType<typeof createClient>,
  mensaje: { para: string | string[]; asunto: string; html: string; desde: string },
  extra: { refPedido?: string | null; refCampana?: string | null }
): Promise<{ enviado: boolean; pendiente: boolean }> {
  const claveResend = Deno.env.get('RESEND_API_KEY');
  if (claveResend) {
    try {
      const respuesta = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${claveResend}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: mensaje.desde,
          to: Array.isArray(mensaje.para) ? mensaje.para : [mensaje.para],
          subject: mensaje.asunto,
          html: mensaje.html,
        }),
      });
      if (respuesta.ok) return { enviado: true, pendiente: false };
    } catch {
      // sin red o Rechend falla: cae al outbox
    }
  }
  await db.from('outbox').insert({
    para: Array.isArray(mensaje.para) ? mensaje.para.join(', ') : mensaje.para,
    asunto: mensaje.asunto,
    html: mensaje.html,
    eml: generarEml(mensaje.desde, mensaje.para, mensaje.asunto, mensaje.html),
    estado: 'pendiente',
    ref_pedido: extra.refPedido || null,
    ref_campana: extra.refCampana || null,
  });
  return { enviado: false, pendiente: true };
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return textoPlano('Método no permitido', 405);

  const urlSupabase = Deno.env.get('SUPABASE_URL');
  const claveServicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!urlSupabase || !claveServicio) return textoPlano('Función sin configurar', 500);

  const db = createClient(urlSupabase, claveServicio, { auth: { persistSession: false } });

  // 1 · Cuerpo urlencoded de Redsys
  const formulario = new URLSearchParams(await request.text());
  const cuerpo: Record<string, string> = {};
  for (const [clave, valor] of formulario.entries()) cuerpo[clave] = valor;

  // 2 · Clave de firma desde ajustes
  const { data: filaAjustes } = await db
    .from('ajustes')
    .select('contacto, redsys, smtp, emails_automaticos, notificaciones')
    .eq('id', 'general')
    .single();
  if (!filaAjustes) return textoPlano('Pago no configurado', 500);
  const ajustes = filaAjustes as {
    contacto?: Record<string, unknown>;
    redsys?: Record<string, unknown>;
    smtp?: Record<string, unknown>;
    emails_automaticos?: Record<string, { activo?: boolean; asunto?: string; html?: string }>;
    notificaciones?: Record<string, unknown>;
  };
  const clave = String(ajustes.redsys?.clave || '');
  if (!clave) return textoPlano('Pago no configurado', 500);

  // 3 · Verificación de firma
  const verificacion = await verificarNotificacion(cuerpo, clave);
  if (!verificacion.ok) return textoPlano(verificacion.motivo || 'Notificación inválida', 400);

  const numero = String(verificacion.pedido);
  const { data: pedido } = await db
    .from('pedidos')
    .select('id, numero, cliente, subtotal, envio, total, estado')
    .eq('numero', numero)
    .single();
  if (!pedido) return textoPlano('Pedido no encontrado para esta notificación', 404);
  const pedidoInfo = pedido as {
    id: string;
    numero: string;
    cliente: Record<string, string>;
    total: number;
    estado: string;
  };

  if (pedidoInfo.estado === 'pagado') return textoPlano('Pedido ya marcado como pagado');

  // 4 · Marcar pagado / cancelado
  if (!verificacion.autorizado) {
    await db
      .from('pedidos')
      .update({
        estado: 'cancelado',
        respuesta_redsys: {
          respuesta: verificacion.respuesta,
          autorizacion: verificacion.autorizacion,
          importe: verificacion.importe,
        },
      })
      .eq('id', pedidoInfo.id);
    return textoPlano('Pago no autorizado: pedido cancelado');
  }

  if (verificacion.importe && Math.round(pedidoInfo.total * 100) !== verificacion.importe) {
    return textoPlano('El importe notificado no coincide con el pedido', 400);
  }

  await db
    .from('pedidos')
    .update({
      estado: 'pagado',
      pagado_en: new Date().toISOString(),
      respuesta_redsys: {
        respuesta: verificacion.respuesta,
        autorizacion: verificacion.autorizacion,
        importe: verificacion.importe,
      },
    })
    .eq('id', pedidoInfo.id);

  // 5 · Líneas para las plantillas
  const { data: lineasPedido } = await db
    .from('pedidos_lineas')
    .select('codigo, nombre, cantidad, precio_unitario')
    .eq('pedido', pedidoInfo.id);

  const formatearEuro = (valor: number) =>
    (Number(valor) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  const nombre = String(pedidoInfo.cliente?.nombre || 'alma buscadora');
  const variables = {
    nombre,
    pedido: pedidoInfo.numero,
    total: formatearEuro(pedidoInfo.total),
    articulos: listaArticulosHtml((lineasPedido || []) as Array<Record<string, unknown>>),
  };

  const desde = String(ajustes.smtp?.desde || 'SHADDAI · Esencia de Umbral <sin-configurar@omshaddai.com>');
  const emailCliente = String(pedidoInfo.cliente?.email || '');

  // 6 · Emails automáticos (confirmación + agradecimiento) e informe interno
  const plantillas = ajustes.emails_automaticos || {};
  for (const clavePlantilla of ['confirmacionCompra', 'agradecimiento']) {
    const plantilla = plantillas[clavePlantilla];
    if (!plantilla || plantilla.activo === false || !emailCliente) continue;
    await enviarCorreo(
      db,
      {
        para: emailCliente,
        asunto: reemplazarVariables(plantilla.asunto || '', variables),
        html: reemplazarVariables(plantilla.html || '', variables),
        desde,
      },
      { refPedido: pedidoInfo.numero }
    );
  }

  const notificaciones = ajustes.notificaciones || {};
  const destinos = Array.isArray(ajustes.contacto?.emailsDestino) ? (ajustes.contacto!.emailsDestino as string[]) : [];
  if (notificaciones.nuevoPedido !== false && destinos.length > 0) {
    await enviarCorreo(
      db,
      {
        para: destinos,
        asunto: `Nuevo pedido pagado — ${pedidoInfo.numero}`,
        html: `<div style="font-family:Georgia,serif;color:#16261b;line-height:1.7;">
          <p><strong>Pedido:</strong> ${pedidoInfo.numero}</p>
          <p><strong>Cliente:</strong> ${nombre} (${emailCliente})</p>
          <p><strong>Total:</strong> ${formatearEuro(pedidoInfo.total)}</p>
          ${listaArticulosHtml((lineasPedido || []) as Array<Record<string, unknown>>)}
        </div>`,
        desde,
      },
      { refPedido: pedidoInfo.numero }
    );
  }

  return textoPlano('Notificación procesada: pedido marcado como pagado');
});
