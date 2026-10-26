// Panel: resumen con datos reales y accesos directos (contadores con Supabase).
import { sb, asegurar, mensajeError } from '../bd.js';
import { escapar, euro, fechaCorta, fechaHora, badgeEstado, toast } from '../api.js';

const TODOS = ['admin', 'editor', 'lector'];

export default async function (contenedor, contexto) {
  const esGestion = ['admin', 'editor'].includes(contexto.usuario.rol);
  contenedor.innerHTML = '<p class="cargando">Cargando datos del panel…</p>';

  // Conteo exacto sin traer filas (head: true): el count llega junto al error
  const contar = async (tabla, filtros = {}) => {
    let consulta = sb().from(tabla).select('id', { count: 'exact', head: true });
    for (const [campo, valor] of Object.entries(filtros)) consulta = consulta.eq(campo, valor);
    const { count, error } = await consulta;
    if (error) throw new Error(mensajeError(error));
    return Number(count) || 0;
  };

  const resultados = await Promise.allSettled([
    contar('pedidos', { estado: 'pendiente' }),
    contar('mensajes', { leido: false, archivado: false }),
    contar('productos'),
    contar('productos', { activo: true }),
    esGestion ? contar('suscriptores') : Promise.reject(new Error('sin permiso')),
    esGestion ? asegurar(sb().from('campanas').select('id, asunto, estado, enviada_en, creado_en').order('creado_en', { ascending: false }).limit(4)) : Promise.reject(new Error('sin permiso')),
    asegurar(sb().from('pedidos').select('id, numero, cliente, total, estado, creado_en').order('creado_en', { ascending: false }).limit(1)),
  ]);

  const pendientes = resultados[0].status === 'fulfilled' ? resultados[0].value : 0;
  const sinLeer = resultados[1].status === 'fulfilled' ? resultados[1].value : 0;
  const totalProductos = resultados[2].status === 'fulfilled' ? resultados[2].value : 0;
  const activos = resultados[3].status === 'fulfilled' ? resultados[3].value : 0;
  const totalSuscriptores = resultados[4].status === 'fulfilled' ? resultados[4].value : null;
  const campanas = resultados[5].status === 'fulfilled' ? resultados[5].value : null;
  const ultimo = (resultados[6].status === 'fulfilled' ? resultados[6].value : [])[0] || null;

  const tarjeta = (etiqueta, valorTarjeta, detalle) => `
    <article class="tarjeta-dato">
      <p class="tarjeta-valor">${valorTarjeta}</p>
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
      ${tarjeta('Pedidos pendientes', pendientes, pendientes ? 'Revisa la sección Pedidos' : 'Todo al día')}
      ${tarjeta('Mensajes sin leer', sinLeer, sinLeer ? 'En la bandeja de entrada' : 'Bandeja vacía')}
      ${totalSuscriptores !== null ? tarjeta('Suscriptores', totalSuscriptores, 'Del Boletín del Umbral') : ''}
      ${tarjeta('Productos activos', `${activos}<span class="tarjeta-suave"> / ${totalProductos}</span>`, 'En la tienda pública')}
    </div>

    <div class="panel-columnas">
      <article class="tarjeta">
        <h2 class="tarjeta-titulo">Último pedido</h2>
        ${ultimo ? `
          <p class="pedido-numero">${escapar(ultimo.numero)}</p>
          <p class="pedido-cliente">${escapar([ultimo.cliente?.nombre, ultimo.cliente?.apellidos].filter(Boolean).join(' ') || 'Sin nombre')} · ${escapar(ultimo.cliente?.email || '')}</p>
          <p class="pedido-total">${euro(ultimo.total)} · ${fechaCorta(ultimo.creado_en)} ${badgeEstado(ultimo.estado)}</p>`
        : '<p class="estado-vacio">Todavía no hay pedidos.</p>'}
        <button class="boton boton-fantasma boton-ir-pedidos" type="button">Ver pedidos</button>
      </article>

      ${campanas !== null ? `
      <article class="tarjeta">
        <h2 class="tarjeta-titulo">Últimas campañas</h2>
        ${campanas.length ? `<ul class="lista-resumen">${campanas.slice(0, 4).map((c) => `
          <li><span class="lista-asunto">${escapar(c.asunto)}</span>${badgeEstado(c.estado)}<span class="lista-fecha">${fechaHora(c.enviada_en || c.creado_en)}</span></li>`).join('')}</ul>`
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
  if (resultados.some((r) => r.status === 'rejected' && r.reason?.message !== 'sin permiso')) {
    toast('Algunos datos del resumen no se pudieron leer.', 'error');
  }
}
