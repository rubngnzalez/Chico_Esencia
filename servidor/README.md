# Servidor SHADDAI · Panel de gestión y API

Backend Node.js + Express del panel de gestión de **SHADDAI · Esencia de Umbral**. Sirve la web pública (`shaddai-web/`) en `/`, el panel en `/panel` y una API REST bajo `/api`. Almacenamiento en JSON plano (sin bases de datos externas).

## Arranque

```bash
cd servidor
npm install
npm start
```

- Puerto: `3000` (variable de entorno `PUERTO` para cambiarlo).
- Web pública: `http://localhost:3000/`
- Panel: `http://localhost:3000/panel`
- Comprobación rápida: `http://localhost:3000/api/public/config`

## Credenciales iniciales

En el **primer arranque** (si no existen usuarios) se crea automáticamente un administrador:

- **Email:** `admin@omshaddai.com`
- **Contraseña:** temporal y segura, generada al azar. Se imprime **solo esa primera vez** en la consola del servidor y se guarda en `servidor/datos/creado-<fecha>.txt` (carpeta no subida al repositorio).
- El panel **obliga a cambiarla** en el primer acceso (campo `debeCambiarContrasena`). Mientras no se cambie, la API rechaza el resto de operaciones con error 403.

Además, si `productos` está vacío, se siembra el catálogo actual de la tienda (Esencia de Umbral 50 ml · 55 €, Perfume Sólido Natural 12 g · 25 €, Dúo Ritual · 80 € con oferta a 75 €), todos en la categoría **Esencias**. Los testimonios y los artículos del blog **no** se siembran.

## Estructura

```
servidor/
├── servidor.js            Punto de entrada (puerto 3000, variable PUERTO)
├── package.json           Dependencias: express, bcryptjs, nodemailer
├── panel/                 Esqueleto del panel (login funcional + shell)
│   ├── index.html
│   ├── panel.css
│   └── panel.js
├── src/
│   ├── almacen.js         Capa de acceso JSON con escritura atómica (tmp + rename)
│   ├── utilidades.js      Validaciones, slugs, ids, respuestas de error
│   ├── seguridad.js       Sesión con cookie HMAC firmada, roles, rate-limit
│   ├── redsys.js          Firma HMAC_SHA256_V1 y validación de notificaciones
│   ├── correo.js          Envío con nodemailer + guardado .eml si no hay SMTP
│   ├── blog-estatico.js   Genera shaddai-web/news/articulo/<slug>/index.html + índice
│   ├── ajustes-defecto.js Valores y plantillas por defecto de los ajustes
│   ├── semilla.js         Admin inicial + catálogo inicial
│   └── rutas/             Un módulo por dominio de la API
└── datos/                 Datos locales (NO se suben al repositorio)
    ├── *.json             Colecciones: usuarios, productos, categorias, ofertas,
    │                      testimonios, articulos, mensajes, suscriptores,
    │                      campanas, pedidos, ajustes
    ├── secreto-sesion.json
    └── bandeja-salida/    Correos .eml pendientes cuando no hay SMTP
```

## Roles

| Rol | Permisos |
|---|---|
| `admin` | Todo: ajustes, usuarios, pedidos, y todo lo del editor. |
| `editor` | Productos, categorías, ofertas, testimonios, blog, campañas de email, suscriptores, bandeja de entrada. |
| `lector` | Solo lectura (productos, pedidos, artículos…) y gestión de la bandeja de entrada (leer/archivar/responder nota). |

Las rutas de escritura exigen rol mediante middleware; las de lectura requieren sesión válida (cualquier rol). Las rutas `/api/public/*` y `POST /api/pagos/firma` son públicas.

## Autenticación

- `POST /api/auth/login` con `{ "email", "contrasena" }` → cookie `shaddai_sesion` (HttpOnly, SameSite=Lax, firmada HMAC-SHA256 con secreto en `datos/secreto-sesion.json`, caduca en 7 días).
- Rate-limit de login en memoria: 8 intentos por IP cada 15 min → 429.
- Si el usuario tiene `debeCambiarContrasena: true`, todas las rutas excepto `me`, `cambiar-contrasena` y `logout` responden 403 con `{ debeCambiarContrasena: true }`.

## Mapa completo de la API

Todos los cuerpos van y vienen en JSON. Los errores son `{ "error": "mensaje en español" }`. «Sesión» = cookie de sesión válida (cualquier rol salvo indicación).

