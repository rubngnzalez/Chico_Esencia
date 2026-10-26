// Ajustes (solo admin): contacto, redes, SMTP, Redsys, envío, emails
// automáticos y notificaciones. Todo vive en la fila única de la tabla
// ajustes (una columna jsonb por sección). Los secretos (clave Redsys y
// contraseña SMTP) llegan enmascarados: campo vacío o máscara = conserva.
import { sb, mensajeError } from '../bd.js';
import { escapar, toast, abrirModal, abrirVistaPrevia } from '../api.js';

const MASCARA = '••••••••';

const PESTANAS = [
  { clave: 'contacto', texto: 'Contacto' },
  { clave: 'redes', texto: 'Redes sociales' },
  { clave: 'smtp', texto: 'SMTP' },
  { clave: 'redsys', texto: 'Pago (Redsys)' },
  { clave: 'envio', texto: 'Envío' },
  { clave: 'emails_automaticos', texto: 'Emails automáticos' },
  { clave: 'notificaciones', texto: 'Notificaciones' },
];

let pestanaActual = 'contacto';
let ajustes = null;

export default async function (contenedor) {
  contenedor.innerHTML = '<p class="cargando">Cargando ajustes…</p>';
  try {
    ajustes = await (async () => {
      const { data, error } = await sb().from('ajustes').select('*').eq('id', 'general').maybeSingle();
      if (error) throw new Error(mensajeError(error));
      if (!data) {
        const { error: errorInsert } = await sb().from('ajustes').insert({ id: 'general' });
        if (errorInsert) throw new Error(mensajeError(errorInsert));
        const { data: creada } = await sb().from('ajustes').select('*').eq('id', 'general').maybeSingle();
        return creada;
      }
      return data;
    })();
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
    else if (pestanaActual === 'emails_automaticos') pintarEmails(zona, datos);
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

// Guarda una sección: fusiona con lo guardado (los secretos vacíos conservan)
async function guardarSeccion(seccion, valores) {
  const actual = ajustes[seccion] || {};
  const fusion = { ...actual, ...valores };
  const error = (await sb().from('ajustes').update({ [seccion]: fusion }).eq('id', 'general')).error;
  if (error) throw new Error(mensajeError(error));
  ajustes[seccion] = fusion;
  toast('Ajustes guardados.');
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

function pintarContacto(zona, datos) {
  const formulario = formularioSimple(zona,
    campoTexto('telefono', 'Teléfono', datos.telefono) +
    campoTexto('direccion', 'Dirección', datos.direccion) +
    campoTexto('horario', 'Horario', datos.horario),
    `<label>Emails de destino de contacto y avisos (uno por línea) *</label>
     <textarea name="emailsDestino" rows="3" required>${escapar((datos.emailsDestino || []).join('\n'))}</textarea>`);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    try {
      await guardarSeccion('contacto', {
        emailsDestino: campos.emailsDestino.value.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean),
        telefono: campos.telefono.value.trim(),
        direccion: campos.direccion.value.trim(),
        horario: campos.horario.value.trim(),
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function pintarRedes(zona, datos) {
  const formulario = formularioSimple(zona,
    ['instagram', 'tiktok', 'pinterest', 'facebook', 'youtube', 'whatsapp']
      .map((red) => campoTexto(red, red.charAt(0).toUpperCase() + red.slice(1), datos[red], 'url', 'https://…'))
      .join(''));
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const envio = {};
    ['instagram', 'tiktok', 'pinterest', 'facebook', 'youtube', 'whatsapp'].forEach((red) => {
      envio[red] = campos[red].value.trim();
    });
    try {
      await guardarSeccion('redes', envio);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function pintarSmtp(zona, datos) {
  const hayClave = Boolean(datos.contrasena);
  const formulario = formularioSimple(zona,
    campoTexto('host', 'Servidor (host)', datos.host, 'text', 'p. ej. smtp.gmail.com') +
    campoTexto('puerto', 'Puerto', datos.puerto ?? 587, 'number') +
    campoTexto('usuario', 'Usuario', datos.usuario) +
    campoTexto('contrasena', 'Contraseña', '', 'password', hayClave ? 'Hay una contraseña guardada: dejar vacío para conservarla' : 'Contraseña') +
    campoTexto('desde', 'Remitente (De:)', datos.desde, 'text', 'SHADDAI <hola@shaddai.es>') +
    campoInterruptor('activo', 'SMTP activo', datos.activo),
    `<p class="nota-secreto">${hayClave ? 'Hay una contraseña guardada. Escribe una nueva solo si quieres reemplazarla.' : 'Sin contraseña guardada.'}</p>
     <div class="ayuda-seccion">
       <p><strong>Sobre el envío real:</strong> la web usa Resend (secreto <code>RESEND_API_KEY</code> de las Edge
       Functions, fase 2). Esta sección SMTP se guarda como referencia y como remitente (De:) de todos los correos.
       Sin envío real configurado, cada correo queda en <em>Email marketing → Bandeja de salida</em> descargable como .eml.</p>
     </div>`);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const contrasena = campos.contrasena.value;
    const valores = {
      host: campos.host.value.trim(),
      puerto: Number.parseInt(campos.puerto.value, 10) || 587,
      usuario: campos.usuario.value.trim(),
      desde: campos.desde.value.trim(),
      activo: campos.activo.checked,
    };
    if (contrasena && contrasena !== MASCARA) valores.contrasena = contrasena;
    try {
      await guardarSeccion('smtp', valores);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function pintarRedsys(zona, datos) {
  const hayClave = Boolean(datos.clave);
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
    campoTexto('urlNotificacion', 'URL de notificación', datos.urlNotificacion, 'text', 'https://TU_REF.supabase.co/functions/v1/redsys-notificacion') +
    campoInterruptor('metodoTarjeta', 'Permitir tarjeta', datos.metodoTarjeta !== false) +
    campoInterruptor('metodoBizum', 'Permitir Bizum', datos.metodoBizum !== false),
    `<p class="nota-secreto">${hayClave ? 'Hay una clave guardada (nunca se vuelve a mostrar). Deja el campo vacío para conservarla.' : 'Sin clave guardada: los pagos firmados en servidor no funcionarán hasta que la introduzcas.'}</p>
     <div class="ayuda-seccion">
       <p><strong>De test a producción:</strong> pide a tu banco el FUC definitivo y la clave de producción, cámbialos aquí junto al entorno «Producción» y guarda. Con funciones desplegadas (fase 2), pon en «URL de notificación» la dirección de la función <code>redsys-notificacion</code>.</p>
       <p><strong>Modo test sin funciones:</strong> mientras el entorno sea «test», la web pública puede firmar en cliente con la clave de pruebas de Redsys (la vista pública solo la expone en test). En producción, la clave real nunca sale de Supabase: despliega las funciones (fase 2) antes de cambiar de entorno.</p>
     </div>`);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const clave = campos.clave.value;
    const valores = {
      fuc: campos.fuc.value.trim(),
      terminal: campos.terminal.value.trim() || '1',
      moneda: campos.moneda.value.trim() || '978',
      entorno: campos.entorno.value,
      nombreComercio: campos.nombreComercio.value.trim(),
      urlOk: campos.urlOk.value.trim(),
      urlKo: campos.urlKo.value.trim(),
      urlNotificacion: campos.urlNotificacion.value.trim(),
      metodoTarjeta: campos.metodoTarjeta.checked,
      metodoBizum: campos.metodoBizum.checked,
    };
    if (clave && clave !== MASCARA) valores.clave = clave;
    try {
      await guardarSeccion('redsys', valores);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

function pintarEnvio(zona, datos) {
  const formulario = formularioSimple(zona,
    campoTexto('coste', 'Coste de envío (€)', datos.coste ?? 0, 'number') +
    campoTexto('gratisDesde', 'Envío gratis desde (€, 0 = nunca)', datos.gratisDesde ?? 0, 'number'),
    `<label>Plazos y texto de envío (se muestra en la web)</label>
     <textarea name="plazos" rows="3" maxlength="2000">${escapar(datos.plazos || '')}</textarea>
     ${campoInterruptor('activo', 'Cobrar envío', datos.activo !== false)}`);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    try {
      await guardarSeccion('envio', {
        coste: Number(String(campos.coste.value).replace(',', '.')) || 0,
        gratisDesde: Number(String(campos.gratisDesde.value).replace(',', '.')) || 0,
        plazos: campos.plazos.value.trim(),
        activo: campos.activo.checked,
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  });
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
        <p>Se envían cuando la función <code>redsys-notificacion</code> confirma un pago autorizado. Variables disponibles:
        <code>{{nombre}}</code> <code>{{pedido}}</code> <code>{{total}}</code> <code>{{articulos}}</code>.
        Sin funciones desplegadas (fase 2) los correos quedan pendientes en la bandeja de salida.</p>
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
      await guardarSeccion('emails_automaticos', {
        confirmacionCompra: construir('confirmacionCompra'),
        agradecimiento: construir('agradecimiento'),
      });
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
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    try {
      await guardarSeccion('notificaciones', {
        email: campos.email.value.trim(),
        nuevoPedido: campos.nuevoPedido.checked,
        nuevoContacto: campos.nuevoContacto.checked,
        nuevoMensaje: campos.nuevoMensaje.checked,
      });
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
