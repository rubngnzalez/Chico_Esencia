// Pago seguro del Umbral — Redsys (tarjeta) + Bizum
// ------------------------------------------------------------------
// CADENA DE FIRMA (de mayor a menor garantía; cae al siguiente eslabón
// si el anterior no está disponible):
//   1. Edge Function «pagos-firma» de Supabase (si js/config-supabase.js
//      está rellenada): calcula el importe EN SERVIDOR con precios y
//      ofertas reales y firma HMAC_SHA256_V1. La clave nunca sale.
//   2. Worker actual (window.SHADDAI_API_BASE en js/config-api.js):
//      POST /api/pagos/firma, igual que siempre.
//   3. Firma en cliente (CryptoJS) con los datos de la vista pública
//      ajustes_publicos. OJO: la vista solo expone la clave si el entorno
//      es «test» (clave de pruebas pública de Redsys). En producción sin
//      funciones desplegadas el panel avisa: esta vía no puede usarse.
// ------------------------------------------------------------------

const CONFIG_REDSYS = {
  entorno: "test", // "test" | "produccion"
  urls: {
    test: "https://sis-t.redsys.es:25443/sis/realizarPago",
    produccion: "https://sis.redsys.es/sis/realizarPago",
  },
  comercio: "372022558", // FUC: cÃ³digo de comercio de tu TPV
  terminal: "1", // nÃºmero de terminal
  moneda: "978", // EUR
  clave: "sq7HjrUOBfKmC576ILgskD5srU870gJ7", // clave secreta (en pruebas, la de test de Redsys)
  nombreComercio: "SHADDAI Â· Esencia de Umbral",
  urlOk: "",
  urlKo: "",
  urlNotificacion: "",
};

// URLs de retorno sobre la misma raíz de la web; la notificación online va
// a la Edge Function del proyecto OMS que valida, marca el pedido pagado
// y dispara los correos
(() => {
  const base = location.href.replace(/pago\.html.*$/, "");
  CONFIG_REDSYS.urlOk = base + "pago-ok.html";
  CONFIG_REDSYS.urlKo = base + "pago-ko.html";
  CONFIG_REDSYS.urlNotificacion =
    "https://zjzqbugpdpfuttdwagai.supabase.co/functions/v1/oms-redsys-notificacion";
})();

const resumenPedido = document.querySelector("[data-resumen-pedido]");
const formularioPagoR = document.querySelector("[data-formulario-pago]");
const avisoPagoR = document.querySelector("[data-aviso-pago]");
const bloqueVacio = document.querySelector("[data-pago-vacio]");

const articulosPago = typeof leerCarrito === "function" ? leerCarrito() : [];

// Zona de envío según el país elegido en el formulario (España por defecto)
const zonaDeEnvio = () =>
  zonaDePais(formularioPagoR && formularioPagoR.elements.pais ? formularioPagoR.elements.pais.value : "España");

// Productos del carrito que no se pueden enviar a la zona elegida
const noDisponiblesEn = (zona) => articulosPago.filter((articulo) => !productoDisponible(articulo.id, zona));

// Nota de envío adaptada a la zona (se repinta al cambiar el país)
const pintarNotaEnvio = () => {
  const notaEnvio = document.querySelector("[data-nota-envio]");
  if (!notaEnvio) return;
  const zona = zonaDeEnvio();
  const configZona = (CONFIG_ENVIO.zonas || {})[zona] || CONFIG_ENVIO.zonas.espana;
  const umbral = Number(configZona.gratisDesde) || 0;
  const coste = calcularTotales([{ precio: 1, cantidad: 1 }], zona).envio;
  notaEnvio.textContent =
    `Envío a ${etiquetaZona(zona)}: ${umbral > 0 ? `gratis a partir de ${formatearPrecio(umbral)}` : formatearPrecio(coste)}. Preparamos cada frasco por orden de pago.`;
};

