// Testimonios: CRUD con selector visual de estrellas y aprobación.
import { sb, asegurar, mensajeError } from '../bd.js';
import {
  escapar, fechaCorta, toast, confirmar, abrirModal, campoEstrellas, estrellasVisual, etiquetaVacia,
} from '../api.js';

export default async function (contenedor) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Solo los testimonios aprobados se publican en la web (la portada los lee de la tabla con RLS).</p>
      <button id="boton-nuevo-testimonio" class="boton boton-primario" type="button">+ Nuevo testimonio</button>
    </div>
    <div id="zona-testimonios" class="zona-tabla"><p class="cargando">Cargando testimonios…</p></div>`;

  const zona = contenedor.querySelector('#zona-testimonios');
  let testimonios = [];
  let productos = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando testimonios…</p>';
    try {
      const [datosTestimonios, datosProductos] = await Promise.all([
        asegurar(sb().from('testimonios').select('*').order('fecha', { ascending: false })),
        asegurar(sb().from('productos').select('nombre').order('nombre')),
      ]);
      testimonios = datosTestimonios || [];
      productos = datosProductos || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los testimonios: ${error.message}`);
    }
  }

  function pintar() {
    if (!testimonios.length) {
      zona.innerHTML = etiquetaVacia('Aún no hay testimonios. Recoge las primeras palabras del Umbral.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Valoración</th><th>Persona</th><th>Producto</th><th>Texto</th><th>Fecha</th><th>Aprobado</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${testimonios.map((t) => `
          <tr data-id="${escapar(t.id)}">
            <td>${estrellasVisual(t.estrellas)}</td>
            <td><strong>${escapar(t.nombre)}</strong>${t.ciudad ? `<br><span class="texto-suave">${escapar(t.ciudad)}</span>` : ''}</td>
            <td class="texto-suave">${escapar(t.producto || '—')}</td>
            <td class="texto-suave">${escapar((t.texto || '').length > 80 ? t.texto.slice(0, 80) + '…' : t.texto)}</td>
            <td class="texto-suave">${fechaCorta(t.fecha)}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="aprobado" ${t.aprobado ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="aprobado"]');
    if (!interruptor) return;
    const testimonio = testimonios.find((t) => t.id === interruptor.closest('tr').dataset.id);
    if (!testimonio) return;
    try {
      const error = (await sb().from('testimonios').update({ aprobado: interruptor.checked }).eq('id', testimonio.id)).error;
      if (error) throw new Error(mensajeError(error));
      testimonio.aprobado = interruptor.checked;
      toast(interruptor.checked ? 'Testimonio aprobado: ya se muestra en la web.' : 'Testimonio retirado de la web.');
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const testimonio = testimonios.find((t) => t.id === boton.closest('tr').dataset.id);
    if (!testimonio) return;
    if (boton.dataset.accion === 'editar') {
      abrirFormulario(testimonio, productos, cargar);
      return;
    }
    const seguro = await confirmar('Eliminar testimonio', `¿Eliminar el testimonio de «${testimonio.nombre}»?`);
    if (!seguro) return;
    try {
      const error = (await sb().from('testimonios').delete().eq('id', testimonio.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Testimonio eliminado.');
      cargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  contenedor.querySelector('#boton-nuevo-testimonio').addEventListener('click', () => abrirFormulario(null, productos, cargar));
  await cargar();
}

function abrirFormulario(testimonio, productos, alGuardar) {
  const esNuevo = !testimonio;
  const { cerrar, cuerpo } = abrirModal(esNuevo ? 'Nuevo testimonio' : `Editar testimonio de ${testimonio.nombre}`, `
    <form id="formulario-testimonio" class="formulario">
      <label>Valoración *</label>
      <div class="zona-estrellas"></div>
      <div class="formulario-grid">
        <div>
          <label>Nombre *</label>
          <input name="nombre" required maxlength="120" value="${escapar(testimonio?.nombre || '')}">
        </div>
        <div>
          <label>Ciudad</label>
          <input name="ciudad" maxlength="120" value="${escapar(testimonio?.ciudad || '')}">
        </div>
        <div>
          <label>Producto</label>
          <input name="producto" maxlength="160" list="lista-productos" value="${escapar(testimonio?.producto || '')}">
          <datalist id="lista-productos">
            ${productos.map((p) => `<option value="${escapar(p.nombre)}"></option>`).join('')}
          </datalist>
        </div>
        <div>
          <label>Fecha</label>
          <input name="fecha" type="date" value="${testimonio?.fecha ? String(testimonio.fecha).slice(0, 10) : ''}">
        </div>
      </div>
      <label>Texto *</label>
      <textarea name="texto" rows="4" required maxlength="4000">${escapar(testimonio?.texto || '')}</textarea>
      <label class="interruptor"><input type="checkbox" name="aprobado" ${testimonio?.aprobado ? 'checked' : ''}><span class="interruptor-pista"></span> Aprobado (visible en la web)</label>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">${esNuevo ? 'Crear testimonio' : 'Guardar cambios'}</button>
      </div>
    </form>`, '36rem');

  const formulario = cuerpo.querySelector('#formulario-testimonio');
  const estrellas = campoEstrellas(testimonio?.estrellas || 5);
  cuerpo.querySelector('.zona-estrellas').appendChild(estrellas.elemento);
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const valor = estrellas.valor();
    if (valor < 1) {
      toast('Marca una valoración de 1 a 5 estrellas.', 'error');
      return;
    }
    const envio = {
      nombre: campos.nombre.value.trim(),
      ciudad: campos.ciudad.value.trim(),
      producto: campos.producto.value.trim(),
      texto: campos.texto.value.trim(),
      estrellas: valor,
      aprobado: campos.aprobado.checked,
    };
    if (campos.fecha.value) {
      envio.fecha = new Date(`${campos.fecha.value}T12:00:00`).toISOString();
    }
    try {
      const error = esNuevo
        ? (await sb().from('testimonios').insert(envio)).error
        : (await sb().from('testimonios').update(envio).eq('id', testimonio.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast(esNuevo ? 'Testimonio creado.' : 'Testimonio actualizado.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