### Auth — `/api/auth`

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, contrasena }` | Público (rate-limit) |
| POST | `/api/auth/logout` | — | Sesión |
| GET | `/api/auth/me` | — | Sesión |
| POST | `/api/auth/cambiar-contrasena` | `{ contrasenaActual, contrasenaNueva }` | Sesión (mín. 8 caracteres) |

### Productos — `/api/productos`

Campos: `nombre`*, `slug`, `descripcion`, `historia`, `precio`*, `precioOferta` (o `null`), `stock`, `categoria` (slug), `imagenes[]`, `destacado`, `activo`, `codigo`.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/productos` | — | Sesión |
| GET | `/api/productos/:id` | — | Sesión |
| GET | `/api/productos/publico` | — | Público (solo activos, incluye `precioEfectivo`) |
| POST | `/api/productos` | campos anteriores | admin, editor |
| PUT | `/api/productos/:id` | campos anteriores | admin, editor |
| DELETE | `/api/productos/:id` | — | admin, editor |

### Categorías — `/api/categorias`

Campos: `nombre`*, `slug`, `descripcion`, `orden`.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/categorias` · `/api/categorias/:id` | — | Sesión |
| POST / PUT | `/api/categorias[/:id]` | campos anteriores | admin, editor |
| DELETE | `/api/categorias/:id` | — | admin, editor |

### Ofertas — `/api/ofertas`

Campos: `producto` (id)*, `tipo`* (`precio` \| `porcentaje`), `valor`*, `inicio` (ISO), `fin` (ISO), `activa`. El listado añade `activaAhora` y `productoNombre`. El precio efectivo de un producto (web y firma de pago) es el mínimo entre `precioOferta` y las ofertas activas vigentes.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/ofertas` · `/api/ofertas/:id` | — | Sesión |
| POST / PUT | `/api/ofertas[/:id]` | campos anteriores | admin, editor |
| DELETE | `/api/ofertas/:id` | — | admin, editor |

### Testimonios — `/api/testimonios`

Campos: `nombre`*, `texto`*, `estrellas`* (1–5), `ciudad`, `producto`, `fecha` (ISO), `aprobado`.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/testimonios` · `/api/testimonios/:id` | — | Sesión |
| GET | `/api/public/testimonios` | — | Público (solo `aprobado: true`) |
| POST / PUT | `/api/testimonios[/:id]` | campos anteriores | admin, editor |
| DELETE | `/api/testimonios/:id` | — | admin, editor |

### Blog — `/api/articulos`

Campos: `titulo`*, `slug`, `extracto`, `contenido` (HTML), `imagenPortada`, `etiquetas[]`, `estado` (`borrador` \| `programado` \| `publicado`), `fechaPublicacion` (ISO), `autor`. `slug` es único.

Al publicar (crear/editar con `estado: "publicado"`, o `POST /:id/publicar`) se genera `shaddai-web/news/articulo/<slug>/index.html` con el diseño de la marca (`css/estilos.css`) y se actualiza `shaddai-web/news/articulos.json` (índice para la web pública). Al despublicar o eliminar se borra la carpeta y la entrada del índice. Los artículos `programado` se publican solos cuando llega su fecha.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/articulos` · `/api/articulos/:id` | — | Sesión |
| POST | `/api/articulos` | campos anteriores | admin, editor |
| PUT | `/api/articulos/:id` | campos anteriores | admin, editor |
| POST | `/api/articulos/:id/publicar` | — | admin, editor |
| POST | `/api/articulos/:id/despublicar` | — | admin, editor |
| DELETE | `/api/articulos/:id` | — | admin, editor |

### Bandeja de entrada — `/api/mensajes`

Campos de un mensaje: `nombre`, `email`, `telefono`, `texto`, `leido`, `archivado`, `respuesta`, `respondidoEn`, `recibidoEn`.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/mensajes?estado=todos\|noleidos\|leidos\|archivados` | — | Sesión |
| GET | `/api/mensajes/:id` | — | Sesión |
| PUT | `/api/mensajes/:id` | `{ leido?, archivado?, respuesta? }` | Sesión (los tres roles) |
| POST | `/api/mensajes/:id/responder` | `{ respuesta, enviar? }` — `enviar: true` manda el correo al cliente si hay SMTP | admin, editor |
| DELETE | `/api/mensajes/:id` | — | admin |

**Formulario de contacto (público):** `POST /api/public/contacto` con `{ nombre, email, mensaje, telefono?, web }`. `web` es honeypot anti-spam (si llega relleno se responde OK sin guardar). Rate-limit: 10/min por IP. Guarda el mensaje y avisa por email a `contacto.emailsDestino` si hay SMTP y `notificaciones.nuevoContacto`.

### Suscriptores — `/api/suscriptores`

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/suscriptores` | — | admin, editor |
| GET | `/api/suscriptores/exportar` | — (devuelve CSV) | admin, editor |
| DELETE | `/api/suscriptores/:id` | — | admin, editor |
| POST | `/api/public/suscribirse` | `{ email, nombre? }` | Público (duplicados ignorados) |

