// Suite HTTP completa contra `npx wrangler dev` (D1 y R2 simulados, puerto 8787).
// Uso: arranca `npx wrangler dev` en worker/ y ejecuta `node test/prueba-local.mjs`.
// Cubre: instalación, login, cambio forzado, CRUD + precioEfectivo, testimonios,
// contacto con honeypot, suscriptores y CSV, campaña → outbox + .eml, blog
// publicar/despublicar, imágenes R2, firma y notificación Redsys, máscara de
// secretos, roles, rate-limits, /admin y /api/auth/me.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizWorker = path.resolve(aqui, '..');
const raizRepo = path.resolve(raizWorker, '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';

const redsysNode = require(path.join(raizRepo, 'servidor', 'src', 'redsys.js'));
const CLAVE_TEST = 'sq7HjrUOBf2m7spUjazlA';

let ok = 0;
let total = 0;
function chequear(nombre, condicion, detalle = '') {
  total++;
  if (condicion) {
    ok++;
    console.log(`  ✓ ${nombre}`);
  } else {
    console.error(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`);
  }
}

class Sesion {
  constructor() {
    this.cookies = new Map();
  }
  cabeceraCookie() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async pedir(ruta, opciones = {}) {
    const cabeceras = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
    if (this.cookies.size) cabeceras.Cookie = this.cabeceraCookie();
    const cuerpo = opciones.cuerpo !== undefined ? JSON.stringify(opciones.cuerpo) : opciones.crudo;
    const respuesta = await fetch(BASE + ruta, {
      method: opciones.method || (cuerpo !== undefined ? 'POST' : 'GET'),
      headers: cabeceras,
      redirect: 'manual',
      body: cuerpo,
    });
    for (const cookie of respuesta.headers.getSetCookie?.() || []) {
      const [par] = cookie.split(';');
      const i = par.indexOf('=');
      if (i > 0) {
        const nombre = par.slice(0, i).trim();
        const valor = par.slice(i + 1).trim();
        if (valor === '') this.cookies.delete(nombre);
        else this.cookies.set(nombre, valor);
      }
    }
    return respuesta;
  }
  async json(ruta, opciones = {}) {
    const respuesta = await this.pedir(ruta, opciones);
    let datos = null;
    try {
      datos = await respuesta.json();
    } catch {}
    return { estado: respuesta.status, datos, respuesta };
  }
}

const anonimo = new Sesion();
const admin = new Sesion();
const editor = new Sesion();
const lector = new Sesion();

// ═══════════════════ 1 · Instalación ═══════════════════
console.log('\n— 1. Instalación —');
{
  const { estado, datos } = await anonimo.json('/api/instalacion');
  chequear('GET /api/instalacion responde 200', estado === 200);
  chequear('pendiente === true sin usuarios', datos?.pendiente === true);
}
{
  const { estado, datos } = await anonimo.json('/api/instalacion', {
    method: 'POST',
    cuerpo: { nombre: 'Dueño', email: 'dueno@omshaddai.com', contrasena: 'Umbral-2026-largo' },
  });
  chequear('POST /api/instalacion crea admin (201)', estado === 201 && datos?.ok === true);
  chequear('devuelve rol admin', datos?.usuario?.rol === 'admin');
}
{
  const { estado, datos } = await anonimo.json('/api/instalacion');
  chequear('pendiente === false tras crear admin', estado === 200 && datos?.pendiente === false);
}
{
  const { estado } = await anonimo.json('/api/instalacion', {
    method: 'POST',
    cuerpo: { nombre: 'X', email: 'x@x.com', contrasena: '12345678' },
  });
  chequear('segunda instalación rechazada (403)', estado === 403);
}

// ═══════════════════ 2 · Login ═══════════════════
console.log('\n— 2. Login y sesión —');
let intentosLogin = 0; // el limitador cuenta TODOS los intentos por IP
{
  intentosLogin++;
  const { estado, datos } = await admin.json('/api/auth/login', {
    method: 'POST',
    cuerpo: { email: 'dueno@omshaddai.com', contrasena: 'contrasena-mala' },
  });
  chequear('contraseña incorrecta → 401', estado === 401);
  chequear('mensaje exacto del Node', datos?.error === 'Correo o contraseña incorrectos.');
}
{
  intentosLogin++;
  const { estado, datos } = await admin.json('/api/auth/login', {
    method: 'POST',
    cuerpo: { email: 'dueno@omshaddai.com', contrasena: 'Umbral-2026-largo' },
  });
  chequear('login correcto → 200 con cookie', estado === 200 && admin.cookies.has('shaddai_sesion'));
  chequear('usuario sin hash', datos?.usuario?.email === 'dueno@omshaddai.com' && !('hashContrasena' in (datos?.usuario || {})));
}
{
  const { estado, datos } = await admin.json('/api/auth/me');
  chequear('GET /api/auth/me con cookie', estado === 200 && datos?.usuario?.rol === 'admin');
}
{
  const { estado } = await anonimo.json('/api/auth/me');
  chequear('GET /api/auth/me sin cookie → 401', estado === 401);
}
{
  const { estado, datos } = await anonimo.json('/api/public/config');
  chequear('GET /api/public/config público', estado === 200 && typeof datos?.datos?.nombreComercio === 'string');
  chequear('config nunca incluye clave Redsys', !JSON.stringify(datos).includes('sq7HjrUOBf2m7spUjazlA'));
}

// ═══════════════════ 3 · Semilla y CRUD básico ═══════════════════
console.log('\n— 3. Semilla, categorías y productos —');
let idCategoria = '';
let idProducto = '';
let idDuo = '';
{
  const { estado, datos } = await admin.json('/api/categorias');
  chequear('semilla: categoría «Esencias»', estado === 200 && datos?.datos?.some((c) => c.slug === 'esencias'));
  const { estado: e2, datos: d2 } = await admin.json('/api/categorias', {
    method: 'POST',
    cuerpo: { nombre: 'Velas', descripcion: 'Velas artesanales', orden: 2 },
  });
  chequear('POST /api/categorias (201, slug único)', e2 === 201 && d2?.dato?.slug === 'velas');
  idCategoria = d2?.dato?.id;
  const { estado: e3, datos: d3 } = await admin.json(`/api/categorias/${idCategoria}`, {
    method: 'PUT',
    cuerpo: { descripcion: 'Velas artesanales del Umbral' },
  });
  chequear('PUT /api/categorias/:id', e3 === 200 && d3?.dato?.descripcion === 'Velas artesanales del Umbral');
}
{
  const { estado, datos } = await admin.json('/api/productos');
  chequear('semilla: 3 productos', estado === 200 && datos?.total === 3);
  idDuo = datos?.datos?.find((p) => p.codigo === 'duo-ritual')?.id;
  chequear('semilla: Dúo Ritual con precioOferta 75', Boolean(idDuo) && datos?.datos?.find((p) => p.codigo === 'duo-ritual')?.precioOferta === 75);
}
{
  const { estado, datos } = await admin.json('/api/productos', {
    method: 'POST',
    cuerpo: {
      nombre: 'Vela de Umbral',
      precio: 30,
      stock: 10,
      categoria: 'velas',
      codigo: 'vela-test',
      activo: true,
    },
  });
  chequear('POST /api/productos (201)', estado === 201 && datos?.dato?.slug === 'vela-de-umbral');
  idProducto = datos?.dato?.id;
}
{
  const { estado, datos } = await anonimo.json('/api/productos/publico');
  const vela = datos?.datos?.find((p) => p.codigo === 'vela-test');
  const duo = datos?.datos?.find((p) => p.codigo === 'duo-ritual');
  chequear('/api/productos/publico con precioEfectivo', estado === 200 && vela?.precioEfectivo === 30);
  chequear('precioEfectivo del dúo = precioOferta 75', duo?.precioEfectivo === 75);
}

// ═══════════════════ 4 · Ofertas y precioEfectivo ═══════════════════
console.log('\n— 4. Ofertas —');
let idOferta = '';
{
  const { estado, datos } = await admin.json('/api/ofertas', {
    method: 'POST',
    cuerpo: { producto: idProducto, tipo: 'precio', valor: 25, activa: true },
  });
  chequear('POST /api/ofertas (201)', estado === 201);
  idOferta = datos?.dato?.id;
  const { estado: e2, datos: d2 } = await admin.json('/api/ofertas');
  const oferta = d2?.datos?.find((o) => o.id === idOferta);
  chequear('listado con activaAhora y productoNombre', e2 === 200 && oferta?.activaAhora === true && oferta?.productoNombre === 'Vela de Umbral');
  const publico = await anonimo.json('/api/productos/publico');
  chequear('precioEfectivo con oferta 25 €', publico.datos?.datos?.find((p) => p.id === idProducto)?.precioEfectivo === 25);
}
{
  const { estado } = await admin.json(`/api/ofertas/${idOferta}`, {
    method: 'PUT',
    cuerpo: { tipo: 'porcentaje', valor: 20 },
  });
  const publico = await anonimo.json('/api/productos/publico');
  chequear('oferta 20 % → precioEfectivo 24', estado === 200 && publico.datos?.datos?.find((p) => p.id === idProducto)?.precioEfectivo === 24);
}
{
  const { estado } = await admin.json(`/api/ofertas/${idOferta}`, { method: 'PUT', cuerpo: { activa: false } });
  const publico = await anonimo.json('/api/productos/publico');
  chequear('oferta desactivada → precioEfectivo vuelve a 30', estado === 200 && publico.datos?.datos?.find((p) => p.id === idProducto)?.precioEfectivo === 30);
}
{
  const { estado, datos } = await admin.json('/api/ofertas', {
    method: 'POST',
    cuerpo: { producto: 'prd_inexistente', tipo: 'precio', valor: 10 },
  });
  chequear('oferta con producto inexistente → 400', estado === 400 && datos?.error === 'El producto indicado no existe.');
}

// ═══════════════════ 5 · Testimonios ═══════════════════
console.log('\n— 5. Testimonios —');
let idTestimonio = '';
{
  const { estado, datos } = await admin.json('/api/testimonios', {
    method: 'POST',
    cuerpo: { nombre: 'Ana', texto: 'Una esencia que me devuelve al presente.', estrellas: 5, ciudad: 'Madrid' },
  });
  chequear('POST /api/testimonios (201, aprobado false por defecto)', estado === 201 && datos?.dato?.aprobado === false && Boolean(datos?.dato?.fecha));
  idTestimonio = datos?.dato?.id;
  const publico1 = await anonimo.json('/api/public/testimonios');
  chequear('no aparece en /api/public/testimonios sin aprobar', publico1.datos?.total === 0);
  await admin.json(`/api/testimonios/${idTestimonio}`, { method: 'PUT', cuerpo: { aprobado: true } });
  const publico2 = await anonimo.json('/api/public/testimonios');
  chequear('aprobado → aparece en /api/public/testimonios', publico2.datos?.datos?.some((t) => t.id === idTestimonio));
}

// ═══════════════════ 6 · Contacto con honeypot ═══════════════════
console.log('\n— 6. Contacto (honeypot) —');
let intentosContacto = 0;
{
  const antes = (await admin.json('/api/mensajes?estado=todos')).datos.total;
  intentosContacto++;
  const { estado, datos } = await anonimo.json('/api/public/contacto', {
    method: 'POST',
    cuerpo: { nombre: 'Robot', email: 'robot@spam.com', mensaje: 'Compra ahora', web: 'http://spam.example' },
  });
  chequear('honeypot relleno → respuesta OK sin guardar (200)', estado === 200 && datos?.ok === true);
  const despues = (await admin.json('/api/mensajes?estado=todos')).datos.total;
  chequear('el honeypot NO crea mensaje', despues === antes);

  intentosContacto++;
  const { estado: e2 } = await anonimo.json('/api/public/contacto', {
    method: 'POST',
    cuerpo: { nombre: 'Clara Real', email: 'clara@ejemplo.es', mensaje: 'Quiero saber cuándo abre el próximo lote.', telefono: '600000000' },
  });
  chequear('contacto normal → 201', e2 === 201);
  const lista = await admin.json('/api/mensajes?estado=noleidos');
  chequear('mensaje en bandeja, no leído', lista.datos?.datos?.some((m) => m.email === 'clara@ejemplo.es' && m.leido === false) && lista.datos?.totalNoLeidos >= 1);
}

// ═══════════════════ 7 · Suscriptores y CSV ═══════════════════
console.log('\n— 7. Suscriptores y CSV —');
{
  const { estado, datos } = await anonimo.json('/api/public/suscribirse', {
    method: 'POST',
    cuerpo: { email: 'suscriptor@ejemplo.es', nombre: 'Lectora' },
  });
  chequear('suscripción pública (201)', estado === 201 && datos?.ok === true);
  const dup = await anonimo.json('/api/public/suscribirse', { method: 'POST', cuerpo: { email: 'suscriptor@ejemplo.es' } });
  chequear('duplicado ignorado con mensaje', dup.estado === 200 && dup.datos?.mensaje === 'Ya estabas en la lista: bienvenido de nuevo al Umbral.');
  const lista = await admin.json('/api/suscriptores');
  chequear('listado /api/suscriptores (1 suscriptor)', lista.estado === 200 && lista.datos?.total === 1);
  const csv = await admin.pedir('/api/suscriptores/exportar');
  const csvBytes = Buffer.from(await csv.arrayBuffer());
  const texto = csvBytes.toString('utf8');
  chequear(
    'CSV con BOM (bytes EF BB BF) y cabecera',
    csv.status === 200 && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && texto.includes('email,nombre,etiquetas,fechaAlta,activo') && texto.includes('suscriptor@ejemplo.es')
  );
}

// ═══════════════════ 8 · Campaña sin Resend → outbox + .eml ═══════════════════
console.log('\n— 8. Campañas y outbox (.eml) —');
let idCampana = '';
let idOutbox = '';
{
  const { estado, datos } = await admin.json('/api/campanas', {
    method: 'POST',
    cuerpo: { asunto: 'Apertura del lote de otoño', html: '<p>El nuevo lote ya está aquí.</p>', destinatarios: { tipo: 'todos' } },
  });
  chequear('POST /api/campanas (201, borrador)', estado === 201 && datos?.dato?.estado === 'borrador' && datos?.destinatariosEstimados === 1);
  idCampana = datos?.dato?.id;
}
{
  const { estado, datos } = await admin.json(`/api/campanas/${idCampana}/enviar`, { method: 'POST' });
  chequear('enviar sin Resend → pendiente:true, estado «pendiente»', estado === 200 && datos?.pendiente === true && datos?.dato?.estado === 'pendiente');
  chequear('estadisticas pendientes', datos?.dato?.estadisticas?.pendientes === 1);
  idOutbox = datos?.archivo || datos?.dato?.outboxId;
  chequear('respuesta incluye archivo (id outbox) y campaña guarda outboxId', Boolean(idOutbox) && datos?.dato?.outboxId === idOutbox);
}
{
  const { estado, datos } = await admin.json('/api/outbox');
  const filaCampana = datos?.datos?.find((o) => o.campana === idCampana);
  chequear(
    'GET /api/outbox lista la campaña como pendiente',
    estado === 200 && datos.total >= 1 && filaCampana?.estado === 'pendiente' && filaCampana?.asunto === 'Apertura del lote de otoño'
  );
  const eml = await admin.pedir(`/api/outbox/${idOutbox}/eml`);
  const texto = await eml.text();
  chequear(
    'GET /api/outbox/:id/eml descarga .eml',
    eml.status === 200 && (eml.headers.get('Content-Type') || '').includes('message/rfc822') && texto.includes('Subject: Apertura del lote de otoño') && texto.includes('X-SHADDAI-Estado: pendiente')
  );
}
{
  // editar campaña enviada/pendiente y borrado solo admin se prueban en roles
  const { estado } = await admin.json(`/api/campanas/${idCampana}`, {
    method: 'PUT',
    cuerpo: { asunto: 'Apertura del lote de otoño (editada)' },
  });
  chequear('PUT /api/campanas/:id en pendiente permitido', estado === 200);
}

// ═══════════════════ 9 · Blog dinámico ═══════════════════
console.log('\n— 9. Blog: publicar → HTML + índice → despublicar —');
let idArticulo = '';
const slugArticulo = 'primeras-notas-del-umbral';
{
  const { estado, datos } = await admin.json('/api/articulos', {
    method: 'POST',
    cuerpo: {
      titulo: 'Primeras notas del Umbral',
      extracto: 'Cómo nace la 1ª edición.',
      contenido: '<p>Inhala el origen.</p>',
      etiquetas: ['diario'],
      estado: 'borrador',
    },
  });
  chequear('POST /api/articulos (201, borrador)', estado === 201 && datos?.dato?.estado === 'borrador');
  idArticulo = datos?.dato?.id;
  const htmlAntes = await anonimo.pedir(`/news/articulo/${slugArticulo}`);
  chequear('borrador NO sirve HTML (404)', htmlAntes.status === 404);
}
{
  const { estado, datos } = await admin.json(`/api/articulos/${idArticulo}/publicar`, { method: 'POST' });
  chequear('POST /:id/publicar devuelve url', estado === 200 && datos?.url === `/news/articulo/${slugArticulo}/`);
  const html = await anonimo.pedir(`/news/articulo/${slugArticulo}`);
  const texto = await html.text();
  chequear(
    'GET /news/articulo/<slug> sirve HTML de marca',
    html.status === 200 && texto.includes('<h1>Primeras notas del Umbral</h1>') && texto.includes('https://omshaddai.com/css/estilos.css') && texto.includes('SHADDAI · El Umbral')
  );
  const htmlBarra = await anonimo.pedir(`/news/articulo/${slugArticulo}/`);
  chequear('también sirve con barra final', htmlBarra.status === 200);
  const indice = await anonimo.pedir('/news/articulos.json');
  const indiceJson = await indice.json();
  chequear(
    '/news/articulos.json lo lista con {articulos:[…]}',
    indice.status === 200 && (indice.headers.get('Content-Type') || '').includes('application/json') && Array.isArray(indiceJson?.articulos) && indiceJson.articulos.some((a) => a.slug === slugArticulo && a.url === `/news/articulo/${slugArticulo}/`)
  );
}
{
  const { estado } = await admin.json(`/api/articulos/${idArticulo}/despublicar`, { method: 'POST' });
  const indice = await (await anonimo.pedir('/news/articulos.json')).json();
  const html = await anonimo.pedir(`/news/articulo/${slugArticulo}`);
  chequear('despublicar → fuera del índice y HTML 404', estado === 200 && !indice.articulos.some((a) => a.slug === slugArticulo) && html.status === 404);
}
{
  // programado se publica solo al listar si llegó su fecha
  const { datos } = await admin.json('/api/articulos', {
    method: 'POST',
    cuerpo: {
      titulo: 'Notas programadas',
      contenido: '<p>Programado.</p>',
      estado: 'programado',
      fechaPublicacion: new Date(Date.now() - 60000).toISOString(),
    },
  });
  const lista = await admin.json('/api/articulos');
  const publicado = lista.datos?.datos?.find((a) => a.id === datos?.dato?.id)?.estado === 'publicado';
  chequear('programado con fecha pasada → publicado al listar', publicado);
  await admin.json(`/api/articulos/${datos?.dato?.id}`, { method: 'DELETE' });
}

// ═══════════════════ 10 · Imágenes → R2 ═══════════════════
console.log('\n— 10. Subida de imágenes (R2) —');
{
  // PNG 1×1 px válido
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const { estado, datos } = await admin.json('/api/subir-imagen', {
    method: 'POST',
    cuerpo: { nombre: 'prueba.png', datos: `data:image/png;base64,${png.toString('base64')}` },
  });
  chequear(
    'POST /api/subir-imagen (201, url /recursos/...)',
    estado === 201 && datos?.ok === true && datos?.url?.startsWith('/recursos/') && datos?.tipo === 'image/png' && datos?.bytes === png.length && datos?.ruta === (datos?.url || '').slice(1),
    `estado=${estado} png=${png.length} ${JSON.stringify(datos)}`
  );
  const clave = (datos?.url || '').replace('/recursos/', '');
  const served = await anonimo.pedir(`/recursos/${clave}`);
  const bytes = Buffer.from(await served.arrayBuffer());
  chequear(
    'GET /recursos/<clave> sirve el binario con Content-Type y caché',
    served.status === 200 && (served.headers.get('Content-Type') || '').includes('image/png') && (served.headers.get('Cache-Control') || '').includes('max-age=31536000') && bytes.equals(png)
  );
  const { estado: e2, datos: d2 } = await admin.json('/api/subir-imagen', {
    method: 'POST',
    cuerpo: { nombre: 'falso.txt', datos: Buffer.from('esto no es una imagen').toString('base64') },
  });
  chequear('bytes no-imagen → 400 formato no admitido', e2 === 400 && (d2?.error || '').includes('Formato de imagen no admitido'));
}

// ═══════════════════ 11 · Firma Redsys (importe calculado en servidor) ═══════════════════
console.log('\n— 11. /api/pagos/firma —');
let numeroPedido1 = '';
{
  const { estado, datos } = await anonimo.json('/api/pagos/firma', {
    method: 'POST',
    cuerpo: {
      articulos: [
        { codigo: 'esencia-umbral-50', cantidad: 1 },
        { slug: 'duo-ritual-esencia-perfume-solido', cantidad: 1 },
      ],
      metodo: 'tarjeta',
      envio: { nombre: 'Ana', apellidos: 'García', email: 'ana@ejemplo.es', telefono: '600111222', direccion: 'C/ Mayor 1', cp: '28001', poblacion: 'Madrid', provincia: 'Madrid' },
    },
  });
  chequear('firma con productos reales (200)', estado === 200 && Boolean(datos?.parametrosB64));
  chequear('subtotal 130 (55 + 75)', datos?.resumen?.subtotal === 130);
  chequear('envío gratis desde 80 € → total 130', datos?.resumen?.envio === 0 && datos?.resumen?.total === 130);
  chequear('DS_MERCHANT_AMOUNT en céntimos', datos?.parametros?.DS_MERCHANT_AMOUNT === '13000');
  chequear('url de Redsys de test', datos?.url === 'https://sis-t.redsys.es:25443/sis/realizarPago');
  const firmaNode = redsysNode.firmarParametros(datos.parametrosB64, datos.numeroPedido, CLAVE_TEST);
  chequear('firma del Worker === firma del módulo Node', datos.firma === firmaNode);
  numeroPedido1 = datos.numeroPedido;
  const pedido = await admin.json(`/api/pedidos/${numeroPedido1}`);
  chequear('pedido creado pendiente con líneas', pedido.estado === 200 && pedido.datos?.dato?.estado === 'pendiente' && pedido.datos?.dato?.articulos?.length === 2);
}
{
  const { estado, datos } = await anonimo.json('/api/pagos/firma', {
    method: 'POST',
    cuerpo: { articulos: [{ codigo: 'no-existe', cantidad: 1 }] },
  });
  chequear('artículo desconocido → 400 con mensaje exacto', estado === 400 && datos?.error === 'No reconocemos el artículo «no-existe».');
}
{
  const { estado, datos } = await anonimo.json('/api/pagos/firma', {
    method: 'POST',
    cuerpo: { articulos: [{ codigo: 'vela-test', cantidad: 1 }], numeroPedido: 'PEQ3590' },
  });
  // 30 < 80 → envío 5.9 → total 35.9 (número fijo para evitar colisión de segundo)
  chequear('pedido pequeño añade coste de envío (35.9)', estado === 200 && datos?.resumen?.total === 35.9 && datos?.parametros?.DS_MERCHANT_AMOUNT === '3590', `estado=${estado} ${JSON.stringify(datos?.error || datos?.resumen)}`);
}

// ═══════════════════ 12 · Notificación Redsys ═══════════════════
console.log('\n— 12. /api/public/redsys-notificacion —');
function notificar(numero, importe, respuestaCodigo) {
  const datosJson = {
    Ds_Date: '25/10/2026',
    Ds_Hour: '13:00',
    Ds_Amount: String(importe),
    Ds_Currency: '978',
    Ds_Order: numero,
    Ds_MerchantCode: '999008889',
    Ds_Terminal: '1',
    Ds_Response: respuestaCodigo,
    Ds_AuthorisationCode: respuestaCodigo === '0000' ? '123456' : '',
    Ds_TransactionType: '0',
    Ds_SecurePayment: '1',
  };
  const b64 = Buffer.from(JSON.stringify(datosJson), 'utf8').toString('base64');
  const firma = redsysNode.firmarParametros(b64, numero, CLAVE_TEST);
  const cuerpo = new URLSearchParams({
    Ds_Merchant_Parameters: b64,
    Ds_Signature: firma,
    Ds_Signature_Version: 'HMAC_SHA256_V1',
  }).toString();
  return anonimo.json('/api/public/redsys-notificacion', {
    method: 'POST',
    crudo: cuerpo,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}
{
  const { estado, datos } = await notificar(numeroPedido1, 13000, '0000');
  chequear('notificación válida → ok', estado === 200 && datos?.ok === true);
  const pedido = await admin.json(`/api/pedidos/${numeroPedido1}`);
  chequear('pedido marcado pagado con respuesta Redsys', pedido.datos?.dato?.estado === 'pagado' && pedido.datos?.dato?.respuestaRedsys?.respuesta === 0 && Boolean(pedido.datos?.dato?.pagadoEn));
  const duplicada = await notificar(numeroPedido1, 13000, '0000');
  chequear('notificación repetida → «ya marcado como pagado»', duplicada.estado === 200 && duplicada.datos?.mensaje === 'Pedido ya marcado como pagado.');
  await new Promise((r) => setTimeout(r, 2000)); // los emails automáticos van por waitUntil
  let outbox = await admin.json(`/api/outbox?pedido=${numeroPedido1}`);
  let filas = Array.isArray(outbox.datos?.datos) ? outbox.datos.datos : null;
  for (let reintento = 0; reintento < 10 && filas?.length !== 3; reintento++) {
    await new Promise((r) => setTimeout(r, 1000));
    outbox = await admin.json(`/api/outbox?pedido=${numeroPedido1}`);
    filas = Array.isArray(outbox.datos?.datos) ? outbox.datos.datos : null;
  }
  chequear(
    'emails automáticos en outbox (confirmación + agradecimiento + aviso interno)',
    outbox.estado === 200 && Array.isArray(filas) && filas.length === 3 && filas.some((o) => o.asunto.includes('Pedido ' + numeroPedido1)) && filas.every((o) => o.pedido === numeroPedido1),
    `estado=${outbox.estado} total=${outbox.datos?.total} ${JSON.stringify(outbox.datos?.error || '')}`
  );
  const eml = await admin.pedir(`/api/outbox/${filas?.[0]?.id}/eml`);
  const textoEml = await eml.text();
  chequear('el .eml de compra contiene total y artículos', eml.status === 200 && (textoEml.includes('130,00 €') || textoEml.includes('130')));
}
{
  // firma inválida
  const datosJson = { Ds_Amount: '5500', Ds_Order: 'PEDIDOFAKE1', Ds_Response: '0000' };
  const b64 = Buffer.from(JSON.stringify(datosJson), 'utf8').toString('base64');
  const { estado, datos } = await anonimo.json('/api/public/redsys-notificacion', {
    method: 'POST',
    crudo: new URLSearchParams({ Ds_Merchant_Parameters: b64, Ds_Signature: 'FIRMA-FALSA', Ds_Signature_Version: 'HMAC_SHA256_V1' }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  chequear('firma inválida → 400 con mensaje exacto', estado === 400 && datos?.error === 'La firma de la notificación no es válida.');
}
{
  // importe que no coincide
  const { estado, datos } = await anonimo.json('/api/pagos/firma', {
    method: 'POST',
    cuerpo: { articulos: [{ codigo: 'perfume-solido', cantidad: 1 }], envio: { nombre: 'B', email: 'b@ejemplo.es' } },
  });
  const numero = datos.numeroPedido;
  const { estado: e2, datos: d2 } = await notificar(numero, 9999, '0000');
  chequear('importe no coincide → 400', e2 === 400 && d2?.error === 'El importe notificado no coincide con el pedido.');
  const { estado: e3, datos: d3 } = await notificar(numero, 2500, '0180');
  chequear('Ds_Response 0180 → pedido cancelado', e3 === 200 && d3?.mensaje === 'Pago no autorizado: pedido cancelado.');
  const pedido = await admin.json(`/api/pedidos/${numero}`);
  chequear('estado cancelado en pedidos', pedido.datos?.dato?.estado === 'cancelado');
}

// ═══════════════════ 13 · Máscara de secretos en ajustes ═══════════════════
console.log('\n— 13. Ajustes con máscara de secretos —');
{
  const { estado, datos } = await admin.json('/api/ajustes');
  chequear('GET /api/ajustes (admin) devuelve secciones', estado === 200 && Boolean(datos?.datos?.redsys && datos?.datos?.envio && datos?.datos?.['emails-automaticos']));
  chequear('redsys.clave enmascarada ••••••••', datos?.datos?.redsys?.clave === '••••••••');
  // con la contraseña SMTP vacía por defecto llega vacía (el Node solo enmascara si hay valor)
  chequear('smtp.contraseña nunca viaja en claro', datos?.datos?.smtp?.contraseña === '' || datos?.datos?.smtp?.contraseña === '••••••••');
}
{
  // reenviar la máscara conserva la clave real (la firma sigue funcionando)
  const { estado, datos } = await admin.json('/api/ajustes/redsys', {
    method: 'PUT',
    cuerpo: { entorno: 'test', clave: '••••••••', metodoTarjeta: true, metodoBizum: false },
  });
  chequear('PUT redsys con máscara → sigue enmascarada', estado === 200 && datos?.datos?.clave === '••••••••');
  const firma = await anonimo.json('/api/pagos/firma', {
    method: 'POST',
    cuerpo: { articulos: [{ codigo: 'vela-test', cantidad: 1 }], numeroPedido: 'PRESERVA1' },
  });
  chequear(
    'la clave real se conservó (la firma sigue funcionando)',
    firma.estado === 200 && firma.datos.firma === redsysNode.firmarParametros(firma.datos.parametrosB64, firma.datos.numeroPedido, CLAVE_TEST),
    `estado=${firma.estado} ${JSON.stringify(firma.datos?.error || '')}`
  );
  chequear('metodoBizum cambió a false', (await admin.json('/api/ajustes')).datos?.datos?.redsys?.metodoBizum === false);
}
{
  const { estado, datos } = await admin.json('/api/ajustes/smtp', {
    method: 'PUT',
    cuerpo: { host: 'smtp.omshaddai.com', puerto: 587, usuario: 'hola@omshaddai.com', contraseña: '••••••••', desde: 'SHADDAI <hola@omshaddai.com>', activo: true },
  });
  chequear(
    'PUT smtp conserva contraseña enmascarada (vacía → sigue vacía)',
    estado === 200 && (datos?.datos?.contraseña === '••••••••' || datos?.datos?.contraseña === ''),
    `estado=${estado} ${JSON.stringify(datos?.error || datos?.datos?.contraseña)}`
  );
  const { estado: e2 } = await admin.json('/api/ajustes/seccion-inventada', { method: 'PUT', cuerpo: {} });
  chequear('sección desconocida → 400', e2 === 400);
}

// ═══════════════════ 14 · Cambio de contraseña FORZADO (bloqueo 403) ═══════════════════
console.log('\n— 14. DebeCambiarContrasena y bloqueo 403 —');
{
  const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const hash = require('node:crypto').pbkdf2Sync('Temporal-1234', salt, 200000, 32, 'sha256');
  const almacenado = `pbkdf2$200000$${salt.toString('base64')}$${hash.toString('base64')}`;
  const datosUsuario = {
    id: 'usr_forzado',
    nombre: 'Forzada',
    email: 'forzada@test.local',
    hashContrasena: almacenado,
    rol: 'admin',
    activo: true,
    debeCambiarContrasena: true,
    creadoEn: new Date().toISOString(),
    ultimoAcceso: null,
  };
  const sql = `INSERT INTO usuarios (id, email, datos) VALUES ('usr_forzado', 'forzada@test.local', '${JSON.stringify(datosUsuario)}');`;
  fs.writeFileSync(path.join(raizWorker, 'test', 'usuario-forzado.sql'), sql + '\n');
  execSync('npx wrangler d1 execute shaddai --local --file=test/usuario-forzado.sql', { cwd: raizWorker, stdio: 'pipe' });

  const forzada = new Sesion();
  intentosLogin++;
  await forzada.json('/api/auth/login', { method: 'POST', cuerpo: { email: 'forzada@test.local', contrasena: 'Temporal-1234' } });
  const me = await forzada.json('/api/auth/me');
  chequear('login con temporal → me debeCambiarContrasena true', me.estado === 200 && me.datos?.usuario?.debeCambiarContrasena === true);
  const bloqueada = await forzada.json('/api/productos');
  chequear(
    'ruta bloqueada → 403 { debeCambiarContrasena: true }',
    bloqueada.estado === 403 && bloqueada.datos?.debeCambiarContrasena === true && bloqueada.datos?.error === 'Debes cambiar tu contraseña temporal antes de continuar.'
  );
  const cambio = await forzada.json('/api/auth/cambiar-contrasena', {
    method: 'POST',
    cuerpo: { contrasenaActual: 'Temporal-1234', contrasenaNueva: 'Nueva-segura-2026' },
  });
  chequear('cambiar-contrasena permitido → mensaje exacto', cambio.estado === 200 && cambio.datos?.mensaje === 'Contraseña actualizada correctamente.');
  const liberada = await forzada.json('/api/productos');
  chequear('tras cambiar, la ruta ya responde', liberada.estado === 200);
  const borrado = await admin.json('/api/usuarios/usr_forzado', { method: 'DELETE' });
  chequear('limpieza del usuario de prueba', borrado.estado === 200);
}

// ═══════════════════ 15 · Usuarios y roles ═══════════════════
console.log('\n— 15. Usuarios y roles —');
let idEditor = '';
let idLector = '';
{
  const { estado, datos } = await admin.json('/api/usuarios', {
    method: 'POST',
    cuerpo: { nombre: 'Editora', email: 'editora@test.local', contrasena: 'Editor-2026-ok', rol: 'editor' },
  });
  chequear('POST /api/usuarios editor (201, sin hash)', estado === 201 && !('hashContrasena' in (datos?.dato || {})));
  idEditor = datos?.dato?.id;
  const { datos: d2 } = await admin.json('/api/usuarios', {
    method: 'POST',
    cuerpo: { nombre: 'Lector', email: 'lector@test.local', contrasena: 'Lector-2026-ok', rol: 'lector' },
  });
  idLector = d2?.dato?.id;
  const dup = await admin.json('/api/usuarios', {
    method: 'POST',
    cuerpo: { nombre: 'Dup', email: 'editora@test.local', contrasena: '12345678', rol: 'editor' },
  });
  chequear('email duplicado → 400', dup.estado === 400 && dup.datos?.error === 'Ya existe un usuario con ese correo electrónico.');

  intentosLogin++;
  await editor.json('/api/auth/login', { method: 'POST', cuerpo: { email: 'editora@test.local', contrasena: 'Editor-2026-ok' } });
  intentosLogin++;
  await lector.json('/api/auth/login', { method: 'POST', cuerpo: { email: 'lector@test.local', contrasena: 'Lector-2026-ok' } });

  const edLista = await editor.json('/api/productos');
  chequear('editor lee productos', edLista.estado === 200);
  const edCrea = await editor.json('/api/productos', { method: 'POST', cuerpo: { nombre: 'Producto editor', precio: 10 } });
  chequear('editor crea producto', edCrea.estado === 201);
  const edAjustes = await editor.json('/api/ajustes');
  chequear('editor NO ve ajustes (403)', edAjustes.estado === 403 && edAjustes.datos?.error === 'No tienes permisos para realizar esta acción.');
  const edUsuarios = await editor.json('/api/usuarios');
  chequear('editor NO ve usuarios (403)', edUsuarios.estado === 403);
  const edBorraCampana = await editor.json(`/api/campanas/${idCampana}`, { method: 'DELETE' });
  chequear('editor NO borra campañas (403, solo admin)', edBorraCampana.estado === 403);
  const edSuscriptores = await editor.json('/api/suscriptores');
  chequear('editor ve suscriptores', edSuscriptores.estado === 200);

  const leLista = await lector.json('/api/productos');
  chequear('lector lee productos', leLista.estado === 200);
  const leCrea = await lector.json('/api/productos', { method: 'POST', cuerpo: { nombre: 'No', precio: 1 } });
  chequear('lector NO crea producto (403)', leCrea.estado === 403);
  const leAjustes = await lector.json('/api/ajustes');
  chequear('lector NO ve ajustes (403)', leAjustes.estado === 403);
  const leSuscriptores = await lector.json('/api/suscriptores');
  chequear('lector NO ve suscriptores (403)', leSuscriptores.estado === 403);
  const lePedidos = await lector.json('/api/pedidos');
  chequear('lector lee pedidos', lePedidos.estado === 200);
  const leEstado = await lector.json(`/api/pedidos/${numeroPedido1}/estado`, { method: 'PUT', cuerpo: { estado: 'enviado' } });
  chequear('lector NO cambia estado de pedido (403)', leEstado.estado === 403);
  const mensajes = await lector.json('/api/mensajes?estado=todos');
  const idMensaje = mensajes.datos?.datos?.[0]?.id;
  const leMarca = await lector.json(`/api/mensajes/${idMensaje}`, { method: 'PUT', cuerpo: { leido: true } });
  chequear('lector gestiona bandeja (marca leído)', leMarca.estado === 200 && leMarca.datos?.dato?.leido === true);
  const leResponde = await lector.json(`/api/mensajes/${idMensaje}/responder`, { method: 'POST', cuerpo: { respuesta: 'hola' } });
  chequear('lector NO responde mensajes (403)', leResponde.estado === 403);
  const leBorra = await lector.json(`/api/mensajes/${idMensaje}`, { method: 'DELETE' });
  chequear('lector NO borra mensajes (403)', leBorra.estado === 403);

  const autoBorrado = await admin.json(`/api/usuarios/${(await admin.json('/api/auth/me')).datos.usuario.id}`, { method: 'DELETE' });
  chequear('admin NO se borra a sí mismo (400)', autoBorrado.estado === 400);
}

// ═══════════════════ 16 · Pedidos (listado y estado) ═══════════════════
console.log('\n— 16. Pedidos —');
{
  const lista = await admin.json('/api/pedidos');
  // 4: el grande, PEQ3590, el del importe que no coincide y PRESERVA1 (máscara)
  chequear('GET /api/pedidos lista los 4 pedidos creados', lista.estado === 200 && lista.datos?.total === 4);
  const filtrada = await admin.json('/api/pedidos?estado=pagado');
  chequear('filtro estado=pagado', filtrada.datos?.total === 1 && filtrada.datos?.datos?.[0]?.numero === numeroPedido1);
  const cambio = await admin.json(`/api/pedidos/${numeroPedido1}/estado`, { method: 'PUT', cuerpo: { estado: 'enviado' } });
  chequear('PUT /:id/estado (admin) → enviado', cambio.estado === 200 && cambio.datos?.dato?.estado === 'enviado' && Boolean(cambio.datos?.dato?.estadoActualizadoEn));
  const mal = await admin.json(`/api/pedidos/${numeroPedido1}/estado`, { method: 'PUT', cuerpo: { estado: 'desconocido' } });
  chequear('estado inválido → 400', mal.estado === 400);
}

// ═══════════════════ 17 · Panel servido en /admin y /panel ═══════════════════
console.log('\n— 17. /admin y /panel —');
{
  const redir = await anonimo.pedir('/admin');
  chequear('/admin redirige a /admin/', redir.status === 308 && (redir.headers.get('Location') || '').endsWith('/admin/'));
  const indice = await anonimo.pedir('/admin/');
  const html = await indice.text();
  chequear(
    '/admin/ sirve el panel (login)',
    indice.status === 200 && html.includes('id="vista-login"') && html.includes('Panel de gestión')
  );
  const js = await anonimo.pedir('/admin/panel.js');
  chequear('/admin/panel.js servido', js.status === 200 && (await js.text()).includes('vista-login'));
  const api = await anonimo.pedir('/admin/js/api.js');
  chequear('/admin/js/api.js servido (módulos del panel)', api.status === 200);
  const panel = await anonimo.pedir('/panel/');
  chequear('/panel/ también sirve el panel', panel.status === 200 && (await panel.text()).includes('vista-login'));
  const css = await anonimo.pedir('/admin/panel.css');
  chequear('/admin/panel.css servido', css.status === 200 && (css.headers.get('Content-Type') || '').includes('text/css'));
}

// ═══════════════════ 18 · CORS y errores de la API ═══════════════════
console.log('\n— 18. CORS y errores —');
{
  const pre = await anonimo.pedir('/api/public/config', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
  chequear(
    'preflight CORS localhost',
    pre.status === 204 && pre.headers.get('Access-Control-Allow-Origin') === 'http://localhost:5173' && pre.headers.get('Access-Control-Allow-Credentials') === 'true'
  );
  const { estado, datos } = await anonimo.json('/api/no-existe');
  chequear('ruta de API desconocida → 404 mensaje exacto', estado === 404 && datos?.error === 'Ruta de la API no encontrada.');
  const malJson = await anonimo.pedir('/api/public/contacto', { method: 'POST', crudo: '{no-json', headers: { 'Content-Type': 'application/json' } });
  chequear('JSON inválido → 400', malJson.status === 400);
  const campos = await anonimo.json('/api/public/contacto', { method: 'POST', cuerpo: { nombre: 'A', email: 'mal' } });
  chequear('validación → mensajes en español', campos.estado === 400 && (campos.datos?.error || '').includes('obligatorio'));
}

// ═══════════════════ 19 · Rate-limits (429) ═══════════════════
console.log('\n— 19. Rate-limits —');
{
  // El límite de login es 8 intentos / 15 min. Llevamos intentosLogin contados;
  // agotamos la ventana con contraseñas malas y comprobamos el 429.
  while (intentosLogin < 8) {
    intentosLogin++;
    await anonimo.json('/api/auth/login', { method: 'POST', cuerpo: { email: 'dueno@omshaddai.com', contrasena: 'falla-' + intentosLogin } });
  }
  intentosLogin++;
  const bloqueado = await anonimo.json('/api/auth/login', { method: 'POST', cuerpo: { email: 'dueno@omshaddai.com', contrasena: 'una-mas' } });
  chequear('login: intento 9 → 429 «Demasiados intentos»', bloqueado.estado === 429 && (bloqueado.datos?.error || '').startsWith('Demasiados intentos. Espera unos minutos'));
  intentosLogin++;
  const bloqueado2 = await anonimo.json('/api/auth/login', { method: 'POST', cuerpo: { email: 'dueno@omshaddai.com', contrasena: 'otra' } });
  chequear('login: siguiente → 429 con Retry-After y segundos', bloqueado2.estado === 429 && (bloqueado2.datos?.error || '').includes('Espera') && bloqueado2.respuesta.headers.get('Retry-After') !== null);
}
{
  // Contacto: 10/min. Hemos usado 2; 9 honeypots más (inocuos) agotan la ventana.
  for (let i = 0; i < 9; i++) {
    intentosContacto++;
    await anonimo.json('/api/public/contacto', {
      method: 'POST',
      cuerpo: { nombre: 'H', email: 'h@h.es', mensaje: 'xxxxx', web: 'http://x' },
    });
  }
  intentosContacto++;
  const bloqueado = await anonimo.json('/api/public/contacto', {
    method: 'POST',
    cuerpo: { nombre: 'Clara', email: 'clara2@ejemplo.es', mensaje: 'Otra consulta razonable.' },
  });
  chequear('contacto: intento 11 → 429', bloqueado.estado === 429 && (bloqueado.datos?.error || '').startsWith('Demasiados intentos.'));
}

console.log(`\n════════ RESULTADO: ${ok}/${total} pruebas OK ════════`);
process.exit(ok === total ? 0 : 1);
