// Ofertas: descuentos por precio fijo o porcentaje, con precio efectivo
// resultante (el MISMO cálculo que hace la vista productos_publicos).
// Cupones: códigos de descuento activables por código o QR (tabla oms_cupones,
// se aplican en el checkout y se validan siempre en servidor).
import { sb, asegurar, mensajeError } from '../bd.js';
import {
  escapar, euro, fechaCorta, toast, confirmar, abrirModal, aIso, aLocal, badgeEstado, etiquetaVacia,
} from '../api.js';

const DOMINIO_WEB = 'https://omshaddai.com';

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
    <div id="zona-ofertas" class="zona-tabla"><p class="cargando">Cargando ofertas…</p></div>

    <h2 class="titulo-seccion" style="margin-top:2.4rem;">Códigos de descuento (cupones)</h2>
    <div class="barra-herramientas">
      <p class="texto-suave">Cupones que el cliente activa escribiendo el código o escaneando el QR en la web. Se aplican sobre el subtotal del checkout y se validan siempre en servidor; el uso se cuenta cuando Redsys confirma el pago.</p>
      <button id="boton-nuevo-cupon" class="boton boton-primario" type="button">+ Nuevo cupón</button>
    </div>
    <div id="zona-cupones" class="zona-tabla"><p class="cargando">Cargando cupones…</p></div>`;

  const zona = contenedor.querySelector('#zona-ofertas');
  const zonaCupones = contenedor.querySelector('#zona-cupones');
  let ofertas = [];
  let cupones = [];
  let productos = [];
  const porId = new Map();

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando ofertas…</p>';
    zonaCupones.innerHTML = '<p class="cargando">Cargando cupones…</p>';
    try {
      const [datosOfertas, datosProductos, datosCupones] = await Promise.all([
        asegurar(sb().from('oms_ofertas').select('*').order('creado_en', { ascending: false })),
        asegurar(sb().from('oms_productos').select('*').order('nombre')),
        asegurar(sb().from('oms_cupones').select('*').order('creado_en', { ascending: false })),
      ]);
      ofertas = datosOfertas || [];
      productos = datosProductos || [];
      cupones = datosCupones || [];
      porId.clear();
      productos.forEach((p) => porId.set(p.id, p));
      pintar();
      pintarCupones();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar las ofertas: ${error.message}`);
      zonaCupones.innerHTML = etiquetaVacia(`No se pudieron cargar los cupones (¿ejecutaste el SQL de cupones?): ${error.message}`);
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
      const error = (await sb().from('oms_ofertas').update({ activa: interruptor.checked }).eq('id', oferta.id)).error;
      if (error) throw new Error(mensajeError(error));
      oferta.activa = interruptor.checked;
      toast(interruptor.checked ? 'Oferta activada.' : 'Oferta desactivada.');
      pintar();
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });  zona.addEventListener('click', async (evento) => {
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
      const error = (await sb().from('oms_ofertas').delete().eq('id', oferta.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Oferta eliminada.');
      cargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  contenedor.querySelector('#boton-nueva-oferta').addEventListener('click', () => abrirFormulario(null, productos, cargar));

  // ── Códigos de descuento (cupones) ────────────────────────────────────────

  function estadoCupon(cupon) {
    if (!cupon.activo) return badgeEstado('inactiva', 'Inactivo');
    const ahora = Date.now();
    const inicio = cupon.inicio ? Date.parse(cupon.inicio) : 0;
    const fin = cupon.fin ? Date.parse(cupon.fin) : Infinity;
    if (inicio > ahora) return badgeEstado('programado', 'Programado');
    if (fin < ahora) return badgeEstado('borrador', 'Caducado');
    if (cupon.usos_maximos != null && cupon.usos >= cupon.usos_maximos) return badgeEstado('borrador', 'Agotado');
    return badgeEstado('publicado', 'Activo ahora');
  }

  function textoDescuentoCupon(cupon) {
    if (cupon.tipo === 'porcentaje') return `<strong>−${Number(cupon.valor)} %</strong>`;
    if (cupon.tipo === 'fijo') return `<strong>${euro(cupon.valor)}</strong>`;
    return '<strong>Envío gratis</strong>';
  }

  function pintarCupones() {
    if (!cupones.length) {
      zonaCupones.innerHTML = etiquetaVacia('Aún no hay códigos de descuento. Crea el primero y genera su QR.');
      return;
    }
    zonaCupones.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Código</th><th>Descuento</th><th>Mínimo</th><th>Vigencia</th><th>Usos</th><th>Activo</th><th>Estado</th><th class="alineado-derecha">Acciones</th></tr></thead>
        <tbody>
          ${cupones.map((cupon) => `
          <tr data-id="${escapar(cupon.id)}">
            <td><strong class="codigo-cupon">${escapar(cupon.codigo)}</strong></td>
            <td>${textoDescuentoCupon(cupon)}</td>
            <td class="texto-suave">${Number(cupon.minimo_subtotal) > 0 ? euro(cupon.minimo_subtotal) : '—'}</td>
            <td class="texto-suave">${cupon.inicio ? fechaCorta(cupon.inicio) : 'siempre'} → ${cupon.fin ? fechaCorta(cupon.fin) : 'sin fin'}</td>
            <td class="texto-suave">${cupon.usos}${cupon.usos_maximos != null ? ` / ${cupon.usos_maximos}` : ''}</td>
            <td><label class="interruptor"><input type="checkbox" data-accion="cupon-activo" ${cupon.activo ? 'checked' : ''}><span class="interruptor-pista"></span></label></td>
            <td>${estadoCupon(cupon)}</td>
            <td class="alineado-derecha">
              <button class="boton boton-fantasma boton-pequeno" data-accion="cupon-qr" type="button">QR</button>
              <button class="boton boton-fantasma boton-pequeno" data-accion="cupon-editar" type="button">Editar</button>
              <button class="boton boton-peligro boton-pequeno" data-accion="cupon-eliminar" type="button">Eliminar</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  zonaCupones.addEventListener('change', async (evento) => {
    const interruptor = evento.target.closest('input[data-accion="cupon-activo"]');
    if (!interruptor) return;
    const cupon = cupones.find((c) => c.id === interruptor.closest('tr').dataset.id);
    if (!cupon) return;
    try {
      const error = (await sb().from('oms_cupones').update({ activo: interruptor.checked }).eq('id', cupon.id)).error;
      if (error) throw new Error(mensajeError(error));
      cupon.activo = interruptor.checked;
      toast(interruptor.checked ? 'Cupón activado.' : 'Cupón desactivado.');
      pintarCupones();
    } catch (error) {
      interruptor.checked = !interruptor.checked;
      toast(error.message, 'error');
    }
  });

  zonaCupones.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion^="cupon-"]');
    if (!boton) return;
    const cupon = cupones.find((c) => c.id === boton.closest('tr').dataset.id);
    if (!cupon) return;
    if (boton.dataset.accion === 'cupon-qr') {
      abrirQr(cupon);
      return;
    }
    if (boton.dataset.accion === 'cupon-editar') {
      abrirFormularioCupon(cupon, cargar);
      return;
    }
    const seguro = await confirmar('Eliminar cupón', `¿Eliminar el cupón «${cupon.codigo}»? Los pedidos ya hechos lo conservan en su historial.`);
    if (!seguro) return;
    try {
      const error = (await sb().from('oms_cupones').delete().eq('id', cupon.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast('Cupón eliminado.');
      cargar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  contenedor.querySelector('#boton-nuevo-cupon').addEventListener('click', () => abrirFormularioCupon(null, cargar));

  await cargar();
}

// ── Formulario y QR de cupones ───────────────────────────────────────────────

function urlCupon(codigo) {
  return `${DOMINIO_WEB}/?cupon=${encodeURIComponent(String(codigo || ''))}`;
}

function imagenQr(texto) {
  if (typeof window.qrcode !== 'function') return null;
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(texto);
    qr.make();
    return qr.createDataURL(8, 4);
  } catch {
    return null;
  }
}

function abrirQr(cupon) {
  const url = urlCupon(cupon.codigo);
  const imagen = imagenQr(url);
  const { cerrar, cuerpo } = abrirModal(`QR del cupón «${cupon.codigo}»`, `
    <div class="cupon-qr">
      ${imagen
        ? `<img src="${imagen}" alt="QR del cupón ${escapar(cupon.codigo)}" width="256" height="256">`
        : '<p class="texto-suave">No se pudo generar la imagen del QR (sin conexión al CDN o navegador antiguo). Comparte el enlace de abajo.</p>'}
      <p><strong>${escapar(cupon.codigo)}</strong> — ${textoDescuentoCupon(cupon)}</p>
      <p class="texto-suave" style="word-break:break-all;">${escapar(url)}</p>
      <p class="texto-suave">Al escanearlo, la web guarda el cupón y lo aplica solo en el checkout.</p>
      <div class="modal-acciones">
        ${imagen ? `<a class="boton boton-primario" download="cupon-${escapar(cupon.codigo)}.png" href="${imagen}">Descargar PNG</a>` : ''}
        <button type="button" class="boton boton-fantasma" data-copiar>Copiar enlace</button>
        <button type="button" class="boton boton-fantasma" data-cancelar>Cerrar</button>
      </div>
    </div>`, '22rem');

  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  cuerpo.querySelector('[data-copiar]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado.');
    } catch {
      toast('No se pudo copiar: selecciona el enlace a mano.', 'error');
    }
  });
}

function abrirFormularioCupon(cupon, alGuardar) {
  const esNuevo = !cupon;
  const { cerrar, cuerpo } = abrirModal(esNuevo ? 'Nuevo cupón' : 'Editar cupón', `
    <form id="formulario-cupon" class="formulario">
      <label>Código *</label>
      <input name="codigo" type="text" maxlength="40" required placeholder="PRIMAVERA10"
             value="${escapar(cupon?.codigo || '')}" style="text-transform:uppercase;">
      <p class="texto-suave" style="margin:.2rem 0 0;">Mayúsculas y números. El cliente lo escribe o lo escanea en el QR.</p>
      <div class="formulario-grid">
        <div>
          <label>Tipo *</label>
          <select name="tipo">
            <option value="porcentaje" ${(cupon?.tipo || 'porcentaje') === 'porcentaje' ? 'selected' : ''}>Porcentaje (%)</option>
            <option value="fijo" ${cupon?.tipo === 'fijo' ? 'selected' : ''}>Importe fijo (€)</option>
            <option value="envio" ${cupon?.tipo === 'envio' ? 'selected' : ''}>Envío gratuito</option>
          </select>
        </div>
        <div>
          <label class="etiqueta-valor">Valor *</label>
          <input name="valor" type="number" step="0.01" min="0" value="${cupon?.valor ?? ''}">
        </div>
        <div>
          <label>Subtotal mínimo (€)</label>
          <input name="minimo" type="number" step="0.01" min="0" value="${cupon?.minimo_subtotal ?? ''}">
        </div>
        <div>
          <label>Usos máximo (vacío = sin límite)</label>
          <input name="usosMaximos" type="number" min="1" step="1" value="${cupon?.usos_maximos ?? ''}">
        </div>
        <div>
          <label>Inicio (opcional)</label>
          <input name="inicio" type="datetime-local" value="${aLocal(cupon?.inicio)}">
        </div>
        <div>
          <label>Fin (opcional)</label>
          <input name="fin" type="datetime-local" value="${aLocal(cupon?.fin)}">
        </div>
      </div>
      <label class="interruptor"><input type="checkbox" name="activo" ${cupon?.activo !== false ? 'checked' : ''}><span class="interruptor-pista"></span> Cupón activo</label>
      <div class="modal-acciones">
        <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
        <button type="submit" class="boton boton-primario">${esNuevo ? 'Crear cupón' : 'Guardar cambios'}</button>
      </div>
    </form>`, '32rem');

  const formulario = cuerpo.querySelector('#formulario-cupon');
  const actualizarEtiquetaValor = () => {
    const tipo = formulario.elements.tipo.value;
    const campoValor = formulario.elements.valor;
    campoValor.disabled = tipo === 'envio';
    cuerpo.querySelector('.etiqueta-valor').textContent =
      tipo === 'porcentaje' ? 'Porcentaje de descuento *' : tipo === 'fijo' ? 'Importe a descontar (€) *' : 'Valor (envío gratis)';
  };
  formulario.elements.tipo.addEventListener('change', actualizarEtiquetaValor);
  formulario.elements.codigo.addEventListener('input', () => {
    formulario.elements.codigo.value = formulario.elements.codigo.value.toUpperCase().replace(/\s+/g, '');
  });
  actualizarEtiquetaValor();
  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);

  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const codigo = campos.codigo.value.trim().toUpperCase();
    const tipo = campos.tipo.value;
    const valor = Number(String(campos.valor.value).replace(',', '.')) || 0;
    if (!codigo) {
      toast('Escribe el código del cupón.', 'error');
      return;
    }
    if (tipo !== 'envio' && (!(valor > 0) || (tipo === 'porcentaje' && valor > 100))) {
      toast('Indica un valor válido (porcentaje entre 1 y 100, o importe en €).', 'error');
      return;
    }
    const usos = String(campos.usosMaximos.value).trim();
    const envio = {
      codigo,
      tipo,
      valor: tipo === 'envio' ? 0 : valor,
      minimo_subtotal: Number(String(campos.minimo.value).replace(',', '.')) || 0,
      inicio: aIso(campos.inicio.value),
      fin: aIso(campos.fin.value),
      usos_maximos: usos === '' ? null : Math.max(1, Number.parseInt(usos, 10) || 1),
      activo: campos.activo.checked,
    };
    try {
      const error = esNuevo
        ? (await sb().from('oms_cupones').insert(envio)).error
        : (await sb().from('oms_cupones').update(envio).eq('id', cupon.id)).error;
      if (error) {
        const duplicado = String(error.message || '').toLowerCase().includes('duplicate');
        throw new Error(duplicado ? 'Ese código ya existe: elige otro.' : mensajeError(error));
      }
      toast(esNuevo ? 'Cupón creado. Ya puedes generar su QR con el botón «QR».' : 'Cupón actualizado.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
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
        ? (await sb().from('oms_ofertas').insert(envio)).error
        : (await sb().from('oms_ofertas').update(envio).eq('id', oferta.id)).error;
      if (error) throw new Error(mensajeError(error));
      toast(esNueva ? 'Oferta creada.' : 'Oferta actualizada.');
      cerrar();
      alGuardar();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
