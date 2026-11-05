// Navegación: fondo al hacer scroll
const cabecera = document.querySelector(".cabecera");
const marcarFondo = () => {
  if (window.scrollY > 40) {
    cabecera.classList.add("fondo");
  } else {
    cabecera.classList.remove("fondo");
  }
};
marcarFondo();
window.addEventListener("scroll", marcarFondo, { passive: true });

// Menú móvil: botón de cierre único, Escape, toque fuera y foco gestionado
const botonMenu = document.querySelector(".menu-boton");
const navegacion = document.querySelector(".navegacion");

if (botonMenu && navegacion) {
  navegacion.id = "menu-principal";
  botonMenu.setAttribute("aria-controls", "menu-principal");
  botonMenu.setAttribute("aria-expanded", "false");

  // El botón de cierre se crea una sola vez (antes se duplicaba en cada apertura)
  const botonCerrar = document.createElement("button");
  botonCerrar.type = "button";
  botonCerrar.className = "cerrar";
  botonCerrar.setAttribute("aria-label", "Cerrar menú");
  botonCerrar.textContent = "×";
  navegacion.appendChild(botonCerrar);

  const abrirMenu = () => {
    navegacion.classList.add("abierta");
    document.body.classList.add("menu-abierto");
    botonMenu.setAttribute("aria-expanded", "true");
    botonCerrar.focus({ preventScroll: true });
  };

  const cerrarMenu = () => {
    if (!navegacion.classList.contains("abierta")) return;
    navegacion.classList.remove("abierta");
    document.body.classList.remove("menu-abierto");
    botonMenu.setAttribute("aria-expanded", "false");
    botonMenu.focus({ preventScroll: true });
  };

  botonMenu.addEventListener("click", () => {
    if (navegacion.classList.contains("abierta")) cerrarMenu();
    else abrirMenu();
  });
  botonCerrar.addEventListener("click", cerrarMenu);

  // Un único listener por enlace (antes se acumulaban en cada apertura)
  navegacion.querySelectorAll("a").forEach((enlace) =>
    enlace.addEventListener("click", cerrarMenu)
  );

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") cerrarMenu();
  });

  // Cierre al tocar o hacer clic fuera de la capa de navegación
  document.addEventListener("pointerdown", (evento) => {
    if (
      navegacion.classList.contains("abierta") &&
      !navegacion.contains(evento.target) &&
      !botonMenu.contains(evento.target)
    ) {
      cerrarMenu();
    }
  });
}

// Enlace activo según la página
const pagina = document.body.dataset.pagina;
document.querySelectorAll(".navegacion a").forEach((enlace) => {
  if (enlace.dataset.pagina === pagina) {
    enlace.classList.add("activo");
  }
});

// Luciérnagas doradas del umbral (fondo animado)
const fondo = document.querySelector(".fondo-magico");
const movimientoReducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (fondo && !movimientoReducido) {
  const total = 26;
  for (let i = 0; i < total; i++) {
    const luz = document.createElement("span");
    luz.className = "luz";
    luz.style.left = (Math.random() * 100).toFixed(2) + "%";
    luz.style.setProperty("--tamano", (1.5 + Math.random() * 3).toFixed(1) + "px");
    luz.style.setProperty("--duracion", (15 + Math.random() * 18).toFixed(1) + "s");
    luz.style.setProperty("--retraso", (-Math.random() * 33).toFixed(1) + "s");
    luz.style.setProperty("--deriva", ((Math.random() * 160 - 80).toFixed(0)) + "px");
    luz.style.setProperty("--maxo", (0.35 + Math.random() * 0.55).toFixed(2));
    fondo.appendChild(luz);
  }

  // Volutas de vapor de perfume que ascienden
  for (let i = 0; i < 6; i++) {
    const voluta = document.createElement("span");
    voluta.className = "vapor";
    const base = 170 + Math.random() * 260;
    voluta.style.width = base.toFixed(0) + "px";
    voluta.style.height = (base * 1.6).toFixed(0) + "px";
    voluta.style.left = (Math.random() * 96).toFixed(2) + "%";
    voluta.style.setProperty("--duracion-v", (32 + Math.random() * 26).toFixed(1) + "s");
    voluta.style.setProperty("--retraso-v", (-Math.random() * 58).toFixed(1) + "s");
    voluta.style.setProperty("--deriva-v", ((Math.random() * 240 - 120).toFixed(0)) + "px");
    fondo.appendChild(voluta);
  }
}

