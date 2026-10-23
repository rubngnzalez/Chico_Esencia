// Conexión con la API del panel: fetch con timeout corto y degradación silenciosa.
// Si la API no responde (modo GitHub Pages), la web sigue funcionando como estática.
const CONEXION = (() => {
  const TIEMPO_MS = 2500; // espera máxima: en estático la carga no se ralentiza
  const pendientes = new Map(); // respuestas GET reutilizables dentro de la misma página

  // Escapa el texto que llega del panel antes de pintarlo en el DOM
  const escapar = (texto) =>
    String(texto == null ? "" : texto).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const peticion = (ruta, metodo, cuerpo) => {
    const clave = metodo + " " + ruta + (cuerpo ? " " + JSON.stringify(cuerpo) : "");
    if (metodo === "GET" && pendientes.has(clave)) return pendientes.get(clave);

    const promesa = (async () => {
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), TIEMPO_MS);
      try {
        const respuesta = await fetch(ruta, {
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

  // GET: cuerpo JSON o null si la API no está disponible
  const get = async (ruta) => {
    const respuesta = await peticion(ruta, "GET");
    return respuesta && respuesta.ok && respuesta.cuerpo ? respuesta.cuerpo : null;
  };

  // POST: cuerpo JSON (también en error, para mostrar su mensaje) o null sin red
  const post = async (ruta, cuerpo) => {
    const respuesta = await peticion(ruta, "POST", cuerpo);
    return respuesta ? respuesta.cuerpo : null;
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
  const cuandoConfig = get("/api/public/config")
    .then((cuerpo) => {
      configuracion = cuerpo && cuerpo.datos ? cuerpo.datos : null;
      if (configuracion) {
        aplicarEnvio(configuracion);
        aplicarRedes(configuracion);
      }
      return configuracion;
    })
    .catch(() => null);

  // ---- Testimonios: las secciones solo se rellenan con aprobados de la API ----
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
