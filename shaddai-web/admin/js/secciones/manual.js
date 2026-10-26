// Manual del panel (adaptado a Supabase): documentación en español con
// estilos de impresión.
import { escapar } from '../api.js';

const SECCIONES_MANUAL = [
  {
    id: 'primeros-pasos', titulo: '1 · Primeros pasos',
    contenido: `
      <h3>¿Dónde viven las cosas?</h3>
      <p>Este panel es una página estática dentro de la propia web (omshaddai.com/admin/) que habla
      directamente con <strong>Supabase</strong>: la base de datos, las cuentas de usuario (Authentication),
      el almacenamiento de imágenes (bucket <code>recursos</code>) y, en fase 2, las funciones de pago y
      de correo. No hay servidores propios que mantener.</p>
      <h3>Entrar por primera vez</h3>
      <p>La cuenta se crea desde el dashboard de Supabase: <strong>Authentication → Users → Add user</strong>
      (marca «Auto Confirm User»). El primer usuario del proyecto queda automáticamente como
      <strong>administración</strong>; los siguientes entran como <strong>lector</strong> y pueden promocionarse
      desde la sección Usuarios de este panel.</p>
      <h3>Roles</h3>
      <ul>
        <li><strong>admin</strong>: todo — ajustes, usuarios, pedidos y todo lo del editor.</li>
        <li><strong>editor</strong>: productos, categorías, ofertas, testimonios, blog, campañas, suscriptores y bandeja de entrada.</li>
        <li><strong>lector</strong>: solo lectura (productos, pedidos, artículos) y gestionar la bandeja de entrada.</li>
      </ul>
      <p>El menú lateral oculta automáticamente las secciones que tu rol no puede usar, y la propia base de
      datos (RLS) lo verifica: un lector no puede escribir aunque manipule la página.</p>`,
  },
  {
    id: 'panel', titulo: '2 · Panel (resumen)',
    contenido: `
      <p>La pantalla inicial resume la actividad real de la tienda: pedidos pendientes, mensajes sin leer,
      suscriptores del boletín, productos activos, el último pedido recibido y las últimas campañas de email.
      Usa los accesos directos para saltar a cada sección.</p>`,
  },
  {
    id: 'productos', titulo: '3 · Productos e imágenes',
    contenido: `
      <p>Cada producto tiene nombre, slug (su dirección en la web, se rellena solo desde el nombre), código de
      referencia, descripción corta, historia, precio, precio de oferta opcional, stock, categoría, imágenes,
      «destacado» y el interruptor «activo».</p>
      <ul>
        <li><strong>Buscar</strong>: el cuadro de búsqueda filtra por nombre, código o slug mientras escribes.</li>
        <li><strong>Activar/desactivar</strong>: el interruptor de la columna «Activo». Un producto desactivado
        desaparece de la tienda pública al momento, sin borrar nada.</li>
        <li><strong>Imágenes</strong>: elige los archivos (JPEG, PNG o WebP, máximo 5 MB). Se suben al bucket
        <strong>recursos</strong> de Supabase (Storage) y se guardan como URL pública completa, así que la web
        las muestra sin tocar nada más. La primera imagen es la principal.</li>
        <li><strong>Eliminar</strong> pide confirmación y no se puede deshacer.</li>
      </ul>`,
  },
  {
    id: 'categorias-ofertas', titulo: '4 · Categorías y ofertas',
    contenido: `
      <h3>Categorías</h3>
      <p>Organizan el catálogo (por ejemplo «Esencias»). El número de <strong>orden</strong> decide qué categoría
      aparece primero; las flechas ↑ y ↓ de la tabla intercambian el orden de dos categorías de un clic.</p>
      <h3>Ofertas</h3>
      <p>Una oferta se aplica a un producto concreto con dos formatos: <strong>precio fijo</strong> (el precio
      final, por ejemplo 75 €) o <strong>porcentaje</strong> (por ejemplo −10 %). Puedes limitarla con fecha de
      inicio y/o fin. La tabla muestra siempre el <strong>precio efectivo resultante</strong>: la web cobra
      siempre el más bajo entre el precio de oferta del producto y sus ofertas activas, y ese mismo cálculo es
      el que firma el pago (la vista <code>productos_publicos</code> lo calcula idéntico en la base de datos).</p>`,
  },
  {
    id: 'testimonios', titulo: '5 · Testimonios',
    contenido: `
      <p>Recoge las palabras de clientas y clientes: nombre, ciudad, producto, texto y las <strong>estrellas</strong>
      con el selector visual de 1 a 5. Un testimonio solo se publica en la web cuando está <strong>aprobado</strong>
      (interruptor en la tabla): la web pública solo lee los aprobados, así que desactivar el interruptor los
      retira al instante, sin borrarlos.</p>`,
  },
  {
    id: 'blog', titulo: '6 · Blog: escribir y publicar',
    contenido: `
      <p>Pulsa «+ Nuevo artículo». El editor incluye título con slug automático, extracto, contenido en HTML con
      <strong>vista previa</strong>, imagen de portada (se sube al bucket recursos) y estado.</p>
      <h3>¿Qué hace «Publicar»?</h3>
      <p>Los artículos viven en la tabla <code>articulos</code>. Al marcarlos <strong>publicado</strong> aparecen
      al momento en <code>omshaddai.com/blog/</code> (índice) y su página es
      <code>omshaddai.com/blog/articulo.html?slug=…</code>, con el diseño de la marca. Los <strong>programados</strong>
      se publican solos cuando llega su hora (la web solo ve publicados y programados ya vencidos — lo garantiza
      la RLS). «Despublicar» devuelve el artículo a borrador y desaparece del blog público.</p>`,
  },
  {
    id: 'email', titulo: '7 · Email marketing',
    contenido: `
      <h3>Suscriptores</h3>
      <p>La lista de personas apuntadas al Boletín del Umbral (la web pública las añade con su formulario).
      Puedes <strong>exportar un CSV</strong> y eliminar suscriptores.</p>
      <h3>Campañas</h3>
      <p>Crea una campaña con asunto, contenido HTML (con vista previa) y destinatarios: «todos» o un
      <strong>segmento</strong> por etiqueta. Al pulsar <strong>«Enviar»</strong>:</p>
      <ul>
        <li>Si la función <code>enviar-campana</code> está desplegada (fase 2) y hay <code>RESEND_API_KEY</code>,
        se envía de verdad por lotes y verás estadísticas (enviados/fallidos).</li>
        <li>Si no, la campaña queda <strong>pendiente</strong> y los correos se guardan en la
        <strong>Bandeja de salida</strong>, descargables como archivos .eml (se abren con cualquier gestor de
        correo y pueden reenviarse a mano).</li>
      </ul>`,
  },
  {
    id: 'bandeja', titulo: '8 · Bandeja de entrada',
    contenido: `
      <p>Aquí llegan los mensajes del formulario de contacto de la web. Los <strong>no leídos se ven en
      negrita</strong> y el número aparece junto a «Bandeja de entrada» en el menú. Desde el detalle puedes:</p>
      <ul>
        <li>Marcar leído / no leído, y archivar (pestaña «Archivados»).</li>
        <li><strong>Responder</strong>: abre tu programa de correo con el destinatario, el asunto y el mensaje original ya rellenados.</li>
        <li>Guardar una nota interna con el contexto del trato.</li>
        <li>Eliminar (solo administración, con confirmación).</li>
      </ul>
      <p>El formulario lleva un <strong>honeypot</strong> (campo «web» invisible): los robots que lo rellenan son
      rechazados por la base de datos sin guardar nada.</p>`,
  },
  {
    id: 'pedidos', titulo: '9 · Pedidos y el flujo de compra',
    contenido: `
      <p>Cuando alguien paga en la web, el pedido se crea con estado <strong>pendiente</strong> (lo crea la función
      de firma con el importe calculado en servidor). La notificación de Redsys lo marca <strong>pagado</strong>
      automáticamente — o cancelado si el pago no se autoriza — mediante la función
      <code>redsys-notificacion</code> (fase 2).</p>
      <p>La tabla muestra número, fecha, cliente, total y estado. La administración cambia el estado con el
      desplegable: pendiente → pagado → enviado → entregado (o cancelado). El botón «Ver» abre el detalle con
      las líneas del pedido, precios, envío y la respuesta de Redsys.</p>
      <h3>Emails automáticos</h3>
      <p>Al confirmarse un pago, la función envía al cliente la <strong>confirmación de compra</strong> y el
      <strong>agradecimiento</strong> con las plantillas de <em>Ajustes → Emails automáticos</em> (variables
      <code>{{nombre}}</code>, <code>{{pedido}}</code>, <code>{{total}}</code>, <code>{{articulos}}</code>).
      Si no hay envío real, todo queda en la Bandeja de salida (.eml). El equipo recibe un aviso interno si
      <em>Ajustes → Notificaciones</em> lo tiene activado.</p>`,
  },
  {
    id: 'redsys', titulo: '10 · Pago (Redsys): test y producción',
    contenido: `
      <p>En <em>Ajustes → Pago (Redsys)</em> se guardan el <strong>FUC</strong>, el <strong>terminal</strong>, la
      moneda (978 = euros), el <strong>entorno</strong> y la <strong>clave secreta</strong> de firma.</p>
      <ul>
        <li><strong>Modo test</strong>: FUC de pruebas 999008889, terminal 1 y clave de test de Redsys
        (<code>sq7HjrUOBf2m7spUjazlA</code>, pública en su documentación). La web envía a <code>sis-t.redsys.es</code>.</li>
        <li><strong>Cadena de firma de la web</strong>: 1º Edge Function <code>pagos-firma</code> (fase 2) →
        2º Worker antiguo si sigue desplegado → 3º firma en cliente con la clave de test (solo posible mientras
        el entorno sea test; la base de datos nunca expone la clave en producción).</li>
        <li><strong>Pasar a producción</strong>: FUC y clave definitivos, entorno «Producción», guardar, y
        desplegar las funciones de fase 2 con la URL de notificación en <code>redsys.urlNotificacion</code>.</li>
        <li><strong>La clave nunca se muestra</strong>: se guarda y a partir de entonces solo indica «hay una
        clave guardada». Deja el campo vacío para conservarla.</li>
      </ul>`,
  },
  {
    id: 'ajustes', titulo: '11 · Resto de ajustes',
    contenido: `
      <ul>
        <li><strong>Contacto</strong>: los emails de destino (uno por línea) reciben los avisos internos; también
        teléfono, dirección y horario que muestra la web.</li>
        <li><strong>Redes sociales</strong>: URLs completas de Instagram, TikTok, Pinterest, Facebook, YouTube y
        WhatsApp (se pintan en el pie de la web).</li>
        <li><strong>Envío</strong>: coste, umbral de gratuidad («gratis desde»), texto de plazos y un interruptor
        para cobrar o no envío. La web y el cálculo del pedido usan estos valores.</li>
        <li><strong>Notificaciones</strong>: email interno y qué avisos se generan (pedido pagado, nuevo contacto…).</li>
        <li><strong>SMTP</strong>: se guarda el remitente (De:) y, de momento, los datos de referencia. El envío
        real de la fase 2 usa Resend (<code>RESEND_API_KEY</code>).</li>
      </ul>`,
  },
  {
    id: 'usuarios', titulo: '12 · Usuarios',
    contenido: `
      <p>Solo la administración ve esta sección. Para <strong>dé alta de cuentas nuevas</strong>: dashboard de
      Supabase → <strong>Authentication → Users → Add user</strong> (auto-confirmar). El trigger de la base de
      datos les crea el perfil como <strong>lector</strong>; desde aquí puedes cambiarles nombre y rol, o
      desactivarlos con el interruptor (bloquea el acceso sin borrar la cuenta).</p>
      <p><strong>Contraseñas:</strong> se autogestionan en Supabase — «Send password recovery» en
      Authentication → Users envía el correo para fijar una nueva. Desde la esquina inferior del panel
      cualquier persona puede cambiar su propia contraseña.</p>`,
  },
  {
    id: 'datos', titulo: '13 · Dónde viven los datos y copias de seguridad',
    contenido: `
      <p>Todo vive en tu proyecto de Supabase (tablas del esquema <code>public</code> + bucket <code>recursos</code>
      + Authentication).</p>
      <h3>Copia de seguridad</h3>
      <ol>
        <li><strong>Tablas</strong>: Table Editor → abre la tabla → menú «⋮» → <em>Export CSV</em> (o desde el SQL
        Editor: <code>select * from productos;</code> → Download CSV). Repite con productos, pedidos, mensajes,
        ajustes…</li>
        <li><strong>Todo el SQL</strong>: Project Settings → Database → Backups (plan Pro) o <code>pg_dump</code>
        con la Connection string de Settings → Database.</li>
        <li><strong>Imágenes</strong>: Storage → recursos (se pueden descargar carpetas enteras desde el dashboard).</li>
      </ol>
      <p>La instalación completa de un proyecto nuevo está documentada paso a paso en
      <code>supabase/LEEME-INSTALACION.md</code> (esquema idempotente: ejecutar una vez en el SQL Editor).</p>`,
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
        <p>Guía completa, sección a sección, escrita en español claro. Panel estático + Supabase.</p>
      </header>
      ${SECCIONES_MANUAL.map((s) => `
        <section class="manual-seccion" id="${escapar(s.id)}">
          <h3>${escapar(s.titulo)}</h3>
          ${s.contenido}
        </section>`).join('')}
      <footer class="manual-pie">SHADDAI · Esencia de Umbral — panel de gestión interno. Instalación y despliegue: <code>supabase/LEEME-INSTALACION.md</code>.</footer>
    </article>`;

  contenedor.querySelector('#boton-imprimir').addEventListener('click', () => window.print());
}
