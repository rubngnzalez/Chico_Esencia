// Datos estáticos de la tienda: réplica exacta de los productos actuales (fallback sin API)
const DATOS_TIENDA = [
  {
    id: "esencia-umbral-50",
    nombre: "Esencia de Umbral · 50 ml",
    etiqueta: "Edición Limitada Numerada",
    descripcion: "El Eau de Parfum Neurosensorial original, 1ª Edición especial.",
    puntos: [
      "Inhala el Origen — el aroma invisible que abre el encuentro y te devuelve al interior.",
      "Exhala tu Esencia — libera el peso, aclara la mente y reconócete en este umbral.",
    ],
    precio: 55,
    precioAnterior: null,
    imagen: "img/esencia-meditacion.webp?v=2",
    alt: "Frasco verde de SHADDAI Esencia de Umbral de 50 ml en vista cenital sobre la mesa de madera oscura, rodeado del cuenco dorado con resinas de olíbano y copal, ámbar, ramas de canela, dátiles, nardos blancos e incienso encendido",
    vertical: false,
    inversa: false,
  },
  {
    id: "perfume-solido",
    nombre: "Perfume Sólido Natural · 12 g",
    etiqueta: "Formato de Viaje",
    descripcion: "La Esencia de Umbral en bálsamo: el umbral que cabe en el bolsillo y despierta despacio.",
    puntos: [
      "Fragancia sólida — se funde con la piel y libera su aroma al ritmo de tu pulso.",
      "Frasco de 12 g — para llevar el ritual en el bolsillo, sin pulverizar.",
      "Misma alma — Inhala el origen, exhala tu esencia, estés donde estés.",
    ],
    precio: 25,
    precioAnterior: null,
    imagen: "img/perfume-solido.webp?v=7",
    alt: "Perfume Sólido Natural de SHADDAI abierto sobre el altar de piedra, con el bálsamo crema a la vista y su tapa dorada grabada con el shin, junto al incienso, la canela, los dátiles y los jazmines",
    vertical: false,
    inversa: false,
  },
  {
    id: "duo-ritual",
    nombre: "Dúo Ritual · Esencia + Perfume Sólido",
    etiqueta: "Precio Especial · Las Dos Piezas",
    descripcion: "La Esencia de Umbral y el Perfume Sólido Natural juntos, con precio de lanzamiento.",
    puntos: [
      "Esencia de Umbral · 50 ml — el Eau de Parfum Neurosensorial original.",
      "Perfume Sólido Natural · 12 g — el umbral que cabe en el bolsillo.",
      "Ahorro especial — 75 € en lugar de 80 € por separado.",
    ],
    precio: 75,
    precioAnterior: 80,
    imagen: "img/duo-esencial.webp?v=8",
    alt: "Dúo Ritual de SHADDAI: el frasco verde de la Esencia de Umbral de 50 ml junto al Perfume Sólido Natural abierto con su tapa dorada del shin, sobre la losa de piedra entre jazmines, canela y dátiles, a la luz cálida del amanecer",
    vertical: false,
    inversa: true,
  },
];

