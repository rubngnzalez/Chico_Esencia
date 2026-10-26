// Dirección de la API del panel (Cloudflare Worker).
// Vacía = misma origen (pruebas locales con el servidor Node).
// En producción la web (GitHub Pages) lee del Worker siempre encendido.
(() => {
  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  window.SHADDAI_API_BASE = local
    ? ""
    : "https://shaddai-panel.redes-301dpi.workers.dev";
})();
