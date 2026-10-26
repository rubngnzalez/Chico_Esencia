// /api/campanas (email marketing). Sin RESEND_API_KEY el envío queda
// «pendiente»: guarda un .eml en outbox y registra envíos por destinatario.

import { requerirRol } from '../seguridad.js';
import { validar, error400, error404, respuestaJson, ahora, nuevoId } from '../utilidades.js';
import { enviarCorreo, guardarEnOutbox } from '../correo.js';
import { envioDisponible, direccionDesde } from '../ajustes-defecto.js';
import { Ajustes } from '../db.js';

export function registrar(enrutador, cx) {
  async function destinatariosDe(campana) {
    const lista = (await cx.coleccionSuscriptores.leer()).filter((s) => s.activo !== false);
    if (campana.destinatarios && campana.destinatarios.tipo === 'segmento' && campana.destinatarios.etiqueta) {
      const etiqueta = String(campana.destinatarios.etiqueta).toLowerCase();
      return lista.filter((s) => (s.etiquetas || []).some((e) => String(e).toLowerCase() === etiqueta));
    }
    return lista;
  }

  enrutador.get('/api/campanas', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const datos = (await cx.coleccionCampanas.todo()).sort((a, b) =>
      String(b.creadaEn || '').localeCompare(String(a.creadaEn || ''))
    );
    return respuestaJson({ datos, total: datos.length });
  });

  enrutador.get('/api/campanas/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const campana = await cx.coleccionCampanas.porId(c.params.id);
    if (!campana) return error404('Campaña no encontrada.');
    return respuestaJson({ dato: campana, destinatariosEstimados: (await destinatariosDe(campana)).length });
  });

  enrutador.post('/api/campanas', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const comprobacion = validar(
      {
        asunto: { tipo: 'texto', requerido: true, min: 1, max: 200, etiqueta: 'el asunto' },
        html: { tipo: 'texto', requerido: true, min: 1, max: 500000, etiqueta: 'el contenido HTML' },
        destinatarios: { tipo: 'objeto', defecto: { tipo: 'todos' } },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const destino = comprobacion.datos.destinatarios;
    if (destino.tipo && !['todos', 'segmento'].includes(destino.tipo)) {
      return error400('Los destinatarios deben ser de tipo «todos» o «segmento».');
    }
    if (destino.tipo === 'segmento' && !destino.etiqueta) {
      return error400('Para un segmento debes indicar la etiqueta de los suscriptores.');
    }
    const campana = {
      id: nuevoId('cam'),
      asunto: comprobacion.datos.asunto,
      html: comprobacion.datos.html,
      destinatarios: destino,
      estado: 'borrador',
      estadisticas: null,
      bounces: [],
      creadaEn: ahora(),
      enviadaEn: null,
    };
    await cx.coleccionCampanas.insertar(campana, { estado: campana.estado });
    return respuestaJson({ dato: campana, destinatariosEstimados: (await destinatariosDe(campana)).length }, 201);
  });

  enrutador.put('/api/campanas/:id', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const campana = await cx.coleccionCampanas.porId(c.params.id);
    if (!campana) return error404('Campaña no encontrada.');
    if (campana.estado === 'enviada') {
      return error400('No puedes editar una campaña ya enviada.');
    }
    const comprobacion = validar(
      {
        asunto: { tipo: 'texto', min: 1, max: 200, etiqueta: 'el asunto' },
        html: { tipo: 'texto', min: 1, max: 500000, etiqueta: 'el contenido HTML' },
        destinatarios: { tipo: 'objeto' },
      },
      c.cuerpo
    );
    if (!comprobacion.ok) return error400(comprobacion.errores);
    const actualizado = await cx.coleccionCampanas.modificar(campana.id, comprobacion.datos);
    return respuestaJson({ dato: actualizado });
  });

  enrutador.delete('/api/campanas/:id', async (c) => {
    const guard = requerirRol(c, 'admin');
    if (guard) return guard;
    const campana = await cx.coleccionCampanas.porId(c.params.id);
    if (!campana) return error404('Campaña no encontrada.');
    await cx.coleccionCampanas.quitar(campana.id);
    return respuestaJson({ ok: true });
  });

  enrutador.post('/api/campanas/:id/enviar', async (c) => {
    const guard = requerirRol(c, 'admin', 'editor');
    if (guard) return guard;
    const campana = await cx.coleccionCampanas.porId(c.params.id);
    if (!campana) return error404('Campaña no encontrada.');
    if (campana.estado === 'enviada') {
      return error400('Esta campaña ya fue enviada.');
    }

    const ajustes = await new Ajustes(c.db).leer();
    const destinatarios = await destinatariosDe(campana);
    if (destinatarios.length === 0) {
      return error400('No hay suscriptores en el destinatario elegido.');
    }

    if (!envioDisponible(c.env)) {
      const desde = direccionDesde(ajustes);
      const outboxId = await guardarEnOutbox(
        c.db,
        {
          para: destinatarios.map((s) => s.email),
          asunto: campana.asunto,
          html: campana.html,
          desde,
        },
        { campana: campana.id }
      );
      const actualizada = await cx.coleccionCampanas.modificar(campana.id, {
        estado: 'pendiente',
        outboxId,
        notaPendiente: 'Sin Resend configurado: la campaña se guardó en la bandeja de salida (outbox). Descarga el .eml o configura RESEND_API_KEY y reenvía.',
        estadisticas: { total: destinatarios.length, enviados: 0, fallidos: 0, pendientes: destinatarios.length },
      });
      return respuestaJson({ dato: actualizada, pendiente: true, archivo: outboxId });
    }

    let enviados = 0;
    let fallidos = 0;
    const bounces = [];
    for (const suscriptor of destinatarios) {
      const resultado = await enviarCorreo(c.db, c.env, ajustes, {
        para: suscriptor.email,
        asunto: campana.asunto,
        html: campana.html,
      });
      await c.db
        .prepare('INSERT INTO envios (id, campana, email, datos) VALUES (?1, ?2, ?3, ?4)')
        .bind(
          nuevoId('env'),
          campana.id,
          suscriptor.email,
          JSON.stringify({ campana: campana.id, email: suscriptor.email, enviado: Boolean(resultado.enviado), pendiente: Boolean(resultado.pendiente), fecha: ahora(), detalle: resultado.error || '' })
        )
        .run();
      if (resultado.enviado) enviados++;
      else {
        fallidos++;
        if (resultado.rechazados && resultado.rechazados.length > 0) bounces.push(...resultado.rechazados);
        else bounces.push(suscriptor.email);
      }
    }

    const actualizada = await cx.coleccionCampanas.modificar(campana.id, {
      estado: 'enviada',
      enviadaEn: new Date().toISOString(),
      estadisticas: { total: destinatarios.length, enviados, fallidos, pendientes: 0 },
      bounces: Array.from(new Set(bounces)),
    });
    return respuestaJson({ dato: actualizada });
  });
}
