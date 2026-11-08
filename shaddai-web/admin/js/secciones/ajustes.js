// Ajustes (solo admin): contacto, redes, SMTP, Redsys, envío, emails
// automáticos y notificaciones. Todo vive en la fila única de la tabla
// ajustes (una columna jsonb por sección). Los secretos (clave Redsys y
// contraseña SMTP) llegan enmascarados: campo vacío o máscara = conserva.
import { sb, mensajeError } from '../bd.js';
import { escapar, toast, abrirModal, abrirVistaPrevia } from '../api.js';

const MASCARA = '••••••••';

// Textos por defecto de los correos de seguimiento post-venta: se muestran
// rellenos en el formulario (editables) y la base de datos usa los suyos
// (oms_plantilla_seguimiento_defecto) si el ajuste se guarda vacío.
const PLANTILLAS_DEFECTO = {
  seguimientoEnvio: {
    asunto: 'Tu pedido {{pedido}} ya va en camino 📦',
    html: `<p>Hola, {{nombre}}:</p>
<p>Tu paquete acaba de salir. Queremos que el trayecto sea tan fluido como esperas.</p>
{{bloqueSeguimiento}}
<p>Tiempo estimado de entrega: {{plazo}}.</p>
<p>Prepara un momento de calma para cuando lo recibas; nos hemos asegurado de cuidar cada detalle del embalaje.</p>
<p>Nos seguimos leyendo,<br>SHADDAI · Esencia de Umbral</p>`,
  },
  seguimientoCuidado: {
    asunto: '¿Cómo ha sido tu primer contacto con tu pedido?',
    html: `<p>Hola, {{nombre}}:</p>
<p>Hace unos días que tu pedido debió llegar a tus manos. Esperamos que la llegada haya ido sobre ruedas.</p>
<p>Para que le saques el máximo partido desde el primer momento, hemos preparado una breve guía con algunos consejos esenciales de uso y conservación:</p>
<ul>
<li><strong>Conservación:</strong> guarda tu esencia lejos de la luz solar directa y de fuentes de calor; así el aroma se mantiene intacto mucho más tiempo.</li>
<li><strong>Aplicación:</strong> aplícala sobre piel hidratada (muñecas, cuello o interior de los codos): la fragancia fija mejor y se desarrolla por capas.</li>
<li><strong>Truco:</strong> espera unos segundos tras aplicarla antes de acercarla a la nariz; las notas de salida se abren con la calidez de la piel.</li>
</ul>
<p>Si te ha surgido cualquier duda sobre cómo integrarlo en tu rutina, solo tienes que responder a este mensaje. Estamos aquí para ayudarte.</p>
<p>Con aprecio,<br>SHADDAI · Esencia de Umbral</p>`,
  },
  seguimientoOpinion: {
    asunto: 'Tu opinión nos importa (de verdad)',
    html: `<p>Hola, {{nombre}}:</p>
<p>Esperamos que estés disfrutando de tu pedido {{pedido}}.</p>
<p>Para nosotros, el trabajo no termina cuando entregamos un pedido; nos importa conocer el impacto real que tiene en quien lo recibe. Tu experiencia nos ayuda a seguir afinando cada fórmula y cada detalle.</p>
<p>¿Nos dedicarías 2 minutos para contarnos tus impresiones?</p>
<p style="text-align:center;margin:24px 0;"><a href="https://omshaddai.com/contacto.html" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Dejar mi valoración</a></p>
<p>Gracias por formar parte de esto.</p>
<p>Un abrazo,<br>SHADDAI · Esencia de Umbral</p>`,
  },
};

const PESTANAS = [
  { clave: 'contacto', texto: 'Contacto' },
  { clave: 'redes', texto: 'Redes sociales' },
  { clave: 'smtp', texto: 'SMTP' },
  { clave: 'redsys', texto: 'Pago (Redsys)' },
  { clave: 'envio', texto: 'Envío' },
  { clave: 'emails_automaticos', texto: 'Emails automáticos' },
  { clave: 'notificaciones', texto: 'Notificaciones' },
  { clave: 'sistema', texto: 'Sistema (oculto)' },
];

