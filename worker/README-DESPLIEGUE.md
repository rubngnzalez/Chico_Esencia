# Despliegue del Worker SHADDAI · Panel en Cloudflare

Guía paso a paso para poner el panel de gestión y la API en la nube de
Cloudflare (D1 + R2 + Assets), sustituyendo al servidor Node local.
**El contrato de la API es exactamente el de `servidor/README.md`**; el panel
en `servidor/panel/` funciona sin cambios (salvo la pantalla de instalación y
los botones «Descargar .eml»).

## Requisitos

- Una cuenta de Cloudflare (plan gratuito sirve).
- El dominio `omshaddai.com` **añadido a esa misma cuenta de Cloudflare**
  (la zona debe estar activa). Es imprescindible para las rutas del Worker.
- Node.js 18 o superior en tu PC (para `npx wrangler`).

## 1. Preparar el proyecto (una vez)

```bash
cd worker
npm install
```

## 2. Iniciar sesión en Cloudflare

```bash
npx wrangler login
```

Se abre el navegador; acepta los permisos.

## 3. Crear la base de datos D1

```bash
npx wrangler d1 create shaddai
```

El comando devuelve un bloque así:

```
[[d1_databases]]
binding = "DB"
database_name = "shaddai"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copia ese `database_id` y pégalo en `worker/wrangler.toml`, sustituyendo
`REEMPLAZA_CON_EL_ID_DE_TU_BASE_D1`.

Aplica el esquema (tablas e índices) a la base REMOTA:

```bash
npx wrangler d1 migrations apply shaddai --remote
```

## 4. Crear el bucket R2 de imágenes

```bash
npx wrangler r2 bucket create shaddai-recursos
```

(El binding `RECURSOS` ya apunta a ese bucket en `wrangler.toml`.)

## 5. Configurar los secretos

Obligatorio (firma de cookies de sesión; genera uno largo y aleatorio, por
ejemplo con `openssl rand -hex 48` o cualquier generador):

```bash
npx wrangler secret put SECRETO_SESION
```

Opcional (envío REAL de correo con Resend; si no lo pones, los correos se
guardan en la bandeja de salida y se descargan como .eml desde el panel):

```bash
npx wrangler secret put RESEND_API_KEY
```

Nota: para que Resend acepte el envío, el remitente (`Ajustes → SMTP → desde`,
p. ej. `SHADDAI · Esencia de Umbral <hola@omshaddai.com>`) debe estar verificado
en tu cuenta de Resend. La sección SMTP se conserva en Ajustes por compatibilidad,
pero el Worker envía con Resend.

## 6. Rutas del dominio (zona)

`wrangler.toml` incluye las rutas **comentadas**:

- `omshaddai.com/api/*`
- `omshaddai.com/admin*`
- `omshaddai.com/panel*`
- `omshaddai.com/news/articulo/*`
- `omshaddai.com/recursos/*`
- `omshaddai.com/news/articulos.json`

Las rutas solo funcionan si el tráfico pasa por la nube de Cloudflare:

1. En el panel de Cloudflare → DNS → registro **A** de `omshaddai.com`
   (y los subdominios que uses) debe estar el icono de **nube naranja
   activado (Proxied)**. Si está gris (DNS only), desactívalo y guárdalo.
2. SSL/TLS → Overview → modo **Full (strict)**.
3. Las rutas se crean solas al desplegar si descomentas el bloque `routes = [...]`
   de `wrangler.toml`. Si prefieres crearlas a mano:
   Panel de Cloudflare → **Workers & Pages → shaddai-panel → Settings →
   Domains & Routes → Add route**, patrón `omshaddai.com/api/*` (y cada uno de
   la lista), zona `omshaddai.com`.

Sin la nube naranja el Worker nunca recibe esas peticiones (irían al servidor
original / a la web estática).

## 7. Desplegar

```bash
npx wrangler deploy
```

Si falla mencionando la zona/rutas, revisa el paso 6 (la zona debe estar en la
misma cuenta). Puedes desplegar primero sin rutas (el Worker queda en
`https://shaddai-panel.<tu-subdominio>.workers.dev`) y añadir las rutas después.

## 8. Crear la cuenta de administrador (primer arranque)

En el Worker no hay consola ni contraseña impresa: la instalación es en un
formulario.

1. Entra a **https://omshaddai.com/admin** (o `/panel`).
2. Como todavía no hay usuarios, verás **«Crear cuenta de administrador»**
   en lugar del login: escribe tu nombre, tu correo y la contraseña que
   **tú eliges** (mínimo 8 caracteres) y pulsa el botón.
3. Entras directamente al panel con esa cuenta (admin).
4. Comprobación extra: `https://omshaddai.com/api/instalacion` debe responder
   `{"pendiente":false}` a partir de ese momento.

## 9. Comprobar que todo vive en la nube

- `https://omshaddai.com/api/public/config` → JSON con nombre del comercio,
  métodos de pago, coste/umbral de envío y redes.
- `https://omshaddai.com/api/productos/publico` → catálogo con `precioEfectivo`
  (la web pública puede leer esta ruta tal cual).
- `https://omshaddai.com/admin` → panel con login.
- Crea un artículo en el panel → Blog → Publicar, y visita
  `https://omshaddai.com/news/articulo/<slug>` (HTML con el diseño de la marca)
  y `https://omshaddai.com/news/articulos.json` (índice publicado).
- Sube una imagen en Productos → aparece servida desde
  `https://omshaddai.com/recursos/<clave>`.
- Ajustes → Redsys: la clave de pruebas (`sq7HjrUOBf2m7spUjazlA`) viene
  sembrada; cámbiala por la de producción cuando tengas el FUC real
  (la clave NUNCA se muestra por la API: llega enmascarada `••••••••`, y si
  guardas la máscara se conserva el valor real).

## 10. Desarrollo / pruebas locales (sin cuenta de Cloudflare)

```bash
npx wrangler dev
```

- Puerto 8787, D1 y R2 simulados en `.wrangler/state` (gitignored).
- Panel: `http://localhost:8787/admin` · API: `http://localhost:8787/api/public/config`
- Migraciones locales: `npx wrangler d1 migrations apply shaddai --local`
- Suite HTTP completa: `npm run pruebas` (arranca `wrangler dev` a mano y
  ejecuta `node test/prueba-local.mjs`); los vectores Redsys comparan el
  Worker con el módulo Node original: `node test/redsys-vectores.mjs`.
- Para poner un secreto SOLO local, crea `worker/.dev.vars` (gitignored):

```
SECRETO_SESION=un-secreto-largo-para-local
# RESEND_API_KEY=re_xxxxxxxxxxxx   (no lo uses en local salvo pruebas reales)
```

## Resumen de comandos (guion rápido)

```bash
cd worker
npm install
npx wrangler login
npx wrangler d1 create shaddai            # → copia database_id a wrangler.toml
npx wrangler d1 migrations apply shaddai --remote
npx wrangler r2 bucket create shaddai-recursos
npx wrangler secret put SECRETO_SESION
npx wrangler secret put RESEND_API_KEY    # opcional
npx wrangler deploy
# Panel de Cloudflare:
#   · DNS: nube naranja (Proxied) en omshaddai.com
#   · SSL/TLS: Full (strict)
#   · Rutas: las del wrangler.toml (o créalas a mano)
# Primera entrada: https://omshaddai.com/admin → "Crear cuenta de administrador"
```
