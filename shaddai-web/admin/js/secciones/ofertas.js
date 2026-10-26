// Ofertas: descuentos por precio fijo o porcentaje, con precio efectivo
// resultante (el MISMO cálculo que hace la vista productos_publicos).
import { sb, asegurar, mensajeError } from '../bd.js';
import {
  escapar, euro, fechaCorta, toast, confirmar, abrirModal, aIso, aLocal, badgeEstado, etiquetaVacia,
} from '../api.js';

function precioResultante(producto, oferta) {
  const base = Number(producto?.precio) || 0;
  let precio = Number(producto?.precio_oferta) > 0 ? Number(producto.precio_oferta) : base;
  const valor = Number(oferta.valor) || 0;
  const candidato = oferta.tipo === 'porcentaje' ? base * (1 - valor / 100) : valor;
  if (candidato >= 0 && candidato < precio) precio = Math.round(candidato * 100) / 100;
  return precio;
}

function estadoVigencia(oferta) {
  if (!oferta.activa) return badgeEstado('inactiva', 'Inactiva');
  const ahora = Date.now();
  const inicio = oferta.inicio ? Date.parse(oferta.inicio) : 0;
  const fin = oferta.fin ? Date.parse(oferta.fin) : Infinity;
  if (inicio > ahora) return badgeEstado('programado', 'Programada');
  if (fin < ahora) return badgeEstado('borrador', 'Caducada');
  return badgeEstado('publicado', 'Activa ahora');
}