// Inventario de todo lo que vive hardcodeado en el código (repo) y en los
// secretos de despliegue: se muestra en la pestaña Sistema para que la
// administración los vea y los edite (copia de consulta en la base de datos).
const VALORES_CODIGO = {
  supabaseUrl: 'https://zjzqbugpdpfuttdwagai.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqenFidWdwZHBmdXR0ZHdhZ2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1OTUxOTIsImV4cCI6MjA5NzE3MTE5Mn0.Z9yr-0aBTwQyyurC-V4-hJ01nRxpbhz-MTkW7pVDZDA',
  supabaseRef: 'zjzqbugpdpfuttdwagai',
  apiWorkerUrl: 'https://shaddai-panel.redes-301dpi.workers.dev',
  dominioWeb: 'omshaddai.com',
  d1Database: 'shaddai · 892de753-37a5-4361-bfa2-84d62b46689b',
  secretosWorker: 'SECRETO_SESION · RESEND_API_KEY (solo con «npx wrangler secret put …»)',
  redsysComercio: '372022558',
  redsysTerminal: '1',
  redsysMoneda: '978',
  redsysClave: 'sq7HjrUOBfKmC576ILgskD5srU870gJ7',
  redsysEntorno: 'test',
  redsysUrlTest: 'https://sis-t.redsys.es:25443/sis/realizarPago',
  redsysUrlProduccion: 'https://sis.redsys.es/sis/realizarPago',
  redsysFucPruebas: '999008889',
  redsysClavePruebas: 'sq7HjrUOBf2m7spUjazlA',
  githubRepo: 'https://github.com/rubngnzalez/Chico_Esencia',
  githubRama: 'main',
  despliegue: 'GitHub Pages (web + /admin) · Cloudflare Worker (API + /panel)',
  emailGeneral: 'info@omshaddai.com',
  emailPedidos: 'pedidos@omshaddai.com',
};

// Los dos valores de conexión reales están ya cargados en esta página:
// enseñamos siempre lo que de verdad está usando el panel ahora mismo.
if (window.SUPABASE_URL) VALORES_CODIGO.supabaseUrl = window.SUPABASE_URL;
if (window.SUPABASE_ANON_KEY) VALORES_CODIGO.supabaseAnonKey = window.SUPABASE_ANON_KEY;

let pestanaActual = 'contacto';
let ajustes = null;

