// Pedidos: tabla con estados, cambio de estado (admin) y detalle de líneas.
import { pedir, escapar, euro, fechaHora, toast, abrirModal, badgeEstado, etiquetaVacia } from '../api.js';

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

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando pedidos…</p>';
    try {
      const datos = await pedir(`/api/pedidos${filtroEstado ? `?estado=${filtroEstado}` : ''}`);
      pedidos = datos.datos;
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los pedidos: ${error.message}`);
    }
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
        <thead><tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Artículos</th><th>Total</th><th>Estado</th><th class="alineado-derecha">Detalle</th></tr></thead>
        <tbody>
          ${pedidos.map((p) => `
          <tr data-id="${escapar(p.id)}">
            <td><strong>${escapar(p.numero)}</strong></td>
            <td class="texto-suave">${fechaHora(p.fecha)}</td>
            <td>${escapar(nombreCliente(p))}<br><span class="texto-suave">${escapar(p.cliente?.email || '')}</span></td>
            <td class="texto-suave">${(p.articulos || []).reduce((suma, a) => suma + (a.cantidad || 0), 0)}</td>
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
      await pedir(`/api/pedidos/${pedido.id}/estado`, { method: 'PUT', cuerpo: { estado: selector.value } });
      pedido.estado = selector.value;
      toast(`Pedido ${pedido.numero}: estado «${selector.value}».`);
    } catch (error) {
      toast(error.message, 'error');
      cargar();
    }
  });

  zona.addEventListener('click', (evento) => {
    const boton = evento.target.closest('button[data-accion="detalle"]');
    if (!boton) return;
    const pedido = pedidos.find((p) => p.id === boton.closest('tr').dataset.id);
    if (pedido) abrirDetalle(pedido);
  });

  contenedor.querySelector('#filtro-estado').addEventListener('change', (evento) => {
    filtroEstado = evento.target.value;
    cargar();
  });

  await cargar();
}

function abrirDetalle(pedido) {
  const cliente = pedido.cliente || {};
  const direccion = [cliente.direccion, cliente.cp, cliente.poblacion, cliente.provincia].filter(Boolean).join(', ');
  abrirModal(`Pedido ${pedido.numero}`, `
    <article class="detalle-pedido">
      <p class="texto-suave">Creado el ${fechaHora(pedido.fecha)} · ${badgeEstado(pedido.estado)} · Método: ${escapar(pedido.metodo || '—')}</p>
      <dl class="detalle-datos">
        <div><dt>Cliente</dt><dd>${escapar([cliente.nombre, cliente.apellidos].filter(Boolean).join(' ') || '—')}</dd></div>
        <div><dt>Email</dt><dd>${escapar(cliente.email || '—')}</dd></div>
        ${cliente.telefono ? `<div><dt>Teléfono</dt><dd>${escapar(cliente.telefono)}</dd></div>` : ''}
        ${direccion ? `<div><dt>Envío</dt><dd>${escapar(direccion)}</dd></div>` : ''}
        ${pedido.pagadoEn ? `<div><dt>Pagado el</dt><dd>${fechaHora(pedido.pagadoEn)}</dd></div>` : ''}
        ${pedido.respuestaRedsys ? `<div><dt>Redsys</dt><dd>respuesta ${escapar(String(pedido.respuestaRedsys.respuesta ?? '—'))} · autorización ${escapar(String(pedido.respuestaRedsys.autorizacion ?? '—'))}</dd></div>` : ''}
      </dl>
      <table class="tabla tabla-compacta">
        <thead><tr><th>Artículo</th><th>Cantidad</th><th>Precio</th><th>Importe</th></tr></thead>
        <tbody>
          ${(pedido.articulos || []).map((a) => `
          <tr>
            <td>${escapar(a.nombre)}${a.codigo ? ` <span class="texto-suave">(${escapar(a.codigo)})</span>` : ''}</td>
            <td>${a.cantidad}</td>
            <td>${euro(a.precioUnitario)}</td>
            <td>${euro((a.precioUnitario || 0) * (a.cantidad || 0))}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="totales-pedido">
        Subtotal: ${euro(pedido.subtotal)} · Envío: ${euro(pedido.envio)} · <strong>Total: ${euro(pedido.total)}</strong>
      </p>
    </article>`, '36rem');
}
