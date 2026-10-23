// Panel: resumen con datos reales y accesos directos.
import { pedir, escapar, euro, fechaCorta, fechaHora, badgeEstado } from '../api.js';

const TODOS = ['admin', 'editor', 'lector'];

export default async function (contenedor, contexto) {
  const esGestion = ['admin', 'editor'].includes(contexto.usuario.rol);
  contenedor.innerHTML = '<p class="cargando">Cargando datos del panel…</p>';

  const [pedidosR, mensajesR, productosR, suscriptoresR, campanasR] = await Promise.allSettled([
    pedir('/api/pedidos'),
    pedir('/api/mensajes?estado=noleidos'),
    pedir('/api/productos'),
    esGestion ? pedir('/api/suscriptores') : Promise.reject(new Error('sin permiso')),
    esGestion ? pedir('/api/campanas') : Promise.reject(new Error('sin permiso')),
  ]);

  const pedidos = pedidosR.status === 'fulfilled' ? pedidosR.value.datos : [];
  const sinLeer = mensajesR.status === 'fulfilled' ? mensajesR.value.totalNoLeidos || 0 : 0;
  const productos = productosR.status === 'fulfilled' ? productosR.value.datos : [];
  const suscriptores = suscriptoresR.status === 'fulfilled' ? suscriptoresR.value.datos : null;
  const campanas = campanasR.status === 'fulfilled' ? campanasR.value.datos : null;

  const pendientes = pedidos.filter((p) => p.estado === 'pendiente');
  const activos = productos.filter((p) => p.activo !== false);
  const ultimo = pedidos[0] || null;

  const tarjeta = (etiqueta, valor, detalle) => `
    <article class="tarjeta-dato">
      <p class="tarjeta-valor">${valor}</p>
      <p class="tarjeta-etiqueta">${escapar(etiqueta)}</p>
      ${detalle ? `<p class="tarjeta-detalle">${detalle}</p>` : ''}
    </article>`;

  const accesos = [
    { clave: 'productos', texto: 'Productos', roles: TODOS },
    { clave: 'ofertas', texto: 'Ofertas', roles: ['admin', 'editor'] },
    { clave: 'blog', texto: 'Escribir en el blog', roles: TODOS },
    { clave: 'email', texto: 'Campañas', roles: ['admin', 'editor'] },
    { clave: 'bandeja', texto: 'Mensajes', roles: TODOS },
    { clave: 'pedidos', texto: 'Pedidos', roles: TODOS },
  ].filter((a) => a.roles.includes(contexto.usuario.rol));

  contenedor.innerHTML = `
    <div class="cuadricula-tarjetas">
      ${tarjeta('Pedidos pendientes', pendientes.length, pendientes.length ? 'Revisa la sección Pedidos' : 'Todo al día')}
      ${tarjeta('Mensajes sin leer', sinLeer, sinLeer ? 'En la bandeja de entrada' : 'Bandeja vacía')}
      ${suscriptores !== null ? tarjeta('Suscriptores', suscriptores.length, 'Del Boletín del Umbral') : ''}
      ${tarjeta('Productos activos', `${activos.length}<span class="tarjeta-suave"> / ${productos.length}</span>`, 'En la tienda pública')}
    </div>

    <div class="panel-columnas">
      <article class="tarjeta">
        <h2 class="tarjeta-titulo">Último pedido</h2>
        ${ultimo ? `
          <p class="pedido-numero">${escapar(ultimo.numero)}</p>
          <p class="pedido-cliente">${escapar([ultimo.cliente?.nombre, ultimo.cliente?.apellidos].filter(Boolean).join(' ') || 'Sin nombre')} · ${escapar(ultimo.cliente?.email || '')}</p>
          <p class="pedido-total">${euro(ultimo.total)} · ${fechaCorta(ultimo.fecha)} ${badgeEstado(ultimo.estado)}</p>`
        : '<p class="estado-vacio">Todavía no hay pedidos.</p>'}
        <button class="boton boton-fantasma boton-ir-pedidos" type="button">Ver pedidos</button>
      </article>

      ${campanas !== null ? `
      <article class="tarjeta">
        <h2 class="tarjeta-titulo">Últimas campañas</h2>
        ${campanas.length ? `<ul class="lista-resumen">${campanas.slice(0, 4).map((c) => `
          <li><span class="lista-asunto">${escapar(c.asunto)}</span>${badgeEstado(c.estado)}<span class="lista-fecha">${fechaHora(c.enviadaEn || c.creadaEn)}</span></li>`).join('')}</ul>`
        : '<p class="estado-vacio">Sin campañas todavía.</p>'}
        <button class="boton boton-fantasma boton-ir-email" type="button">Ir a Email marketing</button>
      </article>` : ''}

      <article class="tarjeta">
        <h2 class="tarjeta-titulo">Accesos directos</h2>
        <div class="nuvol-accesos">
          ${accesos.map((a) => `<button class="boton boton-fantasma" data-ir="${a.clave}" type="button">${escapar(a.texto)}</button>`).join('')}
        </div>
      </article>
    </div>`;

  contenedor.querySelector('.boton-ir-pedidos')?.addEventListener('click', () => contexto.irA('pedidos'));
  contenedor.querySelector('.boton-ir-email')?.addEventListener('click', () => contexto.irA('email'));
  contenedor.querySelectorAll('[data-ir]').forEach((boton) => {
    boton.addEventListener('click', () => contexto.irA(boton.dataset.ir));
  });
}