export default async function (contenedor) {
  contenedor.innerHTML = '<p class="cargando">Cargando ajustes…</p>';
  try {
    ajustes = await (async () => {
      const { data, error } = await sb().from('oms_ajustes').select('*').eq('id', 'general').maybeSingle();
      if (error) throw new Error(mensajeError(error));
      if (!data) {
        const { error: errorInsert } = await sb().from('oms_ajustes').insert({ id: 'general' });
        if (errorInsert) throw new Error(mensajeError(errorInsert));
        const { data: creada } = await sb().from('oms_ajustes').select('*').eq('id', 'general').maybeSingle();
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
    else if (pestanaActual === 'sistema') pintarSistema(zona, datos);
    else pintarNotificaciones(zona, datos);
  };

  // Las pestañas viven en `contenedor` (hermanas de #zona-ajustes): el
  // listener debe estar en `contenedor` o los clics nunca se detectan.
  contenedor.addEventListener('click', (evento) => {
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
  const error = (await sb().from('oms_ajustes').update({ [seccion]: fusion }).eq('id', 'general')).error;
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
    campoTexto('desde', 'Remitente (De:)', datos.desde, 'text', 'SHADDAI <info@omshaddai.com>') +
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
    campoTexto('coste', 'Coste de envío nacional (€)', datos.coste ?? 0, 'number') +
    campoTexto('costeInternacional', 'Coste de envío internacional (€)', datos.costeInternacional ?? '', 'number') +
    campoTexto('gratisDesde', 'Envío gratis nacional desde (€, 0 = nunca)', datos.gratisDesde ?? 0, 'number') +
    campoTexto('gratisDesdeInternacional', 'Envío gratis internacional desde (€, 0 = nunca)', datos.gratisDesdeInternacional ?? 0, 'number'),
    `<label>Plazos y texto de envío (se muestra en la web)</label>
     <textarea name="plazos" rows="3" maxlength="2000">${escapar(datos.plazos || '')}</textarea>
     ${campoInterruptor('activo', 'Cobrar envío', datos.activo !== false)}
     <div class="ayuda-seccion">
       <p>La zona se decide con el país del formulario de pago: España = nacional; cualquier otro país =
       internacional. Si dejas vacío el coste internacional, se usa el nacional.</p>
     </div>`);
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const costeNacional = Number(String(campos.coste.value).replace(',', '.')) || 0;
    const costeInternacionalTexto = String(campos.costeInternacional.value).replace(',', '.').trim();
    try {
      await guardarSeccion('envio', {
        coste: costeNacional,
        costeInternacional: costeInternacionalTexto === '' ? costeNacional : Number(costeInternacionalTexto) || 0,
        gratisDesde: Number(String(campos.gratisDesde.value).replace(',', '.')) || 0,
        gratisDesdeInternacional: Number(String(campos.gratisDesdeInternacional.value).replace(',', '.')) || 0,
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
    const p = {
      activo: true, asunto: '', html: '',
      ...(PLANTILLAS_DEFECTO[nombre] || {}),
      ...(datos[nombre] || {}),
    };
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
  const diasSeguimiento = datos.seguimiento || {};
  zona.innerHTML = `
    <form class="formulario ajustes-formulario">
      <div class="ayuda-seccion">
        <p><strong>Journey post-venta de 4 correos.</strong> Los dos primeros se envían cuando la función
        <code>redsys-notificacion</code> confirma un pago autorizado. Los de seguimiento se programan al cambiar
        el estado del pedido: «En camino» dispara el mensaje 2 y «Entregado» programa los mensajes 3 y 4 a los
        días indicados abajo (se procesan cada hora con el cron de Supabase o desde
        <em>Email marketing → Seguimiento post-venta</em>). Variables disponibles:
        <code>{{nombre}}</code> <code>{{pedido}}</code> <code>{{total}}</code> <code>{{articulos}}</code>
        <code>{{plazo}}</code> <code>{{seguimientoUrl}}</code> y <code>{{bloqueSeguimiento}}</code>
        (botón «Seguir mi envío» con el enlace, o texto alternativo si no hay enlace).
        Sin funciones desplegadas ni cron, los correos quedan pendientes en la bandeja de salida.</p>
      </div>
      ${plantilla('confirmacionCompra', 'Mensaje 1 · Confirmación de compra (al confirmarse el pago)')}
      ${plantilla('agradecimiento', 'Mensaje 1b · Agradecimiento (llega con la confirmación del pago)')}
      <div class="formulario-grid">
        <div>
          <label>Días tras la entrega → correo de consejos (3-5 recomendado)</label>
          <input name="seguimiento.diasCuidado" type="number" min="0" max="30" value="${escapar(diasSeguimiento.diasCuidado ?? 4)}">
        </div>
        <div>
          <label>Días tras la entrega → correo de opinión (10-14 recomendado)</label>
          <input name="seguimiento.diasOpinion" type="number" min="0" max="60" value="${escapar(diasSeguimiento.diasOpinion ?? 12)}">
        </div>
      </div>
      ${plantilla('seguimientoEnvio', 'Mensaje 2 · En camino (al pasar el pedido a «En camino»)')}
      ${plantilla('seguimientoCuidado', 'Mensaje 3 · Consejos de uso (días después de la entrega)')}
      ${plantilla('seguimientoOpinion', 'Mensaje 4 · Petición de opinión (días después de la entrega)')}
      <div class="barra-herramientas sin-borde">
        <button type="button" class="boton boton-fantasma" data-vista-previa>Vista previa</button>
        <button type="button" class="boton boton-fantasma" data-vista-previa-seguimiento>Vista previa del seguimiento</button>
      </div>
      <div class="modal-acciones"><button type="submit" class="boton boton-primario">Guardar plantillas</button></div>
    </form>`;

  const formulario = zona.querySelector('form');
  zona.querySelector('[data-vista-previa]').addEventListener('click', () => {
    abrirVistaPrevia('Plantilla de correo', formulario.elements['confirmacionCompra.html'].value || '<p>(sin contenido)</p>');
  });
  zona.querySelector('[data-vista-previa-seguimiento]').addEventListener('click', () => {
    abrirVistaPrevia('Seguimiento post-venta', formulario.elements['seguimientoEnvio.html'].value || '<p>(sin contenido)</p>');
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
        seguimiento: {
          diasCuidado: Number.parseInt(formulario.elements['seguimiento.diasCuidado'].value, 10) || 4,
          diasOpinion: Number.parseInt(formulario.elements['seguimiento.diasOpinion'].value, 10) || 12,
        },
        seguimientoEnvio: construir('seguimientoEnvio'),
        seguimientoCuidado: construir('seguimientoCuidado'),
        seguimientoOpinion: construir('seguimientoOpinion'),
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

// Pestaña Sistema (oculta: solo llega aquí la administración, porque toda la
// sección Ajustes es de rol admin). Muestra y permite editar TODO lo que hoy
// está hardcodeado en el repo y en los secretos de despliegue. Se guarda en la
// columna jsonb «sistema» de oms_ajustes (nunca sale por la vista pública).
function pintarSistema(zona, datos) {
  // Un campo vacío o sin guardar muestra siempre el valor real del código.
  const valor = (campo) => datos[campo] || VALORES_CODIGO[campo] || '';
  const bloque = (titulo, nota, campos) => `
    <fieldset class="plantilla-email">
      <legend>${titulo}</legend>
      <div class="formulario-grid">${campos}</div>
      <p class="nota-secreto">${nota}</p>
    </fieldset>`;

  zona.innerHTML = `
    <form class="formulario ajustes-formulario">
      <div class="ayuda-seccion">
        <p><strong>Sección oculta de administración.</strong> Inventario completo de la configuración
        que está hardcodeada en el código (Supabase, GitHub, Worker, Redsys, emails por defecto).
        Al guardar queda una copia editable en la tabla <code>oms_ajustes</code>, visible solo para
        administradores desde esta pestaña. Los ficheros indicados en cada bloque son la fuente real
        que usa la web: si cambias un valor aquí, sincroniza también su fichero (o pídemelo en el chat
        y lo actualizo).</p>
      </div>

      ${bloque('Supabase — web pública y panel /admin (GitHub Pages)', `
        Conexión de arranque de este panel y de la web: vive en <code>shaddai-web/js/config-supabase.js</code>
        (mostrada arriba tal y como está cargada ahora mismo). No puede venir de la base de datos:
        el panel la necesita para conectarse, así que el fichero es la fuente real.`,
        campoTexto('supabaseUrl', 'URL del proyecto', valor('supabaseUrl')) +
        campoTexto('supabaseAnonKey', 'Clave anon public (JWT)', valor('supabaseAnonKey')) +
        campoTexto('supabaseRef', 'Referencia del proyecto (ref)', valor('supabaseRef')))}

      ${bloque('API — Worker de Cloudflare', `
        El Worker (<code>worker/</code>, nombre «shaddai-panel») sirve la API y el panel clásico. La URL vive en
        <code>shaddai-web/js/config-api.js</code> (SHADDAI_API_BASE) y los secretos solo se cambian con la CLI:
        <code>npx wrangler secret put SECRETO_SESION</code> y <code>npx wrangler secret put RESEND_API_KEY</code>.`,
        campoTexto('apiWorkerUrl', 'URL del Worker (API)', valor('apiWorkerUrl')) +
        campoTexto('dominioWeb', 'Dominio de la web', valor('dominioWeb')) +
        campoTexto('d1Database', 'Base de datos D1', valor('d1Database')) +
        campoTexto('secretosWorker', 'Secretos del Worker', valor('secretosWorker')))}

      ${bloque('Redsys — valores de reserva en la web (js/pago.js)', `
        La web solo usa estos valores de <code>shaddai-web/js/pago.js</code> si la vista pública de ajustes
        no responde. Lo vigente del TPV se gestiona en la pestaña «Pago (Redsys)». La clave de pruebas
        <code>sq7HjrUOBf2m7spUjazlA</code> es pública en la documentación de Redsys.`,
        campoTexto('redsysComercio', 'FUC (código de comercio) de reserva', valor('redsysComercio')) +
        campoTexto('redsysTerminal', 'Terminal de reserva', valor('redsysTerminal')) +
        campoTexto('redsysMoneda', 'Moneda de reserva', valor('redsysMoneda')) +
        campoTexto('redsysEntorno', 'Entorno de reserva (test/produccion)', valor('redsysEntorno')) +
        campoTexto('redsysClave', 'Clave de reserva del fichero pago.js', valor('redsysClave')) +
        campoTexto('redsysUrlTest', 'URL del SIS · test', valor('redsysUrlTest')) +
        campoTexto('redsysUrlProduccion', 'URL del SIS · producción', valor('redsysUrlProduccion')) +
        campoTexto('redsysFucPruebas', 'FUC genérico de pruebas (ajustes por defecto)', valor('redsysFucPruebas')) +
        campoTexto('redsysClavePruebas', 'Clave de pruebas pública de Redsys', valor('redsysClavePruebas')))}

      ${bloque('GitHub — repositorio y despliegue', `
        La web y este panel /admin se publican en GitHub Pages al actualizar la rama indicada.
        El workflow <code>.github/workflows/news-seo.yml</code> regenera los stubs OG/sitemap del diario.`,
        campoTexto('githubRepo', 'Repositorio', valor('githubRepo')) +
        campoTexto('githubRama', 'Rama de publicación', valor('githubRama')) +
        campoTexto('despliegue', 'Dónde vive cada pieza', valor('despliegue')))}

      ${bloque('Emails por defecto del código', `
        Valores con los que el código se inicializa cuando los ajustes están vacíos
        (contacto y avisos internos por defecto).`,
        campoTexto('emailGeneral', 'Email general (hola@)', valor('emailGeneral')) +
        campoTexto('emailPedidos', 'Email de pedidos', valor('emailPedidos')))}

      <div class="modal-acciones"><button type="submit" class="boton boton-primario">Guardar sistema</button></div>
    </form>`;

  const formulario = zona.querySelector('form');
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = formulario.elements;
    const envio = {};
    Object.keys(VALORES_CODIGO).forEach((campo) => {
      envio[campo] = campos[campo].value.trim();
    });
    try {
      await guardarSeccion('sistema', envio);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}
