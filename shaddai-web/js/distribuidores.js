// Página Distribuidores: presentación de la marca y solicitud de alianza B2B.
// Los packs y las condiciones privadas NO se publican aquí: viven en la
// página discreta distribuidor.html (con usuario y contraseña).
// -----------------------------------------------------------------------
// Degradación como en el resto de la web: si Supabase no está configurado o
// falla, se avisa al visitante en pantalla (nunca se abre su correo).
(() => {
  const escapar = (texto) =>
    String(texto == null ? "" : texto).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // Cliente Supabase solo si hay configuración y la librería vendida cargó.
  // Storage key propia: la sesión del distribuidor no pisa la del panel
  // (que usa la clave por defecto) en el mismo navegador.
  const cliente = (() => {
    if (typeof window.SUPABASE_CONFIGURADO === "function" && window.SUPABASE_CONFIGURADO()) {
      if (typeof window.supabase !== "undefined" && window.supabase && window.supabase.createClient) {
        return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
          auth: { storageKey: "shaddai-distribuidores-auth" },
        });
      }
    }
    return null;
  })();

  // ─── Solicitud de alianza (llega al panel: Distribuidores) ──────────────

  const formAlianza = document.getElementById("form-solicitud-alianza");
  const MENSAJE_FALLO =
    "No hemos podido enviar tu solicitud en este momento. Inténtalo de nuevo en unos minutos o escríbenos a info@omshaddai.com.";

  if (formAlianza) {
    formAlianza.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const datos = new FormData(formAlianza);
      const valores = {
        empresa: (datos.get("empresa") || "").toString().trim(),
        contacto: (datos.get("contacto") || "").toString().trim(),
        email: (datos.get("email") || "").toString().trim(),
        telefono: (datos.get("telefono") || "").toString().trim(),
        mensaje: (datos.get("mensaje") || "").toString().trim(),
        web: (datos.get("web") || "").toString(), // honeypot: los humanos no lo rellenan
      };
      const aviso = document.getElementById("aviso-solicitud-alianza");
      const boton = formAlianza.querySelector('button[type="submit"]');

      if (valores.web) {
        // bot: respondemos OK sin guardar nada, como en el contacto
        aviso.textContent = "Gracias por tu solicitud.";
        formAlianza.reset();
        return;
      }

      if (!cliente) {
        aviso.textContent = MENSAJE_FALLO;
        formAlianza.reset();
        return;
      }

      if (boton) boton.disabled = true;
      aviso.textContent = "Enviando tu solicitud…";
      try {
        const { error } = await cliente.from("oms_distribuidores_solicitudes").insert({
          empresa: valores.empresa.slice(0, 120),
          contacto: valores.contacto.slice(0, 120),
          email: valores.email.slice(0, 160),
          telefono: valores.telefono.slice(0, 40),
          mensaje: valores.mensaje.slice(0, 5000),
          web: "",
        });
        if (error) throw error;
        aviso.textContent = `Gracias, ${valores.contacto || "alma buscadora"}: hemos recibido tu solicitud y te escribiremos pronto con tu propuesta.`;
        formAlianza.reset();
      } catch {
        aviso.textContent = MENSAJE_FALLO;
        formAlianza.reset();
      } finally {
        if (boton) boton.disabled = false;
      }
    });
  }
})();