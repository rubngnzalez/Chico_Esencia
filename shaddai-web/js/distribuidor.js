// Área privada de DISTRIBUIDOR (distribuidor.html, página discreta sin enlace
// en el menú): login con usuario y contraseña de Supabase Auth, condiciones
// personales (packs activos con el descuento de la cuenta aplicado SOLO a la
// inversión; PVP y beneficio se muestran con los valores públicos), cambio de
// contraseña y solicitud de pedido/stock.
// -----------------------------------------------------------------------
// Degradación: si Supabase no está configurado, el login avisa y remite al
// correo de la marca.
(() => {
  const escapar = (texto) =>
    String(texto == null ? "" : texto).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const euro = (valor) =>
    (Number(valor) || 0).toLocaleString("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: Number.isInteger(Number(valor)) ? 0 : 2,
      maximumFractionDigits: 2,
    });

  // Cliente Supabase solo si hay configuración y la librería vendida cargó.
  // Storage key propia: la sesión del distribuidor no pisa la del panel
  // (que usa la clave por defecto) en el mismo navegador.
  const cliente = (() => {
    if (typeof window.SUPABASE_CONFIGURADO === "function" && window.SUPABASE_CONFIGURADO()) {
      if (typeof window.supabase !== "undefined" && window.supabase && window.supabase.createClient) {
        return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
          auth: { storageKey: "shaddai-distribuidores-auth" },
        });
      }
    }
    return null;
  })();

  const textoInversion = (pack) => {
    const min = pack.inversion_min == null ? null : Number(pack.inversion_min);
    const max = pack.inversion_max == null ? null : Number(pack.inversion_max);
    if (min == null && max == null) return "";
    if (min != null && max != null && min !== max) return `${euro(min)} – ${euro(max)}`;
    const base = min != null ? min : max;
    return `~${euro(base)}`;
  };

  // Tarjeta SIEMPRE privada: el descuento de distribuidor aplica SOLO a la
  // inversión (su coste); el PVP y el beneficio se muestran con los valores
  // públicos reales.
  const tarjetaPack = (pack, descuento = 0) => {
    const factor = descuento > 0 ? 1 - descuento / 100 : 1;
    const aplica = (valor) => (valor == null || valor === "" ? null : Math.round(Number(valor) * factor * 100) / 100);
    const inversionMin = aplica(pack.inversion_min);
    const inversionMax = aplica(pack.inversion_max);
    const inversion = textoInversion({ inversion_min: inversionMin, inversion_max: inversionMax });
    const pvp = pack.pvp == null || pack.pvp === "" ? null : Number(pack.pvp);
    const beneficio = pack.beneficio == null || pack.beneficio === "" ? null : Number(pack.beneficio);
    const notaInversion = descuento > 0
      ? `tu ${String(descuento).replace(".", ",")} % de distribuidor aplicado`
      : String(pack.inversion_nota || "");
    const filas = [
      pack.contenido
        ? { campo: "Contenido del pack", valor: escapar(pack.contenido), cifra: false }
        : null,
      inversion
        ? { campo: "Tu inversión", valor: escapar(inversion), cifra: true, nota: escapar(notaInversion) }
        : null,
      pvp != null
        ? { campo: "Valor de venta (PVP)", valor: escapar(euro(pvp)), cifra: true }
        : null,
      beneficio != null || pack.beneficio_nota
        ? {
            campo: "Beneficio tienda",
            valor: beneficio != null ? escapar(`~${euro(beneficio)}`) : "",
            cifra: true,
            nota: escapar(pack.beneficio_nota || ""),
          }
        : null,
    ].filter(Boolean);

    return `
      <article class="pack-b2b">
        <h3 class="pack-nombre">${escapar(pack.nombre)}</h3>
        ${pack.etiqueta ? `<p class="pack-etiqueta">${escapar(pack.etiqueta)}</p>` : ""}
        ${pack.ideal_para ? `<p class="pack-ideal">${escapar(pack.ideal_para)}</p>` : ""}
        <div class="pack-datos">
          ${filas
            .map(
              (fila) => `
          <div class="pack-dato">
            <span class="pack-campo">${fila.campo}</span>
            <span class="pack-valor${fila.cifra ? " pack-cifra" : ""}">${fila.valor}${fila.nota ? ` <small>${fila.nota}</small>` : ""}</span>
          </div>`
            )
            .join("")}
        </div>
        <button type="button" class="boton boton-lleno boton-pedido-pack" data-pack="${escapar(pack.nombre)}">Solicitar este pack</button>
      </article>`;
  };

  const formLogin = document.getElementById("form-login-distribuidor");
  const avisoLogin = document.getElementById("aviso-login-distribuidor");
  const zonaPrivada = document.getElementById("zona-privada-distribuidor");
  const zonaPacks = document.getElementById("packs-privados");
  const campoEmpresa = document.getElementById("distribuidor-empresa");
  const campoDetalle = document.getElementById("distribuidor-detalle");
  const formPedido = document.getElementById("form-pedido-distribuidor");
  const avisoPedido = document.getElementById("aviso-pedido-distribuidor");
  const formClave = document.getElementById("form-clave-distribuidor");
  const avisoClave = document.getElementById("aviso-clave-distribuidor");

  let distribuidor = null; // { id, empresa, contacto, email, telefono, descuento }
  let packsActuales = [];

  const mostrarLogin = (mensaje = "") => {
    if (zonaPrivada) zonaPrivada.hidden = true;
    if (formLogin) formLogin.hidden = false;
    if (avisoLogin) avisoLogin.textContent = mensaje;
  };

  const pintarPacksPrivados = () => {
    if (!zonaPacks) return;
    const descuento = Number(distribuidor.descuento) || 0;
    zonaPacks.innerHTML = packsActuales.map((pack) => tarjetaPack(pack, descuento)).join("");
  };

  const entrarPrivado = async (fila) => {
    distribuidor = {
      empresa: String(fila.empresa || ""),
      contacto: String(fila.contacto || ""),
      email: String(fila.email || ""),
      telefono: String(fila.telefono || ""),
      descuento: Number(fila.descuento) || 0,
    };
    if (campoEmpresa) campoEmpresa.textContent = distribuidor.empresa;
    if (campoDetalle) {
      const partes = [distribuidor.contacto, distribuidor.email];
      const descuento = distribuidor.descuento;
      const condiciones =
        descuento > 0
          ? `descuento de distribuidor: ${String(descuento).replace(".", ",")} %`
          : "condiciones de lista";
      campoDetalle.textContent = `${partes.filter(Boolean).join(" · ")} — ${condiciones}`;
    }
    try {
      await cliente.rpc("oms_tocar_acceso_distribuidor");
    } catch {}
    pintarPacksPrivados();
    if (formLogin) formLogin.hidden = true;
    if (zonaPrivada) zonaPrivada.hidden = false;
  };

  // Packs para el área privada: los activos (el distribuidor autenticado los
  // lee por RLS; si falla, la zona queda vacía hasta reintentar al entrar).
  const cargarPacksPrivados = async () => {
    try {
      const { data, error } = await cliente
        .from("oms_distribuidores_packs")
        .select("*")
        .eq("activo", true)
        .order("orden", { ascending: true });
      if (!error && Array.isArray(data) && data.length > 0) {
        packsActuales = data;
        pintarPacksPrivados();
      }
    } catch {}
  };

  // Sesión guardada: si no es de un distribuidor activo (p. ej. cuenta del
  // panel) NO se toca la sesión de nadie, solo se muestra el login.
  const comprobarSesion = async () => {
    if (!cliente) return;
    try {
      const { data } = await cliente.auth.getSession();
      const sesion = data && data.session;
      if (!sesion) return;
      const { data: fila, error } = await cliente
        .from("oms_distribuidores")
        .select("id, empresa, contacto, email, telefono, descuento, activo")
        .eq("id", sesion.user.id)
        .maybeSingle();
      if (error || !fila || fila.activo === false) return;
      await entrarPrivado(fila);
      await cargarPacksPrivados();
    } catch {}
  };

  if (formLogin) {
    formLogin.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!cliente) {
        avisoLogin.textContent = "El acceso privado no está disponible ahora mismo. Escríbenos a info@omshaddai.com.";
        return;
      }
      avisoLogin.textContent = "";
      const datos = new FormData(formLogin);
      const email = (datos.get("email") || "").toString().trim();
      const contrasena = (datos.get("contrasena") || "").toString();
      const boton = formLogin.querySelector('button[type="submit"]');
      if (boton) boton.disabled = true;
      try {
        const { error } = await cliente.auth.signInWithPassword({ email, password: contrasena });
        if (error) {
          avisoLogin.textContent = error.message === "Invalid login credentials"
            ? "Correo o contraseña incorrectos."
            : error.message;
          return;
        }
        const { data: sesion } = await cliente.auth.getSession();
        const uid = sesion && sesion.session ? sesion.session.user.id : null;
        const { data: fila } = await cliente
          .from("oms_distribuidores")
          .select("id, empresa, contacto, email, telefono, descuento, activo")
          .eq("id", uid)
          .maybeSingle();
        if (!fila || fila.activo === false) {
          await cliente.auth.signOut();
          avisoLogin.textContent = "Esta cuenta no tiene acceso de distribuidor activo. Escríbenos si debería tenerlo.";
          return;
        }
        formLogin.reset();
        await entrarPrivado(fila);
        await cargarPacksPrivados();
      } catch (fallo) {
        avisoLogin.textContent = fallo && fallo.message ? fallo.message : "No se pudo iniciar sesión.";
      } finally {
        if (boton) boton.disabled = false;
      }
    });
  }

  // Solicitar un pack concreto: prellena el formulario de pedido
  if (zonaPacks) {
    zonaPacks.addEventListener("click", (evento) => {
      const boton = evento.target.closest(".boton-pedido-pack");
      if (!boton || !formPedido) return;
      const mensaje = formPedido.querySelector("textarea");
      if (mensaje && !mensaje.value) mensaje.value = `Pedido de ${boton.dataset.pack}: `;
      if (formPedido) {
        formPedido.scrollIntoView({ behavior: "smooth", block: "center" });
        if (mensaje) mensaje.focus({ preventScroll: true });
      }
    });
  }

  if (formPedido) {
    formPedido.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!cliente || !distribuidor) return;
      const datos = new FormData(formPedido);
      const mensaje = (datos.get("mensaje") || "").toString().trim();
      const web = (datos.get("web") || "").toString();
      if (web) {
        avisoPedido.textContent = "Gracias.";
        formPedido.reset();
        return;
      }
      const boton = formPedido.querySelector('button[type="submit"]');
      if (boton) boton.disabled = true;
      avisoPedido.textContent = "Enviando tu solicitud…";
      try {
        const { error } = await cliente.from("oms_mensajes").insert({
          nombre: `[Distribuidor] ${distribuidor.empresa}`.slice(0, 120),
          email: distribuidor.email.slice(0, 160),
          telefono: String(distribuidor.telefono || "").slice(0, 40),
          mensaje: mensaje.slice(0, 5000),
          web: "",
        });
        if (error) throw error;
        avisoPedido.textContent = "Solicitud recibida: la marca te responderá pronto con la confirmación y los siguientes pasos.";
        formPedido.reset();
      } catch {
        avisoPedido.textContent = "No se pudo enviar tu solicitud. Escríbenos a info@omshaddai.com indicando tu pedido.";
      } finally {
        if (boton) boton.disabled = false;
      }
    });
  }

  const botonClave = document.getElementById("boton-clave-distribuidor");
  if (botonClave && formClave) {
    botonClave.addEventListener("click", () => {
      formClave.hidden = !formClave.hidden;
      if (!formClave.hidden) formClave.querySelector("input").focus();
    });
    formClave.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      if (!cliente) return;
      const nueva = (new FormData(formClave).get("nueva") || "").toString();
      if (nueva.length < 8) {
        avisoClave.textContent = "La contraseña debe tener al menos 8 caracteres.";
        return;
      }
      const boton = formClave.querySelector('button[type="submit"]');
      if (boton) boton.disabled = true;
      try {
        const { error } = await cliente.auth.updateUser({ password: nueva });
        if (error) throw error;
        avisoClave.textContent = "Contraseña actualizada: úsala en tu próximo inicio de sesión.";
        formClave.reset();
        formClave.hidden = true;
      } catch (fallo) {
        avisoClave.textContent = fallo && fallo.message ? fallo.message : "No se pudo cambiar la contraseña.";
      } finally {
        if (boton) boton.disabled = false;
      }
    });
  }

  const botonSalir = document.getElementById("boton-salir-distribuidor");
  if (botonSalir) {
    botonSalir.addEventListener("click", async () => {
      if (cliente) {
        try {
          await cliente.auth.signOut();
        } catch {}
      }
      distribuidor = null;
      packsActuales = [];
      if (zonaPacks) zonaPacks.innerHTML = "";
      if (formClave) formClave.hidden = true;
      mostrarLogin("Sesión cerrada. Hasta el próximo umbral.");
    });
  }

  // ─── Arranque ────────────────────────────────────────────────────────────
  comprobarSesion();
})();