// Aparición suave de elementos
const observador = new IntersectionObserver(
  (entradas) => {
    entradas.forEach((entrada) => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add("visible");
        observador.unobserve(entrada.target);
      }
    });
  },
  { threshold: 0.14 }
);
document.querySelectorAll(".revelar").forEach((el) => observador.observe(el));

// Formulario de contacto: API del panel; si no responde, correo con el mensaje preparado
const formulario = document.querySelector(".formulario");
if (formulario) {
  formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const datos = new FormData(formulario);
    const nombre = (datos.get("nombre") || "").toString().trim();
    const email = (datos.get("email") || "").toString().trim();
    const mensaje = (datos.get("mensaje") || "").toString().trim();
    const telefono = (datos.get("telefono") || "").toString().trim();
    const web = (datos.get("web") || "").toString(); // honeypot: los humanos no lo rellenan
    const aviso = document.querySelector(".aviso-formulario");
    const boton = formulario.querySelector('button[type="submit"]');

    const enviarPorCorreo = () => {
      const asunto = `Mensaje de la web · ${nombre || "consulta"}`;
      const cuerpo = `Nombre: ${nombre}\nEmail: ${email}\n\n${mensaje}`;
      window.location.href = `mailto:hola@shaddai.es?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
      aviso.textContent = "Se abre tu correo con el mensaje preparado para hola@shaddai.es: tu palabra queda registrada al enviarlo.";
      formulario.reset();
    };

    if (typeof CONEXION !== "undefined") {
      aviso.textContent = "Enviando tu mensaje…";
      if (boton) boton.disabled = true;
      const respuesta = await CONEXION.post("/api/public/contacto", { nombre, email, mensaje, telefono, web });
      if (boton) boton.disabled = false;
      if (respuesta) {
        if (respuesta.ok) {
          aviso.textContent = respuesta.mensaje || `Gracias, ${nombre || "alma buscadora"}. Hemos recibido tu mensaje: te responderemos con la calma que mereces.`;
          formulario.reset();
        } else {
          aviso.textContent = `${respuesta.error || "No hemos podido enviar tu mensaje."} También puedes escribirnos a hola@shaddai.es.`;
        }
        return;
      }
      // Sin API disponible: correo de toda la vida
      enviarPorCorreo();
      return;
    }
    enviarPorCorreo();
  });
}

// Boletín del Umbral: alta en la API del panel; sin ella, confirmación local
const boletin = document.querySelector(".boletin");
if (boletin) {
  boletin.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const correo = (new FormData(boletin).get("correo") || "").toString().trim();
    const aviso = document.querySelector(".aviso-boletin");
    if (typeof CONEXION !== "undefined") {
      const respuesta = await CONEXION.post("/api/public/suscribirse", { email: correo });
      if (respuesta) {
        boletin.reset();
        if (aviso) {
          aviso.textContent = respuesta.ok
            ? respuesta.mensaje || "Bienvenido al Umbral: recibirás las próximas reflexiones y aperturas de lotes limitados."
            : respuesta.error || "No hemos podido completar tu suscripción: inténtalo de nuevo en un momento.";
        }
        return;
      }
    }
    boletin.reset();
    if (aviso) aviso.textContent = "Bienvenido al Umbral: recibirás las próximas reflexiones y aperturas de lotes limitados.";
  });
}

// Carrito del Umbral (almacenamiento local del navegador)
const CLAVE_CARRITO = "shaddai-carrito-v2";

const leerCarrito = () => {
  try {
    const datos = JSON.parse(localStorage.getItem(CLAVE_CARRITO));
    return Array.isArray(datos) ? datos : [];
  } catch {
    return [];
  }
};

const formatearPrecio = (valor) =>
  valor.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: Number.isInteger(valor) ? 0 : 2,
    maximumFractionDigits: 2,
  });

// Gastos de envío: edita estos datos con los tuyos
const CONFIG_ENVIO = {
  coste: 5.9,        // envío peninsular estándar
  gratisDesde: 80,   // envío gratuito a partir de este importe
};

const calcularTotales = (articulos) => {
  const subtotal = articulos.reduce((suma, articulo) => suma + articulo.precio * articulo.cantidad, 0);
  const envio = subtotal === 0 || subtotal >= CONFIG_ENVIO.gratisDesde ? 0 : CONFIG_ENVIO.coste;
  return { subtotal, envio, total: subtotal + envio };
};

const pintarConteoCarrito = (articulos) => {
  const unidades = articulos.reduce((suma, articulo) => suma + articulo.cantidad, 0);
  document.querySelectorAll(".carrito-conteo").forEach((conteo) => {
    conteo.textContent = unidades > 99 ? "99+" : String(unidades);
    conteo.classList.toggle("visible", unidades > 0);
  });
};

const pintarCarrito = (articulos) => {
  const lista = document.querySelector(".carrito-lista");
  const resumen = document.querySelector(".carrito-resumen");
  const vacia = document.querySelector(".carrito-vacia");
  if (!lista || !resumen || !vacia) return;

  lista.innerHTML = "";
  resumen.hidden = articulos.length === 0;
  vacia.hidden = articulos.length > 0;

  articulos.forEach((articulo) => {
    const fila = document.createElement("article");
    fila.className = "carrito-item";
    fila.innerHTML = `
      <img src="${articulo.imagen}" alt="${articulo.nombre}">
      <div class="item-info">
        <h3>${articulo.nombre}</h3>
        <p class="item-precio">${formatearPrecio(articulo.precio)} / unidad</p>
      </div>
      <div class="item-acciones">
        <div class="cantidad">
          <button type="button" data-accion="menos" data-id="${articulo.id}" aria-label="Quitar una unidad de ${articulo.nombre}">−</button>
          <span>${articulo.cantidad}</span>
          <button type="button" data-accion="mas" data-id="${articulo.id}" aria-label="Añadir una unidad de ${articulo.nombre}">+</button>
        </div>
        <button type="button" class="quitar" data-accion="quitar" data-id="${articulo.id}">Quitar</button>
      </div>`;
    lista.appendChild(fila);
  });

  const { subtotal, envio, total } = calcularTotales(articulos);
  const importe = document.querySelector(".carrito-total .importe");
  const lineaSubtotal = document.querySelector(".linea-subtotal");
  const lineaEnvio = document.querySelector(".linea-envio");
  const notaEnvio = document.querySelector(".carrito-envio-nota");
  if (importe) importe.textContent = formatearPrecio(total);
  if (lineaSubtotal) lineaSubtotal.textContent = formatearPrecio(subtotal);
  if (lineaEnvio) {
    lineaEnvio.textContent = envio === 0 ? "Gratis" : formatearPrecio(envio);
    lineaEnvio.classList.toggle("gratis", envio === 0);
  }
  if (notaEnvio && articulos.length > 0) {
    notaEnvio.textContent =
      envio === 0
        ? "Envío gratuito aplicado a tu reserva."
        : `Envío peninsular: gratis a partir de ${formatearPrecio(CONFIG_ENVIO.gratisDesde)}. Añade ${formatearPrecio(CONFIG_ENVIO.gratisDesde - subtotal)} más y el envío es gratis.`;
  }
};

const escribirCarrito = (articulos) => {
  localStorage.setItem(CLAVE_CARRITO, JSON.stringify(articulos));
  pintarConteoCarrito(articulos);
  if (document.body.dataset.pagina === "carrito") {
    pintarCarrito(articulos);
  }
};

// Anadir productos desde la tienda (delegado: cubre también los que llegan de la API)
const anadirAlCarrito = (boton) => {
  const { id, nombre, precio, imagen } = boton.dataset;
  const articulos = leerCarrito();
  const existente = articulos.find((item) => item.id === id);
  if (existente) {
    existente.cantidad += 1;
  } else {
    articulos.push({ id, nombre, precio: Number(precio), imagen, cantidad: 1 });
  }
  escribirCarrito(articulos);
  if (!boton.dataset.texto) boton.dataset.texto = boton.textContent;
  boton.textContent = "Añadido ✦";
  boton.classList.add("anadido");
  clearTimeout(boton._aviso);
  boton._aviso = setTimeout(() => {
    boton.textContent = boton.dataset.texto;
    boton.classList.remove("anadido");
  }, 1600);
};

document.addEventListener("click", (evento) => {
  const boton = evento.target.closest(".boton-anadir");
  if (boton) anadirAlCarrito(boton);
});

// Cambios de cantidad y borrado dentro del carrito
const contenidoCarrito = document.querySelector(".carrito-contenido");
if (contenidoCarrito) {
  contenidoCarrito.addEventListener("click", (evento) => {
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    const { accion, id } = boton.dataset;
    let articulos = leerCarrito();
    const articulo = articulos.find((item) => item.id === id);
    if (!articulo) return;
    if (accion === "mas") articulo.cantidad += 1;
    if (accion === "menos") articulo.cantidad = Math.max(0, articulo.cantidad - 1);
    articulos =
      accion === "quitar"
        ? articulos.filter((item) => item.id !== id)
        : articulos.filter((item) => item.cantidad > 0);
    escribirCarrito(articulos);
  });

  const botonVaciar = document.querySelector(".boton-vaciar");
  if (botonVaciar) {
    botonVaciar.addEventListener("click", () => escribirCarrito([]));
  }
}

// Pago directo del carrito: edita estos datos con los tuyos
const CONFIG_PAGO = {
  bizum: "600 000 000",
  iban: "ES00 0000 0000 0000 0000 0000",
  titular: "SHADDAI · Esencia de Umbral",
  email: "hola@shaddai.es",
};

const botonPagar = document.querySelector("[data-accion-pagar]");
const pagoPanel = document.querySelector(".pago-panel");

if (botonPagar && pagoPanel) {
  document.querySelectorAll("[data-pago]").forEach((elemento) => {
    elemento.textContent = CONFIG_PAGO[elemento.dataset.pago] || "";
  });

  botonPagar.addEventListener("click", () => {
    if (leerCarrito().length === 0) return;
    pagoPanel.hidden = false;
    pagoPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const formularioPago = pagoPanel.querySelector(".pago-formulario");
  const avisoPago = pagoPanel.querySelector(".aviso-formulario");

  formularioPago.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const articulos = leerCarrito();
    if (articulos.length === 0) return;

    const datos = new FormData(formularioPago);
    const nombre = (datos.get("nombre") || "").toString().trim();
    const email = (datos.get("email") || "").toString().trim();

    const lineas = articulos
      .map((articulo) => `${articulo.cantidad} × ${articulo.nombre} — ${formatearPrecio(articulo.precio * articulo.cantidad)}`)
      .join("\n");
    const { subtotal, envio, total } = calcularTotales(articulos);
    const asunto = `Pedido SHADDAI · ${nombre}`;
    const cuerpo =
      `Pedido desde el carrito:\n\n${lineas}\n\nSubtotal: ${formatearPrecio(subtotal)}\n` +
      `Gastos de envío: ${envio === 0 ? "Gratis" : formatearPrecio(envio)}\n` +
      `Total: ${formatearPrecio(total)}\n` +
      `Pago realizado vía Bizum/transferencia.\n\nNombre: ${nombre}\nEmail: ${email}\n` +
      `Fecha: ${new Date().toLocaleDateString("es-ES")}\n`;

    window.location.href = `mailto:${CONFIG_PAGO.email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;

    if (avisoPago) {
      avisoPago.textContent = "Se abre tu correo con el pedido listo para enviar: tu reserva queda registrada al recibirlo.";
    }
  });
}

