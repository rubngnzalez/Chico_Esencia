// Manual del panel: documentación en español con estilos de impresión.
import { escapar } from '../api.js';

const SECCIONES_MANUAL = [
  {
    id: 'primeros-pasos', titulo: '1 · Primeros pasos',
    contenido: `
      <h3>Primer arranque</h3>
      <p>La primera vez que arranca el servidor (<code>cd servidor · npm install · npm start</code>), si todavía no hay usuarios, se crea
      automáticamente una cuenta de administración con email <code>admin@omshaddai.com</code> y una <strong>contraseña temporal</strong>
      que se imprime una única vez en la consola del servidor y se guarda en <code>servidor/datos/creado-&lt;fecha&gt;.txt</code>.
      Apúntala y guarda ese archivo en un lugar seguro.</p>
      <h3>Cambio de contraseña obligatorio</h3>
      <p>Al entrar por primera vez, el panel te lleva a una pantalla de «Cambia tu contraseña». Es obligatorio: mientras no la cambies,
      la API rechaza el resto de operaciones. La nueva contraseña debe tener al menos 8 caracteres. Puedes volver a cambiarla en
      cualquier momento pidiéndoselo a una administración desde <em>Usuarios → Contraseña</em>.</p>
      <h3>Roles</h3>
      <ul>
        <li><strong>admin</strong>: todo — ajustes, usuarios, pedidos y todo lo del editor.</li>
        <li><strong>editor</strong>: productos, categorías, ofertas, testimonios, blog, campañas, suscriptores y bandeja de entrada.</li>
        <li><strong>lector</strong>: solo lectura (productos, pedidos, artículos) y gestionar la bandeja de entrada.</li>
      </ul>
      <p>El menú lateral oculta automáticamente las secciones que tu rol no puede usar.</p>`,
  },
  {
    id: 'panel', titulo: '2 · Panel (resumen)',
    contenido: `
      <p>La pantalla inicial resume la actividad real de la tienda: pedidos pendientes, mensajes sin leer, suscriptores del boletín,
      productos activos, el último pedido recibido y las últimas campañas de email. Las tarjetas son pulsables: usa los accesos
      directos para saltar a cada sección.</p>`,
  },
  {
    id: 'productos', titulo: '3 · Productos e imágenes',
    contenido: `
      <p>Cada producto tiene nombre, slug (su dirección en la web, se rellena sola desde el nombre), código de referencia, descripción
      corta, historia, precio, precio de oferta opcional, stock, categoría, imágenes, «destacado» y el interruptor «activo».</p>
      <ul>
        <li><strong>Buscar</strong>: el cuadro de búsqueda filtra por nombre, código, slug o categoría mientras escribes.</li>
        <li><strong>Activar/desactivar</strong>: el interruptor de la columna «Activo». Un producto desactivado desaparece de la tienda
        pública en el momento, sin borrar nada.</li>
        <li><strong>Imágenes</strong>: en el formulario, elige uno o varios archivos (JPEG, PNG o WebP, máximo 2 MB). Se suben al
        almacenamiento del panel y la web pública las muestra automáticamente. Puedes quitarlas con la × de la miniatura. La primera imagen es la principal.</li>
        <li><strong>Eliminar</strong> pide confirmación y no se puede deshacer.</li>
      </ul>`,
  },
  {
    id: 'categorias-ofertas', titulo: '4 · Categorías y ofertas',
    contenido: `
      <h3>Categorías</h3>
      <p>Organizan el catálogo (por ejemplo «Esencias»). El número de <strong>orden</strong> decide qué categoría aparece primero; las
      flechas ↑ y ↓ de la tabla intercambian el orden de dos categorías de un clic.</p>
      <h3>Ofertas</h3>
      <p>Una oferta se aplica a un producto concreto con dos formatos: <strong>precio fijo</strong> (el precio final, por ejemplo 75 €) o
      <strong>porcentaje</strong> (por ejemplo −10 %). Puedes limitarla con fecha de inicio y/o fin. La tabla muestra siempre el
      <strong>precio efectivo resultante</strong>: la web cobra siempre el precio más bajo entre el precio de oferta del producto y sus
      ofertas activas, y ese mismo cálculo es el que firma el pago con Redsys.</p>`,
  },
  {
    id: 'testimonios', titulo: '5 · Testimonios',
    contenido: `
      <p>Recoge las palabras de clientas y clientes: nombre, ciudad, producto, texto y las <strong>estrellas</strong> con el selector
      visual de 1 a 5. Un testimonio solo se publica en la web cuando está <strong>aprobado</strong> (interruptor en la tabla). La web
      pública los lee de <code>/api/public/testimonios</code>, que solo devuelve los aprobados: desactivar el interruptor los retira
      al instante, sin borrarlos.</p>`,
  },
  {
    id: 'blog', titulo: '6 · Blog: escribir y publicar',
    contenido: `
      <p>Pulsa «+ Nuevo artículo». El editor incluye:</p>
      <ul>
        <li><strong>Título y slug</strong>: el slug (dirección del artículo) se rellena solo desde el título y puedes editarlo.</li>
        <li><strong>Extracto</strong>: el resumen que verán en el índice del blog.</li>
        <li><strong>Contenido en HTML</strong>: textarea monoespaciada. Puedes usar etiquetas normales (p, h2, h3, img, blockquote, ul, li, a…).
        El botón <strong>«Vista previa»</strong> abre el resultado renderizado en otra pestaña, con el estilo de la marca.</li>
        <li><strong>Imagen de portada</strong>: sube un archivo y la ruta se rellena sola.</li>
        <li><strong>Estado</strong>: borrador → programado (con fecha futura; se publica solo al llegar la hora) → publicado.</li>
      </ul>
      <h3>¿Qué hace «Publicar»?</h3>
      <p>El botón «Publicar» pide al servidor que genere la <strong>página estática</strong> del artículo en
      <code>shaddai-web/news/articulo/&lt;slug&gt;/index.html</code> y que actualice el índice público
      <code>shaddai-web/news/articulos.json</code>, del que se alimenta la web. «Despublicar» retira la página y devuelve el artículo a
      borrador; eliminar un artículo publicado también retira su página.</p>`,
  },
  {
    id: 'email', titulo: '7 · Email marketing',
    contenido: `
      <h3>Suscriptores</h3>
      <p>La lista de personas apuntadas al Boletín del Umbral (la web pública las añade con su formulario). Puedes
      <strong>exportar un CSV</strong> (ábrelo con Excel u hojas de cálculo) y eliminar suscriptores.</p>
      <h3>Campañas</h3>
      <p>Crea una campaña con asunto, contenido HTML (con vista previa) y destinatarios: «todos» o un <strong>segmento</strong> por
      etiqueta. Guardar crea un borrador; <strong>«Enviar»</strong> pide confirmación y manda el correo real a cada suscriptor.
      Tras el envío verás el estado y las estadísticas (enviados/fallidos). Si el SMTP no está configurado, la campaña queda
      <strong>«pendiente»</strong> y el correo se guarda como archivo .eml en <code>servidor/datos/bandeja-salida/</code>;
      el aviso rojo te enlaza a <em>Ajustes → SMTP</em>.</p>`,
  },
  {
    id: 'bandeja', titulo: '8 · Bandeja de entrada',
    contenido: `
      <p>Aquí llegan los mensajes del formulario de contacto de la web. Los <strong>no leídos se ven en negrita</strong> y el número
      aparece junto a «Bandeja de entrada» en el menú. Al abrir un mensaje verás todos sus datos (nombre, email, teléfono, fecha y
      texto). Desde el detalle puedes:</p>
      <ul>
        <li>Marcar leído / no leído, y archivar (desaparece de la vista normal, pestaña «Archivados»).</li>
        <li><strong>Responder</strong>: abre tu programa de correo con el destinatario, el asunto y el mensaje original ya rellenados.</li>
        <li>Guardar una nota interna con el contexto del trato.</li>
        <li>Eliminar (solo administración, con confirmación).</li>
      </ul>`,
  },
  {
    id: 'pedidos', titulo: '9 · Pedidos y el flujo de compra',
    contenido: `
      <p>Cuando alguien paga en la web, Redsys firma el pago y el servidor crea el pedido con estado <strong>pendiente</strong>. La
      notificación de Redsys lo marca <strong>pagado</strong> automáticamente (o cancelado si el pago no se autoriza).</p>
      <p>La tabla muestra número, fecha, cliente, total y estado. La administración cambia el estado con el desplegable:
      pendiente → pagado → enviado → entregado (o cancelado). El botón «Ver» abre el detalle con los artículos, cantidades,
      precios, envío y la respuesta de Redsys.</p>
      <h3>Emails automáticos</h3>
      <p>Al confirmarse un pago, si hay SMTP activo y plantillas activadas en <em>Ajustes → Emails automáticos</em>, el servidor envía
      al cliente la <strong>confirmación de compra</strong> y, con el mismo pago, el correo de <strong>agradecimiento</strong>. Las
      plantillas aceptan las variables <code>{{nombre}}</code>, <code>{{pedido}}</code>, <code>{{total}}</code> y
      <code>{{articulos}}</code>. Además, si <em>Ajustes → Notificaciones</em> lo tiene activado, el equipo recibe un aviso interno
      con el pedido.</p>`,
  },
  {
    id: 'smtp', titulo: '10 · Configurar el SMTP (correo saliente)',
    contenido: `
      <p>Sin SMTP el panel sigue funcionando, pero ningún correo sale de verdad: todos quedan guardados como .eml en
      <code>servidor/datos/bandeja-salida/</code>. Para activarlo, ve a <em>Ajustes → SMTP</em>:</p>
      <ol>
        <li><strong>Host y puerto</strong>: p. ej. <code>smtp.gmail.com</code> y <code>587</code> (Gmail usa 465 con SSL o 587 con STARTTLS; el servidor elige SSL solo en el 465).</li>
        <li><strong>Usuario y contraseña</strong>: en Gmail la contraseña normal no sirve; crea una <strong>contraseña de aplicación</strong>
        en myaccount.google.com → Seguridad → Contraseñas de aplicaciones (necesitas tener activada la verificación en dos pasos).</li>
        <li><strong>Remitente</strong>: el nombre y correo que verán al recibir, p. ej. <code>SHADDAI &lt;hola@shaddai.es&gt;</code>.</li>
        <li>Activa el interruptor <strong>SMTP activo</strong> y guarda.</li>
        <li><strong>Prueba</strong>: no hay botón de prueba; crea una campaña con asunto «Prueba», apúntate como suscriptora y envíala.
        Si llega, todo listo.</li>
      </ol>`,
  },
  {
    id: 'redsys', titulo: '11 · Redsys: de test a producción',
    contenido: `
      <p>En <em>Ajustes → Pago (Redsys)</em> se guardan el <strong>FUC</strong> (código de comercio), el <strong>terminal</strong>, la
      moneda (978 = euros), el <strong>entorno</strong> y la <strong>clave secreta</strong> de firma.</p>
      <ul>
        <li><strong>Modo test</strong>: usa el FUC de pruebas de tu banco (por ejemplo 999008889) con la clave de prueba, y entorno «Test».
        La web enviará a <code>sis-t.redsys.es</code>.</li>
        <li><strong>Pasar a producción</strong>: cuando el banco dé el alta real, introduce el FUC definitivo y la clave de producción,
        cambia el entorno a «Producción» y guarda. La URL de pago pasa a <code>sis.redsys.es</code> automáticamente.</li>
        <li><strong>La clave secreta nunca se muestra</strong>: el panel la guarda y a partir de entonces solo indica «hay una clave
        guardada». Deja el campo vacío para conservarla; escribe en él solo si quieres reemplazarla.</li>
        <li>Las URLs de OK/KO y de notificación pueden dejarse vacías: el servidor usa las de la propia web
        (<code>/pago-ok.html</code>, <code>/pago-ko.html</code> y <code>/api/public/redsys-notificacion</code>).</li>
      </ul>`,
  },
  {
    id: 'ajustes', titulo: '12 · Resto de ajustes',
    contenido: `
      <ul>
        <li><strong>Contacto</strong>: los emails de destino (uno por línea) reciben los mensajes del formulario y los avisos internos;
        también teléfono, dirección y horario que muestra la web.</li>
        <li><strong>Redes sociales</strong>: URLs completas de Instagram, TikTok, Pinterest, Facebook, YouTube y WhatsApp.</li>
        <li><strong>Envío</strong>: coste, umbral de gratuidad («gratis desde»), texto de plazos y un interruptor para cobrar o no envío.</li>
        <li><strong>Notificaciones</strong>: email interno y qué avisos se envían (pedido pagado, nuevo contacto…). Requieren SMTP.</li>
      </ul>`,
  },
  {
    id: 'usuarios', titulo: '13 · Usuarios',
    contenido: `
      <p>Solo la administración ve esta sección. «+ Nuevo usuario» crea la cuenta con una <strong>contraseña temporal</strong>
      generada automáticamente (puedes regenerarla o escribirla): cópiaseła a la persona en ese momento, porque no se vuelve a
      mostrar. Desde «Editar» cambias nombre y rol; el interruptor <strong>Activo</strong> bloquea el acceso sin borrar la cuenta;
      «Contraseña» fija una nueva. No se permite eliminar tu propio usuario ni dejar la tienda sin administración.</p>`,
  },
  {
    id: 'datos', titulo: '14 · Dónde viven los datos y copias de seguridad',
    contenido: `
      <p>Todo el panel (productos, pedidos, mensajes, ajustes, usuarios…) se guarda en JSON plano dentro de
      <code>servidor/datos/</code>; no hay base de datos externa. Esa carpeta <strong>no se sube al repositorio</strong> (está en el
      .gitignore) porque contiene credenciales y datos personales.</p>
      <h3>Copia de seguridad</h3>
      <ol>
        <li>Para el servidor (Ctrl+C en su consola).</li>
        <li>Copia la carpeta <code>servidor/datos/</code> completa a un lugar seguro (disco externo, nube privada…). Incluye los JSON,
        el secreto de sesión y la bandeja de salida.</li>
        <li>Las imágenes subidas viven en <code>shaddai-web/img/subidas/</code>: cópialas también.</li>
        <li>Para restaurar, devuelve ambas carpetas a su sitio y vuelve a arrancar.</li>
      </ol>
      <p><strong>Ojo:</strong> si borras <code>servidor/datos/</code> entera, el primer arranque re-sembrará el catálogo de ejemplo y
      creará otra contraseña temporal de administración; los datos anteriores se habrán perdido.</p>`,
  },
];

export default async function (contenedor) {
  contenedor.innerHTML = `
    <div class="barra-herramientas">
      <p class="texto-suave">Manual de uso del panel. También puedes imprimirlo o guardarlo en PDF.</p>
      <button id="boton-imprimir" class="boton boton-primario" type="button">Imprimir / Guardar PDF</button>
    </div>
    <article class="manual">
      <header class="manual-cabecera">
        <h2>Manual del panel · SHADDAI · Esencia de Umbral</h2>
        <p>Guía completa, sección a sección, escrita en español claro. Actualizada con cada versión del panel.</p>
      </header>
      ${SECCIONES_MANUAL.map((s) => `
        <section class="manual-seccion" id="${escapar(s.id)}">
          <h3>${escapar(s.titulo)}</h3>
          ${s.contenido}
        </section>`).join('')}
      <footer class="manual-pie">SHADDAI · Esencia de Umbral — panel de gestión interno. Dudas técnicas: <code>servidor/README.md</code>.</footer>
    </article>`;

  contenedor.querySelector('#boton-imprimir').addEventListener('click', () => window.print());
}
