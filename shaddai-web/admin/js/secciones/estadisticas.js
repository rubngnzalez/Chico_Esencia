// Sección "Estadísticas": control de ventas de clientes y distribuidores.
// Filtros (fechas, canal, distribuidor, producto, estado), KPIs, gráficas
// (Chart.js por CDN) y export CSV de las tablas. Solo lectura: los datos
// vienen de oms_pedidos / oms_pedidos_lineas / oms_distribuidores vía RLS.
import { sb, asegurar } from '../bd.js';
import { escapar, euro, fechaCorta, etiquetaVacia } from '../api.js';

const ESTADOS_VENTA = ['pagado', 'enviado', 'entregado'];

const COLORES = {
  oro: '#c9a45f',
  oroClaro: '#e3c98f',
  verde: '#9fc7a8',
  azul: '#9db8cf',
  rojo: '#e0a593',
  crema: '#d9d4c5',
};

let rango = 'mes'; // hoy | 7dias | mes | trimestre | anio | todo | libre
let desdeLibre = '';
let hastaLibre = '';
let canal = 'todos';
let distribuidorFiltro = 'todos';
let productoFiltro = '';
let graficas = [];

function rangoFechas() {
  const hasta = new Date();
  const desde = new Date();
  if (rango === 'hoy') {
    desde.setHours(0, 0, 0, 0);
  } else if (rango === '7dias') desde.setDate(desde.getDate() - 7);
  else if (rango === 'mes') desde.setMonth(desde.getMonth() - 1);
  else if (rango === 'trimestre') desde.setMonth(desde.getMonth() - 3);
  else if (rango === 'anio') desde.setFullYear(desde.getFullYear() - 1);
  else if (rango === 'libre') {
    return { desde: desdeLibre ? new Date(`${desdeLibre}T00:00:00`) : null, hasta: hastaLibre ? new Date(`${hastaLibre}T23:59:59`) : null };
  } else return { desde: null, hasta: null };
  return { desde, hasta };
}

function destruirGraficas() {
  graficas.forEach((g) => g.destroy());
  graficas = [];
}

