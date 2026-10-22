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

if (articulosPago.length === 0) {
  if (resumenPedido) resumenPedido.hidden = true;
  if (formularioPagoR) formularioPagoR.hidden = true;
  if (bloqueVacio) bloqueVacio.hidden = false;
} else {
  const lineas = document.querySelector("[data-lineas-pedido]");
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
  formularioPagoR.addEventListener("submit", (evento) => {
    evento.preventDefault();

    if (articulosPago.length === 0) return;

    if (typeof CryptoJS === "undefined") {
      avisoPagoR.textContent =
        "No se pudo cargar el módulo de firma segura. Comprueba tu conexión y recarga la página.";
      return;
    }

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

    const { total } = calcularTotales(articulosPago);
    const importe = String(Math.round(total * 100));
    const pedido = generarPedido();
    const descripcion = articulosPago
      .map((articulo) => `${articulo.cantidad}× ${articulo.nombre}`)
      .join(" · ")
      .slice(0, 120);

    const parametros = {
      DS_MERCHANT_AMOUNT: importe,
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

    const json = JSON.stringify(parametros);
    const parametrosB64 = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(json));
    const firma = firmarParametros(parametrosB64, pedido, CONFIG_REDSYS.clave);

    // Pedido pendiente: lo muestra la página de confirmación
    localStorage.setItem(
      "shaddai-pedido-pendiente",
      JSON.stringify({
        pedido,
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
    envio.action = CONFIG_REDSYS.urls[CONFIG_REDSYS.entorno];
    [
      ["DS_MERCHANT_PARAMETERS", parametrosB64],
      ["DS_MERCHANT_SIGNATURE", firma],
      ["DS_MERCHANT_SIGNATUREVERSION", "HMAC_SHA256_V1"],
    ].forEach(([name, value]) => {
      const campo = document.createElement("input");
      campo.type = "hidden";
      campo.name = name;
      campo.value = value;
      envio.append(campo);
    });

    avisoPagoR.textContent = "Abriendo el entorno seguro de tu banco…";
    document.body.append(envio);
    envio.submit();
  });
}