// Estado inicial del carrito
const articulosIniciales = leerCarrito();
pintarConteoCarrito(articulosIniciales);
if (document.body.dataset.pagina === "carrito") {
  pintarCarrito(articulosIniciales);
}

// En contacto: arrastrar el resumen del carrito al mensaje de reserva
if (document.body.dataset.pagina === "contacto") {
  const mensaje = document.querySelector("#mensaje");
  const articulos = leerCarrito();
  if (mensaje && articulos.length > 0 && !mensaje.value) {
    const lineas = articulos.map(
      (articulo) =>
        `- ${articulo.cantidad} × ${articulo.nombre} (${formatearPrecio(articulo.precio * articulo.cantidad)})`
    );
    const total = articulos.reduce((suma, articulo) => suma + articulo.precio * articulo.cantidad, 0);
    mensaje.value = `Reserva desde el carrito:\n${lineas.join("\n")}\nTotal estimado: ${formatearPrecio(total)}\n\n`;
  }
}

// Carrusel del héroe: cambio de imagen con brote de niebla pulverizada
const capasHeroe = document.querySelectorAll(".carrusel-capa");
const nieblaHeroe = document.querySelector(".carrusel-niebla");

if (capasHeroe.length > 1 && nieblaHeroe && !movimientoReducido) {
  let capaActual = 0;
  setInterval(() => {
    capasHeroe[capaActual].classList.remove("activa");
    capaActual = (capaActual + 1) % capasHeroe.length;
    capasHeroe[capaActual].classList.add("activa");
    nieblaHeroe.classList.remove("brote");
    void nieblaHeroe.offsetWidth;
    nieblaHeroe.classList.add("brote");
  }, 7000);
}

