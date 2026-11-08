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
  const TIEMPO_MS = 15000; // margen alto: la firma de pago puede arrancar en frío (SIS0042 si se corta)
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
      cliente.from("oms_ajustes_publicos").select("*").eq("id", "general").maybeSingle()
    );
    if (error || !data) return null;
    return {
      envio: {
        activo: data.envio_activo !== false,
        // Zonas del panel (España, Unión Europea, Latinoamérica, Resto del
        // mundo): null si la vista aún no las expone (SQL sin actualizar) y
        // la web usa sus valores por defecto
        zonas: data.envio_zonas && typeof data.envio_zonas === "object" ? data.envio_zonas : null,
        paises: data.envio_paises && typeof data.envio_paises === "object" ? data.envio_paises : null,
        disponibilidad:
          data.envio_disponibilidad && typeof data.envio_disponibilidad === "object" ? data.envio_disponibilidad : null,
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
        .from("oms_productos_publicos")
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
      zonasEnvio: Array.isArray(p.zonas_envio) ? p.zonas_envio : [],
    }));
  };

  // Mapa codigo/slug/id → zonas de envío del producto (para el checkout y
  // las notas de disponibilidad). Devuelve null si aún no está en la vista
  // (SQL sin actualizar) o no hay conexión: la web entonces no restringe.
  const leerZonasProductos = async () => {
    if (!cliente) return null;
    const { data, error } = await conTiempo(
      cliente.from("oms_productos_publicos").select("id, codigo, slug, zonas_envio")
    );
    if (error || !Array.isArray(data)) return null;
    const mapa = {};
    data.forEach((p) => {
      const zonas = Array.isArray(p.zonas_envio) ? p.zonas_envio : [];
      [p.codigo, p.slug, p.id].filter(Boolean).forEach((clave) => {
        mapa[String(clave).toLowerCase()] = zonas;
      });
    });
    return mapa;
  };

  const leerTestimoniosSupabase = async () => {
    if (!cliente) return null;
    const { data, error } = await conTiempo(
      cliente
        .from("oms_testimonios")
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
            cliente.from("oms_mensajes").insert({
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
            cliente.from("oms_suscriptores").insert({ email: String((cuerpo.email || "")).slice(0, 160) })
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
            cliente.functions.invoke("oms-pagos-firma", { body: cuerpo })
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

  // Coste, umbrales, países y disponibilidad reales cuando el panel los trae
  const aplicarEnvio = (datos) => {
    const envio = datos.envio;
    if (!envio) return;
    if (typeof CONFIG_ENVIO !== "object" || !CONFIG_ENVIO) return;
    // «Cobrar envío» apagado = envío gratuito en todas las zonas
    if (envio.activo === false) {
      CONFIG_ENVIO.activo = false;
      Object.keys(CONFIG_ENVIO.zonas || {}).forEach((clave) => {
        CONFIG_ENVIO.zonas[clave].coste = 0;
      });
      return;
    }
    CONFIG_ENVIO.activo = true;
    const zonas = envio.zonas && typeof envio.zonas === "object" ? envio.zonas : null;
    if (zonas) {
      Object.keys(CONFIG_ENVIO.zonas).forEach((clave) => {
        const zona = zonas[clave];
        if (zona && typeof zona === "object") {
          if (Number(zona.coste) >= 0) CONFIG_ENVIO.zonas[clave].coste = Number(zona.coste);
          if (zona.gratisDesde != null && Number(zona.gratisDesde) >= 0) {
            CONFIG_ENVIO.zonas[clave].gratisDesde = Number(zona.gratisDesde);
          }
        }
      });
    }
    if (envio.paises && typeof envio.paises === "object") {
      CONFIG_ENVIO.paises = { ...CONFIG_ENVIO.paises, ...envio.paises };
    }
    if (envio.disponibilidad && typeof envio.disponibilidad === "object") {
      CONFIG_ENVIO.disponibilidad = { ...CONFIG_ENVIO.disponibilidad, ...envio.disponibilidad };
    }
    // Repinta el carrito visible con el envío real
    if (
      document.body.dataset.pagina === "carrito" &&
      typeof pintarCarrito === "function" &&
      typeof leerCarrito === "function"
    ) {
      pintarCarrito(leerCarrito());
    }
  };

  // Redes sociales del pie: iconos con las URLs del panel (Ajustes → Redes)
  const ICONOS_SOCIALES = {
    instagram: "M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.562-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 100-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 01-2.88 0 1.44 1.44 0 012.88 0z",
    facebook: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z",
    tiktok: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.91-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
    youtube: "M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
    whatsapp: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z",
    pinterest: "M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.404-5.965 1.404-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.224-.181.272-.427.165-1.555-.65-2.53-2.689-2.53-4.329 0-3.507 2.548-6.727 7.351-6.727 3.859 0 6.86 2.751 6.86 6.429 0 3.839-2.42 6.928-5.78 6.928-1.128 0-2.188-.587-2.55-1.28l-.696 2.652c-.252 1.02-.932 2.301-1.389 3.081.997.308 2.05.473 3.139.473 6.621 0 11.987-5.367 11.987-11.987C24.014 5.367 18.641.001 12.017.001z",
  };

  const aplicarRedes = (datos) => {
    const pie = document.querySelector(".pie");
    const entradas = Object.entries(datos.redes || {}).filter(([, url]) => url);
    if (!pie || entradas.length === 0) return;
    // Los pies ya llevan los iconos en el HTML estático: evitar duplicados
    if (pie.querySelector(".pie-social") || pie.querySelector(".pie-redes")) return;
    const nombres = {
      instagram: "Instagram",
      tiktok: "TikTok",
      pinterest: "Pinterest",
      facebook: "Facebook",
      youtube: "YouTube",
      whatsapp: "WhatsApp",
    };
    const estilo = document.createElement("style");
    estilo.textContent =
      ".pie-social{display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;margin-top:2.4rem;padding-top:2.2rem;border-top:1px solid rgba(201,164,95,.22)}" +
      ".pie-social a{display:grid;place-items:center;width:44px;height:44px;border:1px solid rgba(201,164,95,.4);border-radius:50%;color:var(--oro);transition:background .35s ease,color .35s ease,transform .35s ease}" +
      ".pie-social a:hover{background:var(--oro);color:var(--verde);transform:translateY(-3px)}" +
      ".pie-social svg{width:20px;height:20px;fill:currentColor}";
    document.head.appendChild(estilo);
    const lista = document.createElement("nav");
    lista.className = "pie-social";
    lista.setAttribute("aria-label", "Redes sociales");
    lista.innerHTML = entradas
      .map(([red, url]) => {
        const icono = ICONOS_SOCIALES[red];
        if (!icono) return "";
        const nombre = nombres[red] || red;
        return `<a href="${escapar(url)}" target="_blank" rel="noopener noreferrer" aria-label="${nombre}" title="${nombre}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${icono}"/></svg></a>`;
      })
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
    zonasProductos: leerZonasProductos,
    get configuracion() {
      return configuracion;
    },
  };
})();

window.CONEXION = CONEXION;
