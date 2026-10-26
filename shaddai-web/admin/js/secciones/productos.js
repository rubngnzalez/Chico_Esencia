// Productos: catálogo con búsqueda, alta/edición en modal, imágenes del bucket
// «recursos», interruptor de activo y borrado. (Datos: tablas productos/categorias.)
import { sb, asegurar, subirImagen, mensajeError } from '../bd.js';
import {
  escapar, euro, toast, confirmar, abrirModal, urlImagen, slugificar, etiquetaVacia,
} from '../api.js';

let textoBusqueda = '';

export default async function (contenedor, contexto) {
  const puedeEditar = ['admin', 'editor'].includes(contexto.usuario.rol);
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <input id="buscar-producto" class="campo-busqueda" type="search" placeholder="Buscar por nombre, código o categoría…" value="${escapar(textoBusqueda)}">
      ${puedeEditar ? '<button id="boton-nuevo-producto" class="boton boton-primario" type="button">+ Nuevo producto</button>' : ''}
    </div>
    <div id="zona-productos" class="zona-tabla"><p class="cargando">Cargando productos…</p></div>`;

  const zona = contenedor.querySelector('#zona-productos');
  const entradaBusqueda = contenedor.querySelector('#buscar-producto');
  const botonNuevo = contenedor.querySelector('#boton-nuevo-producto');
  let productos = [];
  let categorias = [];

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando productos…</p>';
    try {
      const [datosProductos, datosCategorias] = await Promise.all([
        asegurar(sb().from('productos').select('*').order('creado_en')),
        asegurar(sb().from('categorias').select('*').order('orden')),
      ]);
      productos = datosProductos || [];
      categorias = datosCategorias || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los productos: ${error.message}`);
    }
  }

  function nombreCategoria(id) {
    const categoria = categorias.find((c) => c.id === id);
    return categoria ? categoria.nombre : '—';
  }

  function filtrados() {
    const aguja = textoBusqueda.trim().toLowerCase();
    if (!aguja) return productos;
    return productos.filter((p) =>
      [p.nombre, p.slug, p.codigo].some((campo) => String(campo || '').toLowerCase().includes(aguja)));
  }

  function pintar() {
    if (!productos.length) {
      zona.innerHTML = etiquetaVacia('Aún no hay productos. Crea el primero.');
      return;
    }
    const lista = filtrados();
    if (!lista.length) {
      zona.innerHTML = etiquetaVacia('Ningún producto coincide con la búsqueda.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr>
          <th></th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Destacado</th><th>Activo</th><th class="alineado-derecha">Acciones</th>
        </tr></thead>
        <tbody>
          ${lista.map((p) => `
          <tr data-id="${escapar(p.id)}">
            <td class="celda-miniatura">${p.imagenes?.[0] ? `<img class="miniatura-tabla" src="${escapar(urlImagen(p.imagenes[0]))}" alt="">` : '<span class="miniatura-vacia">✦</span>'}</td>
            <td><strong>${escapar(p.nombre)}</strong>${p.codigo ? `<span class="texto-suave"> · ${escapar(p.codigo)}</span>` : ''}<br><span class="texto-suave">${escapar(p.slug)}</span></td>
            <td>${escapar(nombreCategoria(p.categoria))}</td>
            <td>${Number(p.precio_oferta) > 0 ? `<s class="texto-suave">${euro(p.precio)}</s> <strong>${euro(p.precio_oferta)}</strong>` : euro(p.precio)}</td>
            <td>${Number(p.stock) || 0}</td>
            <td>${p.destacado ? '<span class="estrella-activa">★</span>' : '<span class="texto-suave">—</span>'}</td>
            <td><label class="interruptor" title="${p.activo !== false ? 'Desactivar' : 'Activar'}"><input type="checkbox" data-accion="activo" ${p.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td class="alineado-derecha">
              ${puedeEditar ? `
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>` : '<span class="texto-suave">solo lectura</span>'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="activo"]');
    if (!interruptor) return;
    const producto = productos.find((p) => p.id === interruptor.closest('tr').dataset.id);
    if (!producto) return;
    try {
      const error = (await sb().from('productos').update({ activo: interruptor.checked }).eq('id', producto.id)).error;
      if (error) throw new Error(mensajeError(error));
      producto.activo = interruptor.checked;
      toast(interruptor.checked ? `«${producto.nombre}» activado.` : `«${producto.nombre}» desactivado: ya no se ve en la web.`);
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const producto = productos.find((p) => p.id === boton.closest('tr').dataset.id);
    if (!producto) return;
    if (boton.dataset.accion === 'editar') {
      abrirFormulario(producto, categorias, cargar);
    } else if (boton.dataset.accion === 'eliminar') {
      const seguro = await confirmar('Eliminar producto', `¿Eliminar «${producto.nombre}»? Esta acción no se puede deshacer.`);
      if (!seguro) return;
      try {
        const error = (await sb().from('productos').delete().eq('id', producto.id)).error;
        if (error) throw new Error(mensajeError(error));
        toast('Producto eliminado.');
        cargar();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });

  if (botonNuevo) botonNuevo.addEventListener('click', () => abrirFormulario(null, categorias, cargar));
  entradaBusqueda.addEventListener('input', () => {
    textoBusqueda = entradaBusqueda.value;
    pintar();
  });

  await cargar();
}

function abrirFormulario(producto, categorias, alGuardar) {
  const esNuevo = !producto;
  const imagenes = [...(producto?.imagenes || [])];

  const { cerrar, cuerpo } = abrirModal(esNuevo ? 'Nuevo producto' : `Editar: ${producto.nombre}`, `
    <form id="formulario-producto" class="formulario">
      <div class="formulario-grid">
        <div>
          <label>Nombre *</label>
          <input name="nombre" required maxlength="160" value="${escapar(producto?.nombre || '')}">
        </div>
        <div>
          <label>Código (referencia)</label>
          <input name="codigo" maxlength="60" value="${escapar(producto?.codigo || '')}" placeholder="p. ej. esencia-umbral-50">
        </div>
        <div>
          <label>Slug (URL)</label>
          <input name="slug" maxlength="90" value="${escapar(producto?.slug || '')}">
        </div>
        <div>
          <label>Categoría</label>
          <select name="categoria">
            <option value="">— Sin categoría —</option>
            ${categorias.map((c) => `<option value="${escapar(c.id)}" ${producto?.categoria === c.id ? 'selected' : ''}>${escapar(c.nombre)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label>Precio (€) *</label>
          <input name="precio" type="number" step="0.01" min="0" required value="${producto?.precio ?? ''}">
        </div>
        <div>
          <label>Precio de oferta (€, vacío = sin oferta)</label>
          <input name="precioOferta" type="number" step="0.01" min="0" value="${producto?.precio_oferta ?? ''}">
        </div>
        <div>
          <label>Stock</label>
          <input name="stock" type="number" step="1" min="0" value="${producto?.stock ?? 0}">
        </div>
        <div class="formulario-opciones">
          <label class="interruptor"><input type="checkbox" name="destacado" ${producto?.destacado ? 'checked' : ''}><span class="interruptor-pista"></span> Producto destacado</label>
          <label class="interruptor"><input type="checkbox" name="activo" ${producto?.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span> Activo (visible en la web)</label>
        </div>
      </div>
      <label>Descripción corta</label>
      <textarea name="descripcion" rows="3" maxlength="3000">${escapar(producto?.descripcion || '')}</textarea>
      <label>Historia (página del producto)</label>
      <textarea name="historia" rows="6" maxlength="12000">${escapar(producto?.historia || '')}</textarea>
      <label>Imágenes (JPEG, PNG o WebP · máx. 5 MB cada una)</label>
      <div class="zona-subida">
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple class="entrada-archivo">
        <span class="texto-suave">Se suben al bucket «recursos» de Supabase al elegir el archivo.</span>
      </div>
      <div class="zona-imagenes"></div>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">${esNuevo ? 'Crear producto' : 'Guardar cambios'}</button>
      </div>
    </form>`, '52rem');

  const formulario = cuerpo.querySelector('#formulario-producto');
  const inputNombre = formulario.elements.nombre;
  const inputSlug = formulario.elements.slug;
  let slugEditado = !esNuevo;
  inputNombre.addEventListener('input', () => { if (!slugEditado) inputSlug.value = slugificar(inputNombre.value); });
  inputSlug.addEventListener('input', () => { slugEditado = true; });
  if (!esNuevo && inputSlug.value) slugEditado = true;

  const zonaImagenes = cuerpo.querySelector('.zona-imagenes');
  const entradaArchivo = cuerpo.querySelector('.entrada-archivo');

  function pintarImagenes() {
    zonaImagenes.innerHTML = imagenes.length
      ? imagenes.map((ruta, indice) => `
        <div class="miniatura">
          <img src="${escapar(urlImagen(ruta))}" alt="">
          <button type="button" class="miniatura-quitar" data-indice="${indice}" aria-label="Quitar imagen">×</button>
        </div>`).join('')
      : '<p class="texto-suave">Sin imágenes todavía.</p>';
  }

  zonaImagenes.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.miniatura-quitar');
    if (boton) {
      imagenes.splice(Number(boton.dataset.indice), 1);
      pintarImagenes();
    }
  });

  entradaArchivo.addEventListener('change', async () => {
    for (const archivo of entradaArchivo.files) {
      try {
        const url = await subirImagen(archivo);
        imagenes.push(url);
        pintarImagenes();
      } catch (error) {
        toast(error.message, 'error');
      }
    }
    entradaArchivo.value = '';
  });

  pintarImagenes();
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const precioOfertaTexto = String(campos.precioOferta.value).trim();
    const envio = {
      nombre: campos.nombre.value.trim(),
      slug: campos.slug.value.trim(),
      codigo: campos.codigo.value.trim(),
      categoria: campos.categoria.value || null,
      precio: Number(String(campos.precio.value).replace(',', '.')),
      precio_oferta: precioOfertaTexto === '' ? null : Number(precioOfertaTexto.replace(',', '.')),
      stock: Number.parseInt(campos.stock.value, 10) || 0,
      descripcion: campos.descripcion.value.trim(),
      historia: campos.historia.value.trim(),
      imagenes,
      destacado: campos.destacado.checked,
      activo: campos.activo.checked,
    };
    if (!envio.nombre || !envio.slug || Number.isNaN(envio.precio)) {
      toast('Revisa el nombre, el slug y el precio del producto.', 'error');
      return;
    }
    const botonGuardar = formulario.querySelector('button[type="submit"]');
    botonGuardar.disabled = true;
    try {
      const error = esNuevo
        ? (await sb().from('productos').insert(envio)).error
        : (await sb().from('productos').update(envio).eq('id', producto.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast(esNuevo ? 'Producto creado.' : 'Producto actualizado.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
      botonGuardar.disabled = false;
    }
  });
}
