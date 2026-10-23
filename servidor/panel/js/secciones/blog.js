// Blog: lista con estado, editor completo con slug automático, vista previa y publicación estática.
import {
  pedir, escapar, fechaCorta, toast, confirmar, abrirModal, abrirVistaPrevia,
  subirImagen, urlImagen, slugificar, aIso, aLocal, badgeEstado, etiquetaVacia,
} from '../api.js';

export default async function (contenedor, contexto) {
  const esLector = contexto.usuario.rol === 'lector';
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Al publicar, el servidor genera la página estática del artículo en la web y actualiza el índice.</p>
      ${esLector ? '' : '<button id="boton-nuevo-articulo" class="boton boton-primario" type="button">+ Nuevo artículo</button>'}
    </div>
    <div id="zona-blog" class="zona-tabla"><p class="cargando">Cargando artículos…</p></div>`;

  const zona = contenedor.querySelector('#zona-blog');
  const botonNuevo = contenedor.querySelector('#boton-nuevo-articulo');
  let articulos = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando artículos…</p>';
    try {
      articulos = (await pedir('/api/articulos')).datos;
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los artículos: ${error.message}`);
    }
  }

  function pintar() {
    if (!articulos.length) {
      zona.innerHTML = etiquetaVacia(esLector ? 'Aún no hay artículos.' : 'Aún no hay artículos. Escribe el primero.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Título</th><th>Estado</th><th>Fecha</th><th>Autor</th><th>Etiquetas</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${articulos.map((a) => `
          <tr data-id="${escapar(a.id)}">
            <td><strong>${escapar(a.titulo)}</strong><br><span class="texto-suave">${escapar(a.slug)}</span></td>
            <td>${badgeEstado(a.estado)}</td>
            <td class="texto-suave">${fechaCorta(a.fechaPublicacion)}</td>
            <td class="texto-suave">${escapar(a.autor || '—')}</td>
            <td>${(a.etiquetas || []).map((e) => `<span class="chip">${escapar(e)}</span>`).join(' ') || '<span class="texto-suave">—</span>'}</td>
            <td class="alineado-derecha acciones-blog">
              ${esLector ? '' : `
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              ${a.estado === 'publicado'
                ? '<button class="boton boton-fantasma boton-pequeno" data-accion="despublicar" type="button">Despublicar</button>'
                : '<button class="boton boton-oro boton-pequeno" data-accion="publicar" type="button">Publicar</button>'}
              <button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>`}
              ${a.estado === 'publicado' ? `<a class="boton boton-fantasma boton-pequeno" href="/news/articulo/${escapar(a.slug)}/" target="_blank" rel="noopener">Ver ↗</a>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const articulo = articulos.find((a) => a.id === boton.closest('tr').dataset.id);
    if (!articulo) return;

    if (boton.dataset.accion === 'editar') {
      abrirEditor(articulo, cargar);
      return;
    }

    if (boton.dataset.accion === 'publicar') {
      try {
        const respuesta = await pedir(`/api/articulos/${articulo.id}/publicar`, { method: 'POST' });
        toast(`Artículo publicado en ${respuesta.url}`, 'ok', { texto: 'Ver ↗', alPulsar: () => window.open(respuesta.url, '_blank') });
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (boton.dataset.accion === 'despublicar') {
      const seguro = await confirmar('Despublicar', `«${articulo.titulo}» pasará a borrador y su página se retirará de la web. ¿Continuar?`, 'Despublicar');
      if (!seguro) return;
      try {
        await pedir(`/api/articulos/${articulo.id}/despublicar`, { method: 'POST' });
        toast('Artículo despublicado: la página se ha retirado de la web.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar('Eliminar artículo', `¿Eliminar «${articulo.titulo}»? Si estaba publicado, su página también se retirará de la web.`);
      if (!seguro) return;
      try {
        await pedir(`/api/articulos/${articulo.id}`, { method: 'DELETE' });
        toast('Artículo eliminado.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  if (botonNuevo) botonNuevo.addEventListener('click', () => abrirEditor(null, cargar));
  await cargar();
}

function abrirEditor(articulo, alGuardar) {
  const esNuevo = !articulo;
  const contenedorModales = document.getElementById('contenedor-modales');
  const fondo = document.createElement('div');
  fondo.className = 'editor-articulo';
  fondo.innerHTML = `
    <header class="editor-cabecera">
      <button class="boton boton-fantasma" data-volver type="button">← Volver a la lista</button>
      <h2>${esNuevo ? 'Nuevo artículo' : 'Editar artículo'}</h2>
      ${articulo ? badgeEstado(articulo.estado) : ''}
    </header>
    <form class="formulario editor-cuerpo">
      <label>Título *</label>
      <input name="titulo" required maxlength="200" value="${escapar(articulo?.titulo || '')}">
      <label>Slug (se rellena solo desde el título; editable)</label>
      <input name="slug" maxlength="100" value="${escapar(articulo?.slug || '')}">
      <div class="formulario-grid">
        <div>
          <label>Estado</label>
          <select name="estado">
            <option value="borrador" ${articulo?.estado === 'borrador' || esNuevo ? 'selected' : ''}>Borrador</option>
            <option value="programado" ${articulo?.estado === 'programado' ? 'selected' : ''}>Programado</option>
            <option value="publicado" ${articulo?.estado === 'publicado' ? 'selected' : ''}>Publicado</option>
          </select>
        </div>
        <div>
          <label>Fecha de publicación</label>
          <input name="fechaPublicacion" type="datetime-local" value="${aLocal(articulo?.fechaPublicacion)}">
        </div>
        <div>
          <label>Autor</label>
          <input name="autor" maxlength="120" value="${escapar(articulo?.autor || 'SHADDAI')}">
        </div>
        <div>
          <label>Etiquetas (separadas por comas)</label>
          <input name="etiquetas" value="${escapar((articulo?.etiquetas || []).join(', '))}">
        </div>
      </div>
      <label>Extracto</label>
      <textarea name="extracto" rows="2" maxlength="600">${escapar(articulo?.extracto || '')}</textarea>
      <label>Imagen de portada</label>
      <div class="formulario-grid">
        <div class="crece">
          <input name="imagenPortada" maxlength="500" placeholder="img/subidas/… o pega una ruta" value="${escapar(articulo?.imagenPortada || '')}">
        </div>
        <div>
          <input type="file" accept="image/jpeg,image/png,image/webp" class="entrada-archivo-portada">
        </div>
      </div>
      <p class="vista-miniatura"></p>
      <label>Contenido (HTML)</label>
      <textarea name="contenido" rows="16" class="campo-mono" placeholder="<p>Escribe aquí el artículo…</p>">${escapar(articulo?.contenido || '')}</textarea>
      <div class="barra-herramientas sin-borde">
        <button type="button" class="boton boton-fantasma" data-vista-previa>Vista previa</button>
        <span class="texto-suave">Puedes usar p, h2, h3, img, blockquote, ul, li, a…</span>
      </div>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="button" class="boton boton-primario" data-guardar>${esNuevo ? 'Guardar borrador' : 'Guardar'}</button>
        <button type="button" class="boton boton-oro" data-publicar>Publicar en la web</button>
      </div>
    </form>`;
  contenedorModales.appendChild(fondo);

  const formulario = fondo.querySelector('form');
  const inputTitulo = formulario.elements.titulo;
  const inputSlug = formulario.elements.slug;
  let slugEditado = Boolean(articulo?.slug);
  inputTitulo.addEventListener('input', () => { if (!slugEditado) inputSlug.value = slugificar(inputTitulo.value); });
  inputSlug.addEventListener('input', () => { slugEditado = true; });

  const vistaMiniatura = fondo.querySelector('.vista-miniatura');
  const entradaPortada = fondo.querySelector('.entrada-archivo-portada');
  const pintarMiniatura = () => {
    const ruta = formulario.elements.imagenPortada.value.trim();
    vistaMiniatura.innerHTML = ruta ? `<img class="miniatura-tabla" src="${escapar(urlImagen(ruta))}" alt="">` : '';
  };
  formulario.elements.imagenPortada.addEventListener('change', pintarMiniatura);
  entradaPortada.addEventListener('change', async () => {
    const archivo = entradaPortada.files[0];
    if (!archivo) return;
    try {
      formulario.elements.imagenPortada.value = await subirImagen(archivo);
      pintarMiniatura();
      toast('Imagen de portada subida.');
    } catch (error) {
      toast(error.message, 'error');
    }
    entradaPortada.value = '';
  });
  pintarMiniatura();

  const cerrar = () => fondo.remove();
  fondo.querySelector('[data-volver]').addEventListener('click', cerrar);
  fondo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  fondo.querySelector('[data-vista-previa]').addEventListener('click', () => {
    abrirVistaPrevia(inputTitulo.value || 'Sin título', formulario.elements.contenido.value || '<p>(sin contenido)</p>');
  });

  function recogerDatos() {
    const etiquetas = formulario.elements.etiquetas.value
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    return {
      titulo: inputTitulo.value.trim(),
      slug: inputSlug.value.trim(),
      extracto: formulario.elements.extracto.value.trim(),
      contenido: formulario.elements.contenido.value,
      imagenPortada: formulario.elements.imagenPortada.value.trim(),
      etiquetas,
      estado: formulario.elements.estado.value,
      fechaPublicacion: aIso(formulario.elements.fechaPublicacion.value) || articulo?.fechaPublicacion,
      autor: formulario.elements.autor.value.trim() || 'SHADDAI',
    };
  }

  async function guardar(publicar) {
    const datos = recogerDatos();
    if (publicar) datos.estado = 'publicado';
    if (!datos.titulo) {
      toast('El artículo necesita un título.', 'error');
      return;
    }
    if (datos.estado === 'programado' && !datos.fechaPublicacion) {
      toast('Un artículo programado necesita fecha de publicación.', 'error');
      return;
    }
    try {
      let guardado;
      if (esNuevo) {
        guardado = (await pedir('/api/articulos', { method: 'POST', cuerpo: datos })).dato;
      } else {
        guardado = (await pedir(`/api/articulos/${articulo.id}`, { method: 'PUT', cuerpo: datos })).dato;
      }
      if (publicar && !esNuevo) {
        const respuesta = await pedir(`/api/articulos/${articulo.id}/publicar`, { method: 'POST' });
        toast(`Publicado en ${respuesta.url}`, 'ok', { texto: 'Ver ↗', alPulsar: () => window.open(respuesta.url, '_blank') });
      } else {
        toast(datos.estado === 'publicado' ? 'Artículo guardado y publicado.' : 'Artículo guardado.');
      }
      cerrar();
      alGuardar();
      return guardado;
    } catch (error) {
      toast(error.message, 'error');
    }
  }

  fondo.querySelector('[data-guardar]').addEventListener('click', () => guardar(false));
  fondo.querySelector('[data-publicar]').addEventListener('click', () => guardar(true));
}
