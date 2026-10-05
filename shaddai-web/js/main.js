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
