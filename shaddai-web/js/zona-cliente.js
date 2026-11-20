// Zona de clientes (zona-cliente.html).
// Acceso en dos pasos, sin contraseña (el proyecto tiene autoconfirmación
// activa: los enlaces mágicos no crean sesión, pero los CÓDIGOS OTP sí):
//   1 · El cliente escribe el correo con el que compró → recibe un código.
//   2 · Escribe el código de 6 dígitos → sesión → ve SUS pedidos (RLS por email).
// Limpieza del correo de acceso: el usuario puede personalizar la plantilla
// "Magic Link" de Supabase (Dashboard → Authentication → Emails) con el logo.
(() => {
  if (typeof window.SUPABASE_CONFIGURADO !== 'function' || !window.SUPABASE_CONFIGURADO()) {
    document.getElementById('zona-subtitulo').textContent = 'Zona sin configurar: falta js/config-supabase.js.';
    return;
  }
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const $ = (id) => document.getElementById(id);
  const escapar = (texto) =>
    String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (valor) => (Number(valor) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  let emailAcceso = '';
  let pasoActual = 'correo';

  function mostrarPaso(paso) {
    pasoActual = paso;
    $('zc-paso-correo').hidden = paso !== 'correo';
    $('zc-paso-codigo').hidden = paso !== 'codigo';
  }

  function toastVisual(mensaje) {
    const nota = document.createElement('div');
    nota.className = 'aviso-zona';
    nota.style.position = 'fixed';
    nota.style.bottom = '1.2rem';
    nota.style.right = '1.2rem';
    nota.style.zIndex = '60';
    nota.style.background = '#f3eee2';
    nota.textContent = mensaje;
    document.body.appendChild(nota);
    setTimeout(() => nota.remove(), 4000);
  }

  // ─── PASO 1 · pedir el enlace de acceso (correo de marca vía panel-worker) ─
  $('zona-form-login').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('zl-aviso').textContent = '';
    emailAcceso = $('zl-email').value.trim();
    $('zl-boton').disabled = true;
    $('zl-boton').textContent = 'Enviando…';
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 20000);
    let respuesta;
    try {
      const base = window.SHADDAI_API_BASE || 'https://shaddai-panel.redes-301dpi.workers.dev';
      respuesta = await fetch(`${base.replace(/\/$/, '')}/api/acceso-zona`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailAcceso, destino: 'cliente', web: $('zl-web').value }),
        signal: control.signal,
      });
    } catch {
      $('zl-boton').disabled = false;
      $('zl-boton').textContent = 'Enviar código de acceso';
      $('zl-aviso').textContent = 'No hemos podido conectar. Inténtalo de nuevo.';
      return;
    } finally {
      clearTimeout(reloj);
    }
    const contenido = await respuesta.json().catch(() => ({}));
    $('zl-boton').disabled = false;
    $('zl-boton').textContent = 'Enviar código de acceso';
    if (respuesta.ok && contenido.ok) {
      $('zl-aviso').textContent = '';
      $('zl-aviso').style.color = '';
      $('zl-aviso').textContent = contenido.mensaje || 'Revisa tu correo: te hemos enviado el enlace de acceso.';
      $('zl-email').value = '';
    } else {
      $('zl-aviso').textContent = contenido.error || 'No se pudo enviar el acceso. Inténtalo de nuevo en unos minutos.';
    }
  });

  // ─── PASO 2 · el acceso llega por correo (enlace de sesión) ───────────────
  // Sin UI de código: al pulsar el enlace del correo, Supabase entrega la
  // sesión en esta página y onAuthStateChange dispara la entrada.

  $('zona-salir').addEventListener('click', async () => {
    await sb.auth.signOut({ scope: 'local' });
    location.reload();
  });

  // ─── SESIÓN Y PEDIDOS ─────────────────────────────────────────────────────
  const ETIQUETAS_ESTADO = {
    pendiente: 'Pendiente', pagado: 'Pagado', enviado: 'En camino',
    entregado: 'Entregado', cancelado: 'Cancelado',
  };

  async function determinarEstado() {
    const { data: sesion } = await sb.auth.getSession();
    const usuario = sesion?.session?.user;
    if (!usuario) {
      mostrarPaso('correo');
      return;
    }
    $('zona-acceso').hidden = true;
    $('zona-app').hidden = false;
    $('zona-salir').style.display = '';
    $('zona-bienvenida').innerHTML = `
      <strong>${escapar(usuario.email || '')}</strong> — estos son los pedidos registrados con este correo.
      Si falta alguno (comprado con otro correo), accede con ese correo para verlo.`;
    cargarPedidos(usuario.email || '');
  }

  async function cargarPedidos(emailSesion) {
    const vista = $('zona-pedidos');
    try {
      const { data: pedidos, error } = await sb
        .from('oms_pedidos')
        .select('id, numero, numero_publico, subtotal, envio, total, metodo, estado, seguimiento_url, creado_en')
        .order('creado_en', { ascending: false })
        .limit(50);
      if (error) throw error;
      const lista = pedidos || [];
      if (!lista.length) {
        vista.innerHTML = `
          <p class="aviso-formulario">No encontramos pedidos registrados con el correo <strong>${escapar(emailSesion)}</strong>.</p>
          <p style="text-align:center;margin-top:1.2rem;"><a href="tienda.html" class="boton boton-lleno">Ir a la tienda</a></p>`;
        return;
      }
      const { data: lineas } = await sb
        .from('oms_pedidos_lineas')
        .select('pedido, nombre, cantidad, precio_unitario')
        .in('pedido', lista.map((p) => p.id))
        .limit(1000);
      const porPedido = {};
      (lineas || []).forEach((l) => {
        (porPedido[l.pedido] = porPedido[l.pedido] || []).push(l);
      });

      vista.innerHTML = lista
        .map((p) => {
          const misLineas = (porPedido[p.id] || [])
            .map((l) => `<li>${escapar(l.cantidad)} × ${escapar(l.nombre)} — ${euro(l.precio_unitario)}</li>`)
            .join('');
          return `<article class="pedido-articulo">
            <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:baseline;">
              <strong>${escapar(p.numero_publico || p.numero)}</strong>
              <span class="estado-badge">${escapar(ETIQUETAS_ESTADO[p.estado] || p.estado)}</span>
            </div>
            <p style="font-size:.85rem;color:#7d7466;">${new Date(p.creado_en).toLocaleString('es-ES')} · ${p.metodo === 'transferencia' ? 'Transferencia' : 'Tarjeta'}</p>
            <ul style="padding-left:1.2rem;">${misLineas}</ul>
            <p style="text-align:right;"><strong>Total: ${euro(p.total)}</strong> (envío ${euro(p.envio)})</p>
            ${p.seguimiento_url ? `<p style="text-align:right;"><a href="${escapar(p.seguimiento_url)}" target="_blank" rel="noopener">Seguir mi envío</a></p>` : ''}
          </article>`;
        })
        .join('');
    } catch {
      vista.innerHTML = '<p class="aviso-formulario">No se pudieron cargar tus pedidos.</p>';
    }
  }

  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED' || evento === 'PASSWORD_RECOVERY') {
      determinarEstado();
    }
  });
  determinarEstado();
})();
