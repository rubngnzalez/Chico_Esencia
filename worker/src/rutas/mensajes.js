// /api/mensajes (bandeja de entrada) y /api/outbox (correos .eml pendientes)

import { requerirSesion, requerirRol } from '../seguridad.js';
import { validar, error400, error404, respuestaJson, ahora, nuevoId } from '../utilidades.js';
import { enviarCorreo } from '../correo.js';
import { Ajustes } from '../db.js';

export function registrar(enrutador, cx) {
  // ── Bandeja de entrada ───────────────────────────────────────────────────
  enrutador.get('/api/mensajes', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    const filtro = c.query.get('estado') || 'todos';
    let datos = await cx.coleccionMensajes.todo();
    if (filtro === 'noleidos') datos = datos.filter((m) => !m.leido && !m.archivado);
    else if (filtro === 'leidos') datos = datos.filter((m) => m.leido && !m.archivado);
    else if (filtro === 'archivados') datos = datos.filter((m) => m.archivado);
    else datos = datos.filter((m) => !m.archivado);
    datos.sort((a, b) => String(b.recibidoEn || '').localeCompare(String(a.recibidoEn || '')));
    const totalNoLeidos = (await cx.coleccionMensajes.leer()).filter((m) => !m.leido && !m.archivado).length;
    return respuestaJson({ datos, total: datos.length, totalNoLeidos });
  });

  enrutador.get('/api/mensajes/:id', async (c) => {
    const guard = requerirSesion(c);
    if (guard) return guard;
    const mensaje = await cx.coleccionMensajes.porId(c.params.id);
    if (!mensaje) return error404('Mensaje no encontrado.');
    return respuestaJson({ dato: mensaje });
  });

  enrutador.put('/api/mensajes/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor', 'lector');
    if (guard) return guard;
    const mensaje = await cx.coleccionMensajes.porId(c.params.id);
    if (!mensaje) return error404('Mensaje no encontrado.');
    const comprobacion = validar(
      {
        leido: { tipo: 'booleano' },
        archivado: { tipo: 'booleano' },
        respuesta: { tipo: 'texto', max: 8000 },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const cambios = {};
    if (comprobacion.datos.leido !== undefined) cambios.leido = comprobacion.datos.leido;
    if (comprobacion.datos.archivado !== undefined) cambios.archivado = comprobacion.datos.archivado;
    if (comprobacion.datos.respuesta !== undefined) {
      cambios.respuesta = comprobacion.datos.respuesta;
      cambios.respondidoEn = comprobacion.datos.respuesta ? new Date().toISOString() : null;
    }
    const actualizado = await cx.coleccionMensajes.modificar(mensaje.id, cambios);
    return respuestaJson({ dato: actualizado });
  });

  enrutador.post('/api/mensajes/:id/responder', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const mensaje = await cx.coleccionMensajes.porId(c.params.id);
    if (!mensaje) return error404('Mensaje no encontrado.');
    const comprobacion = validar(
      {
        respuesta: { tipo: 'texto', requerido: true, min: 1, max: 20000, etiqueta: 'la respuesta' },
        enviar: { tipo: 'booleano', defecto: false },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const { respuesta, enviar } = comprobacion.datos;
    const actualizado = await cx.coleccionMensajes.modificar(mensaje.id, {
      respuesta,
      respondidoEn: new Date().toISOString(),
    });

    let envio = null;
    if (enviar) {
      const ajustes = await new Ajustes(c.db).leer();
      envio = await enviarCorreo(c.db, c.env, ajustes, {
        para: mensaje.email,
        asunto: 'Re: tu mensaje a SHADDAI · Esencia de Umbral',
        html: `<div style="font-family:Georgia,serif;line-height:1.7;color:#16261b;">${respuesta.replace(/\n/g, '<br>')}</div>`,
        responderA: (ajustes.contacto && ajustes.contacto.emailsDestino && ajustes.contacto.emailsDestino[0]) || undefined,
      });
      await cx.coleccionMensajes.modificar(mensaje.id, {
        respuestaEnviada: Boolean(envio && envio.enviado),
        respuestaPendiente: Boolean(envio && envio.pendiente),
      });
    }

    return respuestaJson({ dato: await cx.coleccionMensajes.porId(mensaje.id), envio });
  });

  enrutador.delete('/api/mensajes/:id', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const mensaje = await cx.coleccionMensajes.porId(c.params.id);
    if (!mensaje) return error404('Mensaje no encontrado.');
    await cx.coleccionMensajes.quitar(mensaje.id);
    return respuestaJson({ ok: true });
  });

  // ── Outbox (correos .eml pendientes de descargar/enviar) ────────────────
  enrutador.get('/api/outbox', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const { results } = await c.db
      .prepare('SELECT id, estado, pedido, campana, creadoEn, datos FROM outbox ORDER BY creadoEn DESC')
      .all();
    let datos = results
      .map((f) => {
        try {
          return { ...JSON.parse(f.datos), id: f.id, estado: f.estado, pedido: f.pedido, campana: f.campana, creadoEn: f.creadoEn };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const pedido = c.query.get('pedido');
    const campana = c.query.get('campana');
    const estado = c.query.get('estado');
    if (pedido) datos = datos.filter((o) => o.pedido === pedido);
    if (campana) datos = datos.filter((o) => o.campana === campana);
    if (estado) datos = datos.filter((o) => o.estado === estado);
    datos = datos.map(({ eml, html, ...resto }) => resto);
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/outbox/:id/eml', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const fila = await c.db.prepare('SELECT datos FROM outbox WHERE id = ?1').bind(c.params.id).first();
    if (!fila) return error404('Correo pendiente no encontrado.');
    const datos = JSON.parse(fila.datos);
    const eml = datos.eml || '';
    const asuntoLimpio = String(datos.asunto || 'sin-asunto')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return new Response(eml, {
      status: 200,
      headers: {
        'Content-Type': 'message/rfc822; charset=utf-8',
        'Content-Disposition': `attachment; filename="${asuntoLimpio}.eml"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
