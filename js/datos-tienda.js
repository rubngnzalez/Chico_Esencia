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
    imagen: "img/esencia-50.webp?v=6",
    alt: "Frasco verde de SHADDAI Esencia de Umbral de 50 ml junto a su caja verde con la Shin dorada, sobre un pedestal dorado en el templo",
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
    imagen: "img/perfume-solido.webp?v=6",
    alt: "Perfume Sólido Natural de SHADDAI sobre el altar de piedra, con su tapa dorada grabada",
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
    imagen: "img/duo-esencial.webp?v=6",
    alt: "Dúo Ritual de SHADDAI: la Esencia de Umbral de 50 ml y el Perfume Sólido Natural sobre el altar de ceremonia, con incienso y jazmines",
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
  const IMAGENES_SEMILLA = [
    "img/esencia-50.jpg",
    "img/perfume-solido.jpg",
    "img/duo-esencial.jpg",
    "img/esencia-50.webp",
    "img/perfume-solido.webp",
    "img/duo-esencial.webp",
  ];

  const imagenDe = (producto) => {
    const actual = producto.imagenes && producto.imagenes[0];
    if (!actual || IMAGENES_SEMILLA.includes(actual)) {
      return IMAGENES_CONOCIDAS[producto.codigo] || actual || "";
    }
    // Las imágenes del bucket «recursos» de Supabase son URLs completas
    // (https://…supabase.co/storage/v1/object/public/recursos/…): se usan tal cual.
    if (/^(https?:)?\/\//.test(actual)) return actual;
    // Compatibilidad con rutas del almacenamiento del Worker antiguo
    if (typeof window.SHADDAI_API_BASE === "string" && window.SHADDAI_API_BASE && /^recursos\//.test(actual)) {
      return window.SHADDAI_API_BASE.replace(/\/$/, "") + "/" + actual;
    }
    return actual;
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
      `data-imagen="${CONEXION.escapar(imagenDe(producto))}"`;
    if (Number(producto.stock) === 0) {
      return `<button class="boton boton-lleno boton-anadir" ${atributos} disabled aria-disabled="true">Agotado</button>`;
    }
    return `<button class="boton boton-lleno boton-anadir" ${atributos}>Añadir al carrito</button>`;
  };

  // Orden fijo de la tienda: Esencia, Perfume Sólido y Dúo al final
  const ORDEN_TIENDA = ["esencia-umbral-50", "perfume-solido", "duo-ritual"];

  // Orientación y lado de cada producto (las fotos horizontales no van en marco vertical)
  const datosDe = (producto) => {
    const codigo = String(producto.codigo || producto.slug || producto.id || "");
    return DATOS_TIENDA.find((dato) => dato.id === codigo) || null;
  };

  const ordenarComoTienda = (productos) => {
    const posicion = (producto) => {
      const codigo = String(producto.codigo || producto.slug || producto.id || "");
      const indice = ORDEN_TIENDA.indexOf(codigo);
      return indice === -1 ? ORDEN_TIENDA.length : indice;
    };
    return productos.slice().sort((a, b) => posicion(a) - posicion(b));
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
    seccion.innerHTML =
      `<div class="contenedor dos-columnas${inversa ? " inversa" : ""}">` +
      (imagen
        ? `<div class="columna-imagen marco-imagen compra-figura${vertical ? " vertical" : ""} revelar visible">` +
          `<img src="${CONEXION.escapar(imagen)}" alt="${CONEXION.escapar(producto.nombre)} — SHADDAI" loading="lazy" ${medidas}>` +
          `</div>`
        : "") +
      `<div class="compra revelar visible">` +
      `<span class="etiqueta">${CONEXION.escapar(etiquetaDe(producto))}</span>` +
      `<h2 class="titulo">${tituloHtml(producto.nombre)}</h2>` +
      `<p class="texto-grande">${CONEXION.escapar(producto.descripcion || producto.historia || "")}</p>` +
      `<p class="compra-precio">${precioHtml(producto)}</p>` +
      botonHtml(producto) +
      `<p class="compra-nota">Por orden de solicitud. Consulta la <a href="politica.html">Política de Envío Consciente</a>.</p>` +
      `</div>` +
      `</div>`;
    return seccion;
  };

  // Si no hay conexión no pasa nada: queda el HTML estático actual
  CONEXION.get("/api/productos/publico").then((cuerpo) => {
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
  });
})();
