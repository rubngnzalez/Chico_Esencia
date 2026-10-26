// Email marketing: pestañas de Suscriptores, Campañas y Bandeja de salida.
// Sin la Edge Function «enviar-campana» (o sin RESEND_API_KEY), los envíos
// quedan «pendientes»: la campaña se marca y los correos van a la tabla
// outbox, descargables como .eml desde aquí.
import { sb, asegurar, invocarFuncion, mensajeError } from '../bd.js';
import {
  escapar, fechaHora, toast, confirmar, abrirModal, abrirVistaPrevia, badgeEstado, etiquetaVacia, descargarEml,
} from '../api.js';

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="pestanas" role="tablist">
      <button class="pestana activa" data-pestana="suscriptores" type="button">Suscriptores</button>
      <button class="pestana" data-pestana="campanas" type="button">Campañas</button>
      <button class="pestana" data-pestana="outbox" type="button">Bandeja de salida</button>
    </div>
    <div id="zona-email"></div>`;

  const zona = contenedor.querySelector('#zona-email');

  zona.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.pestana');
    if (!boton) return;
    zona.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p === boton));
    if (boton.dataset.pestana === 'suscriptores') pintarSuscriptores(zona);
    else if (boton.dataset.pestana === 'campanas') pintarCampanas(zona, contexto);
    else pintarOutbox(zona);
  });

  await pintarSuscriptores(zona);
}

async function pintarSuscriptores(zona) {
  zona.innerHTML = '<p class="cargando">Cargando suscriptores…</p>';
  let suscriptores;
  try {
    suscriptores = (await asegurar(sb().from('suscriptores').select('*').order('creado_en', { ascending: false }))) || [];
  } catch (error) {
    zona.innerHTML = etiquetaVacia(`No se pudieron cargar los suscriptores: ${error.message}`);
    return;
  }

  // Export CSV generado en el cliente (los datos no salen del panel)
  const exportarCsv = () => {
    const lineas = ['email,alta', ...suscriptores.map((s) => `"${String(s.email).replace(/"/g, '""')}",${s.creado_en || ''}`)];
    descargarArchivo('suscriptores-shaddai.csv', lineas.join('\n'), 'text/csv;charset=utf-8');
  };

  zona.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">${suscriptores.length} suscriptor${suscriptores.length === 1 ? '' : 'es'} del Boletín del Umbral.</p>
      <button class="boton boton-fantasma" data-exportar type="button">Exportar CSV</button>
    </div>
    <div class="zona-tabla">
    ${suscriptores.length ? `
      <table class="tabla">
        <thead><tr><th>Email</th><th>Etiquetas</th><th>Fecha de alta</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${suscriptores.map((s) => `
          <tr data-id="${escapar(s.id)}">
            <td><strong>${escapar(s.email)}</strong></td>
            <td>${(s.etiquetas || []).map((e) => `<span class="chip">${escapar(e)}</span>`).join(' ') || '<span class="texto-suave">—</span>'}</td>
            <td class="texto-suave">${fechaHora(s.creado_en)}</td>
            <td class="alineado-derecha"><button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button></td>
          </tr>`).join('')}
        </tbody>
      </table>` : etiquetaVacia('Aún no hay suscriptores. La web pública los añade con el formulario del boletín.')}
    </div>`;

  zona.querySelector('[data-exportar]').addEventListener('click', exportarCsv);

  zona.querySelector('.zona-tabla').addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion="eliminar"]');
    if (!boton) return;
    const suscriptor = suscriptores.find((s) => s.id === boton.closest('tr').dataset.id);
    if (!suscriptor) return;
    const seguro = await confirmar('Eliminar suscriptor', `¿Eliminar a ${suscriptor.email} de la lista?`);
    if (!seguro) return;
    try {
      const error = (await sb().from('suscriptores').delete().eq('id', suscriptor.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Suscriptor eliminado.');
      pintarSuscriptores(zona);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function pintarCampanas(zona, contexto) {
  zona.innerHTML = '<p class="cargando">Cargando campañas…</p>';

  let campanas;
  try {
    campanas = (await asegurar(sb().from('campanas').select('*').order('creado_en', { ascending: false }))) || [];
  } catch (error) {
    zona.innerHTML = etiquetaVacia(`No se pudieron cargar las campañas: ${error.message}`);
    return;
  }

  const aviso = `
    <div class="aviso-smtp">
      <p><strong>El envío real usa Resend</strong> (secreto <code>RESEND_API_KEY</code> de las Edge Functions,
      fase 2). Sin él, los envíos quedan «pendientes»: los correos se guardan en la
      <em>Bandeja de salida</em> y puedes descargarlos como archivos .eml.</p>
    </div>`;

  zona.innerHTML = `
    ${aviso}
    <div class="barra-herramientas">
      <p class="texto-suave">${campanas.length} campaña${campanas.length === 1 ? '' : 's'}.</p>
      <button class="boton boton-primario" data-nueva-campana type="button">+ Nueva campaña</button>
    </div>
    <div class="zona-tabla">
    ${campanas.length ? `
      <table class="tabla">
        <thead><tr><th>Asunto</th><th>Estado</th><th>Destinatarios</th><th>Enviada</th><th>Estadísticas</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${campanas.map((c) => `
          <tr data-id="${escapar(c.id)}">
            <td><strong>${escapar(c.asunto)}</strong></td>
            <td>${badgeEstado(c.estado === 'pendiente' ? 'pendiente' : c.estado === 'enviada' ? 'enviada' : 'borrador', c.estado)}${c.estado === 'pendiente' ? '<br><span class="texto-suave">sin envío configurado</span>' : ''}</td>
            <td class="texto-suave">${c.destinatarios?.tipo === 'segmento' ? `Segmento: ${escapar(c.destinatarios.etiqueta || '')}` : 'Todos los suscriptores'}</td>
            <td class="texto-suave">${c.enviada_en ? fechaHora(c.enviada_en) : '—'}</td>
            <td class="texto-suave">${c.estadisticas ? `${c.estadisticas.enviados || 0}/${c.estadisticas.total || 0} enviados${c.estadisticas.fallidos ? ` · <span class="texto-error">${c.estadisticas.fallidos} fallidos</span>` : ''}` : '—'}</td>
            <td class="alineado-derecha">
              ${c.estado !== 'enviada' ? `
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-oro boton-pequeno" data-accion="enviar" type="button">Enviar</button>` : ''}
              ${contexto.usuario.rol === 'admin' ? '<button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>' : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : etiquetaVacia('Aún no hay campañas. Crea la primera y cuéntanos la apertura del próximo lote.')}
    </div>`;

  zona.querySelector('[data-nueva-campana]').addEventListener('click', () => abrirFormularioCampana(null, () => pintarCampanas(zona, contexto)));

  zona.querySelector('.zona-tabla').addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const campana = campanas.find((c) => c.id === boton.closest('tr').dataset.id);
    if (!campana) return;

    if (boton.dataset.accion === 'editar') {
      abrirFormularioCampana(campana, () => pintarCampanas(zona, contexto));
      return;
    }

    if (boton.dataset.accion === 'enviar') {
      const destinatario = campana.destinatarios?.tipo === 'segmento' ? `el segmento «${campana.destinatarios.etiqueta}»` : 'todos los suscriptores';
      const seguro = await confirmar('Enviar campaña', `¿Enviar «${campana.asunto}» a ${destinatario}? Si no hay envío configurado quedará pendiente (con .eml descargable).`, 'Enviar');
      if (!seguro) return;
      boton.disabled = true;
      try {
        let respuesta;
        try {
          // Fase 2: Edge Function con envío real (requiere admin + RESEND_API_KEY)
          respuesta = await invocarFuncion('enviar-campana', { campanaId: campana.id });
        } catch {
          // Sin función desplegada: marca pendiente (los correos se generan al desplegarla)
          const error = (await sb().from('campanas').update({
            estado: 'pendiente',
            estadisticas: { ...(campana.estadisticas || {}), pendienteDesde: new Date().toISOString() },
          }).eq('id', campana.id)).error;
          if (error) throw new Error(mensajeError(error));
          toast('Campaña marcada como pendiente: no hay función de envío desplegada (fase 2). Cuando se despliegue, podrás enviarla con un clic.', 'error');
          pintarCampanas(zona, contexto);
          return;
        }
        if (respuesta.pendiente) {
          toast(respuesta.mensaje || 'Campaña pendiente: sin envío configurado. Revisa la bandeja de salida.', 'error');
        } else {
          toast(respuesta.mensaje || 'Campaña enviada.');
        }
        pintarCampanas(zona, contexto);
      } catch (error) {
        toast(error.message, 'error');
        boton.disabled = false;
      }
      return;
    }

    if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar('Eliminar campaña', `¿Eliminar la campaña «${campana.asunto}»?`);
      if (!seguro) return;
      try {
        const error = (await sb().from('campanas').delete().eq('id', campana.id)).error;
        if (error) throw new Error(mensajeError(error));
        toast('Campaña eliminada.');
        pintarCampanas(zona, contexto);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

async function pintarOutbox(zona) {
  zona.innerHTML = '<p class="cargando">Cargando bandeja de salida…</p>';
  let pendientes;
  try {
    pendientes = (await asegurar(sb().from('outbox').select('*').order('creado_en', { ascending: false }).limit(200))) || [];
  } catch (error) {
    zona.innerHTML = etiquetaVacia(`No se pudo cargar la bandeja: ${error.message}`);
    return;
  }

  zona.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">${pendientes.length} correo${pendientes.length === 1 ? '' : 's'} guardado${pendientes.length === 1 ? '' : 's'} (sin envío real configurado o con la función de emails sin desplegar).</p>
    </div>
    <div class="zona-tabla">
    ${pendientes.length ? `
      <table class="tabla">
        <thead><tr><th>Para</th><th>Asunto</th><th>Referencia</th><th>Fecha</th><th>Estado</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${pendientes.map((o) => `
          <tr data-id="${escapar(o.id)}">
            <td><strong>${escapar(o.para)}</strong></td>
            <td class="texto-suave">${escapar(o.asunto || '—')}</td>
            <td class="texto-suave">${escapar(o.ref_pedido || (o.ref_campana ? 'campaña' : '—'))}</td>
            <td class="texto-suave">${fechaHora(o.creado_en)}</td>
            <td>${badgeEstado(o.estado === 'pendiente' ? 'pendiente' : 'enviada', o.estado)}</td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="eml" type="button">Descargar .eml</button>
              ${o.estado === 'pendiente' ? '<button class="boton boton-fantasma boton-pequeno" data-accion="marcar" type="button">Marcar enviado</button>' : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : etiquetaVacia('La bandeja está vacía: cuando haya correos pendientes aparecerán aquí con su descarga .eml.')}
    </div>`;

  zona.querySelector('.zona-tabla').addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const fila = pendientes.find((o) => o.id === boton.closest('tr').dataset.id);
    if (!fila) return;

    if (boton.dataset.accion === 'eml') {
      const eml = fila.eml || generarEml(fila);
      descargarEml(`correo-${(fila.asunto || 'shaddai').slice(0, 40).replace(/[^\w-]+/g, '-')}.eml`, eml);
      return;
    }
    if (boton.dataset.accion === 'marcar') {
      try {
        const error = (await sb().from('outbox').update({ estado: 'enviado' }).eq('id', fila.id)).error;
        if (error) throw new Error(mensajeError(error));
        toast('Correo marcado como enviado.');
        pintarOutbox(zona);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

// .eml de respaldo si la fila llega sin la columna eml (compatibilidad)
function generarEml(fila) {
  const cabeceras = [
    `From: SHADDAI · Esencia de Umbral`,
    `To: ${fila.para}`,
    `Subject: ${fila.asunto || ''}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    `Date: ${new Date((fila.creado_en ? new Date(fila.creado_en) : new Date())).toUTCString()}`,
    'X-SHADDAI-Estado: pendiente',
    '',
  ];
  return cabeceras.join('\r\n') + (fila.html || '') + '\r\n';
}

function descargarArchivo(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function abrirFormularioCampana(campana, alGuardar) {
  const esNueva = !campana;
  const { cerrar, cuerpo } = abrirModal(esNueva ? 'Nueva campaña' : 'Editar campaña', `
    <form class="formulario">
      <label>Asunto *</label>
      <input name="asunto" required maxlength="200" value="${escapar(campana?.asunto || '')}">
      <div class="formulario-grid">
        <div>
          <label>Destinatarios</label>
          <select name="tipo">
            <option value="todos" ${campana?.destinatarios?.tipo !== 'segmento' ? 'selected' : ''}>Todos los suscriptores</option>
            <option value="segmento" ${campana?.destinatarios?.tipo === 'segmento' ? 'selected' : ''}>Segmento (por etiqueta)</option>
          </select>
        </div>
        <div>
          <label>Etiqueta del segmento</label>
          <input name="etiqueta" maxlength="60" value="${escapar(campana?.destinatarios?.etiqueta || '')}" placeholder="p. ej. vip">
        </div>
      </div>
      <label>Contenido (HTML) *</label>
      <textarea name="html" rows="12" required class="campo-mono" placeholder="<p>Hola de nuevo desde el Umbral…</p>">${escapar(campana?.html || '')}</textarea>
      <div class="barra-herramientas sin-borde">
        <button type="button" class="boton boton-fantasma" data-vista-previa>Vista previa</button>
        <span class="texto-suave">Los correos se envían en HTML: usa párrafos, imágenes y estilos en línea.</span>
      </div>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">${esNueva ? 'Crear campaña' : 'Guardar campaña'}</button>
      </div>
    </form>`, '48rem');

  const formulario = cuerpo.querySelector('form');
  const actualizarEtiqueta = () => {
    formulario.elements.etiqueta.closest('div').hidden = formulario.elements.tipo.value !== 'segmento';
  };
  formulario.elements.tipo.addEventListener('change', actualizarEtiqueta);
  actualizarEtiqueta();
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  cuerpo.querySelector('[data-vista-previa]').addEventListener('click', () => {
    abrirVistaPrevia(formulario.elements.asunto.value || 'Campaña sin asunto', formulario.elements.html.value || '<p>(sin contenido)</p>');
  });

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const destinatarios = formulario.elements.tipo.value === 'segmento'
      ? { tipo: 'segmento', etiqueta: formulario.elements.etiqueta.value.trim() }
      : { tipo: 'todos' };
    const envio = {
      asunto: formulario.elements.asunto.value.trim(),
      html: formulario.elements.html.value,
      destinatarios,
    };
    if (!envio.asunto || !envio.html.trim()) {
      toast('La campaña necesita asunto y contenido.', 'error');
      return;
    }
    if (destinatarios.tipo === 'segmento' && !destinatarios.etiqueta) {
      toast('Indica la etiqueta del segmento.', 'error');
      return;
    }
    try {
      const error = esNueva
        ? (await sb().from('campanas').insert(envio)).error
        : (await sb().from('campanas').update(envio).eq('id', campana.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast(esNueva ? 'Campaña creada como borrador. Revísala y envíala cuando quieras.' : 'Campaña actualizada.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