// Re-render de la tienda con los productos de la base de datos cuando hay
// conexión (Supabase → productos_publicos con precio_efectivo; o Worker).
// Sin conexión queda el HTML estático actual: degradación silenciosa.
(() => {
  if (document.body.dataset.pagina !== "tienda" || typeof CONEXION === "undefined") return;

  // Las imágenes .jpg de la semilla no existen en la web: se usan las .webp actuales
  const IMAGENES_CONOCIDAS = {
    "esencia-umbral-50": DATOS_TIENDA[0].imagen,
    "perfume-solido": DATOS_TIENDA[1].imagen,
    "duo-ritual": DATOS_TIENDA[2].imagen,
  };
  const IMAGENES_ALIAS = {
    "balsamo-solido": "perfume-solido",
    "balsamo-solido-natural-12-g": "perfume-solido",
  };
  const IMAGENES_SEMILLA = [
    "img/esencia-50.jpg",
    "img/perfume-solido.jpg",
    "img/duo-esencial.jpg",
    "img/esencia-50.webp",
    "img/perfume-solido.webp",
    "img/duo-esencial.webp",
  ];

  const imagenDe = (producto) => {
    const codigo = String(producto.codigo || producto.slug || producto.id || "").toLowerCase();
    const clave = IMAGENES_ALIAS[codigo] || codigo;
    const actual = producto.imagenes && producto.imagenes[0];
    if (actual && !IMAGENES_SEMILLA.includes(actual)) {
      // Las imágenes del bucket «recursos» de Supabase son URLs completas
      // (https://…supabase.co/storage/v1/object/public/recursos/…): se usan tal cual.
      if (/^(https?:)?\/\//.test(actual)) return actual;
      // Compatibilidad con rutas del almacenamiento del Worker antiguo
      if (typeof window.SHADDAI_API_BASE === "string" && window.SHADDAI_API_BASE && /^recursos\//.test(actual)) {
        return window.SHADDAI_API_BASE.replace(/\/$/, "") + "/" + actual;
      }
      return actual;
    }
    return IMAGENES_CONOCIDAS[clave] || actual || "";
  };

  // Imagen para el carrito (los botones guardan una miniatura): la primera de
  // verdad; si el producto solo tiene vídeos, se queda con ese vídeo.
  const imagenCarrito = (producto) => {
    const lista = Array.isArray(producto.imagenes) ? producto.imagenes : [];
    const sinVideo = lista.find((ruta) => !esVideoUrl(ruta));
    if (!sinVideo || IMAGENES_SEMILLA.includes(sinVideo)) return imagenDe(producto);
    return urlMedio(sinVideo);
  };

  // Resuelve rutas de medios restantes (compatibilidad Worker antiguo)
  const urlMedio = (ruta) => {
    const valor = String(ruta || "");
    if (!valor || IMAGENES_SEMILLA.includes(valor)) return "";
    if (/^(https?:)?\/\//.test(valor)) return valor;
    if (typeof window.SHADDAI_API_BASE === "string" && window.SHADDAI_API_BASE && /^recursos\//.test(valor)) {
      return window.SHADDAI_API_BASE.replace(/\/$/, "") + "/" + valor;
    }
    return valor;
  };

  const esVideoUrl = (ruta) => /\.(mp4|webm|mov)(\?|#|$)/i.test(String(ruta || ""));

  // Medios del producto para el carrusel: la imagen principal primero y,
  // debajo, el resto de imágenes y vídeos (viven juntos en producto.imagenes)
  const mediosDe = (producto) => {
    const medios = [];
    const principal = imagenDe(producto);
    if (principal) medios.push({ url: principal, video: esVideoUrl(principal) });
    (Array.isArray(producto.imagenes) ? producto.imagenes : []).slice(1).forEach((ruta) => {
      const url = urlMedio(ruta);
      if (url && !medios.some((m) => m.url === url)) medios.push({ url, video: esVideoUrl(url) });
    });
    return medios;
  };

  const precioTexto = (valor) => {
    const numero = Number(valor) || 0;
    const texto = numero.toLocaleString("es-ES", {
      minimumFractionDigits: Number.isInteger(numero) ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return `${texto}\u00a0€`;
  };

  // Precio con la oferta aplicada (la API ya devuelve precioEfectivo)
  const precioHtml = (producto) => {
    const efectivo = Number(producto.precioEfectivo != null ? producto.precioEfectivo : producto.precio) || 0;
    const base = Number(producto.precio) || 0;
    if (base > efectivo) {
      return `${precioTexto(efectivo)} <span style="font-size: 1.1rem; opacity: .55; text-decoration: line-through;">${precioTexto(base)}</span>`;
    }
    return precioTexto(efectivo);
  };

  // El "·" del nombre se pinta en dorado, como en las secciones estáticas
  const tituloHtml = (nombre) => {
    const partes = String(nombre || "").split("·");
    if (partes.length < 2) return CONEXION.escapar(nombre || "");
    return `${CONEXION.escapar(partes[0].trim())} <span class="oro">· ${CONEXION.escapar(partes.slice(1).join("·").trim())}</span>`;
  };

  const etiquetaDe = (producto) => {
    const texto = String(producto.categoria || "").replace(/-/g, " ").trim();
    return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "Edición Limitada";
  };

  // Mismos data-atributos que las secciones estáticas: el carrito funciona igual
  const botonHtml = (producto) => {
    const efectivo = Number(producto.precioEfectivo != null ? producto.precioEfectivo : producto.precio) || 0;
    const atributos =
      `data-id="${CONEXION.escapar(producto.codigo || producto.slug || producto.id)}" ` +
      `data-nombre="${CONEXION.escapar(producto.nombre)}" ` +
      `data-precio="${efectivo}" ` +
      `data-imagen="${CONEXION.escapar(imagenCarrito(producto))}"`;
    if (Number(producto.stock) === 0) {
      return `<button class="boton boton-lleno boton-anadir" ${atributos} disabled aria-disabled="true">Agotado</button>`;
    }
    return `<button class="boton boton-lleno boton-anadir" ${atributos}>Añadir al carrito</button>`;
  };

  // Orden fijo de la tienda: Esencia, Bálsamo (Perfume Sólido) segundo y
  // Dúo Ritual al final; códigos del panel y de la web, sin distinguir mayúsculas
  const ORDEN_TIENDA = [
    "esencia-umbral-50",
    "balsamo-solido",
    "balsamo-solido-natural-12-g",
    "perfume-solido",
    "duo-ritual",
  ];

  // Orientación y lado de cada producto (las fotos horizontales no van en marco vertical)
  const ALIAS_DATOS = {
    "balsamo-solido": "perfume-solido",
    "balsamo-solido-natural-12-g": "perfume-solido",
  };
  const datosDe = (producto) => {
    const codigo = String(producto.codigo || producto.slug || producto.id || "").toLowerCase();
    const clave = ALIAS_DATOS[codigo] || codigo;
    return DATOS_TIENDA.find((dato) => dato.id === clave) || null;
  };

  const ordenarComoTienda = (productos) => {
    const posicion = (producto) => {
      const codigo = String(producto.codigo || producto.slug || producto.id || "").toLowerCase();
      const indice = ORDEN_TIENDA.indexOf(codigo);
      return indice === -1 ? ORDEN_TIENDA.length : indice;
    };
    return productos.slice().sort((a, b) => posicion(a) - posicion(b));
  };

  // Carrusel de medios: visor encima y tira de miniaturas debajo del marco.
  // Con un solo medio se mantiene el marcado clásico de una sola imagen.
  // El visor permite el AUDIO del vídeo: sin muted ni autoplay (los navegadores
  // bloquean el sonido sin gesto); lo arranca el usuario con el botón ▶.
  const medioVisorHtml = (medio, producto, indice) =>
    medio.video
      ? `<video src="${CONEXION.escapar(medio.url)}" controls playsinline preload="metadata" aria-label="${CONEXION.escapar(producto.nombre)} — vídeo ${indice + 1}"></video>`
      : `<img src="${CONEXION.escapar(medio.url)}" alt="${CONEXION.escapar(producto.nombre)} — SHADDAI" loading="lazy">`;

  const carruselHtml = (producto, medidas) => {
    const medios = mediosDe(producto);
    if (medios.length === 0) return "";
    if (medios.length === 1) {
      const medio = medios[0];
      return medio.video
        ? `<div class="carrusel-producto"><div class="carrusel-producto-visor"><div class="carrusel-producto-medio">${medioVisorHtml(medio, producto, 0)}</div></div></div>`
        : `<img src="${CONEXION.escapar(medio.url)}" alt="${CONEXION.escapar(producto.nombre)} — SHADDAI" loading="lazy" ${medidas}>`;
    }
    const flechas =
      `<button type="button" class="carrusel-producto-flecha anterior" data-flecha="-1" aria-label="Medio anterior">&#8249;</button>` +
      `<button type="button" class="carrusel-producto-flecha siguiente" data-flecha="1" aria-label="Medio siguiente">&#8250;</button>`;
    const pulgares = medios
      .map((medio, indice) =>
        `<button type="button" class="carrusel-producto-pulgar${indice === 0 ? " activa" : ""}" data-pulgar="${indice}" aria-label="Ver ${medio.video ? "vídeo" : "imagen"} ${indice + 1} de ${medios.length}">` +
        (medio.video
          ? `<video src="${CONEXION.escapar(medio.url)}#t=0.1" muted preload="metadata"></video><span class="carrusel-producto-play" aria-hidden="true">▶</span>`
          : `<img src="${CONEXION.escapar(medio.url)}" alt="" loading="lazy">`) +
        `</button>`)
      .join("");
    return (
      `<div class="carrusel-producto" data-carrusel>` +
      `<div class="carrusel-producto-visor">` +
      `<div class="carrusel-producto-medio">${medioVisorHtml(medios[0], producto, 0)}</div>` +
      flechas +
      `</div>` +
      `<div class="carrusel-producto-miniaturas">${pulgares}</div>` +
      `</div>`
    );
  };

  // Conecta el carrusel de una sección: flechas y miniaturas cambian el visor
  const conectarCarrusel = (seccion, producto) => {
    const carrusel = seccion.querySelector("[data-carrusel]");
    if (!carrusel) return;
    const medios = mediosDe(producto);
    const caja = carrusel.querySelector(".carrusel-producto-medio");
    const tira = carrusel.querySelector(".carrusel-producto-miniaturas");
    let indice = 0;
    const irA = (destino) => {
      indice = (destino + medios.length) % medios.length;
      caja.innerHTML = medioVisorHtml(medios[indice], producto, indice);
      tira.querySelectorAll(".carrusel-producto-pulgar").forEach((pulgar, i) => {
        pulgar.classList.toggle("activa", i === indice);
      });
      const activo = tira.querySelectorAll(".carrusel-producto-pulgar")[indice];
      if (activo && tira.scrollWidth > tira.clientWidth) {
        tira.scrollTo({ left: activo.offsetLeft - tira.clientWidth / 2 + activo.clientWidth / 2, behavior: "smooth" });
      }
    };
    carrusel.addEventListener("click", (evento) => {
      const flecha = evento.target.closest("[data-flecha]");
      if (flecha) {
        irA(indice + Number(flecha.dataset.flecha));
        return;
      }
      const pulgar = evento.target.closest("[data-pulgar]");
      if (pulgar) irA(Number(pulgar.dataset.pulgar));
    });
  };

  // Mismo marcado y clases que las secciones estáticas para no romper estilos
  const crearSeccion = (producto, indice) => {
    const seccion = document.createElement("section");
    seccion.className = "seccion";
    const imagen = imagenDe(producto);
    const datos = datosDe(producto);
    const vertical = datos ? datos.vertical : false;
    const inversa = datos ? datos.inversa : indice % 2 === 1;
    const medidas = vertical ? 'width="900" height="1125"' : 'width="800" height="600"';
    const codigoCarrito = String(producto.codigo || producto.slug || producto.id || "");
    // Disponibilidad por destino (el panel la define en Ajustes → Envío)
    const zonasProducto =
      typeof zonasDeProducto === "function" ? zonasDeProducto(codigoCarrito) : null;
    const notaZonas =
      zonasProducto && zonasProducto.length && zonasProducto.length < 4
        ? ` Envío a: ${CONEXION.escapar(zonasProducto.join(" · "))}.`
        : "";
    seccion.innerHTML =
      `<div class="contenedor dos-columnas${inversa ? " inversa" : ""}">` +
      (imagen
        ? `<div class="columna-imagen marco-imagen compra-figura${vertical ? " vertical" : ""} revelar visible">` +
          carruselHtml(producto, medidas) +
          `</div>`
        : "") +
      `<div class="compra revelar visible">` +
      `<span class="etiqueta">${CONEXION.escapar(etiquetaDe(producto))}</span>` +
      `<h2 class="titulo">${tituloHtml(producto.nombre)}</h2>` +
      `<p class="texto-grande">${CONEXION.escapar(producto.descripcion || producto.historia || "")}</p>` +
      `<p class="compra-precio">${precioHtml(producto)}</p>` +
      botonHtml(producto) +
      `<p class="compra-nota">Por orden de solicitud.${notaZonas} Tu pedido incluye una mini muestra para descubrir la esencia sin romper el precinto. Por motivos de higiene, no se aceptan devoluciones una vez abierto el precinto de garantía: consulta la <a href="devoluciones.html">Política de Devoluciones</a> y la <a href="politica.html">Política de Envío Consciente</a>.</p>` +
      `</div>` +
      `</div>`;
    seccion.dataset.productoTienda = codigoCarrito;
    conectarCarrusel(seccion, producto);
    return seccion;
  };

  // URLs directas por producto para campañas y enlaces compartidos:
  //   tienda.html?producto=esencia-umbral-50 | perfume-solido | duo-ritual
  // Muestra solo esa ficha, la destaca y centra el scroll; con un código
  // desconocido (o sin parámetro) la tienda funciona con normalidad.
  const productoPedido = (() => {
    const pedido = new URLSearchParams(location.search).get("producto");
    if (!pedido) return "";
    const clave = String(pedido).toLowerCase().trim();
    return IMAGENES_ALIAS[clave] || clave;
  })();

  const aplicarProductoPedido = () => {
    if (!productoPedido) return;
    const todas = Array.from(document.querySelectorAll("[data-producto-tienda]"));
    const objetivo = todas.find((seccion) => (seccion.dataset.productoTienda || "") === productoPedido);
    if (!objetivo) return;
    document.querySelectorAll(".enlace-todos").forEach((enlace) => enlace.remove());
    todas.forEach((seccion) => { seccion.hidden = seccion !== objetivo; });
    objetivo.hidden = false;
    objetivo.classList.add("producto-destacado");
    const enlace = document.createElement("p");
    enlace.className = "centrar enlace-todos";
    enlace.innerHTML = `<a href="tienda.html">&#8592; Ver todos los productos de la tienda</a>`;
    objetivo.parentNode.insertBefore(enlace, objetivo);
    const titulo = objetivo.querySelector(".titulo");
    if (titulo) document.title = `${titulo.textContent.trim()} — SHADDAI · Esencia de Umbral`;
    setTimeout(() => {
      objetivo.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  };

  // Si no hay conexión no pasa nada: queda el HTML estático actual.
  // Se espera también al mapa de zonas por producto (disponibilidad de envío)
  const cargaProductos = CONEXION.get("/api/productos/publico");
  const cargaZonas =
    typeof CONEXION.zonasProductos === "function"
      ? CONEXION.zonasProductos().catch(() => null)
      : Promise.resolve(null);
  Promise.all([cargaProductos, cargaZonas]).then(([cuerpo, mapa]) => {
    if (mapa && typeof mapa === "object") MAPA_ZONAS_PRODUCTO.valor = mapa;
    const productos = cuerpo && Array.isArray(cuerpo.datos) ? cuerpo.datos : [];
    if (productos.length === 0) return;
    const estaticas = Array.from(document.querySelectorAll("[data-producto-tienda]"));
    if (estaticas.length === 0) return;
    const ancla = estaticas[estaticas.length - 1].nextElementSibling;
    estaticas.forEach((seccion) => seccion.remove());
    ordenarComoTienda(productos)
      .map((producto, indice) => crearSeccion(producto, indice))
      .forEach((seccion) => {
        if (ancla && ancla.parentNode) ancla.parentNode.insertBefore(seccion, ancla);
        else document.querySelector("main").appendChild(seccion);
      });
    aplicarProductoPedido();
  });

  // Sin conexión a la base de datos: el filtro actúa sobre las fichas estáticas
  aplicarProductoPedido();
})();
