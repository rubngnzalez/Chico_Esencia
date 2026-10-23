// Pago seguro del Umbral — Redsys (tarjeta) + Bizum
// ------------------------------------------------------------------
// Configura aquí los datos de tu TPV (panel de tu banco).
// IMPORTANTE: la firma HMAC_SHA256_V1 se calcula en el navegador con
// la clave secreta. Para un comercio en producción lo recomendable es
// firmar en un servidor; esta página está lista para pruebas y para
// comercios que asumen ese paso.
// ------------------------------------------------------------------

const CONFIG_REDSYS = {
  entorno: "test", // "test" | "produccion"
  urls: {
    test: "https://sis-t.redsys.es:25443/sis/realizarPago",
    produccion: "https://sis.redsys.es/sis/realizarPago",
  },
  comercio: "999008889", // FUC: código de comercio de tu TPV
  terminal: "1", // número de terminal
  moneda: "978", // EUR
  clave: "sq7HjrUOBf2m7spUjazlA", // clave secreta (en pruebas, la de test de Redsys)
  nombreComercio: "SHADDAI · Esencia de Umbral",
  urlOk: "",
  urlKo: "",
  urlNotificacion: "",
};

// URLs de retorno sobre la misma raíz de la web
(() => {
  const base = location.href.replace(/pago\.html.*$/, "");
  CONFIG_REDSYS.urlOk = base + "pago-ok.html";
  CONFIG_REDSYS.urlKo = base + "pago-ko.html";
  CONFIG_REDSYS.urlNotificacion = base + "pago-ok.html";
})();

const resumenPedido = document.querySelector("[data-resumen-pedido]");
const formularioPagoR = document.querySelector("[data-formulario-pago]");
const avisoPagoR = document.querySelector("[data-aviso-pago]");
const bloqueVacio = document.querySelector("[data-pago-vacio]");

const articulosPago = typeof leerCarrito === "function" ? leerCarrito() : [];

// Resumen del pedido (se repinta cuando la API trae el coste de envío real)
const pintarResumen = () => {
  if (articulosPago.length === 0) {
    if (resumenPedido) resumenPedido.hidden = true;
    if (formularioPagoR) formularioPagoR.hidden = true;
    if (bloqueVacio) bloqueVacio.hidden = false;
    return;
  }
  const lineas = document.querySelector("[data-lineas-pedido]");
  lineas.innerHTML = "";
  articulosPago.forEach((articulo) => {
    const fila = document.createElement("div");
    fila.className = "carrito-linea";
    const nombre = document.createElement("span");
    nombre.textContent = `${articulo.cantidad} × ${articulo.nombre}`;
    const precio = document.createElement("span");
    precio.textContent = formatearPrecio(articulo.precio * articulo.cantidad);
    fila.append(nombre, precio);
    lineas.append(fila);
  });

  const { subtotal, envio, total } = calcularTotales(articulosPago);
  document.querySelector("[data-subtotal]").textContent = formatearPrecio(subtotal);
  document.querySelector("[data-envio]").textContent = envio === 0 ? "Gratis" : formatearPrecio(envio);
  document.querySelector("[data-total]").textContent = formatearPrecio(total);
};

pintarResumen();

// Entorno, comercio, métodos y envío reales del panel cuando la API responde
if (typeof CONEXION !== "undefined") {
  CONEXION.cuandoConfig.then((config) => {
    if (!config) return;
    if (config.entornoPago === "test" || config.entornoPago === "produccion") {
      CONFIG_REDSYS.entorno = config.entornoPago;
    }
    if (config.nombreComercio) CONFIG_REDSYS.nombreComercio = config.nombreComercio;
    pintarResumen();
    const metodos = config.metodosPago || {};
    document.querySelectorAll(".metodo-pago input[name='metodo']").forEach((entrada) => {
      const activo = entrada.value === "bizum" ? metodos.bizum !== false : metodos.tarjeta !== false;
      entrada.disabled = !activo;
      const etiqueta = entrada.closest(".metodo-pago");
      if (etiqueta) etiqueta.hidden = !activo;
    });
  });
}

// Número de pedido: fecha + hora, 12 dígitos únicos
const generarPedido = () => {
  const ahora = new Date();
  const dos = (n) => String(n).padStart(2, "0");
  return (
    String(ahora.getFullYear()).slice(2) +
    dos(ahora.getMonth() + 1) +
    dos(ahora.getDate()) +
    dos(ahora.getHours()) +
    dos(ahora.getMinutes()) +
    dos(ahora.getSeconds())
  );
};

// Firma HMAC_SHA256_V1: clave de operación 3DES + HMAC-SHA256 base64
const firmarParametros = (parametrosB64, pedido, claveB64) => {
  const clave = CryptoJS.enc.Base64.parse(claveB64);
  const claveOperacion = CryptoJS.TripleDES.encrypt(pedido, clave, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  }).ciphertext;
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(parametrosB64 + pedido, claveOperacion)
  );
};