// Resumen del pedido (se repinta cuando la API trae el coste de envío real
// y cuando se cambia el país del formulario)
const pintarResumen = () => {
  if (articulosPago.length === 0) {
    if (resumenPedido) resumenPedido.hidden = true;
    if (formularioPagoR) formularioPagoR.hidden = true;
    if (bloqueVacio) bloqueVacio.hidden = false;
    return;
  }
  const zona = zonaDeEnvio();
  const noDisponibles = noDisponiblesEn(zona);
  const lineas = document.querySelector("[data-lineas-pedido]");
  lineas.innerHTML = "";
  articulosPago.forEach((articulo) => {
    const fila = document.createElement("div");
    fila.className = "carrito-linea";
    const disponible = productoDisponible(articulo.id, zona);
    const nombre = document.createElement("span");
    nombre.textContent = disponible
      ? `${articulo.cantidad} × ${articulo.nombre}`
      : `${articulo.cantidad} × ${articulo.nombre} — no disponible para ${etiquetaZona(zona)}`;
    const precio = document.createElement("span");
    precio.textContent = formatearPrecio(articulo.precio * articulo.cantidad);
    if (!disponible) nombre.style.color = "#9d3b3b";
    fila.append(nombre, precio);
    lineas.append(fila);
  });

  const { subtotal, envio, total } = calcularTotales(articulosPago, zona);
  document.querySelector("[data-subtotal]").textContent = formatearPrecio(subtotal);
  document.querySelector("[data-envio]").textContent = envio === 0 ? "Gratis" : formatearPrecio(envio);
  document.querySelector("[data-total]").textContent = formatearPrecio(total);

  // Aviso persistente mientras haya productos sin disponibilidad en la zona
  const avisoZona = document.querySelector("[data-aviso-zona]");
  if (avisoZona) {
    avisoZona.textContent =
      noDisponibles.length > 0
        ? `Para envío a ${etiquetaZona(zona)} no están disponibles: ${noDisponibles
            .map((articulo) => articulo.nombre)
            .join(", ")}. Quita esos artículos del carrito o elige otro destino.`
        : "";
  }
};

pintarResumen();

// El país decide la zona de envío: al cambiarlo se recalcula el resumen
const paisPago = formularioPagoR ? formularioPagoR.elements.pais : null;
if (paisPago) {
  paisPago.addEventListener("change", () => {
    pintarResumen();
    pintarNotaEnvio();
  });
}

// Lista de países del checkout construida desde el panel (Ajustes → Envío):
// España siempre primero, luego las zonas (UE, Latinoamérica, Resto) con sus
// países configurados, y «Otro país» como destino comodín. Sin conexión, el
// select estático del HTML sigue sirviendo igual.
const poblarPaises = () => {
  if (!paisPago) return;
  const elegido = paisPago.value || "España";
  const paises = ["España"];
  const listas = CONFIG_ENVIO.paises || {};
  ["unionEuropea", "latinoamerica", "resto"].forEach((clave) => {
    (Array.isArray(listas[clave]) ? listas[clave] : []).forEach((pais) => {
      if (!paises.some((x) => x.toLowerCase() === String(pais).toLowerCase())) paises.push(String(pais));
    });
  });
  if (!paises.some((x) => x.toLowerCase() === "otro país")) paises.push("Otro país");
  paisPago.innerHTML = paises
    .map(
      (pais) =>
        `<option value="${pais.replace(/"/g, "&quot;")}" ${pais.toLowerCase() === elegido.toLowerCase() ? "selected" : ""}>${pais}</option>`
    )
    .join("");
  if (paisPago.value !== elegido) paisPago.value = "España";
};

// Cuando el panel trae costes/umbrales/países nuevos, el checkout se repinta
window.addEventListener("shaddai:envio-actualizado", () => {
  poblarPaises();
  pintarResumen();
  pintarNotaEnvio();
});

// Zonas de envío por producto (columna zonas_envio del catálogo): al cargar
// el mapa se repinta el resumen con la disponibilidad real
if (typeof CONEXION !== "undefined" && typeof CONEXION.zonasProductos === "function") {
  CONEXION
    .zonasProductos()
    .then((mapa) => {
      if (mapa && typeof mapa === "object" && Object.keys(mapa).length > 0) {
        MAPA_ZONAS_PRODUCTO.valor = mapa;
        pintarResumen();
        pintarNotaEnvio();
      }
    })
    .catch(() => {});
}