// Universo del Umbral: estrellas, constelaciones y brotes de esencia al hacer clic
if (fondo && !movimientoReducido) {
  const UNIVERSO = {
    densidad: 15000,           // px² por estrella en escritorio
    densidadTactil: 11000,     // px² por estrella en pantallas pequeñas o táctiles
    minEstrellas: 60,
    maxEstrellas: 170,
    planos: [0.4, 0.7, 1.1],   // factor de parallax por plano de profundidad
    deslizMax: 13,             // px máximos de desplazamiento por plano
    suavizado: 0.04,           // interpolación del parallax
    radioConstelacion: 130,    // px de alcance de los hilos dorados
    broteMin: 24,              // partículas por clic
    broteMax: 36,
    friccionBrote: 0.96,
  };

  const punteroTactil = window.matchMedia("(pointer: coarse)").matches;
  // Tonos de estrellas e hilos: dorados, como las letras del sello
  const tonos = { estrellaA: [227, 201, 143], estrellaB: [243, 238, 226], hilo: "201, 164, 95" };
  const lienzo = document.createElement("canvas");
  lienzo.id = "universo-umbral";
  fondo.insertBefore(lienzo, fondo.firstChild);
  const contexto = lienzo.getContext("2d");

  let ancho = 0;
  let alto = 0;
  let areaAnterior = 0;
  let estrellas = [];
  let idAnimacion = null;
  let ultimoTiempo = performance.now();
  const brotes = [];
  const cursor = { x: -9999, y: -9999, activo: false };
  const desliz = UNIVERSO.planos.map(() => ({ x: 0, y: 0 }));

  const tonoEstrella = (mezcla, alfa) => {
    const a = tonos.estrellaA;
    const b = tonos.estrellaB;
    const r = Math.round(a[0] + (b[0] - a[0]) * mezcla);
    const g = Math.round(a[1] + (b[1] - a[1]) * mezcla);
    const v = Math.round(a[2] + (b[2] - a[2]) * mezcla);
    return `rgba(${r}, ${g}, ${v}, ${alfa})`;
  };

  const contarEstrellas = () => {
    const densidad = punteroTactil || ancho < 720 ? UNIVERSO.densidadTactil : UNIVERSO.densidad;
    return Math.max(
      UNIVERSO.minEstrellas,
      Math.min(UNIVERSO.maxEstrellas, Math.round((ancho * alto) / densidad))
    );
  };

  const sembrarEstrellas = () => {
    estrellas = Array.from({ length: contarEstrellas() }, () => ({
      px: Math.random(),
      py: Math.random(),
      plano: Math.floor(Math.random() * UNIVERSO.planos.length),
      radio: 0.5 + Math.random() * 1.1,
      brillo: 0.35 + Math.random() * 0.5,
      fase: Math.random() * Math.PI * 2,
      ritmo: 0.4 + Math.random() * 1.1,
      mezcla: Math.random(),
    }));
  };

  const ajustarTamano = () => {
    ancho = window.innerWidth;
    alto = window.innerHeight;
    const pixeles = window.devicePixelRatio || 1;
    lienzo.width = Math.round(ancho * pixeles);
    lienzo.height = Math.round(alto * pixeles);
    contexto.setTransform(pixeles, 0, 0, pixeles, 0, 0);
    const area = ancho * alto;
    const proporcion = areaAnterior > 0 ? area / areaAnterior : Infinity;
    if (estrellas.length === 0 || proporcion > 1.25 || proporcion < 0.8) {
      sembrarEstrellas();
      areaAnterior = area;
    }
  };

  const crearBrote = (x, y) => {
    const total =
      UNIVERSO.broteMin +
      Math.floor(Math.random() * (UNIVERSO.broteMax - UNIVERSO.broteMin + 1));
    for (let i = 0; i < total; i++) {
      const angulo = Math.random() * Math.PI * 2;
      const velocidad = 1.6 + Math.random() * 3.8;
      const vida = 1 + Math.random() * 0.6;
      brotes.push({
        x,
        y,
        vx: Math.cos(angulo) * velocidad,
        vy: Math.sin(angulo) * velocidad,
        radio: 0.8 + Math.random() * 1.4,
        vida,
        vidaTotal: vida,
        mezcla: Math.random(),
      });
    }
  };

  const pintar = (ahora) => {
    const dt = Math.min(0.05, (ahora - ultimoTiempo) / 1000);
    ultimoTiempo = ahora;
    const segundos = ahora / 1000;
    contexto.clearRect(0, 0, ancho, alto);

    // Parallax suave hacia la posición del cursor
    const objetivoX = cursor.activo ? (cursor.x / ancho) * 2 - 1 : 0;
    const objetivoY = cursor.activo ? (cursor.y / alto) * 2 - 1 : 0;
    UNIVERSO.planos.forEach((factor, i) => {
      desliz[i].x += (objetivoX * factor * UNIVERSO.deslizMax - desliz[i].x) * UNIVERSO.suavizado;
      desliz[i].y += (objetivoY * factor * UNIVERSO.deslizMax - desliz[i].y) * UNIVERSO.suavizado;
    });

    // Estrellas con parpadeo lento
    for (const estrella of estrellas) {
      const x = estrella.px * ancho + desliz[estrella.plano].x;
      const y = estrella.py * alto + desliz[estrella.plano].y;
      const parpadeo = 0.55 + 0.45 * Math.sin(segundos * estrella.ritmo + estrella.fase);
      contexto.beginPath();
      contexto.arc(x, y, estrella.radio, 0, Math.PI * 2);
      contexto.fillStyle = tonoEstrella(estrella.mezcla, estrella.brillo * parpadeo);
      contexto.fill();
    }

    // Constelaciones: hilos dorados entre el cursor y las estrellas cercanas
    if (cursor.activo) {
      const halo = contexto.createRadialGradient(
        cursor.x,
        cursor.y,
        0,
        cursor.x,
        cursor.y,
        UNIVERSO.radioConstelacion
      );
      halo.addColorStop(0, `rgba(${tonos.hilo}, 0.10)`);
      halo.addColorStop(1, `rgba(${tonos.hilo}, 0)`);
      contexto.fillStyle = halo;
      contexto.beginPath();
      contexto.arc(cursor.x, cursor.y, UNIVERSO.radioConstelacion, 0, Math.PI * 2);
      contexto.fill();

      contexto.lineWidth = 1;
      for (const estrella of estrellas) {
        const x = estrella.px * ancho + desliz[estrella.plano].x;
        const y = estrella.py * alto + desliz[estrella.plano].y;
        const distancia = Math.hypot(x - cursor.x, y - cursor.y);
        if (distancia < UNIVERSO.radioConstelacion) {
          const alfa = (1 - distancia / UNIVERSO.radioConstelacion) * 0.45;
          contexto.strokeStyle = `rgba(${tonos.hilo}, ${alfa.toFixed(3)})`;
          contexto.beginPath();
          contexto.moveTo(cursor.x, cursor.y);
          contexto.lineTo(x, y);
          contexto.stroke();
        }
      }
    }

    // Brotes de esencia: se frenan y se desvanecen
    const freno = Math.pow(UNIVERSO.friccionBrote, dt * 60);
    for (let i = brotes.length - 1; i >= 0; i--) {
      const particula = brotes[i];
      particula.vida -= dt;
      if (particula.vida <= 0) {
        brotes.splice(i, 1);
        continue;
      }
      particula.vx *= freno;
      particula.vy *= freno;
      particula.x += particula.vx * dt * 60;
      particula.y += particula.vy * dt * 60;
      const alfa = (particula.vida / particula.vidaTotal) * 0.9;
      contexto.beginPath();
      contexto.arc(particula.x, particula.y, particula.radio, 0, Math.PI * 2);
      contexto.fillStyle = tonoEstrella(particula.mezcla, alfa);
      contexto.fill();
    }

    idAnimacion = requestAnimationFrame(pintar);
  };

  const moverCursor = (x, y) => {
    cursor.x = x;
    cursor.y = y;
    cursor.activo = true;
  };

  window.addEventListener(
    "mousemove",
    (evento) => moverCursor(evento.clientX, evento.clientY),
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (evento) => {
      if (evento.touches.length > 0) {
        moverCursor(evento.touches[0].clientX, evento.touches[0].clientY);
      }
    },
    { passive: true }
  );
  window.addEventListener("click", (evento) => {
    if (evento.target.closest("a, button, input, select, textarea, label")) {
      return;
    }
    crearBrote(evento.clientX, evento.clientY);
  });
  window.addEventListener("resize", ajustarTamano);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (idAnimacion !== null) {
        cancelAnimationFrame(idAnimacion);
        idAnimacion = null;
      }
    } else if (idAnimacion === null) {
      ultimoTiempo = performance.now();
      idAnimacion = requestAnimationFrame(pintar);
    }
  });

  ajustarTamano();
  idAnimacion = requestAnimationFrame(pintar);
}