if (formularioPagoR) {
  formularioPagoR.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (articulosPago.length === 0) return;

    const datos = new FormData(formularioPagoR);
    const nombre = (datos.get("nombre") || "").toString().trim();
    const apellidos = (datos.get("apellidos") || "").toString().trim();
    const email = (datos.get("email") || "").toString().trim();
    const telefono = (datos.get("telefono") || "").toString().trim();
    const direccion = (datos.get("direccion") || "").toString().trim();
    const cp = (datos.get("cp") || "").toString().trim();
    const poblacion = (datos.get("poblacion") || "").toString().trim();
    const provincia = (datos.get("provincia") || "").toString().trim();
    const metodo = (datos.get("metodo") || "tarjeta").toString();
    const pedido = generarPedido();
    const botonEnviar = formularioPagoR.querySelector('button[type="submit"]');

    // 1) Firma en servidor: el importe se calcula con precios y ofertas reales del panel
    let firmaApi = null;
    if (typeof CONEXION !== "undefined") {
      avisoPagoR.textContent = "Preparando tu pago seguro…";
      if (botonEnviar) botonEnviar.disabled = true;
      firmaApi = await CONEXION.post("/api/pagos/firma", {
        articulos: articulosPago.map((articulo) => ({ codigo: articulo.id, cantidad: articulo.cantidad })),
        metodo,
        numeroPedido: pedido,
        envio: { nombre, apellidos, email, telefono, direccion, cp, poblacion, provincia },
      });
      if (botonEnviar) botonEnviar.disabled = false;
      if (firmaApi && !firmaApi.parametrosB64) {
        avisoPagoR.textContent = `${firmaApi.error || "No hemos podido preparar el pago seguro."} Inténtalo de nuevo en un momento o escríbenos a hola@shaddai.es.`;
        return;
      }
    }

    let numeroFinal = pedido;
    let total = calcularTotales(articulosPago).total;
    let parametrosB64;
    let firma;
    let version = "HMAC_SHA256_V1";

    if (firmaApi && firmaApi.parametrosB64) {
      numeroFinal = firmaApi.numeroPedido || pedido;
      version = firmaApi.version || version;
      if (firmaApi.resumen && Number(firmaApi.resumen.total) > 0) total = Number(firmaApi.resumen.total);
      parametrosB64 = firmaApi.parametrosB64;
      firma = firmaApi.firma;
    } else {
      // 2) Sin API: firma en cliente con la configuración local (flujo actual intacto)
      if (typeof CryptoJS === "undefined") {
        avisoPagoR.textContent =
          "No se pudo cargar el módulo de firma segura. Comprueba tu conexión y recarga la página.";
        return;
      }
      const descripcion = articulosPago
        .map((articulo) => `${articulo.cantidad}× ${articulo.nombre}`)
        .join(" · ")
        .slice(0, 120);

      const parametros = {
        DS_MERCHANT_AMOUNT: String(Math.round(total * 100)),
        DS_MERCHANT_ORDER: pedido,
        DS_MERCHANT_MERCHANTCODE: CONFIG_REDSYS.comercio,
        DS_MERCHANT_CURRENCY: CONFIG_REDSYS.moneda,
        DS_MERCHANT_TRANSACTIONTYPE: "0",
        DS_MERCHANT_TERMINAL: CONFIG_REDSYS.terminal,
        DS_MERCHANT_MERCHANTNAME: CONFIG_REDSYS.nombreComercio,
        DS_MERCHANT_PRODUCTDESCRIPTION: descripcion,
        DS_MERCHANT_TITULAR: [nombre, apellidos].filter(Boolean).join(" ").slice(0, 60),
        DS_MERCHANT_CONSUMERLANGUAGE: "001",
        DS_MERCHANT_URLOK: CONFIG_REDSYS.urlOk,
        DS_MERCHANT_URLKO: CONFIG_REDSYS.urlKo,
        DS_MERCHANT_MERCHANTURL: CONFIG_REDSYS.urlNotificacion,
        DS_MERCHANT_PAYMETHODS: metodo === "bizum" ? "z" : "C",
      };

      parametrosB64 = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(JSON.stringify(parametros)));
      firma = firmarParametros(parametrosB64, pedido, CONFIG_REDSYS.clave);
    }

    // Pedido pendiente: lo muestra la página de confirmación
    localStorage.setItem(
      "shaddai-pedido-pendiente",
      JSON.stringify({
        pedido: numeroFinal,
        total,
        metodo,
        nombre: [nombre, apellidos].filter(Boolean).join(" "),
        email,
        telefono,
        direccion: [direccion, cp, poblacion, provincia].filter(Boolean).join(", "),
        fecha: new Date().toISOString(),
        articulos: articulosPago,
      })
    );

    const envio = document.createElement("form");
    envio.method = "POST";
    envio.action = (firmaApi && firmaApi.url) || CONFIG_REDSYS.urls[CONFIG_REDSYS.entorno];
    [
      ["DS_MERCHANT_PARAMETERS", parametrosB64],
      ["DS_MERCHANT_SIGNATURE", firma],
      ["DS_MERCHANT_SIGNATUREVERSION", version],
    ].forEach(([campo, valor]) => {
      const entrada = document.createElement("input");
      entrada.type = "hidden";
      entrada.name = campo;
      entrada.value = valor;
      envio.append(entrada);
    });

    avisoPagoR.textContent = "Abriendo el entorno seguro de tu banco…";
    document.body.append(envio);
    envio.submit();
  });
}
