// Bandeja de entrada: mensajes de contacto con lectura, archivo, nota interna
// y respuesta por correo. El borrado es solo de administración.
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, fechaHora, toast, confirmar, etiquetaVacia } from '../api.js';

const FILTROS = [
  { clave: 'todos', texto: 'Activos' },
  { clave: 'noleidos', texto: 'Sin leer' },
  { clave: 'leidos', texto: 'Leídos' },
  { clave: 'archivados', texto: 'Archivados' },
];

let filtroActual = 'todos';

export default async function (contenedor, contexto) {
  const esAdmin = contexto.usuario.rol === 'admin';
  let mensajeSeleccionado = null;

  contenedor.innerHTML = `
    <div class="pestanas" role="tablist">
      ${FILTROS.map((f) => `<button class="pestana ${f.clave === filtroActual ? 'activa' : ''}" data-filtro="${f.clave}" type="button">${f.texto}</button>`).join('')}
    </div>
    <div class="bandeja-rejilla">
      <div id="bandeja-lista" class="bandeja-lista"><p class="cargando">Cargando mensajes…</p></div>
      <div id="bandeja-detalle" class="bandeja-detalle"><p class="estado-vacio">Elige un mensaje para leerlo aquí.</p></div>
    </div>`;

  const zonaLista = contenedor.querySelector('#bandeja-lista');
  const zonaDetalle = contenedor.querySelector('#bandeja-detalle');
  let mensajes = [];

  async function cargar(conservarSeleccion = true) {
    try {
      let consulta = sb().from('mensajes').select('*').order('creado_en', { ascending: false });
      if (filtroActual === 'archivados') consulta = consulta.eq('archivado', true);
      else {
        consulta = consulta.eq('archivado', false);
        if (filtroActual === 'noleidos') consulta = consulta.eq('leido', false);
        if (filtroActual === 'leidos') consulta = consulta.eq('leido', true);
      }
      mensajes = (await asegurar(consulta)) || [];
      if (!conservarSeleccion || (mensajeSeleccionado && !mensajes.some((m) => m.id === mensajeSeleccionado.id))) {
        mensajeSeleccionado = null;
      }
      pintarLista();
      pintarDetalle();
      contexto.refrescarContador();
    } catch (error) {
      zonaLista.innerHTML = etiquetaVacia(`No se pudo cargar la bandeja: ${error.message}`);
    }
  }

  function pintarLista() {
    contenedor.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p.dataset.filtro === filtroActual));
    if (!mensajes.length) {
      zonaLista.innerHTML = etiquetaVacia('No hay mensajes en esta vista.');
      return;
    }
    zonaLista.innerHTML = mensajes.map((m) => `
      <button class="elemento-bandeja ${m.id === mensajeSeleccionado?.id ? 'seleccionado' : ''} ${m.leido ? '' : 'sin-leer'}" data-id="${escapar(m.id)}" type="button">
        <span class="elemento-cabecera">
          <strong class="elemento-nombre">${escapar(m.nombre || '(sin nombre)')}</strong>
          <span class="elemento-fecha">${fechaHora(m.creado_en)}</span>
        </span>
        <span class="elemento-texto">${escapar((m.mensaje || '').slice(0, 90))}${(m.mensaje || '').length > 90 ? '…' : ''}</span>
        ${m.archivado ? '<span class="chip">archivado</span>' : ''}
        ${m.nota ? '<span class="chip chip-oro">con nota</span>' : ''}
      </button>`).join('');
  }

  function pintarDetalle() {
    if (!mensajeSeleccionado) {
      zonaDetalle.innerHTML = '<p class="estado-vacio">Elige un mensaje para leerlo aquí.</p>';
      return;
    }
    const m = mensajeSeleccionado;
    zonaDetalle.innerHTML = `
      <article class="detalle-mensaje">
        <header class="detalle-cabecera">
          <h3>${escapar(m.nombre || '(sin nombre)')} ${m.leido ? '' : '<span class="badge badge-oro">sin leer</span>'}</h3>
          <p class="texto-suave">${fechaHora(m.creado_en)}</p>
        </header>
        <dl class="detalle-datos">
          <div><dt>Email</dt><dd><a href="mailto:${escapar(m.email)}">${escapar(m.email || '—')}</a></dd></div>
          ${m.telefono ? `<div><dt>Teléfono</dt><dd>${escapar(m.telefono)}</dd></div>` : ''}
        </dl>
        <p class="detalle-texto">${escapar(m.mensaje || '').replace(/\n/g, '<br>')}</p>
        ${m.nota ? `
          <div class="detalle-respuesta">
            <p class="texto-suave">Nota interna guardada</p>
            <p>${escapar(m.nota).replace(/\n/g, '<br>')}</p>
          </div>` : ''}
        <div class="modal-acciones envuelto">
          <button class="boton boton-fantasma" data-accion="leido" type="button">${m.leido ? 'Marcar como no leído' : 'Marcar como leído'}</button>
          <button class="boton boton-fantasma" data-accion="archivado" type="button">${m.archivado ? 'Desarchivar' : 'Archivar'}</button>
          <a class="boton boton-primario" href="mailto:${escapar(m.email)}?subject=${encodeURIComponent('Re: tu mensaje a SHADDAI · Esencia de Umbral')}&body=${encodeURIComponent(cuerpoRespuesta(m))}" data-accion="responder">Responder por correo</a>
          ${esAdmin ? '<button class="boton boton-peligro" data-accion="eliminar" type="button">Eliminar</button>' : ''}
        </div>
        <details class="detalle-nota">
          <summary>Nota interna (se guarda con el mensaje)</summary>
          <textarea rows="3" placeholder="Anota aquí el contexto o el trato dado al mensaje…">${escapar(m.nota || '')}</textarea>
          <button class="boton boton-fantasma boton-pequeno" data-accion="guardar-nota" type="button">Guardar nota</button>
        </details>
      </article>`;
  }

  function cuerpoRespuesta(m) {
    return `Hola ${m.nombre}:\n\n\n\n———\nEl ${fechaHora(m.creado_en)} escribiste:\n> ${(m.mensaje || '').replace(/\n/g, '\n> ')}`;
  }

  async function actualizar(id, cambios, aviso) {
    try {
      const datos = await asegurar(sb().from('mensajes').update(cambios).eq('id', id).select());
      mensajeSeleccionado = datos?.[0] || { ...mensajeSeleccionado, ...cambios };
      toast(aviso);
      await cargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  zonaLista.addEventListener('click', async (evento) => {
    const elemento = evento.target.closest('.elemento-bandeja');
    if (!elemento) return;
    const mensaje = mensajes.find((m) => m.id === elemento.dataset.id);
    if (!mensaje) return;
    mensajeSeleccionado = mensaje;
    pintarLista();
    pintarDetalle();
    if (!mensaje.leido) {
      try {
        const datos = await asegurar(sb().from('mensajes').update({ leido: true }).eq('id', mensaje.id).select());
        mensajeSeleccionado = datos?.[0] || mensaje;
        pintarLista();
        pintarDetalle();
        contexto.refrescarContador();
      } catch {}
    }
  });

  contenedor.querySelectorAll('.pestana').forEach((pestana) => {
    pestana.addEventListener('click', () => {
      filtroActual = pestana.dataset.filtro;
      mensajeSeleccionado = null;
      cargar(false);
    });
  });

  zonaDetalle.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('[data-accion]');
    if (!boton || !mensajeSeleccionado) return;
    const id = mensajeSeleccionado.id;

    switch (boton.dataset.accion) {
      case 'leido':
        await actualizar(id, { leido: !mensajeSeleccionado.leido }, mensajeSeleccionado.leido ? 'Marcado como no leído.' : 'Marcado como leído.');
        break;
      case 'archivado':
        await actualizar(id, { archivado: !mensajeSeleccionado.archivado }, mensajeSeleccionado.archivado ? 'Mensaje desarchivado.' : 'Mensaje archivado.');
        break;
      case 'responder':
        // mailto ya abre el correo; aquí solo lo marcamos como leído
        if (!mensajeSeleccionado.leido) await actualizar(id, { leido: true }, 'Marcado como leído.');
        break;
      case 'guardar-nota':
        await actualizar(id, { nota: boton.closest('.detalle-nota').querySelector('textarea').value.trim() }, 'Nota guardada.');
        break;
      case 'eliminar': {
        const seguro = await confirmar('Eliminar mensaje', `¿Eliminar el mensaje de «${mensajeSeleccionado.nombre}»? No se puede recuperar.`);
        if (!seguro) return;
        try {
          const error = (await sb().from('mensajes').delete().eq('id', id)).error;
          if (error) throw new Error(mensajeError(error));
          toast('Mensaje eliminado.');
          mensajeSeleccionado = null;
          await cargar();
        } catch (error) {
          toast(error.message, 'error');
        }
        break;
      }
    }
  });

  await cargar();
}
