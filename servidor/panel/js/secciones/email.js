// Email marketing: pestañas de Suscriptores y Campañas (crear, vista previa, enviar, estadísticas).
import {
  pedir, escapar, fechaHora, toast, confirmar, abrirModal, abrirVistaPrevia, badgeEstado, etiquetaVacia,
} from '../api.js';

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="pestanas" role="tablist">
      <button class="pestana activa" data-pestana="suscriptores" type="button">Suscriptores</button>
      <button class="pestana" data-pestana="campanas" type="button">Campañas</button>
    </div>
    <div id="zona-email"></div>`;

  const zona = contenedor.querySelector('#zona-email');

  zona.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.pestana');
    if (!boton) return;
    zona.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p === boton));
    if (boton.dataset.pestana === 'suscriptores') pintarSuscriptores(zona);
    else pintarCampanas(zona, contexto);
  });

  await pintarSuscriptores(zona);
}

async function pintarSuscriptores(zona) {
  zona.innerHTML = '<p class="cargando">Cargando suscriptores…</p>';
  let suscriptores;
  try {
    suscriptores = (await pedir('/api/suscriptores')).datos;
  } catch (error) {
    zona.innerHTML = etiquetaVacia(`No se pudieron cargar los suscriptores: ${error.message}`);
    return;
  }

  zona.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">${suscriptores.length} suscriptor${suscriptores.length === 1 ? '' : 'es'} del Boletín del Umbral.</p>
      <a class="boton boton-fantasma" href="/api/suscriptores/exportar" download>Exportar CSV</a>
    </div>
    <div class="zona-tabla">
    ${suscriptores.length ? `
      <table class="tabla">
        <thead><tr><th>Email</th><th>Nombre</th><th>Etiquetas</th><th>Fecha de alta</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${suscriptores.map((s) => `
          <tr data-id="${escapar(s.id)}">
            <td><strong>${escapar(s.email)}</strong></td>
            <td class="texto-suave">${escapar(s.nombre || '—')}</td>
            <td>${(s.etiquetas || []).map((e) => `<span class="chip">${escapar(e)}</span>`).join(' ') || '<span class="texto-suave">—</span>'}</td>
            <td class="texto-suave">${fechaHora(s.fechaAlta)}</td>
            <td class="alineado-derecha"><button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button></td>
          </tr>`).join('')}
        </tbody>
      </table>` : etiquetaVacia('Aún no hay suscriptores. La web pública los añade con el formulario del boletín.')}
    </div>`;

  zona.querySelector('.zona-tabla').addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion="eliminar"]');
    if (!boton) return;
    const suscriptor = suscriptores.find((s) => s.id === boton.closest('tr').dataset.id);
    if (!suscriptor) return;
    const seguro = await confirmar('Eliminar suscriptor', `¿Eliminar a ${suscriptor.email} de la lista?`);
    if (!seguro) return;
    try {
      await pedir(`/api/suscriptores/${suscriptor.id}`, { method: 'DELETE' });
      toast('Suscriptor eliminado.');
      pintarSuscriptores(zona);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

async function pintarCampanas(zona, contexto) {
  const esAdmin = contexto.usuario.rol === 'admin';
  zona.innerHTML = '<p class="cargando">Cargando campañas…</p>';

  let campanas;
  try {
    campanas = (await pedir('/api/campanas')).datos;
  } catch (error) {
    zona.innerHTML = etiquetaVacia(`No se pudieron cargar las campañas: ${error.message}`);
    return;
  }

  let avisoSmtp = '';
  if (esAdmin) {
    try {
      const ajustes = (await pedir('/api/ajustes')).datos;
      if (!ajustes.smtp?.activo) {
        avisoSmtp = `
          <div class="aviso-smtp">
            <p><strong>El SMTP no está configurado.</strong> Los envíos quedarán «pendientes» y se guardarán como archivos .eml en <code>servidor/datos/bandeja-salida/</code>.</p>
            <button class="boton boton-fantasma boton-pequeno" data-ir-ajustes type="button">Ir a Ajustes → SMTP</button>
          </div>`;
      }
    } catch {}
  } else {
    avisoSmtp = `<div class="aviso-smtp"><p>Si el SMTP no está configurado, los envíos quedarán «pendientes» (se guardan en <code>servidor/datos/bandeja-salida/</code>). Solo la administración puede configurarlo en Ajustes.</p></div>`;
  }

  zona.innerHTML = `
    ${avisoSmtp}
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
            <td>${badgeEstado(c.estado === 'pendiente' ? 'pendiente' : c.estado === 'enviada' ? 'enviada' : 'borrador', c.estado)}${c.estado === 'pendiente' ? '<br><span class="texto-suave">SMTP sin configurar</span>' : ''}</td>
            <td class="texto-suave">${c.destinatarios?.tipo === 'segmento' ? `Segmento: ${escapar(c.destinatarios.etiqueta || '')}` : 'Todos los suscriptores'}</td>
            <td class="texto-suave">${c.enviadaEn ? fechaHora(c.enviadaEn) : '—'}</td>
            <td class="texto-suave">${c.estadisticas ? `${c.estadisticas.enviados}/${c.estadisticas.total} enviados${c.estadisticas.fallidos ? ` · <span class="texto-error">${c.estadisticas.fallidos} fallidos</span>` : ''}` : '—'}</td>
            <td class="alineado-derecha">
              ${c.estado !== 'enviada' ? `
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-oro boton-pequeno" data-accion="enviar" type="button">Enviar</button>` : ''}
              ${esAdmin ? '<button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>' : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>` : etiquetaVacia('Aún no hay campañas. Crea la primera y cuéntanos la apertura del próximo lote.')}
    </div>`;

  zona.querySelector('[data-ir-ajustes]')?.addEventListener('click', () => contexto.irA('ajustes'));
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
      const seguro = await confirmar('Enviar campaña', `¿Enviar «${campana.asunto}» a ${destinatario}? El envío real no se puede deshacer.`, 'Enviar');
      if (!seguro) return;
      boton.disabled = true;
      try {
        const respuesta = await pedir(`/api/campanas/${campana.id}/enviar`, { method: 'POST' });
        if (respuesta.pendiente) {
          toast(`Campaña pendiente: no hay SMTP configurado. Se guardó en servidor/datos/bandeja-salida/. ${esAdmin ? 'Configúralo en Ajustes → SMTP.' : ''}`, 'error');
        } else {
          const estadisticas = respuesta.dato.estadisticas;
          toast(`Campaña enviada: ${estadisticas.enviados} de ${estadisticas.total} correos entregados.`);
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
        await pedir(`/api/campanas/${campana.id}`, { method: 'DELETE' });
        toast('Campaña eliminada.');
        pintarCampanas(zona, contexto);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
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
      if (esNueva) {
        await pedir('/api/campanas', { method: 'POST', cuerpo: envio });
        toast('Campaña creada como borrador. Revísala y envíala cuando quieras.');
      } else {
        await pedir(`/api/campanas/${campana.id}`, { method: 'PUT', cuerpo: envio });
        toast('Campaña actualizada.');
      }
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