### Campañas (email marketing) — `/api/campanas`

Campos: `asunto`*, `html`*, `destinatarios: { tipo: "todos" | "segmento", etiqueta? }` (el segmento filtra por `etiquetas` del suscriptor). Estado: `borrador` → `enviada` (o `pendiente` si no hay SMTP).

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/campanas` · `/api/campanas/:id` | — | admin, editor |
| POST | `/api/campanas` | campos anteriores | admin, editor |
| PUT | `/api/campanas/:id` | campos anteriores (no enviadas) | admin, editor |
| POST | `/api/campanas/:id/enviar` | — (envío real con nodemailer; registra `estadisticas` y `bounces`) | admin, editor |
| DELETE | `/api/campanas/:id` | — | admin |

Si el SMTP no está configurado, el envío guarda un `.eml` en `servidor/datos/bandeja-salida/` y la campaña queda `pendiente`.

### Ajustes — `/api/ajustes`

`GET /api/ajustes` (admin) devuelve todas las secciones. `PUT /api/ajustes/:seccion` (admin) fusiona la sección enviada. **Nunca se devuelve la clave Redsys ni la contraseña SMTP**: llegan enmascaradas como `••••••••`; si el PUT reenvía la máscara (o vacío), se conserva el valor guardado.

| Sección | Campos |
|---|---|
| `contacto` | `emailsDestino[]`, `telefono`, `direccion`, `horario` |
| `redes` | `instagram`, `tiktok`, `pinterest`, `facebook`, `youtube`, `whatsapp` (URLs) |
| `smtp` | `host`, `puerto`, `usuario`, `contraseña` (secreta), `desde`, `activo` |
| `redsys` | `fuc`, `terminal`, `moneda`, `entorno` (`test`/`produccion`), `clave` (secreta), `nombreComercio`, `urlOk`, `urlKo`, `urlNotificacion`, `metodoTarjeta`, `metodoBizum` |
| `envio` | `coste`, `gratisDesde`, `plazos`, `activo` |
| `emails-automaticos` | `confirmacionCompra` y `agradecimiento`: `{ activo, asunto, html }` con variables `{{nombre}}`, `{{pedido}}`, `{{total}}`, `{{articulos}}` |
| `notificaciones` | `email`, `nuevoPedido`, `nuevoContacto`, `nuevoMensaje` |

### Pagos — `/api/pagos`

**`POST /api/pagos/firma`** (público, rate-limit 30/min) — sustituye a la firma en cliente de `js/pago.js`. Cuerpo:

```json
{
  "articulos": [ { "codigo": "esencia-umbral-50", "cantidad": 1 } ],
  "metodo": "tarjeta",
  "numeroPedido": "261023120000",
  "envio": { "nombre": "", "apellidos": "", "email": "", "telefono": "", "direccion": "", "cp": "", "poblacion": "", "provincia": "" }
}
```

Los artículos se reconocen por `codigo`, `slug` o `id`; el importe se calcula **en servidor** con precios y ofertas reales + coste de envío de ajustes. Crea el pedido con estado `pendiente` y devuelve:

```json
{
  "numeroPedido": "...",
  "url": "https://sis-t.redsys.es:25443/sis/realizarPago",
  "version": "HMAC_SHA256_V1",
  "parametrosB64": "...",
  "firma": "...",
  "parametros": { "DS_MERCHANT_AMOUNT": "...", "...": "..." },
  "resumen": { "subtotal": 55, "envio": 5.9, "total": 60.9, "articulos": [] },
  "pedidoId": "..."
}
```

La web pública envía `parametrosB64`, `firma` y `version` a la URL de Redsys en campos `DS_MERCHANT_PARAMETERS`, `DS_MERCHANT_SIGNATURE`, `DS_MERCHANT_SIGNATUREVERSION`. **La clave secreta nunca sale de la API.**

**`POST /api/public/redsys-notificacion`** (público, `application/x-www-form-urlencoded`) — valida la firma HMAC de la notificación de Redsys, comprueba `Ds_Response` (< 100 = autorizado) y el importe, marca el pedido `pagado` (o `cancelado`), dispara los emails automáticos (`confirmacionCompra`, `agradecimiento`) y avisa internamente si `notificaciones.nuevoPedido`.

### Pedidos — `/api/pedidos`

Estados: `pendiente`, `pagado`, `enviado`, `entregado`, `cancelado`.

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/pedidos?estado=` | — | Sesión |
| GET | `/api/pedidos/:id` (id o número) | — | Sesión |
| PUT | `/api/pedidos/:id/estado` | `{ estado }` | admin |

