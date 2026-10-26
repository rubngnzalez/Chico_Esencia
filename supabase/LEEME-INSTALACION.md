# Supabase — instalación para SHADDAI · Esencia de Umbral

Guía EXACTA para montar el panel de gestión sin servidores propios: la web
estática (GitHub Pages, omshaddai.com) habla directamente con Supabase,
igual que el esquema de referencia de Chimeneas-Sierra.

---

## PASO 1 · Crear el proyecto

1. Entra en <https://supabase.com/dashboard> con tu cuenta.
2. **New project**.
3. Nombre: `omshaddai` (o el que prefieras).
4. **Region**: `West EU (London)` o `Central EU` — cualquiera de Europa vale
   (la web y los clientes están en España).
5. Contraseña de la base de datos: genera una segura y guárdala en tu
   gestor de contraseñas (solo hará falta para conexiones directas).
6. Espera 1-2 minutos a que el proyecto quede aprovisionado.

> NOTA: si ya tienes el proyecto de Chimeneas-Sierra en la misma cuenta,
> este será otro proyecto independiente. No se tocan entre sí.

## PASO 2 · Ejecutar el esquema (UNA sola vez)

1. En el menú lateral del proyecto: **SQL Editor → New query**.
2. Abre el archivo `supabase/schema.sql` de este repositorio, copia TODO su
   contenido y pégalo en el editor.
3. Pulsa **Run**.
4. Si todo va bien verás `Success. No rows returned` (o avisos menores).
5. Comprobaciones rápidas:
   - **Table Editor**: deben existir `usuarios, categorias, productos,
     ofertas, testimonios, articulos, mensajes, suscriptores, campanas,
     outbox, pedidos, pedidos_lineas, ajustes`.
   - En `productos` verás los 3 productos reales (Esencia de Umbral 50 ml ·
     55 €, Perfume Sólido Natural 12 g · 25 €, Dúo Ritual · 80 € con oferta
     a 75 €) y en `ajustes` la fila `general`.
   - **Storage**: debe existir el bucket `recursos` (público).
   - En el SQL Editor puedes probar: `select * from productos_publicos;`
     → 3 filas con `precio_efectivo` (el Dúo Ritual sale 75 €).

El esquema es idempotente: si algo se queda a medias puedes volver a
ejecutarlo entero sin duplicar datos.

## PASO 3 · Crear tu usuario (queda como administrador)

1. Menú lateral: **Authentication → Users → Add user**.
2. Marca «Auto Confirm User» (email y contraseña sin verificación).
3. Escribe tu email y una contraseña (mínimo 8 caracteres).
4. Al crear el usuario, un trigger inserta su perfil en `usuarios`:
   **el PRIMER usuario del proyecto queda como `admin`** (los siguientes
   entran como `lector`; puedes promoverlos desde el panel, sección
   Usuarios).
5. Entra en <https://omshaddai.com/admin/> con ese email y esa contraseña:
   deberías ver el panel completo (sección Ajustes incluida, que es solo
   de administración).

## PASO 4 · Dar los datos al coordinador (para conectar la web)

En **Settings → API** (menú lateral) copia estos DOS valores y pásaselos:

| Dato | Dónde está | Para qué |
|---|---|---|
| **Project URL** | Settings → API → Project URL, forma `https://xxxx.supabase.co` | `js/config-supabase.js` |
| **anon public key** | Settings → API → Project API keys → `anon` `public` | `js/config-supabase.js` |

La clave `anon` es PÚBLICA por diseño (la RLS la limita): puede ir en el
repositorio. La clave `service_role` NUNCA sale del dashboard: la usan en
 secreto las Edge Functions (fase 2) y no hay que compartirla.

El coordinador rellenará `shaddai-web/js/config-supabase.js`:

