// Etiquetas de envío: lista de pedidos y generación de la etiqueta de
// impresión con los datos de contacto y envío del cliente. La impresión se
// abre en una ventana propia (A6) para que en el papel solo salga la etiqueta.
// El botón «Imprimir etiqueta» del detalle de Pedidos usa este mismo módulo.
import { sb, asegurar } from '../bd.js';
import { escapar, euro, fechaCorta, toast, abrirModal, etiquetaVacia } from '../api.js';

const ESTADOS = ['pagado', 'enviado', 'pendiente', 'entregado', 'cancelado'];
let filtroEstado = 'pagado';
let remitenteCache = null;

// Datos del remitente (la tienda) desde Ajustes; si no hay conexión o el rol
// no puede leer ajustes, se usa el nombre por defecto y se dejan en blanco
// la dirección y el teléfono.
export async function remitenteActual() {
  if (remitenteCache) return remitenteCache;
  const porDefecto = {
    nombre: 'SHADDAI · Esencia de Umbral',
    direccion: '',
    telefono: '',
    email: '',
  };
  try {
    const fila = await asegurar(sb().from('oms_ajustes').select('contacto, redsys').eq('id', 'general').single());
    const contacto = fila?.contacto || {};
    remitenteCache = {
      nombre: String(fila?.redsys?.nombreComercio || porDefecto.nombre),
      direccion: String(contacto.direccion || ''),
      telefono: String(contacto.telefono || ''),
      email: Array.isArray(contacto.emailsDestino) ? String(contacto.emailsDestino[0] || '') : '',
    };
  } catch {
    remitenteCache = porDefecto;
  }
  return remitenteCache;
}

function lineasTexto(lineas) {
  return (lineas || [])
    .map((a) => `${a.cantidad}× ${a.nombre}`)
    .filter(Boolean)
    .join(' · ');
}

// HTML interior de la etiqueta (compartido por la vista previa y la impresión)
export function cuerpoEtiqueta(pedido, lineas, rem) {
  const cliente = pedido.cliente || {};
  const remitenteLineas = [
    rem.nombre,
    rem.direccion,
    [rem.telefono, rem.email].filter(Boolean).join(' · '),
  ].filter(Boolean);

  return `
    <div class="etq-remitente">
      ${remitenteLineas.map((linea) => `<div>${escapar(linea)}</div>`).join('')}
    </div>
    <div class="etq-destinatario">
      <div class="etq-rotulo">Destinatario</div>
      <div class="etq-nombre">${escapar([cliente.nombre, cliente.apellidos].filter(Boolean).join(' ') || '—')}</div>
      ${cliente.direccion ? `<div class="etq-linea">${escapar(cliente.direccion)}</div>` : ''}
      <div class="etq-linea etq-poblacion">${escapar([cliente.cp, cliente.poblacion].filter(Boolean).join(' '))}${cliente.provincia ? ` (${escapar(cliente.provincia)})` : ''}</div>
      ${cliente.pais && cliente.pais !== 'España' ? `<div class="etq-linea etq-pais">${escapar(cliente.pais.toUpperCase())}</div>` : ''}
      ${cliente.telefono ? `<div class="etq-linea">Tel. ${escapar(cliente.telefono)}</div>` : ''}
      ${cliente.email ? `<div class="etq-linea etq-email">${escapar(cliente.email)}</div>` : ''}
    </div>
    <div class="etq-pie">
      <div class="etq-pedido"><strong>Pedido ${escapar(pedido.numero)}</strong> · ${fechaCorta(pedido.creado_en)}</div>
      ${lineasTexto(lineas) ? `<div class="etq-contenido">${escapar(lineasTexto(lineas))}</div>` : ''}
    </div>`;
}

