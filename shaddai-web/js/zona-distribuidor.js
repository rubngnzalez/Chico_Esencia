// Zona VIP de distribuidores (zona-distribuidor.html).
// Todo requiere sesión de Supabase Auth de un distribuidor con
// acceso_habilitado = true; la RLS solo expone SU perfil, SUS pedidos y los
// recursos de las carpetas autorizadas. El importe de cada pedido SIEMPRE lo
// recalcula el servidor (oms-distrib-pagos-firma / oms-distrib-pedido) con el
// % de descuento del distribuidor: lo que se muestra aquí es orientativo.
(() => {
  if (typeof window.SUPABASE_CONFIGURADO !== 'function' || !window.SUPABASE_CONFIGURADO()) {
    document.getElementById('zona-subtitulo').textContent = 'Zona sin configurar: falta js/config-supabase.js.';
    return;
  }
  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  const $ = (id) => document.getElementById(id);
  const CLAVE_CARRITO = 'carrito-distrib';
  const escapar = (texto) =>
    String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (valor) => (Number(valor) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  let distribuidor = null; // { id, empresa, email, descuento_pct, … }
  let catalogo = [];
  let carrito = leerCarrito();
  let accesoConTemporal = false; // entró con la contraseña SHAD-… del email de bienvenida

  function leerCarrito() {
    try {
      const datos = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || '{}');
      return datos && typeof datos === 'object' ? datos : {};
    } catch {
      return {};
    }
  }
  function guardarCarrito() {
    localStorage.setItem(CLAVE_CARRITO, JSON.stringify(carrito));
  }
  function precioDistribuidor(p) {
    return Math.round(Number(p.precioEfectivo || p.precio || 0) * (1 - Number(distribuidor.descuento_pct || 0) / 100) * 100) / 100;
  }

  function avisoZona(mensaje) {
    $('zona-subtitulo').textContent = mensaje;
  }

  function mostrarVista(id) {
    ['zona-acceso', 'zona-password', 'zona-app'].forEach((zona) => {
      $(zona).hidden = zona !== id;
    });
  }

  // ─── SESIÓN ───────────────────────────────────────────────────────────────

  async function determinarEstado() {
    const { data: sesion } = await sb.auth.getSession();
    const usuario = sesion?.session?.user;
    if (!usuario) {
      mostrarVista('zona-acceso');
      // Enlace antiguo (antes del sistema de contraseña temporal): sin sesión
      // la invitación ya no vale; se guía al distribuidor para recuperar acceso.
      if (new URLSearchParams(window.location.search).get('invite') === '1') {
        avisoZona('El enlace de este correo ya no es válido (era de antes del nuevo sistema de acceso). Usa el botón «Enviar enlace de acceso» para definir tu contraseña, o pide a SHADDAI un correo de acceso nuevo.');
        $('zl-aviso').textContent = 'Enlace antiguo detectado: usa «Enviar enlace de acceso» para definir tu contraseña.';
      }
      return;
    }
    // Perfil de distribuidor (RLS: solo la propia fila)
    const { data: filas, error } = await sb
      .from('oms_distribuidores')
      .select('id, empresa, razon_social, cif, email, persona_contacto, telefono, descuento_pct, acceso_habilitado, zonas_territorio, direccion')
      .eq('user_id', usuario.id)
      .maybeSingle();
    if (error || !filas) {
      mostrarVista('zona-acceso');
      avisoZona('Esta cuenta no pertenece a ningún distribuidor autorizado.');
      await sb.auth.signOut({ scope: 'local' });
      return;
    }
    distribuidor = filas;
    if (distribuidor.acceso_habilitado !== true) {
      mostrarVista('zona-acceso');
      avisoZona('Tu acceso está deshabilitado temporalmente. Contacta con SHADDAI para reactivarlo.');
      await sb.auth.signOut({ scope: 'local' });
      return;
    }

    const invitacion = new URLSearchParams(window.location.search).get('invite');
    if (invitacion === '1') {
      mostrarVista('zona-password');
      return;
    }
    abrirApp();
  }

  $('zona-form-login').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('zl-aviso').textContent = '';
    const correo = $('zl-email').value.trim();
    const contrasena = $('zl-pass').value;
    const { error } = await sb.auth.signInWithPassword({
      email: correo,
      password: contrasena,
    });
    if (error) {
      const codigo = error.code || '';
      if (codigo === 'email_not_confirmed' || /not confirmed/i.test(error.message || '')) {
        $('zl-aviso').textContent =
          'Tu correo aún no está confirmado. Pide a SHADDAI que reenvíe el acceso (botón ✉ del panel) y entra con la contraseña nueva del correo.';
      } else if (codigo === 'over_request_rate_limit' || codigo === 'over_email_send_rate_limit') {
        $('zl-aviso').textContent = 'Demasiados intentos seguidos. Espera un minuto e inténtalo de nuevo.';
      } else {
        $('zl-aviso').textContent = 'Correo o contraseña incorrectos.';
      }
      return;
    }
    // La contraseña temporal del correo de bienvenida (6 dígitos, o el
    // formato SHAD-… anterior) obliga a definir una propia en el primer acceso.
    accesoConTemporal = /^(SHAD-[A-Z2-9]{5}-[A-Z2-9]{5}|\d{6})$/.test(contrasena);
    determinarEstado();
  });

  $('zona-form-password').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    $('zp-aviso').textContent = '';
    if ($('zp-pass').value !== $('zp-pass2').value) {
      $('zp-aviso').textContent = 'Las contraseñas no coinciden.';
      return;
    }
    const { error } = await sb.auth.updateUser({ password: $('zp-pass').value });
    if (error) {
      $('zp-aviso').textContent = error.message || 'No se pudo guardar la contraseña.';
      return;
    }
    toastVisual('Contraseña guardada. Bienvenido al Umbral.');
    abrirApp();
  });

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

  $('zona-salir').addEventListener('click', async () => {
    await sb.auth.signOut({ scope: 'local' });
    location.reload();
  });

  // ─── SESIÓN Y PEDIDOS ─────────────────────────────────────────────────────

  // ─── APLICACIÓN ───────────────────────────────────────────────────────────

  function abrirApp() {
    mostrarVista('zona-app');
    $('zona-salir').style.display = '';
    $('zona-bienvenida').innerHTML = `
      <div class="zt-bien-marca">
        <span class="zt-bien-empresa">${escapar(distribuidor.empresa || distribuidor.email)}</span>
        <span class="zt-bien-descuento">${escapar(Number(distribuidor.descuento_pct) || 0)}<small>%</small></span>
      </div>
      <p class="zt-bien-nota">Descuento de distribuidor aplicado automáticamente en el cálculo final de cada pedido, verificado en el servidor.${Array.isArray(distribuidor.zonas_territorio) && distribuidor.zonas_territorio.length ? ` Territorios: ${escapar(distribuidor.zonas_territorio.join(', '))}.` : ''}</p>`;
    cargarTienda();
    cargarMaterial();
    cargarPedidos();
    cargarPerfil().then(() => {
      // Primer acceso con la contraseña temporal del correo: la definición de
      // la nueva se pide dentro de Mi perfil.
      if (accesoConTemporal) {
        const pestanaPerfil = document.querySelector('.zona-pista button[data-vista="perfil"]');
        if (pestanaPerfil) pestanaPerfil.click();
        const formulario = $('zona-form-cambiar');
        if (formulario) formulario.hidden = false;
      }
    });
  }

  document.querySelectorAll('.zona-pista button').forEach((boton) => {
    boton.addEventListener('click', () => {
      document.querySelectorAll('.zona-pista button').forEach((b) => b.classList.toggle('activo', b === boton));
      document.querySelectorAll('.zona-vista').forEach((v) => v.classList.toggle('activa', v.id === `zona-vista-${boton.dataset.vista}`));
    });
  });

  // ─── TIENDA ───────────────────────────────────────────────────────────────

  async function cargarTienda() {
    const vista = $('zona-vista-tienda');
    try {
      const { data, error } = await sb
        .from('oms_productos_publicos')
        .select('*')
        .order('destacado', { ascending: false })
        .order('nombre', { ascending: true });
      if (error) throw error;
      catalogo = (data || []).map((p) => ({
        id: p.id,
        codigo: String(p.codigo || p.slug || p.id),
        nombre: String(p.nombre || ''),
        descripcion: String(p.descripcion || ''),
        precio: Number(p.precio) || 0,
        precioEfectivo: Number(p.precio_efectivo) || 0,
        imagenes: Array.isArray(p.imagenes) ? p.imagenes : [],
        agotado: Boolean(p.agotado),
        stock: Number(p.stock) || 0,
        imagenExclusivaUrl: '',
        descripcionDistribuidor: '',
        notasComerciales: '',
      }));
      // Fichas exclusivas por producto (imagen premium + dossier)
      const { data: fichas } = await sb.from('oms_distrib_producto_info').select('*');
      const porId = {};
      (fichas || []).forEach((f) => { porId[f.producto_id] = f; });
      for (const producto of catalogo) {
        const ficha = porId[producto.id];
        if (!ficha) continue;
        producto.descripcionDistribuidor = String(ficha.descripcion_distribuidor || '');
        producto.notasComerciales = String(ficha.notas_comerciales || '');
        if (ficha.imagen_exclusiva) {
          const { data: firma, error: errorFirma } = await sb.storage.from('oms-distrib').createSignedUrl(ficha.imagen_exclusiva, 3600);
          if (!errorFirma && firma?.signedUrl) producto.imagenExclusivaUrl = firma.signedUrl;
        }
      }
      pintarTienda();
      pintarCarrito();
    } catch {
      vista.innerHTML = '<p class="aviso-formulario">No se pudo cargar el catálogo. Recarga la página en unos minutos.</p>';
    }
  }

  function pintarTienda() {
    const vista = $('zona-vista-tienda');
    vista.innerHTML = `
      <div class="zt-coleccion">
        <div class="zt-cabecera">
          <h2>La colección para tu espacio</h2>
          <p>Selección oficial disponible para tu tienda, con tu precio de distribuidor ya aplicado (${escapar(Number(distribuidor.descuento_pct) || 0)}% sobre el precio oficial). Pulsa un producto para abrir su ficha completa.</p>
        </div>
        <div class="zt-lista">
          ${catalogo
            .map((p) => {
              const precio = precioDistribuidor(p);
              const enCarrito = Number(carrito[p.codigo]) || 0;
              const agotado = p.agotado || p.stock <= 0;
              const imagen = p.imagenExclusivaUrl || (p.imagenes[0] || '');
              return `<article class="zt-fila">
                <button type="button" class="zt-fila-imagen" data-ficha="${escapar(p.id)}" aria-label="Ver ficha de ${escapar(p.nombre)}">
                  ${imagen ? `<img src="${escapar(imagen)}" alt="${escapar(p.nombre)}" loading="lazy">` : ''}
                  ${agotado ? '<span class="zt-etiqueta-agotado">Sin stock</span>' : ''}
                  <span class="zt-ver">Ver ficha completa</span>
                </button>
                <div class="zt-fila-info">
                  <span class="zt-codigo">${escapar(p.codigo)}</span>
                  <h3 class="zt-nombre"><button type="button" data-ficha="${escapar(p.id)}">${escapar(p.nombre)}</button></h3>
                  <p class="zt-desc">${escapar(p.descripcion.slice(0, 160))}${p.descripcion.length > 160 ? '…' : ''}</p>
                  <div class="zt-precios">
                    <span class="zt-pvp">${euro(p.precioEfectivo)}</span>
                    <span class="zt-precio">${euro(precio)}</span>
                    <span class="zt-precio-tag">tu precio</span>
                  </div>
                  ${
                    agotado
                      ? '<p class="zt-guardado">Avisaremos cuando vuelva a estar disponible.</p>'
                      : `<div class="zt-compra">
                          <input type="number" min="1" max="999" value="${Math.max(1, enCarrito)}" data-cantidad="${escapar(p.codigo)}" aria-label="Cantidad de ${escapar(p.nombre)}">
                          <button type="button" class="boton boton-lleno" data-anadir="${escapar(p.codigo)}">${enCarrito ? 'Actualizar' : 'Añadir'}</button>
                        </div>`
                  }
                </div>
              </article>`;
            })
            .join('')}
        </div>
      </div>
      <div id="zona-carrito" style="margin-top:2.4rem;"></div>`;

    vista.querySelectorAll('[data-anadir]').forEach((boton) => {
      boton.addEventListener('click', () => {
        const codigo = boton.dataset.anadir;
        const entrada = vista.querySelector(`input[data-cantidad="${CSS.escape(codigo)}"]`);
        const cantidad = Math.max(1, Math.min(999, Number.parseInt(entrada.value, 10) || 1));
        carrito[codigo] = cantidad;
        guardarCarrito();
        pintarCarrito();
        toastVisual('Carrito actualizado.');
      });
    });
    vista.querySelectorAll('[data-ficha]').forEach((boton) => {
      boton.addEventListener('click', () => {
        const producto = catalogo.find((p) => p.id === boton.dataset.ficha);
        if (producto) abrirFicha(producto);
      });
    });
  }

  // ─── FICHA COMPLETA DEL PRODUCTO (página entera con pestañas) ─────────────
  function abrirFicha(producto) {
    const vista = $('zona-vista-tienda');
    const precio = precioDistribuidor(producto);
    const margen = producto.precioEfectivo > 0
      ? Math.round(((producto.precioEfectivo - precio) / producto.precioEfectivo) * 1000) / 10
      : 0;
    const agotado = producto.agotado || producto.stock <= 0;
    const imagen = producto.imagenExclusivaUrl || (producto.imagenes[0] || '');
    const enCarrito = Number(carrito[producto.codigo]) || 0;

    vista.innerHTML = `
      <button type="button" class="boton boton-fantasma" id="zt-volver" style="color:inherit;border-color:rgba(201,164,95,.4);">← Volver a la colección</button>
      <div class="zt-ficha">
        <div class="zt-ficha-media">
          ${imagen ? `<img src="${escapar(imagen)}" alt="${escapar(producto.nombre)}">` : ''}
          ${agotado ? '<span class="zt-etiqueta-agotado">Sin stock</span>' : ''}
        </div>
        <div class="zt-ficha-info">
          <span class="zt-codigo">${escapar(producto.codigo)}</span>
          <h2 class="zt-nombre" style="font-size:2.2rem;">${escapar(producto.nombre)}</h2>
          <p class="zt-desc">${escapar(producto.descripcion)}</p>
          <div class="zt-precios" style="margin:.6rem 0;">
            <span class="zt-pvp">PVP ${euro(producto.precioEfectivo)}</span>
            <span class="zt-precio">${euro(precio)}</span>
            <span class="zt-precio-tag">tu precio (−${escapar(Number(distribuidor.descuento_pct) || 0)}%)</span>
          </div>
          <ul class="zt-datos">
            <li><strong>Margen sobre PVP:</strong> ${margen}%</li>
            <li><strong>Stock disponible:</strong> ${producto.stock} unidades</li>
            <li><strong>Referencia:</strong> ${escapar(producto.codigo)}</li>
          </ul>
          ${
            agotado
              ? '<p class="aviso-formulario">Sin stock ahora mismo.</p>'
              : `<div class="zt-compra" style="max-width:22rem;">
                  <input type="number" min="1" max="999" value="${Math.max(1, enCarrito)}" id="zt-ficha-cantidad" aria-label="Cantidad">
                  <button type="button" class="boton boton-lleno" id="zt-ficha-anadir">${enCarrito ? 'Actualizar carrito' : 'Añadir al pedido'}</button>
                </div>`
          }
          <p class="zt-guardado" id="zt-ficha-guardado"></p>
        </div>
      </div>
      <div class="zt-tabs" role="tablist">
        <button type="button" data-pestana="cliente" class="activo">Vista cliente final</button>
        <button type="button" data-pestana="dossier">Dossier distribuidor</button>
        <button type="button" data-pestana="materiales">Materiales exclusivos</button>
      </div>
      <div class="zt-panel activo" id="zt-panel-cliente">
        <p class="zt-panel-nota">Así lo ve el cliente final en la tienda pública:</p>
        <div class="zt-panel-cuerpo">
          <p>${producto.descripcion ? escapar(producto.descripcion) : '<em>Sin descripción pública.</em>'}</p>
          ${producto.imagenes[0] ? `<img src="${escapar(producto.imagenes[0])}" alt="${escapar(producto.nombre)}" style="max-width:22rem;border-radius:10px;border:1px solid rgba(201,164,95,.4);margin-top:.8rem;">` : ''}
          <p class="zt-panel-nota">Precio público: <strong>${euro(producto.precioEfectivo)}</strong></p>
        </div>
      </div>
      <div class="zt-panel" id="zt-panel-dossier" hidden>
        <p class="zt-panel-nota">Información extensa reservada para el canal distribuidor:</p>
        <div class="zt-panel-cuerpo">
          ${producto.descripcionDistribuidor
            ? `<div class="zt-dossier">${producto.descripcionDistribuidor}</div>`
            : '<p class="aviso-formulario">Este producto aún no tiene dossier de distribuidor.</p>'}
          ${producto.notasComerciales ? `<h3 class="zt-sub">Notas comerciales</h3><div class="zt-dossier">${producto.notasComerciales}</div>` : ''}
        </div>
      </div>
      <div class="zt-panel" id="zt-panel-materiales" hidden>
        <p class="zt-panel-nota">Material comercial exclusivo de este producto (según tus carpetas autorizadas):</p>
        <div id="zt-materiales-lista"><p class="aviso-formulario">Cargando materiales…</p></div>
      </div>`;

    $('zt-volver').addEventListener('click', () => {
      pintarTienda();
      pintarCarrito();
    });
    const entradaFicha = $('zt-ficha-cantidad');
    if (entradaFicha && $('zt-ficha-anadir')) {
      $('zt-ficha-anadir').addEventListener('click', () => {
        const cantidad = Math.max(1, Math.min(999, Number.parseInt(entradaFicha.value, 10) || 1));
        carrito[producto.codigo] = cantidad;
        guardarCarrito();
        pintarCarrito();
        $('zt-ficha-guardado').textContent = 'Carrito actualizado.';
      });
    }
    vista.querySelectorAll('.zt-tabs button').forEach((boton) => {
      boton.addEventListener('click', () => {
        vista.querySelectorAll('.zt-tabs button').forEach((b) => b.classList.toggle('activo', b === boton));
        vista.querySelectorAll('.zt-panel').forEach((panel) => {
          panel.hidden = panel.id !== `zt-panel-${boton.dataset.pestana}`;
          panel.classList.toggle('activo', panel.id === `zt-panel-${boton.dataset.pestana}`);
        });
        if (boton.dataset.pestana === 'materiales') cargarMaterialesFicha(producto);
      });
    });
  }

  async function cargarMaterialesFicha(producto) {
    const lista = $('zt-materiales-lista');
    try {
      const { data: materiales, error } = await sb
        .from('oms_distrib_recursos')
        .select('*')
        .eq('producto_id', producto.id)
        .eq('visible', true)
        .order('creado_en', { ascending: false });
      if (error) throw error;
      const listaMateriales = materiales || [];
      if (!listaMateriales.length) {
        lista.innerHTML = '<p class="aviso-formulario">Este producto aún no tiene materiales exclusivos asignados.</p>';
        return;
      }
      lista.innerHTML = listaMateriales
        .map((m) => {
          const etiquetas = { logo: 'Logotipo', poster: 'Póster', ficha_producto: 'Ficha de producto (PDF)', intencion_ventas: 'Intención de ventas', ventas_reales: 'Ventas reales', otro: 'Documento' };
          return `<div class="recurso-linea">
            <span class="titulo"><strong>${escapar(m.titulo)}</strong><br><span style="font-size:.85rem;color:#7d7466;">${escapar(etiquetas[m.tipo] || m.tipo)}${m.descripcion ? ` · ${escapar(m.descripcion)}` : ''}</span></span>
            <button type="button" class="boton boton-lleno" data-bajar="${escapar(m.archivo)}">Descargar</button>
          </div>`;
        })
        .join('');
      lista.querySelectorAll('[data-bajar]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          boton.disabled = true;
          try {
            const { data, error: errorUrl } = await sb.storage.from('oms-distrib').createSignedUrl(boton.dataset.bajar, 600);
            if (errorUrl || !data?.signedUrl) throw new Error('No se pudo preparar la descarga.');
            window.open(data.signedUrl, '_blank', 'noopener');
          } catch (errorDescarga) {
            toastVisual(errorDescarga.message || 'Error al descargar.');
          }
          boton.disabled = false;
        });
      });
    } catch {
      lista.innerHTML = '<p class="aviso-formulario">No se pudieron cargar los materiales.</p>';
    }
  }

  function pintarCarrito() {
    const zona = $('zona-carrito');
    const lineas = Object.entries(carrito)
      .map(([codigo, cantidad]) => {
        const producto = catalogo.find((p) => p.codigo === codigo);
        return producto ? { producto, cantidad } : null;
      })
      .filter(Boolean);
    if (!lineas.length) {
      zona.innerHTML = '<p class="aviso-formulario">Tu carrito está vacío.</p>';
      return;
    }
    const subtotal = lineas.reduce((s, l) => s + precioDistribuidor(l.producto) * l.cantidad, 0);
    zona.innerHTML = `
      <h2 class="titulo" style="font-size:1.6rem;">Tu pedido</h2>
      <div class="carrito-linea cabecera" style="font-weight:600;"></div>
      ${lineas
        .map(
          (l) => `<div class="carrito-linea">
            <span class="nombre">${escapar(l.producto.nombre)}</span>
            <span>${l.cantidad} × ${euro(precioDistribuidor(l.producto))}</span>
            <strong>${euro(precioDistribuidor(l.producto) * l.cantidad)}</strong>
            <button type="button" class="boton boton-fantasma" data-quitar="${escapar(l.producto.codigo)}" aria-label="Quitar">✕</button>
          </div>`
        )
        .join('')}
      <p style="text-align:right;font-size:1.1rem;margin:1rem 0;">Subtotal con descuento (${escapar(Number(distribuidor.descuento_pct) || 0)}%): <strong>${euro(subtotal)}</strong><br>
      <span style="font-size:.85rem;color:#7d7466;">Los gastos de envío se calculan al confirmar, según destino.</span></p>

      <form id="zona-checkout" class="formulario" autocomplete="off">
        <div class="campo">
          <label for="zc-nombre">Nombre *</label>
          <input type="text" id="zc-nombre" required placeholder="Nombre de quien recibe">
        </div>
        <div class="campo">
          <label for="zc-apellidos">Apellidos</label>
          <input type="text" id="zc-apellidos" placeholder="Apellidos">
        </div>
        <div class="campo">
          <label for="zc-email">Email *</label>
          <input type="email" id="zc-email" required value="${escapar(distribuidor.email || '')}">
        </div>
        <div class="campo">
          <label for="zc-telefono">Teléfono</label>
          <input type="tel" id="zc-telefono" placeholder="600 000 000">
        </div>
        <div class="campo">
          <label for="zc-direccion">Dirección *</label>
          <input type="text" id="zc-direccion" required placeholder="Calle, número, piso">
        </div>
        <div class="campo">
          <label for="zc-cp">Código postal *</label>
          <input type="text" id="zc-cp" required>
        </div>
        <div class="campo">
          <label for="zc-poblacion">Población *</label>
          <input type="text" id="zc-poblacion" required>
        </div>
        <div class="campo">
          <label for="zc-provincia">Provincia *</label>
          <input type="text" id="zc-provincia" required>
        </div>
        <div class="campo">
          <label for="zc-pais">País *</label>
          <select id="zc-pais">
            <option value="España" selected>España</option>
            <option value="Portugal">Portugal</option>
            <option value="Francia">Francia</option>
            <option value="Alemania">Alemania</option>
            <option value="Italia">Italia</option>
            <option value="Reino Unido">Reino Unido</option>
            <option value="Países Bajos">Países Bajos</option>
            <option value="Bélgica">Bélgica</option>
            <option value="México">México</option>
            <option value="Argentina">Argentina</option>
            <option value="Colombia">Colombia</option>
            <option value="Chile">Chile</option>
            <option value="Estados Unidos">Estados Unidos</option>
            <option value="Otro país">Otro país</option>
          </select>
        </div>
        <div class="centrar" style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;">
          <button type="button" class="boton boton-lleno" id="zona-pagar">Pagar con tarjeta / Bizum</button>
          <button type="button" class="boton" id="zona-proforma">Pedido por transferencia</button>
        </div>
        <p class="aviso-formulario centrar" id="zc-aviso" aria-live="polite"></p>
      </form>`;

    zona.querySelectorAll('[data-quitar]').forEach((boton) => {
      boton.addEventListener('click', () => {
        delete carrito[boton.dataset.quitar];
        guardarCarrito();
        pintarTienda();
        pintarCarrito();
      });
    });

    $('zona-pagar').addEventListener('click', () => pagarRedsys());
    $('zona-proforma').addEventListener('click', () => crearProforma());
  }

  function datosPedido() {
    const v = (id) => $(id).value.trim();
    return {
      articulos: Object.entries(carrito).map(([codigo, cantidad]) => ({ codigo, cantidad })),
      envio: {
        nombre: v('zc-nombre'),
        apellidos: v('zc-apellidos'),
        email: v('zc-email'),
        telefono: v('zc-telefono'),
        direccion: v('zc-direccion'),
        cp: v('zc-cp'),
        poblacion: v('zc-poblacion'),
        provincia: v('zc-provincia'),
        pais: $('zc-pais').value,
      },
    };
  }

  async function conSesion(funcion, cuerpo) {
    const { data: sesion } = await sb.auth.getSession();
    const token = sesion?.session?.access_token;
    if (!token) {
      avisoZona('Tu sesión ha caducado. Vuelve a entrar.');
      mostrarVista('zona-acceso');
      return { ok: false, contenido: {} };
    }
    const control = new AbortController();
    const reloj = setTimeout(() => control.abort(), 30000);
    try {
      const respuesta = await fetch(`${window.SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${funcion}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      });
      const contenido = await respuesta.json().catch(() => ({}));
      return { ok: respuesta.ok && !contenido.error, contenido };
    } catch {
      return { ok: false, contenido: { error: 'No hemos podido conectar. Inténtalo de nuevo.' } };
    } finally {
      clearTimeout(reloj);
    }
  }

  async function pagarRedsys() {
    const aviso = $('zc-aviso');
    aviso.textContent = '';
    const cuerpo = datosPedido();
    if (!cuerpo.articulos.length) {
      aviso.textContent = 'Tu carrito está vacío.';
      return;
    }
    const boton = $('zona-pagar');
    boton.disabled = true;
    boton.textContent = 'Preparando el pago…';
    const { ok, contenido } = await conSesion('oms-distrib-pagos-firma', cuerpo);
    boton.disabled = false;
    boton.textContent = 'Pagar con tarjeta / Bizum';
    if (!ok) {
      aviso.textContent = contenido.error || 'No se pudo preparar el pago.';
      return;
    }
    // Guarda el detalle para la página de confirmación y abre el TPV
    try {
      localStorage.setItem(
        'shaddai-pedido-pendiente',
        JSON.stringify({
          pedido: contenido.numeroPedido,
          total: contenido.resumen.total,
          metodo: 'tarjeta',
          nombre: [cuerpo.envio.nombre, cuerpo.envio.apellidos].filter(Boolean).join(' '),
          email: cuerpo.envio.email,
          telefono: cuerpo.envio.telefono,
          direccion: [cuerpo.envio.direccion, cuerpo.envio.cp, cuerpo.envio.poblacion, cuerpo.envio.provincia].filter(Boolean).join(', '),
          fecha: new Date().toISOString(),
          articulos: contenido.resumen.articulos.map((l) => ({ nombre: l.nombre, cantidad: l.cantidad, precio: l.precioUnitario })),
        })
      );
      carrito = {};
      guardarCarrito();
    } catch {}
    const formulario = document.createElement('form');
    formulario.method = 'POST';
    formulario.action = contenido.url;
    [
      ['Ds_MerchantParameters', contenido.parametrosB64],
      ['Ds_Signature', contenido.firma],
      ['Ds_SignatureVersion', contenido.version],
    ].forEach(([campo, valor]) => {
      const entrada = document.createElement('input');
      entrada.type = 'hidden';
      entrada.name = campo;
      entrada.value = valor;
      formulario.append(entrada);
    });
    document.body.append(formulario);
    formulario.submit();
  }

  async function crearProforma() {
    const aviso = $('zc-aviso');
    aviso.textContent = '';
    const cuerpo = datosPedido();
    if (!cuerpo.articulos.length) {
      aviso.textContent = 'Tu carrito está vacío.';
      return;
    }
    const boton = $('zona-proforma');
    boton.disabled = true;
    boton.textContent = 'Registrando…';
    const { ok, contenido } = await conSesion('oms-distrib-pedido', cuerpo);
    boton.disabled = false;
    boton.textContent = 'Pedido por transferencia';
    if (!ok) {
      aviso.textContent = contenido.error || 'No se pudo registrar el pedido.';
      return;
    }
    carrito = {};
    guardarCarrito();
    pintarTienda();
    pintarCarrito();
    aviso.textContent = '';
    const transferencia = contenido.transferencia || {};
    $('zona-carrito').innerHTML = `
      <div class="aviso-zona">
        <strong>Pedido ${escapar(contenido.numeroPedido)} registrado</strong> — total con tu descuento: <strong>${euro(contenido.resumen?.total || 0)}</strong><br>
        ${transferencia.iban ? `Haz la transferencia a: <strong>${escapar(transferencia.iban)}</strong><br>` : ''}
        ${transferencia.info ? `${escapar(transferencia.info)}<br>` : ''}
        Indica siempre el número de pedido en el concepto. Te hemos enviado el detalle por correo y el pedido se prepara al confirmarse el pago.
      </div>`;
    cargarPedidos();
  }

  // ─── MATERIAL COMERCIAL ───────────────────────────────────────────────────

  async function cargarMaterial() {
    const vista = $('zona-vista-material');
    try {
      const [recursos, accesos] = await Promise.all([
        sb.from('oms_distrib_recursos').select('*').eq('visible', true).order('zona').order('creado_en', { ascending: false }),
        sb.from('oms_distrib_recursos_accesos').select('zona'),
      ]);
      const lista = recursos.data || [];
      if (!lista.length) {
        vista.innerHTML = '<p class="aviso-formulario">Todavía no tienes material autorizado. Contacta con SHADDAI.</p>';
        return;
      }
      const tipoEtiquetas = {
        logo: 'Logotipo', poster: 'Póster', ficha_producto: 'Ficha de producto',
        intencion_ventas: 'Intención de ventas', ventas_reales: 'Ventas reales', otro: 'Documento',
      };
      let zonaActual = null;
      vista.innerHTML = lista
        .map((r) => {
          const cabecera = r.zona !== zonaActual ? `<p class="carpeta-cabecera">📁 ${escapar(r.zona)}</p>` : '';
          zonaActual = r.zona;
          return `${cabecera}<div class="recurso-linea">
            <span class="titulo"><strong>${escapar(r.titulo)}</strong><br><span style="font-size:.85rem;color:#7d7466;">${escapar(tipoEtiquetas[r.tipo] || r.tipo)}${r.descripcion ? ` · ${escapar(r.descripcion)}` : ''}</span></span>
            <button type="button" class="boton boton-lleno" data-bajar="${escapar(r.archivo)}">Descargar</button>
          </div>`;
        })
        .join('');

      vista.querySelectorAll('[data-bajar]').forEach((boton) => {
        boton.addEventListener('click', async () => {
          boton.disabled = true;
          try {
            const { data, error } = await sb.storage.from('oms-distrib').createSignedUrl(boton.dataset.bajar, 600);
            if (error || !data?.signedUrl) throw new Error('No se pudo preparar la descarga.');
            window.open(data.signedUrl, '_blank', 'noopener');
          } catch (error) {
            toastVisual(error.message || 'Error al descargar.');
          }
          boton.disabled = false;
        });
      });

      void accesos; // la RLS ya filtra por carpetas autorizadas
    } catch {
      vista.innerHTML = '<p class="aviso-formulario">No se pudo cargar el material comercial.</p>';
    }
  }

  // ─── MIS PEDIDOS ──────────────────────────────────────────────────────────

  const ETIQUETAS_ESTADO = {
    pendiente: 'Pendiente', pagado: 'Pagado', enviado: 'En camino',
    entregado: 'Entregado', cancelado: 'Cancelado',
  };

  async function cargarPedidos() {
    const vista = $('zona-vista-pedidos');
    try {
      const { data: pedidos, error } = await sb
        .from('oms_pedidos')
        .select('id, numero, numero_publico, subtotal, envio, total, descuento_pct, metodo, estado, creado_en')
        .order('creado_en', { ascending: false })
        .limit(50);
      if (error) throw error;
      const lista = pedidos || [];
      if (!lista.length) {
        vista.innerHTML = '<p class="aviso-formulario">Todavía no tienes pedidos.</p>';
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
          return `<article style="border:1px solid rgba(201,164,95,.35);padding:1rem 1.2rem;margin-bottom:1rem;">
            <div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;align-items:baseline;">
              <strong>${escapar(p.numero_publico || p.numero)}</strong>
              <span class="estado-badge">${escapar(ETIQUETAS_ESTADO[p.estado] || p.estado)}</span>
            </div>
            <p style="font-size:.85rem;color:#7d7466;">${new Date(p.creado_en).toLocaleString('es-ES')} · ${p.metodo === 'transferencia' ? 'Transferencia' : 'Tarjeta'} · descuento ${escapar(Number(p.descuento_pct) || 0)}%</p>
            <ul style="padding-left:1.2rem;">${misLineas}</ul>
            <p style="text-align:right;"><strong>Total: ${euro(p.total)}</strong> (envío ${euro(p.envio)})</p>
          </article>`;
        })
        .join('');
    } catch {
      vista.innerHTML = '<p class="aviso-formulario">No se pudieron cargar tus pedidos.</p>';
    }
  }

  // ─── Arranque (detecta sesión del enlace de invitación) ───────────────────
  // ─── MI PERFIL ────────────────────────────────────────────────────────────
  // Lectura directa por RLS (cada distribuidor ve solo su fila). El guardado
  // pasa por la Edge Function «oms-distrib-gestion» (acción «perfil»), porque
  // la RLS no le permite actualizar su propia ficha.

  function pintarPerfil(perfil) {
    const vista = $('zona-vista-perfil');
    const dir = perfil.direccion || {};
    vista.innerHTML = `
      <div class="zt-coleccion">
        <div class="zt-cabecera">
          <h2>Mi perfil</h2>
          <p>Tus datos de empresa y de contacto. El correo y el descuento los gestiona SHADDAI.</p>
        </div>
        <div class="zt-perfil-grid">
          <div class="campo">
            <label>Correo de acceso (no editable)</label>
            <span class="zt-lectura">${escapar(perfil.email || '')}</span>
          </div>
          <div class="campo">
            <label>Descuento de distribuidor</label>
            <span class="zt-lectura">${escapar(Number(perfil.descuento_pct) || 0)}%</span>
          </div>
          <div class="campo">
            <label>Territorios asignados</label>
            <span class="zt-lectura">${escapar(Array.isArray(perfil.zonas_territorio) && perfil.zonas_territorio.length ? perfil.zonas_territorio.join(', ') : '—')}</span>
          </div>
          <div class="campo">
            <label>Estado del acceso</label>
            <span class="zt-lectura">${perfil.acceso_habilitado === false ? 'Deshabilitado' : 'Activo'}</span>
          </div>
          <div class="campo">
            <label for="zp-empresa">Nombre comercial</label>
            <input type="text" id="zp-empresa" value="${escapar(perfil.empresa || '')}">
          </div>
          <div class="campo">
            <label for="zp-razon">Razón social</label>
            <input type="text" id="zp-razon" value="${escapar(perfil.razon_social || '')}">
          </div>
          <div class="campo">
            <label for="zp-cif">CIF / NIF</label>
            <input type="text" id="zp-cif" value="${escapar(perfil.cif || '')}">
          </div>
          <div class="campo">
            <label for="zp-persona">Persona de contacto</label>
            <input type="text" id="zp-persona" value="${escapar(perfil.persona_contacto || '')}">
          </div>
          <div class="campo">
            <label for="zp-telefono">Teléfono</label>
            <input type="tel" id="zp-telefono" value="${escapar(perfil.telefono || '')}">
          </div>
          <div class="campo">
            <label for="zp-calle">Dirección fiscal</label>
            <input type="text" id="zp-calle" value="${escapar(dir.calle || '')}">
          </div>
          <div class="campo">
            <label for="zp-cp">Código postal</label>
            <input type="text" id="zp-cp" value="${escapar(dir.cp || '')}">
          </div>
          <div class="campo">
            <label for="zp-poblacion">Población</label>
            <input type="text" id="zp-poblacion" value="${escapar(dir.poblacion || '')}">
          </div>
          <div class="campo">
            <label for="zp-provincia">Provincia</label>
            <input type="text" id="zp-provincia" value="${escapar(dir.provincia || '')}">
          </div>
          <div class="campo">
            <label for="zp-pais">País</label>
            <input type="text" id="zp-pais" value="${escapar(dir.pais || 'España')}">
          </div>
        </div>
        <div class="centrar" style="margin-top:1.2rem;">
          <button type="button" class="boton boton-lleno" id="zp-guardar">Guardar mis datos</button>
        </div>
        <p class="zt-leyenda">Los cambios se aplican a tu ficha de distribuidor y se usan en tus pedidos y facturación.</p>
        <div class="zt-pass">
          <p class="dist-checks-titulo">Contraseña</p>
          <button type="button" class="boton boton-fantasma" id="zona-mostrar-pass" style="color:inherit;border-color:rgba(201,164,95,.4);">${accesoConTemporal ? 'Definir mi contraseña ahora (estás usando la temporal del correo)' : 'Cambiar contraseña'}</button>
          <form id="zona-form-cambiar" class="formulario" autocomplete="off" hidden>
            <div class="campo">
              <label for="zc-nueva">Nueva contraseña</label>
              <input type="password" id="zc-nueva" minlength="8" placeholder="Mínimo 8 caracteres" required>
            </div>
            <div class="campo">
              <label for="zc-nueva2">Repite la nueva contraseña</label>
              <input type="password" id="zc-nueva2" minlength="8" placeholder="La misma contraseña" required>
            </div>
            <p class="aviso-formulario" id="zc-aviso-cambio" aria-live="polite"></p>
            <button type="submit" class="boton boton-lleno">Guardar contraseña</button>
          </form>
        </div>
      </div>`;

    $('zona-mostrar-pass').addEventListener('click', () => {
      const formulario = $('zona-form-cambiar');
      formulario.hidden = !formulario.hidden;
    });
    $('zona-form-cambiar').addEventListener('submit', async (evento) => {
      evento.preventDefault();
      const avisoCambio = $('zc-aviso-cambio');
      avisoCambio.textContent = '';
      if ($('zc-nueva').value !== $('zc-nueva2').value) {
        avisoCambio.textContent = 'Las contraseñas no coinciden.';
        return;
      }
      const { error } = await sb.auth.updateUser({ password: $('zc-nueva').value });
      if (error) {
        avisoCambio.textContent = error.message || 'No se pudo cambiar la contraseña.';
        return;
      }
      avisoCambio.textContent = 'Contraseña actualizada.';
      $('zc-nueva').value = '';
      $('zc-nueva2').value = '';
      accesoConTemporal = false;
      toastVisual('Contraseña guardada. Ya puedes usarla en tus próximos accesos.');
    });

    $('zp-guardar').addEventListener('click', async () => {
      const boton = $('zp-guardar');
      boton.disabled = true;
      const { ok, contenido } = await conSesion('oms-distrib-gestion', {
        accion: 'perfil',
        guardar: true,
        campos: {
          empresa: $('zp-empresa').value,
          razon_social: $('zp-razon').value,
          cif: $('zp-cif').value,
          persona_contacto: $('zp-persona').value,
          telefono: $('zp-telefono').value,
          direccion: {
            calle: $('zp-calle').value,
            cp: $('zp-cp').value,
            poblacion: $('zp-poblacion').value,
            provincia: $('zp-provincia').value,
            pais: $('zp-pais').value,
          },
        },
      });
      boton.disabled = false;
      if (ok && contenido.perfil) {
        Object.assign(distribuidor, contenido.perfil);
        toastVisual('Tus datos se han guardado.');
        cargarPerfil();
      } else {
        toastVisual(contenido.error || 'No se pudieron guardar tus datos.');
      }
    });
  }

  async function cargarPerfil() {
    const vista = $('zona-vista-perfil');
    const { data: sesion } = await sb.auth.getSession();
    const usuario = sesion?.session?.user;
    if (!usuario) {
      vista.innerHTML = '<p class="aviso-formulario">Tu sesión ha caducado. Vuelve a entrar.</p>';
      return;
    }
    const { data: fila, error } = await sb
      .from('oms_distribuidores')
      .select('*')
      .eq('user_id', usuario.id)
      .maybeSingle();
    if (error || !fila) {
      vista.innerHTML = '<p class="aviso-formulario">No se pudo cargar tu perfil. Inténtalo de nuevo.</p>';
      return;
    }
    Object.assign(distribuidor, fila);
    pintarPerfil(fila);
  }

  sb.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_IN' || evento === 'TOKEN_REFRESHED' || evento === 'PASSWORD_RECOVERY') {
      determinarEstado();
    }
  });
  determinarEstado();
})();