// Música ambiente del Umbral: emisora de Spotify con botón de altavoz flotante
(() => {
  const CLAVE_MUSICA = "shaddai-musica-v1";
  const PISTA_URI = "spotify:track:1MwwRbFmRQ9tjvAZiQJDsf";

  let controlador = null;
  let cargandoApi = false;
  let pedirAlCargar = false;
  let sonando = false;
  let deseada = false;
  try {
    deseada = localStorage.getItem(CLAVE_MUSICA) === "on";
  } catch {}

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "musica-boton";
  boton.dataset.estado = "silencio";
  boton.setAttribute("aria-pressed", "false");
  boton.title = "Música ambiente";
  boton.innerHTML = `
    <svg class="icono-sonido" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/>
      <path d="M15.5 8.5a5 5 0 0 1 0 7"/>
      <path d="M18.5 6a8.5 8.5 0 0 1 0 12"/>
    </svg>
    <svg class="icono-silencio" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/>
      <line x1="16" y1="9" x2="21" y2="14"/>
      <line x1="21" y1="9" x2="16" y2="14"/>
    </svg>`;
  document.body.appendChild(boton);

  const pintar = () => {
    boton.dataset.estado = sonando ? "sonando" : "silencio";
    boton.classList.toggle("cargando", cargandoApi || pedirAlCargar);
    boton.setAttribute("aria-pressed", sonando ? "true" : "false");
    boton.setAttribute(
      "aria-label",
      sonando ? "Silenciar música ambiente" : "Escuchar música ambiente"
    );
  };
  pintar();

  // Fallo al cargar Spotify: soltar el estado "cargando" para permitir reintentar con un clic
  const falloCarga = (montaje) => {
    cargandoApi = false;
    pedirAlCargar = false;
    deseada = false;
    if (montaje) montaje.remove();
    pintar();
  };

  const cargarEmbed = () => {
    if (controlador || cargandoApi) return;
    cargandoApi = true;

    const montaje = document.createElement("div");
    montaje.className = "musica-iframe";
    // Spotify sustituye el elemento que recibe por su iframe: montamos sobre
    // un hijo para que el contenedor oculto (.musica-iframe) se conserve
    const ancla = document.createElement("div");
    montaje.appendChild(ancla);
    document.body.appendChild(montaje);

    window.onSpotifyIframeApiReady = (IFrameAPI) => {
      let montado = false;

      const montar = (c) => {
        if (montado || !c) return;
        montado = true;
        controlador = c;
        cargandoApi = false;

        // Spotify descarta play() hasta que el reproductor emite "ready": reintentamos hasta que arranque
        const intentarReproducir = () => {
          if (!pedirAlCargar || sonando || !controlador) return;
          try {
            c.play();
          } catch {}
        };

        // Sin sesión de Spotify, la vista previa corta a los 30 s: relanzamos la pista para que la música siga
        const reanudarTrasVistaPrevia = () => {
          pedirAlCargar = true;
          [0, 900, 2600].forEach((espera) => setTimeout(intentarReproducir, espera));
        };

        c.addListener("ready", intentarReproducir);
        c.addListener("playback_update", (evento) => {
          const nuevo = Boolean(evento.data && evento.data.is_playing);
          const terminoLaPista = sonando && !nuevo;
          if (nuevo) pedirAlCargar = false;
          sonando = nuevo;
          pintar();
          if (pedirAlCargar) intentarReproducir();
          else if (terminoLaPista && deseada) reanudarTrasVistaPrevia();
        });

        intentarReproducir();
        [600, 1800, 4000].forEach((espera) => setTimeout(intentarReproducir, espera));
        pintar();
      };

      try {
        IFrameAPI.createController(ancla, { uri: PISTA_URI, width: "100%", height: "100%" }, montar);
      } catch {
        falloCarga(montaje);
      }
    };

    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    script.onerror = () => falloCarga(montaje);
    document.head.appendChild(script);
  };

  const sonar = () => {
    deseada = true;
    try {
      localStorage.setItem(CLAVE_MUSICA, "on");
    } catch {}
    if (controlador) {
      try {
        controlador.play();
      } catch {}
    } else {
      pedirAlCargar = true;
      cargarEmbed();
    }
    pintar();
  };

  const silenciar = () => {
    deseada = false;
    pedirAlCargar = false;
    try {
      localStorage.setItem(CLAVE_MUSICA, "off");
    } catch {}
    if (controlador) {
      try {
        controlador.pause();
      } catch {}
    }
    pintar();
  };

  boton.addEventListener("click", () => {
    // Se silencia si suena o hay carga en marcha; en otro caso se arranca o reanuda
    if (sonando || cargandoApi || pedirAlCargar) silenciar();
    else sonar();
  });

  // Si el visitante ya activó la música, retomarla con el primer gesto de la página
  if (deseada) {
    const retomar = () => {
      window.removeEventListener("pointerdown", retomar, true);
      window.removeEventListener("keydown", retomar, true);
      if (deseada && !controlador) {
        pedirAlCargar = true;
        cargarEmbed();
        pintar();
      }
    };
    window.addEventListener("pointerdown", retomar, { once: true, capture: true });
    window.addEventListener("keydown", retomar, { once: true, capture: true });
  }
})();

