// Ajustes (solo admin): contacto, redes, SMTP, Redsys, envío, emails automáticos y notificaciones.
import { pedir, escapar, toast, abrirModal, abrirVistaPrevia } from '../api.js';

const MASCARA = '••••••••';

const PESTANAS = [
  { clave: 'contacto', texto: 'Contacto' },
  { clave: 'redes', texto: 'Redes sociales' },
  { clave: 'smtp', texto: 'SMTP' },
  { clave: 'redsys', texto: 'Pago (Redsys)' },
  { clave: 'envio', texto: 'Envío' },
  { clave: 'emails-automaticos', texto: 'Emails automáticos' },
  { clave: 'notificaciones', texto: 'Notificaciones' },
];

let pestanaActual = 'contacto';

export default async function (contenedor) {
  contenedor.innerHTML = '<p class="cargando">Cargando ajustes…</p>';
  let ajustes;
  try {
    ajustes = (await pedir('/api/ajustes')).datos;
  } catch (error) {
    contenedor.innerHTML = `<p class="estado-vacio">No se pudieron cargar los ajustes: ${error.message}</p>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="pestanas" role="tablist">
      ${PESTANAS.map((p) => `<button class="pestana ${p.clave === pestanaActual ? 'activa' : ''}" data-pestana="${p.clave}" type="button">${p.texto}</button>`).join('')}
    </div>
    <div id="zona-ajustes"></div>`;

  const zona = contenedor.querySelector('#zona-ajustes');

  const pintar = () => {
    const datos = ajustes[pestanaActual] || {};
    if (pestanaActual === 'contacto') pintarContacto(zona, datos);
    else if (pestanaActual === 'redes') pintarRedes(zona, datos);
    else if (pestanaActual === 'smtp') pintarSmtp(zona, datos);
    else if (pestanaActual === 'redsys') pintarRedsys(zona, datos);
    else if (pestanaActual === 'envio') pintarEnvio(zona, datos);
    else if (pestanaActual === 'emails-automaticos') pintarEmails(zona, datos);
    else pintarNotificaciones(zona, datos);
  };

  zona.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.pestana');
    if (!boton) return;
    pestanaActual = boton.dataset.pestana;
    contenedor.querySelectorAll('.pestana').forEach((p) => p.classList.toggle('activa', p.dataset.pestana === pestanaActual));
    pintar();
  });

  pintar();
}

function formularioSimple(zona, campos, extra = '') {
  zona.innerHTML = `
    <form class="formulario ajustes-formulario">
      <div class="formulario-grid">${campos}</div>
      ${extra}
      <div class="modal-acciones"><button type="submit" class="boton boton-primario">Guardar ajustes</button></div>
    </form>`;
  return zona.querySelector('form');
}

function campoTexto(nombre, etiqueta, valor, tipo = 'text', marcador = '') {
  return `<div>
    <label>${etiqueta}</label>
    <input name="${nombre}" type="${tipo}" value="${escapar(valor ?? '')}" ${marcador ? `placeholder="${escapar(marcador)}"` : ''}>
  </div>`;
}

function campoInterruptor(nombre, etiqueta, marcado) {
  return `<div class="formulario-opciones">
    <label class="interruptor"><input type="checkbox" name="${nombre}" ${marcado ? 'checked' : ''}><span class="interruptor-pista"></span> ${etiqueta}</label>
  </div>`;
}

function conectarEnvio(zona, seccion, construir) {
  const formulario = zona.querySelector('form');
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      const respuesta = await pedir(`/api/ajustes/${seccion}`, { method: 'PUT', cuerpo: construir(formulario.elements) });
      toast('Ajustes guardados.');
      return respuesta;
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function pintarContacto(zona, datos) {
  const formulario = formularioSimple(zona,
    campoTexto('telefono', 'Teléfono', datos.telefono) +
    campoTexto('direccion', 'Dirección', datos.direccion) +
    campoTexto('horario', 'Horario', datos.horario),
    `<label>Emails de destino de contacto y avisos (uno por línea) *</label>
     <textarea name="emailsDestino" rows="3" required>${escapar((datos.emailsDestino || []).join('\n'))}</textarea>`);
  conectarEnvio(zona, 'contacto', (campos) => ({
    emailsDestino: campos.emailsDestino.value.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean),
    telefono: campos.telefono.value.trim(),
    direccion: campos.direccion.value.trim(),
    horario: campos.horario.value.trim(),
  }));
}