```js
window.SUPABASE_URL = "https://xxxx.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

y lo publicará; a partir de ahí la web y el panel quedan conectados.

## PASO 5 · Probar que todo funciona

Abre `PRUEBAS-AL-CONECTAR.md` (raíz del repositorio): es la checklist
exacta que ejecuta el coordinador al conectar (login, editar un producto y
verlo en la tienda, testimonio aprobado, contacto, suscriptor, oferta,
pedido de prueba, imagen nueva y artículo del blog).

---

## FASE 2 (OPCIONAL) · Edge Functions: pagos firmados en servidor + emails reales

Mientras no despliegues las funciones, TODO funciona igual:
- el pago usa la cadena de respaldo de `js/pago.js` (firma en cliente con la
  clave de TEST de Redsys — la vista pública solo la expone en entorno test),
- los correos automáticos y campañas quedan en la tabla `outbox` y en
  campañas «pendientes», descargables como `.eml` desde el panel.

Cuando quieras el paso a producción de verdad:

1. Instala la CLI una vez: `npm install -g supabase` (o usa `npx`).
2. Inicia sesión: `npx supabase login` (abre el navegador y autoriza).
3. Enlaza el proyecto (una vez, desde la raíz del repo):
   ```bash
   npx supabase link --project-ref TU_REF
   ```
   (TU_REF es la parte de la Project URL: `https://TU_REF.supabase.co`).
4. Sube el secreto de Resend (solo si quieres envío real de correos):
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxx
   ```
   (API key de <https://resend.com>; dominio verificado recomendado).
5. Despliega las tres funciones:
   ```bash
   npx supabase functions deploy pagos-firma
   npx supabase functions deploy redsys-notificacion
   npx supabase functions deploy enviar-campana
   ```
6. En **Ajustes → Pago (Redsys)** del panel, pon en «URL de notificación»
   la URL de la función webhook:
   `https://TU_REF.supabase.co/functions/v1/redsys-notificacion`
   (y en el portal del banco/Redsys configura la misma URL de notificación
   en línea).

### Con qué se firman los pagos tras la fase 2

- La web pide la firma a la función `pagos-firma` (calcula el importe en
  servidor con precios y ofertas reales y firma con HMAC_SHA256_V1).
- La notificación de Redsys la recibe `redsys-notificacion`, valida la
  firma, marca el pedido pagado/cancelado y dispara los emails automáticos
  (plantillas de Ajustes → Emails automáticos, con `{{nombre}}`,
  `{{pedido}}`, `{{total}}`, `{{articulos}}`).
- `enviar-campana` manda las campañas con Resend (requiere llamada con
  sesión de un admin).

### Pasar Redsys a producción

1. Pide a tu banco el **FUC definitivo** y la **clave de operación de
   producción**.
2. Panel → **Ajustes → Pago (Redsys)**: FUC nuevo, clave nueva (el campo
   vacío conserva la guardada), entorno «Producción», guarda.
3. La web pasará a `sis.redsys.es` automáticamente y la vista pública deja
   de exponer la clave de test (el pago en cliente deja de estar permitido;
   con las funciones desplegadas nada cambia para el comprador).

---

## Copias de seguridad

- **Table Editor** permite exportar cada tabla a **CSV** (botón de la tabla).
- También puedes usar el SQL Editor: `select * from productos;` y el botón
  **Download CSV** de los resultados.
- Backup completo SQL: **Project Settings → Database → Backups** (plan Pro)
  o `pg_dump` con la Connection string de Settings → Database.
- Las imágenes subidas viven en **Storage → recursos** (se pueden descargar
  desde el propio dashboard).

## Dónde está cada cosa en el dashboard de Supabase

| Quiero… | Menú |
|---|---|
| Crear/ver usuarios del panel | Authentication → Users (Add user) |
| Ver/editar productos, pedidos, mensajes… | Table Editor |
| Ver imágenes subidas | Storage → recursos |
| Ejecutar SQL | SQL Editor |
| Copiar URL + anon key | Settings → API |
| Ver logs de las Edge Functions | Edge Functions → (función) → Logs |
| Secretos (RESEND_API_KEY…) | Edge Functions → Secrets |

## Qué pedirle al coordinador

1. Que rellene `shaddai-web/js/config-supabase.js` con tu Project URL y tu
   anon key (PASO 4) y publique la web.
2. Que ejecute `PRUEBAS-AL-CONECTAR.md` contigo cuando lo publique.
3. (Opcional, fase 2) que te acompañe en el despliegue de las funciones con
   `npx supabase functions deploy`.