// Abre la ventana de impresión: papel A6 (105 × 148 mm), solo la etiqueta
export function imprimirEtiqueta(pedido, lineas, rem) {
  const documento = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>Etiqueta ${escapar(pedido.numero)}</title>
<style>
  @page { size: 105mm 148mm; margin: 5mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000;
    font-family: Arial, Helvetica, sans-serif; }
  .etiqueta { width: 93mm; min-height: 136mm; border: 1.5px solid #000;
    padding: 5mm; display: flex; flex-direction: column;
    justify-content: space-between; gap: 4mm; }
  .etq-remitente { font-size: 8.5pt; color: #333; border-bottom: 1px solid #999;
    padding-bottom: 3mm; }
  .etq-destinatario { font-size: 12pt; line-height: 1.45; }
  .etq-rotulo { font-size: 8.5pt; letter-spacing: .18em; text-transform: uppercase;
    color: #333; margin-bottom: 2mm; }
  .etq-nombre { font-weight: bold; font-size: 14pt; margin-bottom: 2mm; }
  .etq-linea { margin: 0.5mm 0; }
  .etq-poblacion { font-weight: bold; }
  .etq-pais { font-weight: bold; letter-spacing: 0.08em; }
  .etq-email { font-size: 9.5pt; color: #222; word-break: break-all; }
  .etq-pie { border-top: 1px solid #999; padding-top: 3mm; font-size: 9pt; }
  .etq-contenido { margin: 1mm 0; }
  .no-imprimir { text-align: center; margin: 6mm 0 0; font-size: 9pt; color: #444; }
  .no-imprimir button { font-size: 10pt; padding: 2mm 6mm; cursor: pointer; }
  @media print { .no-imprimir { display: none; } .etiqueta { border-width: 1.5pt; } }
</style></head>
<body>
  <div class="etiqueta">${cuerpoEtiqueta(pedido, lineas, rem)}</div>
  <p class="no-imprimir"><button type="button" onclick="window.print()">Imprimir de nuevo</button>
  — papel A6 · 105 × 148 mm · se imprime solo al abrir</p>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 350); });<\/script>
</body></html>`;

  const ventana = window.open('', '_blank', 'width=520,height=780');
  if (!ventana) {
    toast('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio.', 'error');
    return;
  }
  ventana.document.open();
  ventana.document.write(documento);
  ventana.document.close();
}

export default async function (contenedor, contexto) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <label class="texto-suave" for="filtro-estado-etiquetas">Estado:</label>
      <select id="filtro-estado-etiquetas" class="selector-filtro">
        <option value="">Todos</option>
        ${ESTADOS.map((e) => `<option value="${e}" ${filtroEstado === e ? 'selected' : ''}>${e.charAt(0).toUpperCase() + e.slice(1)}</option>`).join('')}
      </select>
      <span class="texto-suave">Pulsa «Etiqueta» para previsualizar e imprimir el contacto y el envío (A6).</span>
    </div>
    <div id="zona-etiquetas" class="zona-tabla"><p class="cargando">Cargando pedidos…</p></div>`;

  const zona = contenedor.querySelector('#zona-etiquetas');
  let pedidos = [];
  const rem = await remitenteActual();

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando pedidos…</p>';
    try {
      let consulta = sb().from('oms_pedidos').select('*').order('creado_en', { ascending: false }).limit(300);
      if (filtroEstado) consulta = consulta.eq('estado', filtroEstado);
      pedidos = (await asegurar(consulta)) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los pedidos: ${error.message}`);
    }
  }

  function nombreCliente(pedido) {
    const cliente = pedido.cliente || {};
    return [cliente.nombre, cliente.apellidos].filter(Boolean).join(' ') || cliente.email || '—';
  }

  function destino(pedido) {
    const cliente = pedido.cliente || {};
    return [cliente.cp, cliente.poblacion].filter(Boolean).join(' ') || '—';
  }

  function pintar() {
    if (!pedidos.length) {
      zona.innerHTML = etiquetaVacia('No hay pedidos con este filtro.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Destino</th><th>Total</th><th>Estado</th><th class="alineado-derecha">Etiqueta</th></tr></thead>
        <tbody>
          ${pedidos.map((p) => `
          <tr data-id="${escapar(p.id)}">
            <td><strong>${escapar(p.numero)}</strong></td>
            <td class="texto-suave">${fechaCorta(p.creado_en)}</td>
            <td>${escapar(nombreCliente(p))}<br><span class="texto-suave">${escapar(p.cliente?.email || '')}</span></td>
            <td class="texto-suave">${escapar(destino(p))}</td>
            <td><strong>${euro(p.total)}</strong></td>
            <td class="texto-suave">${escapar(p.estado || '—')}</td>
            <td class="alineado-derecha"><button class="boton boton-fantasma boton-pequeno" data-accion="etiqueta" type="button">Etiqueta</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  async function lineasDe(pedido) {
    try {
      return (await asegurar(sb().from('oms_pedidos_lineas').select('*').eq('pedido', pedido.id).order('creado_en'))) || [];
    } catch {
      return [];
    }
  }

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion="etiqueta"]');
    if (!boton) return;
    const pedido = pedidos.find((p) => p.id === boton.closest('tr').dataset.id);
    if (!pedido) return;
    const lineas = await lineasDe(pedido);
    abrirVista(pedido, lineas, rem);
  });

  contenedor.querySelector('#filtro-estado-etiquetas').addEventListener('change', (evento) => {
    filtroEstado = evento.target.value;
    cargar();
  });

  await cargar();
}

// Vista previa en modal + botón de impresión
export function abrirVista(pedido, lineas, rem) {
  const { cerrar, cuerpo } = abrirModal(`Etiqueta · ${pedido.numero}`, `
    <div class="etiqueta-prev">${cuerpoEtiqueta(pedido, lineas, rem)}</div>
    <p class="texto-suave" style="margin:.8rem 0 0;">Se imprime en A6 (105 × 148 mm). Comprueba que el destino no quede cortado en tu plantilla de etiquetas.</p>
    <div class="modal-acciones">
      <button type="button" class="boton boton-fantasma" data-cancelar>Cerrar</button>
      <button type="button" class="boton boton-primario" data-imprimir>Imprimir etiqueta</button>
    </div>`, '24rem');

  cuerpo.querySelector('[data-cancelar]').addEventListener('click', cerrar);
  cuerpo.querySelector('[data-imprimir]').addEventListener('click', () => imprimirEtiqueta(pedido, lineas, rem));
}