function pintarRedes(zona, datos) {
  const formulario = formularioSimple(zona,
    ['instagram', 'tiktok', 'pinterest', 'facebook', 'youtube', 'whatsapp']
      .map((red) => campoTexto(red, red.charAt(0).toUpperCase() + red.slice(1), datos[red], 'url', 'https://…'))
      .join(''));
  conectarEnvio(zona, 'redes', (campos) => {
    const envio = {};
    ['instagram', 'tiktok', 'pinterest', 'facebook', 'youtube', 'whatsapp'].forEach((red) => {
      envio[red] = campos[red].value.trim();
    });
    return envio;
  });
}

function pintarSmtp(zona, datos) {
  const hayClave = datos.contraseña === MASCARA;
  const formulario = formularioSimple(zona,
    campoTexto('host', 'Servidor (host)', datos.host, 'text', 'p. ej. smtp.gmail.com') +
    campoTexto('puerto', 'Puerto', datos.puerto ?? 587, 'number') +
    campoTexto('usuario', 'Usuario', datos.usuario) +
    campoTexto('contraseña', 'Contraseña', '', 'password', hayClave ? 'Hay una contraseña guardada: dejar vacío para conservarla' : 'Contraseña') +
    campoTexto('desde', 'Remitente (De:)', datos.desde, 'text', 'SHADDAI <hola@shaddai.es>') +
    campoInterruptor('activo', 'SMTP activo', datos.activo),
    `<p class="nota-secreto">${hayClave ? 'Hay una contraseña guardada. Escribe una nueva solo si quieres reemplazarla.' : 'Sin contraseña guardada.'}</p>
     <div class="ayuda-seccion">
       <p><strong>¿Cómo probarlo?</strong> No hay botón de prueba: guarda los datos, ve a <em>Email marketing → Campañas</em>, crea una campaña de prueba contigo de suscriptor y pulsa «Enviar». Si algo falla, el correo queda como .eml en <code>servidor/datos/bandeja-salida/</code>. Ejemplo de Gmail: host <code>smtp.gmail.com</code>, puerto <code>587</code> y contraseña de aplicación (no la normal): genera la tuya en myaccount.google.com → Seguridad → Contraseñas de aplicaciones.</p>
     </div>`);
  conectarEnvio(zona, 'smtp', (campos) => ({
    host: campos.host.value.trim(),
    puerto: Number.parseInt(campos.puerto.value, 10) || 587,
    usuario: campos.usuario.value.trim(),
    contraseña: campos.contraseña.value,
    desde: campos.desde.value.trim(),
    activo: campos.activo.checked,
  }));
}

function pintarRedsys(zona, datos) {
  const hayClave = datos.clave === MASCARA;
  const formulario = formularioSimple(zona,
    campoTexto('fuc', 'Código FUC', datos.fuc) +
    campoTexto('terminal', 'Terminal', datos.terminal ?? '1') +
    campoTexto('moneda', 'Moneda (978 = EUR)', datos.moneda ?? '978') +
    `<div>
      <label>Entorno</label>
      <select name="entorno">
        <option value="test" ${datos.entorno !== 'produccion' ? 'selected' : ''}>Test (sis-t.redsys.es)</option>
        <option value="produccion" ${datos.entorno === 'produccion' ? 'selected' : ''}>Producción (sis.redsys.es)</option>
      </select>
    </div>` +
    campoTexto('clave', 'Clave secreta', '', 'password', hayClave ? 'Hay una clave guardada: dejar vacío para conservarla' : 'Clave secreta (clave de operación)') +
    campoTexto('nombreComercio', 'Nombre del comercio', datos.nombreComercio) +
    campoTexto('urlOk', 'URL de pago correcto', datos.urlOk) +
    campoTexto('urlKo', 'URL de pago cancelado', datos.urlKo) +
    campoTexto('urlNotificacion', 'URL de notificación', datos.urlNotificacion, 'text', 'https://tudominio.com/api/public/redsys-notificacion') +
    campoInterruptor('metodoTarjeta', 'Permitir tarjeta', datos.metodoTarjeta !== false) +
    campoInterruptor('metodoBizum', 'Permitir Bizum', datos.metodoBizum !== false),
    `<p class="nota-secreto">${hayClave ? 'Hay una clave guardada (se muestra enmascarada por seguridad). Deja el campo vacío para conservarla.' : 'Sin clave guardada: los pagos no funcionarán hasta que la introduzcas.'}</p>
     <div class="ayuda-seccion">
       <p><strong>De test a producción:</strong> pide a tu banco el FUC definitivo y la clave de producción, cámbialos aquí junto al entorno «Producción» y guarda. La clave nunca se vuelve a mostrar: el panel solo la guarda.</p>
     </div>`);
  conectarEnvio(zona, 'redsys', (campos) => ({
    fuc: campos.fuc.value.trim(),
    terminal: campos.terminal.value.trim() || '1',
    moneda: campos.moneda.value.trim() || '978',
    entorno: campos.entorno.value,
    clave: campos.clave.value,
    nombreComercio: campos.nombreComercio.value.trim(),
    urlOk: campos.urlOk.value.trim(),
    urlKo: campos.urlKo.value.trim(),
    urlNotificacion: campos.urlNotificacion.value.trim(),
    metodoTarjeta: campos.metodoTarjeta.checked,
    metodoBizum: campos.metodoBizum.checked,
  }));
}

