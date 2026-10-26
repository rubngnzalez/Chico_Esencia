// Pedidos: tabla con estados, cambio de estado (admin) y detalle con líneas.
// Los pedidos se crean desde la Edge Function «pagos-firma» (o el Worker);
// aquí solo se leen y se cambia el estado (solo admin, vía RLS).
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, euro, fechaHora, toast, abrirModal, badgeEstado, etiquetaVacia } from '../api.js';

const ESTADOS = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];

let filtroEstado = '';

export default async function (contenedor, contexto) {
  const esAdmin = contexto.usuario.rol === 'admin';

  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <label class="texto-suave" for="filtro-estado">Estado:</label>
      <select id="filtro-estado" class="selector-filtro">
        <option value="">Todos</option>
        ${ESTADOS.map((e) => `<option value="${e}" ${filtroEstado === e ? 'selected' : ''}>${e.charAt(0).toUpperCase() + e.slice(1)}</option>`).join('')}
      </select>
      ${esAdmin ? '<span class="texto-suave">El cambio de estado es inmediato.</span>' : '<span class="texto-suave">Solo la administración puede cambiar el estado.</span>'}
    </div>
    <div id="zona-pedidos" class="zona-tabla"><p class="cargando">Cargando pedidos…</p></div>`;

  const zona = contenedor.querySelector('#zona-pedidos');
  let pedidos = [];
  const lineasPorPedido = new Map();

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando pedidos…</p>';
    try {
      let consulta = sb().from('pedidos').select('*').order('creado_en', { ascending: false }).limit(300);
      if (filtroEstado) consulta = consulta.eq('estado', filtroEstado);
      pedidos = (await asegurar(consulta)) || [];
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los pedidos: ${error.message}`);
    }
  }

  async function lineasDe(pedido) {
    if (lineasPorPedido.has(pedido.id)) return lineasPorPedido.get(pedido.id);
    const lineas = (await asegurar(sb().from('pedidos_lineas').select('*').eq('pedido', pedido.id).order('creado_en'))) || [];
    lineasPorPedido.set(pedido.id, lineas);
    return lineas;
  }

  function nombreCliente(pedido) {
    const cliente = pedido.cliente || {};
    return [cliente.nombre, cliente.apellidos].filter(Boolean).join(' ') || cliente.email || '—';
  }

  function pintar() {
    if (!pedidos.length) {
      zona.innerHTML = etiquetaVacia('No hay pedidos con este filtro. Se crean solos cuando la web firma un pago.');
      return;
    }
    zona.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th class="alineado-derecha">Detalle</th></tr></thead>
        <tbody>
          ${pedidos.map((p) => `
          <tr data-id="${escapar(p.id)}">
            <td><strong>${escapar(p.numero)}</strong></td>
            <td class="texto-suave">${fechaHora(p.creado_en)}</td>
            <td>${escapar(nombreCliente(p))}<br><span class="texto-suave">${escapar(p.cliente?.email || '')}</span></td>
            <td><strong>${euro(p.total)}</strong></td>
            <td>
              ${esAdmin
                ? `<select class="selector-estado" data-accion="estado">
                    ${ESTADOS.map((e) => `<option value="${e}" ${p.estado === e ? 'selected' : ''}>${e.charAt(0).toUpperCase() + e.slice(1)}</option>`).join('')}
                   </select>`
                : badgeEstado(p.estado)}
            </td>
            <td class="alineado-derecha"><button class="boton boton-fantasma boton-pequeno" data-accion="detalle" type="button">Ver</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`;
  }

  zona.addEventListener('change', async (evento) => {
    const selector = evento.target.closest('select[data-accion="estado"]');
    if (!selector) return;
    const pedido = pedidos.find((p) => p.id === selector.closest('tr').dataset.id);
    if (!pedido) return;
    try {
      const error = (await sb().from('pedidos').update({ estado: selector.value }).eq('id', pedido.id)).error;
      if (error) throw new Error(mensajeError(error));
      pedido.estado = selector.value;
      toast(`Pedido ${pedido.numero}: estado «${selector.value}».`);
    } catch (error) {
      toast(error.message, 'error');
      cargar();
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion="detalle"]');
    if (!boton) return;
    const pedido = pedidos.find((p) => p.id === boton.closest('tr').dataset.id);
    if (!pedido) return;
    const lineas = await lineasDe(pedido);
    abrirDetalle(pedido, lineas);
  });

  contenedor.querySelector('#filtro-estado').addEventListener('change', (evento) => {
    filtroEstado = evento.target.value;
    cargar();
  });

  await cargar();
}

function abrirDetalle(pedido, lineas) {
  const cliente = pedido.cliente || {};
  const direccion = [cliente.direccion, cliente.cp, cliente.poblacion, cliente.provincia].filter(Boolean).join(', ');
  const respuesta = pedido.respuesta_redsys;
  abrirModal(`Pedido ${pedido.numero}`, `
    <article class="detalle-pedido">
      <p class="texto-suave">Creado el ${fechaHora(pedido.creado_en)} · ${badgeEstado(pedido.estado)} · Método: ${escapar(pedido.metodo || '—')}</p>
      <dl class="detalle-datos">
        <div><dt>Cliente</dt><dd>${escapar([cliente.nombre, cliente.apellidos].filter(Boolean).join(' ') || '—')}</dd></div>
        <div><dt>Email</dt><dd>${escapar(cliente.email || '—')}</dd></div>
        ${cliente.telefono ? `<div><dt>Teléfono</dt><dd>${escapar(cliente.telefono)}</dd></div>` : ''}
        ${direccion ? `<div><dt>Envío</dt><dd>${escapar(direccion)}</dd></div>` : ''}
        ${pedido.pagado_en ? `<div><dt>Pagado el</dt><dd>${fechaHora(pedido.pagado_en)}</dd></div>` : ''}
        ${respuesta ? `<div><dt>Redsys</dt><dd>respuesta ${escapar(String(respuesta.respuesta ?? '—'))} · autorización ${escapar(String(respuesta.autorizacion ?? '—'))}</dd></div>` : ''}
      </dl>
      <table class="tabla tabla-compacta">
        <thead><tr><th>Artículo</th><th>Cantidad</th><th>Precio</th><th>Importe</th></tr></thead>
        <tbody>
          ${lineas.map((a) => `
          <tr>
            <td>${escapar(a.nombre)}${a.codigo ? ` <span class="texto-suave">(${escapar(a.codigo)})</span>` : ''}</td>
            <td>${a.cantidad}</td>
            <td>${euro(a.precio_unitario)}</td>
            <td>${euro((a.precio_unitario || 0) * (a.cantidad || 0))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="totales-pedido">
        Subtotal: ${euro(pedido.subtotal)} · Envío: ${euro(pedido.envio)} · <strong>Total: ${euro(pedido.total)}</strong>
      </p>
      <p class="texto-suave">Los correos automáticos de este pedido (confirmación, agradecimiento y aviso interno) viven en la tabla
      outbox: descárgalos como .eml desde <em>Email marketing → Bandeja de salida</em>.</p>
    </article>`, '36rem');
}
