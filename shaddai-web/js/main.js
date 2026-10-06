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

// Menú móvil
const botonMenu = document.querySelector(".menu-boton");
const navegacion = document.querySelector(".navegacion");

if (botonMenu && navegacion) {
  botonMenu.addEventListener("click", () => {
    navegacion.classList.add("abierta");
    const cerrar = document.createElement("button");
    cerrar.className = "cerrar";
    cerrar.setAttribute("aria-label", "Cerrar menú");
    cerrar.textContent = "×";
    navegacion.appendChild(cerrar);
    cerrar.addEventListener("click", cerrarMenu);
    function cerrarMenu() {
      navegacion.classList.remove("abierta");
      cerrar.remove();
    }
    navegacion.querySelectorAll("a").forEach((enlace) =>
      enlace.addEventListener("click", cerrarMenu)
    );
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

// Formulario de contacto (demostración local)
const formulario = document.querySelector(".formulario");
if (formulario) {
  formulario.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const datos = new FormData(formulario);
    const nombre = (datos.get("nombre") || "").toString().trim();
    const aviso = document.querySelector(".aviso-formulario");
    aviso.textContent = `Gracias, ${nombre || "alma buscadora"}. Hemos recibido tu mensaje: te responderemos con la calma que mereces.`;
    formulario.reset();
  });
}

// Boletín del Umbral (demostración local)
const boletin = document.querySelector(".boletin");
if (boletin) {
  boletin.addEventListener("submit", (evento) => {
    evento.preventDefault();
    boletin.reset();
    const aviso = document.querySelector(".aviso-boletin");
    if (aviso) {
      aviso.textContent = "Bienvenido al Umbral: recibirás las próximas reflexiones y aperturas de lotes limitados.";
    }
  });
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
    const r = Math.round(227 + (243 - 227) * mezcla);
    const g = Math.round(201 + (238 - 201) * mezcla);
    const b = Math.round(143 + (226 - 143) * mezcla);
    return `rgba(${r}, ${g}, ${b}, ${alfa})`;
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
      halo.addColorStop(0, "rgba(201, 164, 95, 0.10)");
      halo.addColorStop(1, "rgba(201, 164, 95, 0)");
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
          contexto.strokeStyle = `rgba(201, 164, 95, ${alfa.toFixed(3)})`;
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
