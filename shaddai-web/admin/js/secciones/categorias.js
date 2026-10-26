// Categorías: CRUD simple con orden y reordenación con flechas.
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, toast, confirmar, abrirModal, etiquetaVacia } from '../api.js';

export default async function (contenedor) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Las categorías ordenan el catálogo: el número menor aparece primero.</p>
      <button id="boton-nueva-categoria" class="boton boton-primario" type="button">+ Nueva categoría</button>
    </div>
    <div id="zona-categorias" class="zona-tabla"><p class="cargando">Cargando categorías…</p></div>`;

  const zona = contenedor.querySelector('#zona-categorias');
  let categorias = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando categorías…</p>';
    try {
      categorias = (await asegurar(sb().from('categorias').select('*').order('orden'))) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar las categorías: ${error.message}`);
    }
  }

  function pintar() {
    if (!categorias.length) {
      zona.innerHTML = etiquetaVacia('Aún no hay categorías. Crea la primera.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Orden</th><th>Nombre</th><th>Slug</th><th>Descripción</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${categorias.map((c, indice) => `
          <tr data-id="${escapar(c.id)}">
            <td class="celda-orden">
              <button class="boton boton-fantasma boton-pequeno" data-accion="subir" type="button" title="Subir" ${indice === 0 ? 'disabled' : ''}>↑</button>
              <span>${Number(c.orden) || 0}</span>
              <button class="boton boton-fantasma boton-pequeno" data-accion="bajar" type="button" title="Bajar" ${indice === categorias.length - 1 ? 'disabled' : ''}>↓</button>
            </td>
            <td><strong>${escapar(c.nombre)}</strong></td>
            <td class="texto-suave">${escapar(c.slug)}</td>
            <td class="texto-suave">${escapar((c.descripcion || '').slice(0, 90))}${(c.descripcion || '').length > 90 ? '…' : ''}</td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function actualizar(id, cambios) {
    const error = (await sb().from('categorias').update(cambios).eq('id', id)).error;
    if (error) throw new Error(mensajeError(error));
  }

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton || boton.disabled) return;
    const indice = categorias.findIndex((c) => c.id === boton.closest('tr').dataset.id);
    const categoria = categorias[indice];
    if (!categoria) return;

    if (boton.dataset.accion === 'editar') {
      abrirFormulario(categoria, cargar);
      return;
    }

    if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar('Eliminar categoría', `¿Eliminar la categoría «${categoria.nombre}»? Los productos quedarán sin categoría.`);
      if (!seguro) return;
      try {
        const error = (await sb().from('categorias').delete().eq('id', categoria.id)).error;
        if (error) throw new Error(mensajeError(error));
        toast('Categoría eliminada.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    // Subir o bajar: intercambia el campo «orden» con la vecina
    const vecino = categorias[boton.dataset.accion === 'subir' ? indice - 1 : indice + 1];
    if (!vecino) return;
    try {
      await Promise.all([
        actualizar(categoria.id, { orden: Number(vecino.orden) || 0 }),
        actualizar(vecino.id, { orden: Number(categoria.orden) || 0 }),
      ]);
      await cargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  contenedor.querySelector('#boton-nueva-categoria').addEventListener('click', () => abrirFormulario(null, cargar));
  await cargar();
}

function abrirFormulario(categoria, alGuardar) {
  const esNueva = !categoria;
  const { cerrar, cuerpo } = abrirModal(esNueva ? 'Nueva categoría' : `Editar: ${categoria.nombre}`, `
    <form id="formulario-categoria" class="formulario">
      <div class="formulario-grid">
        <div>
          <label>Nombre *</label>
          <input name="nombre" required maxlength="120" value="${escapar(categoria?.nombre || '')}">
        </div>
        <div>
          <label>Orden</label>
          <input name="orden" type="number" step="1" min="0" value="${categoria?.orden ?? 0}">
        </div>
      </div>
      <label>Slug (vacío = automático)</label>
      <input name="slug" maxlength="90" value="${escapar(categoria?.slug || '')}">
      <label>Descripción</label>
      <textarea name="descripcion" rows="3" maxlength="2000">${escapar(categoria?.descripcion || '')}</textarea>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">${esNueva ? 'Crear categoría' : 'Guardar cambios'}</button>
      </div>
    </form>`, '30rem');

  const formulario = cuerpo.querySelector('#formulario-categoria');
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const envio = {
      nombre: formulario.elements.nombre.value.trim(),
      slug: formulario.elements.slug.value.trim(),
      descripcion: formulario.elements.descripcion.value.trim(),
      orden: Number.parseInt(formulario.elements.orden.value, 10) || 0,
    };
    if (!envio.nombre || !envio.slug) {
      toast('La categoría necesita nombre y slug.', 'error');
      return;
    }
    try {
      const error = esNueva
        ? (await sb().from('categorias').insert(envio)).error
        : (await sb().from('categorias').update(envio).eq('id', categoria.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast(esNueva ? 'Categoría creada.' : 'Categoría actualizada.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