function descargarCsv(nombre, filas) {
  const contenido = filas
    .map((fila) => fila.map((celda) => `"${String(celda ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const blob = new Blob([`\uFEFF${contenido}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default async function (contenedor) {
  contenedor.innerHTML = `
    <div class="filtros-stats">
      <label>Rango
        <select id="st-rango">
          <option value="hoy">Hoy</option>
          <option value="7dias">Últimos 7 días</option>
          <option value="mes" selected>Último mes</option>
          <option value="trimestre">Trimestre</option>
          <option value="anio">Año</option>
          <option value="todo">Todo</option>
          <option value="libre">Personalizado</option>
        </select>
      </label>
      <label id="st-zona-libre" style="display:none;">Fechas
        <span style="display:flex;gap:.4rem;">
          <input type="date" id="st-desde"> <input type="date" id="st-hasta">
        </span>
      </label>
      <label>Canal
        <select id="st-canal">
          <option value="todos" selected>Todos</option>
          <option value="web">Clientes (web)</option>
          <option value="distribuidor">Distribuidores</option>
        </select>
      </label>
      <label>Distribuidor
        <select id="st-distribuidor"><option value="todos">Todos</option></select>
      </label>
      <label>Producto contiene
        <input type="search" id="st-producto" placeholder="Ej. Esencia">
      </label>
      <button class="boton boton-primario" id="st-refrescar" type="button">Aplicar filtros</button>
    </div>
    <div id="st-contenido"><p class="cargando">Calculando estadísticas…</p></div>`;

  const zonaLibre = contenedor.querySelector('#st-zona-libre');
  contenedor.querySelector('#st-rango').addEventListener('change', (evento) => {
    rango = evento.target.value;
    zonaLibre.style.display = rango === 'libre' ? '' : 'none';
  });
  contenedor.querySelector('#st-refrescar').addEventListener('click', pintar);

  async function pintar() {
    const contenido = contenedor.querySelector('#st-contenido');
    contenido.innerHTML = '<p class="cargando">Calculando estadísticas…</p>';
    destruirGraficas();
    try {
      const { desde, hasta } = rangoFechas();
      canal = contenedor.querySelector('#st-canal').value;
      distribuidorFiltro = contenedor.querySelector('#st-distribuidor').value;
      productoFiltro = contenedor.querySelector('#st-producto').value.trim().toLowerCase();

      let consulta = sb()
        .from('oms_pedidos')
        .select('id, numero, numero_publico, cliente, subtotal, envio, total, metodo, estado, canal, distribuidor_id, descuento_pct, creado_en, pagado_en')
        .in('estado', ESTADOS_VENTA)
        .order('creado_en', { ascending: true })
        .limit(3000);
      if (desde) consulta = consulta.gte('creado_en', desde.toISOString());
      if (hasta) consulta = consulta.lte('creado_en', hasta.toISOString());
      if (canal !== 'todos') consulta = consulta.eq('canal', canal);
      if (distribuidorFiltro !== 'todos') consulta = consulta.eq('distribuidor_id', distribuidorFiltro);

      const [pedidos, distribuidores, proformas] = await Promise.all([
        asegurar(consulta),
        asegurar(sb().from('oms_distribuidores').select('id, empresa, descuento_pct').order('empresa')),
        asegurar(
          sb()
            .from('oms_pedidos')
            .select('id, metodo, canal, estado')
            .eq('metodo', 'transferencia')
            .eq('canal', 'distribuidor')
            .in('estado', ['pendiente'])
            .limit(500)
        ),
      ]);

      const selector = contenedor.querySelector('#st-distribuidor');
      const actual = selector.value;
      selector.innerHTML =
        '<option value="todos">Todos</option>' +
        (distribuidores || []).map((d) => `<option value="${escapar(d.id)}">${escapar(d.empresa || d.id)}</option>`).join('');
      selector.value = actual;

      // Líneas de los pedidos filtrados (por lotes para no agotar la URL)
      const ids = pedidos.map((p) => p.id);
      const lineas = [];
      for (let i = 0; i < ids.length; i += 150) {
        const lote = (await asegurar(
          sb().from('oms_pedidos_lineas').select('pedido, codigo, nombre, cantidad, precio_unitario').in('pedido', ids.slice(i, i + 150)).limit(2000)
        )) || [];
        lineas.push(...lote);
      }

      const lineasPorPedido = {};
      lineas.forEach((l) => {
        (lineasPorPedido[l.pedido] = lineasPorPedido[l.pedido] || []).push(l);
      });

      // Filtro de producto por texto (sobre las líneas)
      let lineasVisibles = lineas;
      if (productoFiltro) {
        const pedidosConProducto = new Set(
          lineas.filter((l) => String(l.nombre || '').toLowerCase().includes(productoFiltro) || String(l.codigo || '').toLowerCase().includes(productoFiltro)).map((l) => l.pedido)
        );
        lineasVisibles = lineas.filter((l) => pedidosConProducto.has(l.pedido));
        const filtrados = pedidos.filter((p) => pedidosConProducto.has(p.id));
        return pintarResultados(contenido, filtrados, lineasVisibles, lineasPorPedido, distribuidores, proformas.length);
      }
      pintarResultados(contenido, pedidos, lineasVisibles, lineasPorPedido, distribuidores, proformas.length);
    } catch (error) {
      contenido.innerHTML = etiquetaVacia(`No se pudieron calcular las estadísticas: ${error.message}`);
    }
  }

  function pintarResultados(contenido, pedidos, lineas, lineasPorPedido, distribuidores, proformasPendientes) {
    destruirGraficas();
    const empresaDe = (id) => (distribuidores || []).find((d) => d.id === id)?.empresa || '—';

    // ── KPIs ──
    const ingresos = pedidos.reduce((suma, p) => suma + Number(p.total), 0);
    const unidades = lineas.reduce((suma, l) => suma + Number(l.cantidad), 0);
    const ticket = pedidos.length ? ingresos / pedidos.length : 0;
    const conDescuento = pedidos.filter((p) => p.canal === 'distribuidor');
    const ahorroDistribuidores = pedidos.reduce((suma, p) => {
      if (p.canal !== 'distribuidor') return suma;
      const descuento = Number(p.descuento_pct) || 0;
      if (descuento <= 0) return suma;
      const precioDistribuidor = lineasPorPedido[p.id]?.reduce((s, l) => s + Number(l.precio_unitario) * Number(l.cantidad), 0) || 0;
      // precioDistribuidor = base × (1 − d/100) → ahorro = precioDistribuidor × d/(100−d)
      return suma + precioDistribuidor * (descuento / (100 - descuento));
    }, 0);

    contenido.innerHTML = `
      <div class="zona-stats">
        <div class="tarjeta-kpi"><p class="kpi-etiqueta">Ingresos</p><p class="kpi-valor">${euro(ingresos)}</p><p class="kpi-nota">${pedidos.length} pedidos en el rango</p></div>
        <div class="tarjeta-kpi"><p class="kpi-etiqueta">Unidades</p><p class="kpi-valor">${unidades}</p><p class="kpi-nota">productos vendidos</p></div>
        <div class="tarjeta-kpi"><p class="kpi-etiqueta">Ticket medio</p><p class="kpi-valor">${euro(ticket)}</p><p class="kpi-nota">por pedido</p></div>
        <div class="tarjeta-kpi"><p class="kpi-etiqueta">De distribuidores</p><p class="kpi-valor">${euro(pedidos.filter((p) => p.canal === 'distribuidor').reduce((s, p) => s + Number(p.total), 0))}</p><p class="kpi-nota">${conDescuento.length} pedidos · ahorro aprox. ${euro(Math.max(0, ahorroDistribuidores))}</p></div>
        <div class="tarjeta-kpi"><p class="kpi-etiqueta">Proformas pendientes</p><p class="kpi-valor">${proformasPendientes}</p><p class="kpi-nota">transferencias sin confirmar</p></div>
      </div>
      <div class="contenedor-grafica"><h3>Evolución de ingresos y pedidos</h3><div class="lienzo"><canvas id="st-grafica-tiempo"></canvas></div></div>
      <div class="contenedor-grafica"><h3>Top productos por unidades</h3><div class="lienzo"><canvas id="st-grafica-productos"></canvas></div></div>
      <div class="contenedor-grafica" style="max-width:26rem;"><h3>Reparto por canal</h3><div class="lienzo"><canvas id="st-grafica-canal"></canvas></div></div>
      <div class="contenedor-grafica"><h3>Ranking de distribuidores</h3><div id="st-tabla-distrib"></div></div>
      <div class="contenedor-grafica"><h3>Ventas por producto</h3><div id="st-tabla-productos"></div>
        <div class="modal-acciones envuelto"><button class="boton boton-fantasma boton-pequeno" id="st-csv-productos" type="button">⬇ Exportar CSV</button></div>
      </div>`;

    // ── Evolución temporal ──
    const porDia = new Map();
    pedidos.forEach((p) => {
      const clave = String(p.creado_en).slice(0, 10);
      const fila = porDia.get(clave) || { ingresos: 0, pedidos: 0 };
      fila.ingresos += Number(p.total);
      fila.pedidos += 1;
      porDia.set(clave, fila);
    });
    const claves = [...porDia.keys()].sort();
    const etiquetas = claves.map((c) => fechaCorta(c));
    const ctxTiempo = contenido.querySelector('#st-grafica-tiempo');
    graficas.push(
      new Chart(ctxTiempo, {
        type: 'line',
        data: {
          labels: etiquetas,
          datasets: [
            { label: 'Ingresos (€)', data: claves.map((c) => Math.round(porDia.get(c).ingresos * 100) / 100), borderColor: COLORES.oro, backgroundColor: 'rgba(201,164,95,.15)', fill: true, tension: 0.3, yAxisID: 'y' },
            { label: 'Pedidos', data: claves.map((c) => porDia.get(c).pedidos), borderColor: COLORES.azul, tension: 0.3, yAxisID: 'y1' },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { position: 'left', title: { display: true, text: '€' }, ticks: { color: COLORES.crema } },
            y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: COLORES.crema }, title: { display: true, text: 'pedidos' } },
            x: { ticks: { color: COLORES.crema, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
          },
          plugins: { legend: { labels: { color: COLORES.crema } } },
        },
      })
    );

    // ── Top productos ──
    const porProducto = new Map();
    lineas.forEach((l) => {
      const clave = l.nombre || l.codigo || '—';
      const fila = porProducto.get(clave) || { unidades: 0, ingresos: 0 };
      fila.unidades += Number(l.cantidad);
      fila.ingresos += Number(l.cantidad) * Number(l.precio_unitario);
      porProducto.set(clave, fila);
    });
    const topProductos = [...porProducto.entries()].sort((a, b) => b[1].unidades - a[1].unidades).slice(0, 10);
    graficas.push(
      new Chart(contenido.querySelector('#st-grafica-productos'), {
        type: 'bar',
        data: {
          labels: topProductos.map(([nombre]) => nombre),
          datasets: [
            { label: 'Unidades', data: topProductos.map(([, f]) => f.unidades), backgroundColor: COLORES.oro },
            { label: 'Ingresos (€)', data: topProductos.map(([, f]) => Math.round(f.ingresos * 100) / 100), backgroundColor: COLORES.verde },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: COLORES.crema } } },
          scales: { x: { ticks: { color: COLORES.crema } }, y: { ticks: { color: COLORES.crema } } },
        },
      })
    );

    // ── Canal ──
    const pedidosWeb = pedidos.filter((p) => p.canal !== 'distribuidor').length;
    const pedidosDist = pedidos.length - pedidosWeb;
    graficas.push(
      new Chart(contenido.querySelector('#st-grafica-canal'), {
        type: 'doughnut',
        data: {
          labels: ['Clientes (web)', 'Distribuidores'],
          datasets: [{ data: [pedidosWeb, pedidosDist], backgroundColor: [COLORES.azul, COLORES.oro] }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: COLORES.crema } } } },
      })
    );

    // ── Ranking distribuidores ──
    const porDistribuidor = new Map();
    pedidos.filter((p) => p.canal === 'distribuidor').forEach((p) => {
      const fila = porDistribuidor.get(p.distribuidor_id) || { pedidos: 0, unidades: 0, ingresos: 0 };
      fila.pedidos += 1;
      fila.ingresos += Number(p.total);
      (lineasPorPedido[p.id] || []).forEach((l) => { fila.unidades += Number(l.cantidad); });
      porDistribuidor.set(p.distribuidor_id, fila);
    });
    const ranking = [...porDistribuidor.entries()].sort((a, b) => b[1].ingresos - a[1].ingresos);
    const totalDistrib = ranking.reduce((s, [, f]) => s + f.ingresos, 0) || 1;
    const zonaRanking = contenido.querySelector('#st-tabla-distrib');
    zonaRanking.innerHTML = ranking.length
      ? `<table class="tabla">
          <thead><tr><th>Distribuidor</th><th class="alineado-derecha">Pedidos</th><th class="alineado-derecha">Unidades</th><th class="alineado-derecha">Ingresos</th><th class="alineado-derecha">% del canal B2B</th></tr></thead>
          <tbody>
            ${ranking
              .map(([id, f]) => {
                const d = (distribuidores || []).find((x) => x.id === id);
                return `<tr><td>${escapar(d?.empresa || '—')} <span class="texto-suave">${Number(d?.descuento_pct) || 0}% dto.</span></td>
                  <td class="alineado-derecha">${f.pedidos}</td><td class="alineado-derecha">${f.unidades}</td>
                  <td class="alineado-derecha">${euro(f.ingresos)}</td>
                  <td class="alineado-derecha">${Math.round((f.ingresos / totalDistrib) * 100)}%</td></tr>`;
              })
              .join('')}
          </tbody>
        </table>`
      : '<p class="estado-vacio">Sin ventas de distribuidores en este rango.</p>';

    // ── Tabla productos + CSV ──
    const filasProducto = [...porProducto.entries()].sort((a, b) => b[1].ingresos - a[1].ingresos);
    const zonaProductos = contenido.querySelector('#st-tabla-productos');
    zonaProductos.innerHTML = filasProducto.length
      ? `<table class="tabla tabla-compacta">
          <thead><tr><th>Producto</th><th class="alineado-derecha">Unidades</th><th class="alineado-derecha">Ingresos (€)</th><th class="alineado-derecha">Apariciones</th></tr></thead>
          <tbody>${filasProducto
            .map(([nombre, f]) => {
              const apariciones = new Set(lineas.filter((l) => (l.nombre || l.codigo || '—') === nombre).map((l) => l.pedido)).size;
              return `<tr><td>${escapar(nombre)}</td><td class="alineado-derecha">${f.unidades}</td><td class="alineado-derecha">${f.ingresos.toFixed(2)}</td><td class="alineado-derecha">${apariciones}</td></tr>`;
            })
            .join('')}</tbody>
        </table>`
      : '<p class="estado-vacio">Sin líneas en este rango.</p>';

    contenido.querySelector('#st-csv-productos').addEventListener('click', () => {
      const filas = [['Producto', 'Unidades', 'Ingresos', 'Pedidos']];
      filasProducto.forEach(([nombre, f]) => {
        const apariciones = new Set(lineas.filter((l) => (l.nombre || l.codigo || '—') === nombre).map((l) => l.pedido)).size;
        filas.push([nombre, f.unidades, f.ingresos.toFixed(2), apariciones]);
      });
      descargarCsv('ventas-por-producto.csv', filas);
    });

    if (!pedidos.length) {
      contenido.insertAdjacentHTML('afterbegin', '<p class="estado-vacio">No hay ventas con los filtros actuales.</p>');
    }
  }

  await pintar();
}
