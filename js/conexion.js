// Conexión de la web con su fuente de datos, con degradación silenciosa.
// -----------------------------------------------------------------------
// Cadena (por orden, cada eslabón cae al siguiente si falla o no hay config):
//   1. SUPABASE (js/config-supabase.js rellenado + js/supabase.js vendor):
//      ajustes_publicos, productos_publicos, testimonios aprobados,
//      formularios (mensajes, suscriptores) y firma de pago (Edge Function).
//   2. WORKER (window.SHADDAI_API_BASE en js/config-api.js): la API REST del
//      Cloudflare Worker, que sigue desplegada.
//   3. MODO ESTÁTICO: nada se rompe; la web usa sus datos de datos-tienda.js
//      y el correo de toda la vida (mailto).
// Exporta el mismo CONTRATO que consumían las páginas: escapar, get, post,
// cuandoConfig y configuracion.
const CONEXION = (() => {
  const TIEMPO_MS = 4000; // espera máxima: en estático la carga no se ralentiza
  const BASE = typeof window.SHADDAI_API_BASE === "string" ? window.SHADDAI_API_BASE.replace(/\/$/, "") : "";
  const pendientes = new Map(); // respuestas GET reutilizables dentro de la misma página

  // Cliente Supabase solo si hay configuración y la librería vendida cargó
  const cliente = (() => {
    if (typeof window.SUPABASE_CONFIGURADO === "function" && window.SUPABASE_CONFIGURADO()) {
      if (typeof window.supabase !== "undefined" && window.supabase && window.supabase.createClient) {
        return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      }
    }
    return null;
  })();

  // Escapa el texto que llega del panel antes de pintarlo en el DOM
  const escapar = (texto) =>
    String(texto == null ? "" : texto).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // Carrera con timeout corto; si algo falla devuelve null (modo estático)
  const conTiempo = (promesa) => {
    let reloj;
    const espera = new Promise((_, fin) => {
      reloj = setTimeout(() => fin(new Error("tiempo")), TIEMPO_MS);
    });
    return Promise.race([Promise.resolve(promesa), espera]).finally(() => clearTimeout(reloj));
  };

  // ---- consultas supabase tipadas a las vistas públicas ----

  const numero = (valor) => {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  };

  const leerConfigSupabase = async () => {
    if (!cliente) return null;
    const { data, error } = await conTiempo(
      cliente.from("ajustes_publicos").select("*").eq("id", "general").maybeSingle()
    );
    if (error || !data) return null;
    return {
      envio: {
        coste: numero(data.envio_coste),
        gratisDesde: numero(data.envio_gratis_desde),
        plazos: String(data.envio_plazos || ""),
        activo: data.envio_activo !== false,
      },
      redes: data.redes && typeof data.redes === "object" ? data.redes : {},
      contacto: {
        telefono: String(data.contacto_telefono || ""),
        direccion: String(data.contacto_direccion || ""),
        horario: String(data.contacto_horario || ""),
        emailsDestino: Array.isArray(data.contacto_emails) ? data.contacto_emails : [],
      },
      nombreComercio: String(data.nombre_comercio || "SHADDAI · Esencia de Umbral"),
      entornoPago: String(data.entorno_pago || "test") === "produccion" ? "produccion" : "test",
      metodosPago: {
        tarjeta: data.metodo_tarjeta !== false,
        bizum: data.metodo_bizum !== false,
      },
      pago: {
        fuc: String(data.fuc || ""),
        terminal: String(data.terminal || "1"),
        moneda: String(data.moneda || "978"),
        urlOk: String(data.url_ok || ""),
        urlKo: String(data.url_ko || ""),
        urlNotificacion: String(data.url_notificacion || ""),
      },
      // La clave SOLO llega en entorno test (clave de pruebas pública de
      // Redsys); en producción la vista la oculta y el pago se firma siempre
      // en servidor (Edge Function pagos-firma).
      clavePago: data.clave_pago_test || null,
    };
  };

  const leerProductosSupabase = async () => {
    if (!cliente) return null;
    const { data, error } = await conTiempo(
      cliente
        .from("productos_publicos")
        .select("*")
        .order("destacado", { ascending: false })
        .order("categoria_orden", { ascending: true, nullsFirst: false })
        .order("nombre", { ascending: true })
    );
    if (error || !Array.isArray(data)) return null;
    // Se mapea a la forma que consumen datos-tienda.js y pago.js
    return data.map((p) => ({
      id: p.id,
      codigo: String(p.codigo || p.slug || p.id),
      nombre: String(p.nombre || ""),
      slug: String(p.slug || ""),
      descripcion: String(p.descripcion || ""),
      historia: String(p.historia || ""),
      precio: numero(p.precio),
      precioOferta: p.precio_oferta != null ? numero(p.precio_oferta) : null,
      precioEfectivo: numero(p.precio_efectivo),
      stock: numero(p.stock),
      agotado: Boolean(p.agotado),
      categoria: String(p.categoria_slug || ""),
      imagenes: Array.isArray(p.imagenes) ? p.imagenes : [],
      destacado: Boolean(p.destacado),
    }));
  };

  const leerTestimoniosSupabase = async () => {
    if (!cliente) return null;
    const { data, error } = await conTiempo(
      cliente
        .from("testimonios")
        .select("nombre, ciudad, producto, texto, estrellas, fecha")
        .eq("aprobado", true)
        .order("fecha", { ascending: false })
        .limit(12)
    );
    if (error || !Array.isArray(data)) return null;
    return data.map((t) => ({
      nombre: String(t.nombre || ""),
      ciudad: String(t.ciudad || ""),
      producto: String(t.producto || ""),
      texto: String(t.texto || ""),
      estrellas: Math.max(1, Math.min(5, numero(t.estrellas) || 5)),
      fecha: t.fecha,
    }));
  };

  // ---- peticiones HTTP contra el WORKER (cadena 2) ----

  const peticion = (ruta, metodo, cuerpo) => {
    const clave = metodo + " " + ruta + (cuerpo ? " " + JSON.stringify(cuerpo) : "");
    if (metodo === "GET" && pendientes.has(clave)) return pendientes.get(clave);

    const promesa = (async () => {
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), TIEMPO_MS);
      try {
        const respuesta = await fetch(BASE + ruta, {
          method: metodo,
          headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
          body: cuerpo ? JSON.stringify(cuerpo) : undefined,
          signal: control.signal,
        });
        const contenido = await respuesta.json().catch(() => null);
        return { ok: respuesta.ok, cuerpo: contenido };
      } catch {
        return null; // sin API: silencio, el modo estático continúa
      } finally {
        clearTimeout(reloj);
      }
    })();

    if (metodo === "GET") pendientes.set(clave, promesa);
    return promesa;
  };

  const getTrabajador = async (ruta) => {
    const respuesta = await peticion(ruta, "GET");
    return respuesta && respuesta.ok && respuesta.cuerpo ? respuesta.cuerpo : null;
  };

  const postTrabajador = async (ruta, cuerpo) => {
    const respuesta = await peticion(ruta, "POST", cuerpo);
    return respuesta ? respuesta.cuerpo : null;
  };

  // ---- GET unificado: { datos: [...] } o null ----
  const get = async (ruta) => {
    if (cliente) {
      if (ruta === "/api/public/config") {
        const config = await cuandoConfig;
        return config ? { datos: config } : null;
      }
      if (ruta === "/api/productos/publico") {
        const productos = await leerProductosSupabase();
        return productos && productos.length ? { datos: productos } : null;
      }
      if (ruta === "/api/public/testimonios") {
        const testimonios = await leerTestimoniosSupabase();
        return testimonios && testimonios.length ? { datos: testimonios } : null;
      }
    }
    return getTrabajador(ruta);
  };

  // ---- POST unificado: cuerpo JSON, o null si no hay nadie al otro lado ----
  const post = async (ruta, cuerpo) => {
    if (cliente) {
      if (ruta === "/api/public/contacto") {
        // Honeypot «web»: si llega relleno es un bot → respuesta OK sin guardar
        if (cuerpo && String(cuerpo.web || "") !== "") {
          return { ok: true, mensaje: "Gracias por tu mensaje." };
        }
        try {
          const { error } = await conTiempo(
            cliente.from("mensajes").insert({
              nombre: String(cuerpo.nombre || "").slice(0, 120),
              email: String(cuerpo.email || "").slice(0, 160),
              telefono: String(cuerpo.telefono || "").slice(0, 40),
              mensaje: String(cuerpo.mensaje || "").slice(0, 5000),
              web: "",
            })
          );
          if (error) throw error;
          return { ok: true };
        } catch {
          return { ok: false, error: "No hemos podido guardar tu mensaje." };
        }
      }
      if (ruta === "/api/public/suscribirse") {
        try {
          const { error } = await conTiempo(
            cliente.from("suscriptores").insert({ email: String((cuerpo.email || "")).slice(0, 160) })
          );
          if (error && error.code !== "23505") throw error; // 23505 = duplicado: bienvenida igual
          return { ok: true };
        } catch {
          return { ok: false, error: "No hemos podido completar tu suscripción." };
        }
      }
      if (ruta === "/api/pagos/firma") {
        // Cadena de pago (ver js/pago.js):
        //  1) Edge Function pagos-firma → 2) Worker → 3) null (firma en cliente)
        try {
          const { data, error } = await conTiempo(
            cliente.functions.invoke("pagos-firma", { body: cuerpo })
          );
          if (!error && data && data.parametrosB64) return data;
        } catch {
          // la función no está desplegada (fase 2): cae al Worker
        }
        if (BASE) return postTrabajador(ruta, cuerpo);
        return null;
      }
    }
    return postTrabajador(ruta, cuerpo);
  };

  // Coste y umbral de envío reales cuando el panel los trae
  const aplicarEnvio = (datos) => {
    const envio = datos.envio;
    if (!envio || envio.activo === false) return;
    if (typeof CONFIG_ENVIO === "object" && CONFIG_ENVIO) {
      if (Number(envio.coste) >= 0) CONFIG_ENVIO.coste = Number(envio.coste);
      if (Number(envio.gratisDesde) >= 0) CONFIG_ENVIO.gratisDesde = Number(envio.gratisDesde);
      // Repinta el carrito visible con el envío real
      if (
        document.body.dataset.pagina === "carrito" &&
        typeof pintarCarrito === "function" &&
        typeof leerCarrito === "function"
      ) {
        pintarCarrito(leerCarrito());
      }
    }
  };

  // Redes sociales del pie (solo si el panel las tiene configuradas)
  const aplicarRedes = (datos) => {
    const pie = document.querySelector(".pie");
    const entradas = Object.entries(datos.redes || {}).filter(([, url]) => url);
    if (!pie || entradas.length === 0) return;
    const nombres = {
      instagram: "Instagram",
      tiktok: "TikTok",
      pinterest: "Pinterest",
      facebook: "Facebook",
      youtube: "YouTube",
      whatsapp: "WhatsApp",
    };
    const lista = document.createElement("nav");
    lista.className = "pie-redes";
    lista.setAttribute("aria-label", "Redes sociales");
    lista.innerHTML = entradas
      .map(([red, url]) => `<a href="${escapar(url)}" target="_blank" rel="noopener">${escapar(nombres[red] || red)}</a>`)
      .join("");
    const base = pie.querySelector(".base");
    if (base) base.parentNode.insertBefore(lista, base);
    else pie.querySelector(".contenedor").appendChild(lista);
  };

  // ---- Configuración pública (envío, pago, contacto y redes) ----
  let configuracion = null;
  const cuandoConfig = (async () => {
    let resultado = null;
    if (cliente) {
      resultado = await leerConfigSupabase();
    }
    if (!resultado) {
      const cuerpo = await getTrabajador("/api/public/config");
      resultado = cuerpo && cuerpo.datos ? cuerpo.datos : null;
    }
    configuracion = resultado;
    if (configuracion) {
      aplicarEnvio(configuracion);
      aplicarRedes(configuracion);
    }
    return configuracion;
  })().catch(() => null);

  // ---- Testimonios: las secciones solo se rellenan con aprobados ----
  const seccionesTestimonios = document.querySelectorAll("[data-testimonios]");
  if (seccionesTestimonios.length > 0) {
    get("/api/public/testimonios").then((cuerpo) => {
      const testimonios = cuerpo && Array.isArray(cuerpo.datos) ? cuerpo.datos : [];
      if (testimonios.length === 0) return; // modo estático: la sección permanece oculta
      seccionesTestimonios.forEach((seccion) => {
        const destino = seccion.querySelector("[data-testimonios-lista]");
        if (!destino) return;
        destino.innerHTML = testimonios
          .slice(0, 6)
          .map((t) => {
            const estrellas = Math.max(1, Math.min(5, Number(t.estrellas) || 5));
            const autor = escapar(t.nombre) + (t.ciudad ? `, ${escapar(t.ciudad)}` : "");
            return (
              '<article class="testimonio">' +
              `<div class="testimonio-estrellas" role="img" aria-label="Valoración: ${estrellas} de 5 estrellas">` +
              `<span class="llenas" aria-hidden="true">${"★".repeat(estrellas)}</span>` +
              `<span class="vacias" aria-hidden="true">${"★".repeat(5 - estrellas)}</span>` +
              "</div>" +
              `<blockquote class="testimonio-texto">${escapar(t.texto)}</blockquote>` +
              `<p class="testimonio-autor">${autor}</p>` +
              "</article>"
            );
          })
          .join("");
        seccion.hidden = false;
      });
    });
  }

  return {
    TIEMPO_MS,
    escapar,
    get,
    post,
    cuandoConfig,
    get configuracion() {
      return configuracion;
    },
  };
})();

window.CONEXION = CONEXION;
