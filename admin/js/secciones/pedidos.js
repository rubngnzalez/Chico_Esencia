// Pedidos: tabla con estados, cambio de estado (admin) y detalle con líneas.
// Los pedidos se crean desde la Edge Function «pagos-firma» (o el Worker);
// aquí solo se leen y se cambia el estado (solo admin, vía RLS).
// Al pasar a «enviado» se pide enlace/plazo de seguimiento y al pasar a
// «entregado» se confirman los correos post-venta (trigger oms_seguimientos).
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, euro, fechaHora, toast, abrirModal, confirmar, badgeEstado, etiquetaVacia, descargarEml } from '../api.js';
import { imprimirEtiqueta, remitenteActual } from './etiquetas.js';

const ESTADOS = ['pendiente', 'pagado', 'enviado', 'entregado', 'cancelado'];

const ETIQUETAS_SEGUIMIENTO = {
  envio: 'En camino',
  cuidado: 'Consejos de uso',
  opinion: 'Petición de opinión',
};

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
  const unidadesPorPedido = new Map();

  async function cargar() {
    zona.innerHTML = '<p class="cargando">Cargando pedidos…</p>';
    try {
      let consulta = sb().from('oms_pedidos').select('*').order('creado_en', { ascending: false }).limit(300);
      if (filtroEstado) consulta = consulta.eq('estado', filtroEstado);
      pedidos = (await asegurar(consulta)) || [];
      await contarUnidades();
      pintar();
    } catch (error) {
      zona.innerHTML = etiquetaVacia(`No se pudieron cargar los pedidos: ${error.message}`);
    }
  }

  // Unidades por pedido (columna «Artículos») con una sola lectura de líneas
  async function contarUnidades() {
    unidadesPorPedido.clear();
    if (!pedidos.length) return;
    try {
      const lineas = (await asegurar(
        sb().from('oms_pedidos_lineas').select('pedido, cantidad').in('pedido', pedidos.map((p) => p.id))
      )) || [];
      for (const linea of lineas) {
        unidadesPorPedido.set(linea.pedido, (unidadesPorPedido.get(linea.pedido) || 0) + (linea.cantidad || 0));
      }
    } catch {}
  }

  const unidadesDe = (pedido) => unidadesPorPedido.get(pedido.id) || 0;

  async function lineasDe(pedido) {
    if (lineasPorPedido.has(pedido.id)) return lineasPorPedido.get(pedido.id);
    const lineas = (await asegurar(sb().from('oms_pedidos_lineas').select('*').eq('pedido', pedido.id).order('creado_en'))) || [];
    lineasPorPedido.set(pedido.id, lineas);
    return lineas;
  }

  // Correos automáticos asociados al pedido (outbox): descargables como .eml
  async function correosDe(pedido) {
    try {
      return (await asegurar(
        sb().from('oms_outbox').select('id, asunto, estado, creado_en, eml').eq('ref_pedido', pedido.numero).order('creado_en')
      )) || [];
    } catch {
      return [];
    }
  }

  // Correos post-venta programados para este pedido (seguimiento)
  async function seguimientosDe(pedido) {
    try {
      return (await asegurar(
        sb().from('oms_seguimientos').select('*').eq('pedido', pedido.id).order('creado_en')
      )) || [];
    } catch {
      return [];
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
            <td class="texto-suave">${fechaHora(p.creado_en)}</td>
            <td>${escapar(nombreCliente(p))}<br><span class="texto-suave">${escapar(p.cliente?.email || '')}</span></td>
            <td class="texto-suave">${unidadesDe(p)}</td>
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

  // Guarda el estado (y las columnas de seguimiento que lleguen) y avisa
  async function guardarEstado(pedido, estado, camposExtra = {}) {
    const error = (await sb().from('oms_pedidos').update({ estado, ...camposExtra }).eq('id', pedido.id)).error;
    if (error) throw new Error(mensajeError(error));
    Object.assign(pedido, { estado, ...camposExtra });
    toast(`Pedido ${pedido.numero}: estado «${estado}».`);
  }

  // Estado «enviado»: pide enlace de seguimiento y plazo antes de guardar
  function flujoEnviado(pedido) {
    return new Promise((resolver) => {
      const modal = abrirModal(`Pedido ${pedido.numero} · En camino`, `
        <form class="formulario">
          <p class="texto-suave">Al guardar se programa el correo «Tu pedido ya va en camino» con estos datos.
          Cuando lo marques como <strong>entregado</strong> se programarán los correos de consejos y de opinión.</p>
          <label>Enlace de seguimiento del transporte (opcional)</label>
          <input name="seguimientoUrl" type="url" placeholder="https://…" value="${escapar(pedido.seguimiento_url || '')}">
          <label>Tiempo estimado de entrega (texto libre)</label>
          <input name="plazoEntrega" maxlength="80" placeholder="p. ej. 2-3 días" value="${escapar(pedido.plazo_entrega || '')}">
          <div class="modal-acciones">
            <button type="button" class="boton boton-fantasma" data-cancelar>Cancelar</button>
            <button type="submit" class="boton boton-primario">Guardar y marcar enviado</button>
          </div>
        </form>`, '30rem');

      const cerrar = (valor) => { modal.cerrar(); resolver(valor); };
      modal.cuerpo.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(false));
      const formulario = modal.cuerpo.querySelector('form');
      formulario.addEventListener('submit', async (evento) => {
        evento.preventDefault();
        try {
          await guardarEstado(pedido, 'enviado', {
            seguimiento_url: formulario.elements.seguimientoUrl.value.trim(),
            plazo_entrega: formulario.elements.plazoEntrega.value.trim(),
          });
          pintar();
          cerrar(true);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    });
  }

  // Estado «entregado»: avisa de los correos que se van a programar
  async function flujoEntregado(pedido) {
    const seguro = await confirmar(
      'Marcar entregado',
      `Pedido ${pedido.numero}: al confirmar se programan los correos de «consejos de uso» y de «opinión» (los días de espera se configuran en Ajustes → Emails automáticos).`,
      'Marcar entregado'
    );
    if (!seguro) return;
    await guardarEstado(pedido, 'entregado', {});
    pintar();
  }

  zona.addEventListener('change', async (evento) => {
    const selector = evento.target.closest('select[data-accion="estado"]');
    if (!selector) return;
    const pedido = pedidos.find((p) => p.id === selector.closest('tr').dataset.id);
    if (!pedido) return;
    const nuevoEstado = selector.value;
    selector.value = pedido.estado; // se restaura hasta que el flujo confirme
    try {
      if (nuevoEstado === 'enviado') {
        await flujoEnviado(pedido);
      } else if (nuevoEstado === 'entregado') {
        await flujoEntregado(pedido);
      } else {
        await guardarEstado(pedido, nuevoEstado, {});
        if (nuevoEstado === 'cancelado') pintar();
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  zona.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-accion="detalle"]');
    if (!boton) return;
    const pedido = pedidos.find((p) => p.id === boton.closest('tr').dataset.id);
    if (!pedido) return;
    const [lineas, correos, seguimientos] = await Promise.all([
      lineasDe(pedido), correosDe(pedido), seguimientosDe(pedido),
    ]);
    abrirDetalle(pedido, lineas, correos, seguimientos, esAdmin);
  });

  contenedor.querySelector('#filtro-estado').addEventListener('change', (evento) => {
    filtroEstado = evento.target.value;
    cargar();
  });

  await cargar();
}

function abrirDetalle(pedido, lineas, correos = [], seguimientos = [], esAdmin = false) {
  const cliente = pedido.cliente || {};
  const direccion = [cliente.direccion, cliente.cp, cliente.poblacion, cliente.provincia,
    cliente.pais && cliente.pais !== 'España' ? cliente.pais : null].filter(Boolean).join(', ');
  const respuesta = pedido.respuesta_redsys;
  const modal = abrirModal(`Pedido ${pedido.numero}`, `
    <article class="detalle-pedido">
      <p class="texto-suave">Creado el ${fechaHora(pedido.creado_en)} · ${badgeEstado(pedido.estado)} · Método: ${escapar(pedido.metodo || '—')}</p>
      <dl class="detalle-datos">
        <div><dt>Cliente</dt><dd>${escapar([cliente.nombre, cliente.apellidos].filter(Boolean).join(' ') || '—')}</dd></div>
        <div><dt>Email</dt><dd>${escapar(cliente.email || '—')}</dd></div>
        ${cliente.telefono ? `<div><dt>Teléfono</dt><dd>${escapar(cliente.telefono)}</dd></div>` : ''}
        ${direccion ? `<div><dt>Envío</dt><dd>${escapar(direccion)}</dd></div>` : ''}
        ${pedido.pagado_en ? `<div><dt>Pagado el</dt><dd>${fechaHora(pedido.pagado_en)}</dd></div>` : ''}
        ${pedido.enviado_en ? `<div><dt>Enviado el</dt><dd>${fechaHora(pedido.enviado_en)}</dd></div>` : ''}
        ${pedido.entregado_en ? `<div><dt>Entregado el</dt><dd>${fechaHora(pedido.entregado_en)}</dd></div>` : ''}
        ${pedido.seguimiento_url ? `<div><dt>Seguimiento</dt><dd><a href="${escapar(pedido.seguimiento_url)}" target="_blank" rel="noopener">Ver envío</a></dd></div>` : ''}
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
      <div class="modal-acciones">
        <button class="boton boton-primario" data-etiqueta type="button">Imprimir etiqueta de envío</button>
      </div>
      <div id="zona-seguimientos"></div>
      ${correos.length ? `
      <h3 class="detalle-subtitulo">Correos de este pedido</h3>
      ${correos.map((o) => `
      <div class="barra-herramientas sin-borde" style="justify-content:space-between;">
        <span>${escapar(o.asunto || '(sin asunto)')} · ${badgeEstado(o.estado)} <span class="texto-suave">${fechaHora(o.creado_en)}</span></span>
        <button class="boton boton-fantasma boton-pequeno" data-eml="${escapar(o.id)}" type="button">Descargar .eml</button>
      </div>`).join('')}` : ''}
    </article>`, '36rem');

  // Seguimiento post-venta programado (se re-dibuja al cancelar uno)
  const zonaSeguimientos = modal.cuerpo.querySelector('#zona-seguimientos');
  const pintarSeguimientos = () => {
    if (!seguimientos.length) {
      zonaSeguimientos.innerHTML = '';
      return;
    }
    zonaSeguimientos.innerHTML = `
      <h3 class="detalle-subtitulo">Seguimiento post-venta</h3>
      ${seguimientos.map((s) => `
      <div class="barra-herramientas sin-borde" style="justify-content:space-between;">
        <span>${escapar(ETIQUETAS_SEGUIMIENTO[s.tipo] || s.tipo)} · ${badgeEstado(s.estado)}
          <span class="texto-suave">${s.estado === 'pendiente' ? `se envía el ${fechaHora(s.enviar_desde)}` : s.procesado_en ? `procesado el ${fechaHora(s.procesado_en)}` : ''}</span>
        </span>
        ${esAdmin && s.estado === 'pendiente' ? `<button class="boton boton-fantasma boton-pequeno" data-cancelar-seguimiento="${escapar(s.id)}" type="button">Cancelar</button>` : ''}
      </div>`).join('')}`;
  };
  pintarSeguimientos();

  zonaSeguimientos.addEventListener('click', async (evento) => {
    const boton = evento.target.closest('button[data-cancelar-seguimiento]');
    if (!boton) return;
    const fila = seguimientos.find((s) => s.id === boton.dataset.cancelarSeguimiento);
    if (!fila) return;
    const seguro = await confirmar('Cancelar correo', `¿Cancelar el correo «${ETIQUETAS_SEGUIMIENTO[fila.tipo] || fila.tipo}» de este pedido?`);
    if (!seguro) return;
    try {
      const error = (await sb().from('oms_seguimientos').update({ estado: 'cancelado' }).eq('id', fila.id)).error;
      if (error) throw new Error(mensajeError(error));
      fila.estado = 'cancelado';
      pintarSeguimientos();
      toast('Correo programado cancelado.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  modal.querySelectorAll('button[data-eml]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const correo = correos.find((o) => o.id === boton.dataset.eml);
      if (!correo) return;
      descargarEml(`pedido-${pedido.numero}-${(correo.asunto || 'shaddai').slice(0, 40).replace(/[^\w-]+/g, '-')}.eml`, correo.eml);
    });
  });

  const botonEtiqueta = modal.querySelector('[data-etiqueta]');
  if (botonEtiqueta) {
    botonEtiqueta.addEventListener('click', async () => {
      const rem = await remitenteActual();
      imprimirEtiqueta(pedido, lineas, rem);
    });
  }
}