### Usuarios — `/api/usuarios` (solo admin)

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| GET | `/api/usuarios` · `/api/usuarios/:id` | — | admin |
| POST | `/api/usuarios` | `{ nombre, email, contrasena, rol: admin\|editor\|lector }` | admin |
| PUT | `/api/usuarios/:id` | `{ nombre?, rol?, activo?, contrasena? }` | admin |
| DELETE | `/api/usuarios/:id` | — | admin (no borrarse a sí mismo ni al último admin) |

Las respuestas **nunca** incluyen el hash de la contraseña.

### Subida de imágenes — `/api/subir-imagen`

| Método | Ruta | Cuerpo | Rol |
|---|---|---|---|
| POST | `/api/subir-imagen` | `{ nombre, datos }` — `datos` en base64 (acepta data URL `data:image/...;base64,...`) | admin, editor |

Guarda la imagen en `shaddai-web/img/subidas/<aleatorio>.<ext>` **sin conversión** (se respeta el formato original) y devuelve:

```json
{ "ok": true, "ruta": "img/subidas/lx2k3-abcdef.webp", "url": "/img/subidas/lx2k3-abcdef.webp", "tipo": "image/webp", "bytes": 123456 }
```

- Límite: **5 MB** por imagen (el límite del cuerpo JSON de esta ruta es de 8 MB por el overhead del base64).
- Formatos admitidos: solo `image/jpeg`, `image/png` y `image/webp`, detectados por **bytes mágicos** (no por extensión).
- El tipo real se comprueba en servidor; la extensión final (`jpg`, `png` o `webp`) depende del tipo detectado.
- La ruta devuelta (`img/subidas/...`) es relativa a la raíz de la web pública, lista para guardarla en `imagenes[]` de un producto o en `imagenPortada` de un artículo.
- La usan el editor de Productos y el editor del Blog del panel (input de archivo → base64).

### Públicos — `/api/public`

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/api/public/config` | Datos públicos: nombre del comercio, entorno de pago, métodos activos, coste/umbral de envío, contacto y redes sociales. Nunca la clave Redsys. |
| GET | `/api/public/testimonios` | Testimonios aprobados. |
| POST | `/api/public/contacto` | Alta en bandeja de entrada (honeypot + rate-limit). |
| POST | `/api/public/suscribirse` | Alta en newsletter (duplicados ignorados). |
| POST | `/api/public/redsys-notificacion` | Notificación de Redsys (ver arriba). |

## Decisiones técnicas

- **CommonJS** (`require`), sin build. Node 22.
- **Escritura atómica**: se escribe en un archivo temporal y se hace `rename` sobre el destino (`src/almacen.js`). Colecciones cacheadas en memoria.
- **Sesiones**: cookie firmada HMAC-SHA256 (payload `{uid, exp}`) con secreto propio generado en el primer arranque. Sin dependencias externas.
- **Firma Redsys**: clave de operación por 3DES-ECB (`des-ede3` de Node crypto) sobre el número de pedido + HMAC-SHA256 en base64, según HMAC_SHA256_V1. La clave secreta vive solo en `ajustes`.
- **Secretos en la API**: `GET /api/ajustes` devuelve `smtp.contraseña` y `redsys.clave` enmascarados; los PUT los conservan si llega la máscara.
- **Blog estático**: el HTML generado enlaza `css/estilos.css` real del sitio y añade una capa de estilos de lectura coherente con la marca (crema #f3eee2, verde #16261b, dorado #c9a45f, Cormorant Garamond + Jost).
- `.gitignore` de la raíz excluye `servidor/node_modules/` y `servidor/datos/`: los datos y credenciales son locales.
