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