// Entorno, comercio, métodos y envío reales del panel cuando hay conexión
if (typeof CONEXION !== "undefined") {
  CONEXION.cuandoConfig.then((config) => {
    if (!config) return;
    if (config.entornoPago === "test" || config.entornoPago === "produccion") {
      CONFIG_REDSYS.entorno = config.entornoPago;
    }
    if (config.nombreComercio) CONFIG_REDSYS.nombreComercio = config.nombreComercio;
    // Datos Redsys reales de los ajustes (la vista solo trae la clave en test)
    if (config.pago) {
      if (config.pago.fuc) CONFIG_REDSYS.comercio = config.pago.fuc;
      if (config.pago.terminal) CONFIG_REDSYS.terminal = config.pago.terminal;
      if (config.pago.moneda) CONFIG_REDSYS.moneda = config.pago.moneda;
      if (config.pago.urlOk) CONFIG_REDSYS.urlOk = config.pago.urlOk;
      if (config.pago.urlKo) CONFIG_REDSYS.urlKo = config.pago.urlKo;
      if (config.pago.urlNotificacion) CONFIG_REDSYS.urlNotificacion = config.pago.urlNotificacion;
    }
    if (config.clavePago) {
      // Solo llega en test: firma en cliente con la clave de pruebas pública
      CONFIG_REDSYS.clave = String(config.clavePago);
    }
    // En producción la clave permanece en servidor: la firma la hace la
    // Edge Function oms-pagos-firma y los métodos siguen visibles
    pintarResumen();
    const metodos = config.metodosPago || {};
    document.querySelectorAll(".metodo-pago input[name='metodo']").forEach((entrada) => {
      const activo = entrada.value === "bizum" ? metodos.bizum !== false : metodos.tarjeta !== false;
      entrada.disabled = !activo;
      const etiqueta = entrada.closest(".metodo-pago");
      if (etiqueta) etiqueta.hidden = !activo;
    });
    // Nota de envío con los umbrales reales del panel, según la zona elegida
    pintarNotaEnvio();
    // Países del checkout según las zonas configuradas en el panel
    poblarPaises();
  });

  // Red de seguridad: si el envío del panel llega antes que este bloque,
  // el evento ya se disparó — repintamos con lo que haya ahora
  poblarPaises();
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

// Firma HMAC_SHA256_V1 — igual que la librería oficial de Redsys:
// clave de operación = 3DES-CBC con IV de ceros y relleno de bytes nulos
// (sin bloque PKCS7) sobre el número de pedido. El SIS actual valida la
// firma SOLO sobre la cadena Base64 de parámetros, sin añadir el pedido.
const firmarParametros = (parametrosB64, pedido, claveB64) => {
  const clave = CryptoJS.enc.Base64.parse(claveB64);
  const datos = CryptoJS.enc.Utf8.parse(pedido);
  const falta = (8 - (datos.sigBytes % 8)) % 8;
  const rellenado = falta
    ? datos.clone().concat(CryptoJS.enc.Hex.parse("00".repeat(falta)))
    : datos;
  const claveOperacion = CryptoJS.TripleDES.encrypt(rellenado, clave, {
    mode: CryptoJS.mode.CBC,
    iv: CryptoJS.enc.Hex.parse("0000000000000000"),
    padding: CryptoJS.pad.NoPadding,
  }).ciphertext;
  return CryptoJS.enc.Base64.stringify(
    CryptoJS.HmacSHA256(parametrosB64, claveOperacion)
  );
};

// Datos de contacto y envío obligatorios antes de pasar al pago de Redsys
const CAMPOS_OBLIGATORIOS = ["nombre", "email", "direccion", "cp", "poblacion", "provincia", "pais"];
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Los campos obligatorios se pintan en rojo hasta que están completados
// (y en el caso del email, hasta que el formato es válido). El código
// postal se exige con 5 dígitos cuando el país es España.
const campoValido = (entrada) => {
  const valor = (entrada.value || "").trim();
  if (!valor) return false;
  if (entrada.name === "email" && !EMAIL_VALIDO.test(valor)) return false;
  if (entrada.name === "cp") {
    const pais = formularioPagoR.elements.pais ? formularioPagoR.elements.pais.value : "España";
    if (pais === "España" && !/^\d{5}$/.test(valor)) return false;
  }
  if ((entrada.name === "poblacion" || entrada.name === "provincia") && valor.length < 2) return false;
  return true;
};

const actualizarCampo = (entrada) => {
  entrada.classList.toggle("campo-error", !campoValido(entrada));
};

const marcarPendientesPago = () => {
  CAMPOS_OBLIGATORIOS.forEach((campo) => {
    const entrada = formularioPagoR.elements[campo];
    if (entrada) actualizarCampo(entrada);
  });
};

if (formularioPagoR) {
  formularioPagoR.addEventListener("input", (evento) => {
    const entrada = evento.target;
    if (entrada.name && CAMPOS_OBLIGATORIOS.includes(entrada.name)) actualizarCampo(entrada);
  });

  // Estado inicial: obligatorios vacíos en rojo desde el primer vistazo
  marcarPendientesPago();

  formularioPagoR.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (articulosPago.length === 0) return;

    // Disponibilidad por destino: no se pasa al pago con productos que no
    // se pueden enviar al país elegido
    const zonaElegida = zonaDeEnvio();
    const noDisponibles = noDisponiblesEn(zonaElegida);
    if (noDisponibles.length > 0) {
      avisoPagoR.textContent =
        `Para envío a ${etiquetaZona(zonaElegida)} no están disponibles: ${noDisponibles
          .map((articulo) => articulo.nombre)
          .join(", ")}. Quita esos artículos del carrito o elige otro destino.`;
      avisoPagoR.focus?.();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    // Validación de contacto/envío: no se pasa a Redsys sin estos datos
    marcarPendientesPago();
    const etiquetasFaltan = [];
    let primeraInvalida = null;
    CAMPOS_OBLIGATORIOS.forEach((campo) => {
      const entrada = formularioPagoR.elements[campo];
      if (!entrada) return;
      if (!campoValido(entrada)) {
        if (!primeraInvalida) primeraInvalida = entrada;
        const etiqueta = entrada.closest(".campo")?.querySelector("label");
        etiquetasFaltan.push((etiqueta ? etiqueta.textContent : campo).replace(/\*/g, "").trim());
      }
    });
    if (etiquetasFaltan.length > 0) {
      avisoPagoR.textContent =
        "Para pasar al pago necesitamos tus datos: " + etiquetasFaltan.join(", ") + ".";
      if (primeraInvalida) primeraInvalida.focus();
      return;
    }
    avisoPagoR.textContent = "";

    // Suscripción al Boletín del Umbral si el cliente la ha aceptado: mismo
    // endpoint que el formulario del pie (tabla oms_suscriptores). Va antes
    // del salto a Redsys para que la navegación no la cancele.
    const quiereSuscribirse = formularioPagoR.elements.suscribirse?.checked;
    if (quiereSuscribirse && email && typeof CONEXION !== "undefined") {
      try {
        await CONEXION.post("/api/public/suscribirse", { email });
      } catch {}
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
    const pais = (datos.get("pais") || "España").toString().trim();
    const metodo = (datos.get("metodo") || "tarjeta").toString();
    const pedido = generarPedido();
    const botonEnviar = formularioPagoR.querySelector('button[type="submit"]');

    // Eslabones 1 y 2 de la cadena: Edge Function (Supabase) y Worker.
    // CONEXION.post cae al Worker si la función no está desplegada, y a null
    // si tampoco hay Worker: entonces se firma en cliente (eslabón 3).
    let firmaApi = null;
    if (typeof CONEXION !== "undefined") {
      avisoPagoR.textContent = "Preparando tu pago seguro…";
      if (botonEnviar) botonEnviar.disabled = true;
      firmaApi = await CONEXION.post("/api/pagos/firma", {
        articulos: articulosPago.map((articulo) => ({ codigo: articulo.id, cantidad: articulo.cantidad })),
        metodo,
        numeroPedido: pedido,
        envio: { nombre, apellidos, email, telefono, direccion, cp, poblacion, provincia, pais },
      });
      if (botonEnviar) botonEnviar.disabled = false;
      if (firmaApi && !firmaApi.parametrosB64) {
        avisoPagoR.textContent = `${firmaApi.error || "No hemos podido preparar el pago seguro."} Inténtalo de nuevo en un momento o escríbenos a info@omshaddai.com.`;
        return;
      }
    }

    let numeroFinal = pedido;
    let total = calcularTotales(articulosPago, zonaDeEnvio()).total;
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
      // 3) Sin servidor disponible: firma en cliente con la configuración
      //    cargada de la vista pública (clave solo en entorno test).
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

      // Redsys exige el JSON al estilo de php json_encode: barras escapadas
      const jsonPedido = JSON.stringify(parametros).replace(/\//g, "\\/");
      parametrosB64 = CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(jsonPedido));
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
      ["Ds_MerchantParameters", parametrosB64],
      ["Ds_Signature", firma],
      ["Ds_SignatureVersion", version],
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