export default async function (contenedor) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">El precio de la web es siempre el más bajo entre el precio de oferta del producto y sus ofertas activas.</p>
      <button id="boton-nueva-oferta" class="boton boton-primario" type="button">+ Nueva oferta</button>
    </div>
    <div id="zona-ofertas" class="zona-tabla"><p class="cargando">Cargando ofertas…</p></div>`;

  const zona = contenedor.querySelector('#zona-ofertas');
  let ofertas = [];
  let productos = [];
  const porId = new Map();

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando ofertas…</p>';
    try {
      const [datosOfertas, datosProductos] = await Promise.all([
        asegurar(sb().from('ofertas').select('*').order('creado_en', { ascending: false })),
        asegurar(sb().from('productos').select('*').order('nombre')),
      ]);
      ofertas = datosOfertas || [];
      productos = datosProductos || [];
      porId.clear();
      productos.forEach((p) => porId.set(p.id, p));
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar las ofertas: ${error.message}`);
    }
  }

  function pintar() {
    if (!ofertas.length) {
      zona.innerHTML = etiquetaVacia('Aún no hay ofertas. Crea la primera.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Producto</th><th>Descuento</th><th>Precio resultante</th><th>Vigencia</th><th>Activa</th><th>Estado</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${ofertas.map((oferta) => {
            const producto = porId.get(oferta.producto);
            return `
          <tr data-id="${escapar(oferta.id)}">
            <td><strong>${escapar(producto?.nombre || '—')}</strong>${producto ? `<br><span class="texto-suave">Base: ${euro(producto.precio)}</span>` : ''}</td>
            <td>${oferta.tipo === 'porcentaje' ? `<strong>−${Number(oferta.valor)} %</strong>` : `<strong>${euro(oferta.valor)}</strong> <span class="texto-suave">(precio fijo)</span>`}</td>
            <td><strong class="precio-resultado">${producto ? euro(precioResultante(producto, oferta)) : '—'}</strong></td>
            <td class="texto-suave">${oferta.inicio ? fechaCorta(oferta.inicio) : 'siempre'} → ${oferta.fin ? fechaCorta(oferta.fin) : 'sin fin'}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="activa" ${oferta.activa ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td>${estadoVigencia(oferta)}</td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="editar" type="button">Editar</button>
              <button class="boton boton-peligro boton-pequeno" data-accion="eliminar" type="button">Eliminar</button>
            </td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="activa"]');
    if (!interruptor) return;
    const oferta = ofertas.find((o) => o.id === interruptor.closest('tr').dataset.id);
    if (!oferta) return;
    try {
      const error = (await sb().from('ofertas').update({ activa: interruptor.checked }).eq('id', oferta.id)).error;
      if (error) throw new Error(mensajeError(error));
      oferta.activa = interruptor.checked;
      toast(interruptor.checked ? 'Oferta activada.' : 'Oferta desactivada.');
      pintar();
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion]');
    if (!boton) return;
    const oferta = ofertas.find((o) => o.id === boton.closest('tr').dataset.id);
    if (!oferta) return;
    if (boton.dataset.accion === 'editar') {
      abrirFormulario(oferta, productos, cargar);
      return;
    }
    const seguro = await confirmar('Eliminar oferta', '¿Eliminar esta oferta? El producto volverá a su precio normal.');
    if (!seguro) return;
    try {
      const error = (await sb().from('ofertas').delete().eq('id', oferta.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Oferta eliminada.');
      cargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  contenedor.querySelector('#boton-nueva-oferta').addEventListener('click', () => abrirFormulario(null, productos, cargar));
  await cargar();
}

function abrirFormulario(oferta, productos, alGuardar) {
  const esNueva = !oferta;
  const { cerrar, cuerpo } = abrirModal(esNueva ? 'Nueva oferta' : 'Editar oferta', `
    <form id="formulario-oferta" class="formulario">
      <label>Producto *</label>
      <select name="producto" required>
        <option value="">— Elige un producto —</option>
        ${productos.map((p) => `<option value="${escapar(p.id)}" ${oferta?.producto === p.id ? 'selected' : ''}>${escapar(p.nombre)} · ${euro(p.precio)}</option>`).join('')}
      </select>
      <div class="formulario-grid">
        <div>
          <label>Tipo *</label>
          <select name="tipo">
            <option value="precio" ${oferta?.tipo === 'precio' ? 'selected' : ''}>Precio fijo (€)</option>
            <option value="porcentaje" ${oferta?.tipo === 'porcentaje' ? 'selected' : ''}>Porcentaje (%)</option>
          </select>
        </div>
        <div>
          <label class="etiqueta-valor">Valor *</label>
          <input name="valor" type="number" step="0.01" min="0" required value="${oferta?.valor ?? ''}">
        </div>
        <div>
          <label>Inicio (opcional)</label>
          <input name="inicio" type="datetime-local" value="${aLocal(oferta?.inicio)}">
        </div>
        <div>
          <label>Fin (opcional)</label>
          <input name="fin" type="datetime-local" value="${aLocal(oferta?.fin)}">
        </div>
      </div>
      <label class="interruptor"><input type="checkbox" name="activa" ${oferta?.activa !== false ? 'checked' : ''}><span class="interruptor-pista"></span> Oferta activa</label>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">${esNueva ? 'Crear oferta' : 'Guardar cambios'}</button>
      </div>
    </form>`, '32rem');

  const formulario = cuerpo.querySelector('#formulario-oferta');
  const actualizarEtiquetaValor = () => {
    cuerpo.querySelector('.etiqueta-valor').textContent = formulario.elements.tipo.value === 'porcentaje'
      ? 'Porcentaje de descuento *'
      : 'Precio final (€) *';
  };
  formulario.elements.tipo.addEventListener('change', actualizarEtiquetaValor);
  actualizarEtiquetaValor();
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const envio = {
      producto: campos.producto.value,
      tipo: campos.tipo.value,
      valor: Number(String(campos.valor.value).replace(',', '.')),
      inicio: aIso(campos.inicio.value),
      fin: aIso(campos.fin.value),
      activa: campos.activa.checked,
    };
    if (!envio.producto || Number.isNaN(envio.valor)) {
      toast('Elige un producto e indica el valor de la oferta.', 'error');
      return;
    }
    try {
      const error = esNueva
        ? (await sb().from('ofertas').insert(envio)).error
        : (await sb().from('ofertas').update(envio).eq('id', oferta.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast(esNueva ? 'Oferta creada.' : 'Oferta actualizada.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
