// Blog: lista con estado, editor completo con slug automático, vista previa
// y publicación. Al publicar (estado «publicado») el artículo aparece al
// momento en omshaddai.com/blog/ — los artículos viven en la tabla articulos
// y la web pública los lee con RLS (borradores y programados no vencidos
// quedan ocultos; los programados se publican solos al llegar la fecha).
import { sb, asegurar, subirImagen, mensajeError } from '../bd.js';
import {
  escapar, fechaCorta, toast, confirmar, abrirModal, abrirVistaPrevia,
  urlImagen, slugificar, aIso, aLocal, badgeEstado, etiquetaVacia,
} from '../api.js';

export default async function (contenedor, contexto) {
  const esLector = contexto.usuario.rol === 'lector';
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Al publicar, el artículo aparece al momento en <code>omshaddai.com/blog/</code>. Los programados se publican solos a su hora.</p>
      ${esLector ? '' : '<button id="boton-nuevo-articulo" class="boton boton-primario" type="button">+ Nuevo artículo</button>'}
    </div>
    <div id="zona-blog" class="zona-tabla"><p class="cargando">Cargando artículos…</p></div>`;

  const zona = contenedor.querySelector('#zona-blog');
  const botonNuevo = contenedor.querySelector('#boton-nuevo-articulo');
  let articulos = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando artículos…</p>';
    try {
      articulos = (await asegurar(sb().from('articulos').select('*').order('fecha_publicacion', { ascending: false, nullsFirst: false }).order('creado_en', { ascending: false }))) || [];
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
            <td class="texto-suave">${fechaCorta(a.fecha_publicacion)}</td>
            <td class="texto-suave">${escapar(a.autor || '—')}</td>
            <td>${(a.etiquetas || []).map((e) => `<span class="chip">${escapar(e)}</span>`).join(' ') || '<span class="texto-suave">—</span>'}</td>
            <td class="alineado-derecha acciones-blog">
              ${esLector ? '' : `
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              ${a.estado === 'publicado'
                ? '<button class="boton boton-fantasma boton-pequeno" data-accion="despublicar" type="button">Despublicar</button>'
                : '<button class="boton boton-oro boton-pequeno" data-accion="publicar" type="button">Publicar</button>'}
              <button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>`}
              ${a.estado === 'publicado' ? `<a class="boton boton-fantasma boton-pequeno" href="/blog/articulo.html?slug=${encodeURIComponent(a.slug)}" target="_blank" rel="noopener">Ver ↗</a>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function cambiarEstado(articulo, estado) {
    const cambios = { estado };
    if (estado === 'publicado' && !articulo.fecha_publicacion) {
      cambios.fecha_publicacion = new Date().toISOString();
    }
    const error = (await sb().from('articulos').update(cambios).eq('id', articulo.id)).error;
    if (error) throw new Error(mensajeError(error));
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
        await cambiarEstado(articulo, 'publicado');
        const url = `/blog/articulo.html?slug=${encodeURIComponent(articulo.slug)}`;
        toast('Artículo publicado en la web.', 'ok', { texto: 'Ver ↗', alPulsar: () => window.open(url, '_blank') });
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (boton.dataset.accion === 'despublicar') {
      const seguro = await confirmar('Despublicar', `«${articulo.titulo}» pasará a borrador y se retirará del blog público. ¿Continuar?`, 'Despublicar');
      if (!seguro) return;
      try {
        await cambiarEstado(articulo, 'borrador');
        toast('Artículo despublicado: ya no aparece en la web.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
      return;
    }

    if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar('Eliminar artículo', `¿Eliminar «${articulo.titulo}»? Si estaba publicado, dejará de verse en la web.`);
      if (!seguro) return;
      try {
        const error = (await sb().from('articulos').delete().eq('id', articulo.id)).error;
        if (error) throw new Error(mensajeError(error));
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
          <input name="fecha_publicacion" type="datetime-local" value="${aLocal(articulo?.fecha_publicacion)}">
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
          <input name="imagen_portada" maxlength="500" placeholder="URL de la imagen (se rellena al subir un archivo)" value="${escapar(articulo?.imagen_portada || '')}">
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
    const ruta = formulario.elements.imagen_portada.value.trim();
    vistaMiniatura.innerHTML = ruta ? `<img class="miniatura-tabla" src="${escapar(urlImagen(ruta))}" alt="">` : '';
  };
  formulario.elements.imagen_portada.addEventListener('change', pintarMiniatura);
  entradaPortada.addEventListener('change', async () => {
    const archivo = entradaPortada.files[0];
    if (!archivo) return;
    try {
      formulario.elements.imagen_portada.value = await subirImagen(archivo);
      pintarMiniatura();
      toast('Imagen de portada subida al bucket «recursos».');
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
      imagen_portada: formulario.elements.imagen_portada.value.trim(),
      etiquetas,
      estado: formulario.elements.estado.value,
      fecha_publicacion: aIso(formulario.elements.fecha_publicacion.value) || articulo?.fecha_publicacion,
      autor: formulario.elements.autor.value.trim() || 'SHADDAI',
    };
  }

  async function guardar(publicar) {
    const datos = recogerDatos();
    if (publicar) datos.estado = 'publicado';
    if (!datos.titulo || !datos.slug) {
      toast('El artículo necesita título y slug.', 'error');
      return;
    }
    if (datos.estado === 'programado' && !datos.fecha_publicacion) {
      toast('Un artículo programado necesita fecha de publicación.', 'error');
      return;
    }
    if (datos.estado === 'publicado' && !datos.fecha_publicacion) {
      datos.fecha_publicacion = new Date().toISOString();
    }
    const boton = publicar ? fondo.querySelector('[data-publicar]') : fondo.querySelector('[data-guardar]');
    boton.disabled = true;
    try {
      const error = esNuevo
        ? (await sb().from('articulos').insert(datos)).error
        : (await sb().from('articulos').update(datos).eq('id', articulo.id)).error;
      if (error) throw new Error(mensajeError(error));
      if (datos.estado === 'publicado') {
        const url = `/blog/articulo.html?slug=${encodeURIComponent(datos.slug)}`;
        toast('Artículo publicado en la web.', 'ok', { texto: 'Ver ↗', alPulsar: () => window.open(url, '_blank') });
      } else {
        toast('Artículo guardado.');
      }
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
      boton.disabled = false;
    }
  }

  fondo.querySelector('[data-guardar]').addEventListener('click', () => guardar(false));
  fondo.querySelector('[data-publicar]').addEventListener('click', () => guardar(true));
}
