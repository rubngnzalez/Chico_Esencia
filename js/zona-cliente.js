// Zona de clientes (zona-cliente.html).
// Acceso sin contraseña: el cliente escribe el correo con el que compró y
// recibe un enlace de marca («oms-cliente-acceso») que le da sesión aquí.
// La RLS solo le enseña los pedidos comprados con ese email.
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

  function mostrarVista(id) {
    ['zona-acceso', 'zona-app'].forEach((zona) => {
      $(zona).hidden = zona !== id;
    });
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

  // ─── PETICIÓN DE ACCESO ───────────────────────────────────────────────────
  $('zona-form-login').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('zl-aviso').textContent = '';
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 20000);
    let respuesta;
    try {
      respuesta = await fetch(`${window.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/oms-cliente-acceso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: $('zl-email').value.trim(), web: $('zl-web').value }),
        signal: control.signal,
      });
    } catch {
      $('zl-aviso').textContent = 'No hemos podido conectar. Inténtalo de nuevo.';
      return;
    } finally {
      clearTimeout(reloj);
    }
    const contenido = await respuesta.json().catch(() => ({}));
    if (respuesta.ok && contenido.ok) {
      $('zl-aviso').textContent = '';
      $('zl-aviso').style.color = '';
      $('zl-aviso').textContent = contenido.mensaje || 'Revisa tu correo: te hemos enviado el enlace de acceso.';
      $('zl-email').value = '';
    } else {
      $('zl-aviso').textContent = contenido.error || 'No se pudo enviar el acceso. Inténtalo de nuevo.';
    }
  });

  $('zona-salir').addEventListener('click', async () => {
    await sb.auth.signOut();
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
      mostrarVista('zona-acceso');
      return;
    }
    mostrarVista('zona-app');
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