// Carrusel del universo SHADDAI: una imagen cada 5 segundos
const carruselUniverso = document.querySelector(".carrusel-universo");

if (carruselUniverso) {
  const capasUniverso = Array.from(carruselUniverso.querySelectorAll(".universo-capa"));
  const puntosUniverso = carruselUniverso.querySelector(".universo-puntos");
  const intervaloUniverso = 5000;
  let indiceUniverso = 0;
  let temporizadorUniverso = null;

  const mostrarUniverso = (indice) => {
    indiceUniverso = (indice + capasUniverso.length) % capasUniverso.length;
    capasUniverso.forEach((capa, i) => capa.classList.toggle("activa", i === indiceUniverso));
    if (puntosUniverso) {
      Array.from(puntosUniverso.children).forEach((punto, i) => punto.classList.toggle("activa", i === indiceUniverso));
    }
  };

  const iniciarTemporizador = () => {
    if (temporizadorUniverso) clearInterval(temporizadorUniverso);
    if (!movimientoReducido) {
      temporizadorUniverso = setInterval(() => mostrarUniverso(indiceUniverso + 1), intervaloUniverso);
    }
  };

  if (puntosUniverso) {
    capasUniverso.forEach((capa, i) => {
      const punto = document.createElement("button");
      punto.type = "button";
      punto.setAttribute("aria-label", `Imagen ${i + 1} de ${capasUniverso.length}`);
      punto.addEventListener("click", () => {
        mostrarUniverso(i);
        iniciarTemporizador();
      });
      puntosUniverso.appendChild(punto);
    });
  }

  carruselUniverso.querySelector(".universo-atras").addEventListener("click", () => {
    mostrarUniverso(indiceUniverso - 1);
    iniciarTemporizador();
  });

  carruselUniverso.querySelector(".universo-adelante").addEventListener("click", () => {
    mostrarUniverso(indiceUniverso + 1);
    iniciarTemporizador();
  });

  carruselUniverso.addEventListener("mouseenter", () => {
    if (temporizadorUniverso) clearInterval(temporizadorUniverso);
  });

  carruselUniverso.addEventListener("mouseleave", iniciarTemporizador);

  mostrarUniverso(0);
  iniciarTemporizador();
}