function pintarEnvio(zona, datos) {
  const formulario = formularioSimple(zona,
    campoTexto('coste', 'Coste de envío (€)', datos.coste ?? 0, 'number') +
    campoTexto('gratisDesde', 'Envío gratis desde (€, 0 = nunca)', datos.gratisDesde ?? 0, 'number'),
    `<label>Plazos y texto de envío (se muestra en la web)</label>
     <textarea name="plazos" rows="3" maxlength="2000">${escapar(datos.plazos || '')}</textarea>
     ${campoInterruptor('activo', 'Cobrar envío', datos.activo !== false)}`);
  conectarEnvio(zona, 'envio', (campos) => ({
    coste: Number(String(campos.coste.value).replace(',', '.')) || 0,
    gratisDesde: Number(String(campos.gratisDesde.value).replace(',', '.')) || 0,
    plazos: campos.plazos.value.trim(),
    activo: campos.activo.checked,
  }));
}

function pintarEmails(zona, datos) {
  const plantilla = (nombre, titulo) => {
    const p = datos[nombre] || {};
    return `
      <fieldset class="plantilla-email">
        <legend>${titulo}</legend>
        ${campoInterruptor(`${nombre}.activo`, 'Enviar este correo', p.activo !== false)}
        <label>Asunto</label>
        <input name="${nombre}.asunto" value="${escapar(p.asunto || '')}" maxlength="300">
        <label>Contenido (HTML)</label>
        <textarea name="${nombre}.html" rows="8" class="campo-mono">${escapar(p.html || '')}</textarea>
      </fieldset>`;
  };
  zona.innerHTML = `
    <form class="formulario ajustes-formulario">
      <div class="ayuda-seccion">
        <p>Se envían cuando Redsys notifica un pago autorizado. Variables disponibles:
        <code>{{nombre}}</code> <code>{{pedido}}</code> <code>{{total}}</code> <code>{{articulos}}</code>.
        Se necesitan SMTP activo y el email del cliente en el pedido.</p>
      </div>
      ${plantilla('confirmacionCompra', 'Confirmación de compra')}
      ${plantilla('agradecimiento', 'Agradecimiento (llega más tarde, cuando el pedido ya está en casa)')}
      <div class="barra-herramientas sin-borde">
        <button type="button" class="boton boton-fantasma" data-vista-previa>Vista previa</button>
      </div>
      <div class="modal-acciones"><button type="submit" class="boton boton-primario">Guardar plantillas</button></div>
    </form>`;

  const formulario = zona.querySelector('form');
  zona.querySelector('[data-vista-previa]').addEventListener('click', () => {
    abrirVistaPrevia('Plantilla de correo', formulario.elements['confirmacionCompra.html'].value || '<p>(sin contenido)</p>');
  });
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const construir = (nombre) => ({
      activo: formulario.elements[`${nombre}.activo`].checked,
      asunto: formulario.elements[`${nombre}.asunto`].value.trim(),
      html: formulario.elements[`${nombre}.html`].value,
    });
    try {
      await pedir('/api/ajustes/emails-automaticos', {
        method: 'PUT',
        cuerpo: { confirmacionCompra: construir('confirmacionCompra'), agradecimiento: construir('agradecimiento') },
      });
      toast('Plantillas guardadas.');
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function pintarNotificaciones(zona, datos) {
  const formulario = formularioSimple(zona,
    campoTexto('email', 'Email para avisos internos', datos.email),
    `${campoInterruptor('nuevoPedido', 'Avisar de cada pedido pagado', datos.nuevoPedido !== false)}
     ${campoInterruptor('nuevoContacto', 'Avisar de cada mensaje de contacto', datos.nuevoContacto !== false)}
     ${campoInterruptor('nuevoMensaje', 'Avisar de mensajes nuevos en general', datos.nuevoMensaje !== false)}`);
  conectarEnvio(zona, 'notificaciones', (campos) => ({
    email: campos.email.value.trim(),
    nuevoPedido: campos.nuevoPedido.checked,
    nuevoContacto: campos.nuevoContacto.checked,
    nuevoMensaje: campos.nuevoMensaje.checked,
  }));
}
