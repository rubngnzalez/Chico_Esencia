# PRUEBAS AL CONECTAR — SHADDAI · Esencia de Umbral (panel + web sobre Supabase)

Checklist para el coordinador: se ejecuta UNA VEZ después de rellenar
`shaddai-web/js/config-supabase.js` (Project URL + anon key) y publicar.
Requisito previo: `supabase/schema.sql` ejecutado y la cuenta del dueño creada
como primer usuario (rol admin). Detalles: `supabase/LEEME-INSTALACION.md`.

Cómo probar en local antes de publicar: `python shaddai-web/servidor-local.py`
(o cualquier servidor estático apuntando a `shaddai-web/`) y abrir
`http://localhost:8000/`.

## 1 · Login y roles

- [ ] Abrir `/admin/` → aparece «Entra en el Umbral» (no el aviso de configuración).
- [ ] Entrar con el email/contraseña creados en Supabase → panel completo con las 12 secciones.
- [ ] La esquina inferior muestra el nombre y «Administración · tu@email».
- [ ] Cerrar sesión → vuelve al login. Volver a entrar.

## 2 · Productos → tienda pública

- [ ] Panel → Productos: aparecen los 3 productos sembrados (Esencia 55 €, Perfume Sólido 25 €, Dúo 75/80 €).
- [ ] Editar «Esencia de Umbral · 50 ml»: cambiar precio a `57` y guardar.
- [ ] Abrir `/tienda.html` (o omshaddai.com/tienda) → Ctrl+F5 → la esencia muestra **57 €** (la sección se re-renderiza desde la base de datos).
- [ ] Desactivar el interruptor «Activo» del Perfume Sólido → Ctrl+F5 en la tienda → desaparece. Reactivarlo.
- [ ] Devolver el precio a `55` y verificar en la tienda (Ctrl+F5).

## 3 · Imágenes (bucket recursos)

- [ ] Panel → Productos → editar → elegir una imagen JPEG/PNG/WebP (máx 5 MB) → miniatura visible en el modal.
- [ ] Guardar → en Supabase, Storage → recursos → subidas/ contiene el archivo.
- [ ] Ctrl+F5 en la tienda → el producto muestra la imagen nueva (URL completa de storage).
- [ ] Quitar la imagen con la × del modal y volver a dejar `img/esencia-50.webp` (o la original) → guardar.

## 4 · Ofertas → precio efectivo

- [ ] Panel → Ofertas → «+ Nueva oferta» → producto «Perfume Sólido Natural», tipo porcentaje, valor 20, activa.
- [ ] La tabla muestra «Precio resultante 20,00 €».
- [ ] Tienda → Ctrl+F5 → el perfume muestra **20 €** con el 25 € tachado.
- [ ] Desactivar la oferta (interruptor) → tienda Ctrl+F5 → vuelve a 25 €. Eliminar la oferta.

## 5 · Testimonios

- [ ] Panel → Testimonios → «+ Nuevo testimonio»: nombre, texto, 4 estrellas, APROBADO ✓.
- [ ] Portada (`/`) → Ctrl+F5 → la sección de testimonios aparece con el testimonio nuevo.
- [ ] En el panel quitar la aprobación → Ctrl+F5 en la portada → la sección desaparece. Volver a aprobar.

## 6 · Formulario de contacto → bandeja

- [ ] `/contacto.html`: rellenar nombre, email y mensaje; NO tocar el campo honeypot (invisible). Enviar.
- [ ] El aviso confirma el envío.
- [ ] Panel → Bandeja de entrada: el mensaje está «sin leer» y el contador del menú marca 1.
- [ ] Abrirlo → se marca leído; probar Archivar/Desarchivar y guardar una nota interna.

## 7 · Boletín (suscriptores)

- [ ] Pie de cualquier página: suscribir un email de prueba → aviso de bienvenida.
- [ ] Repetir el MISMO email → también confirma (duplicados ignorados, no duplica fila).
- [ ] Panel → Email marketing → Suscriptores: aparece; «Exportar CSV» descarga el CSV.

## 8 · Blog público

- [ ] Panel → Blog → «+ Nuevo artículo»: título, extracto, un `<p>` de contenido, Publicar.
- [ ] `/blog/` → Ctrl+F5 → el artículo aparece en el listado.
- [ ] Abrirlo → plantilla con el diseño de la marca (crema/verde/dorado, Cormorant + Jost).
- [ ] Panel → Despublicar → Ctrl+F5 en `/blog/` → ya no está.
- [ ] (Opcional) Crear un artículo «programado» para dentro de 1 hora → NO aparece hasta su hora.

## 9 · Pedido de prueba (Redsys test, sin funciones)

Con la clave de test sembrada (entorno test, FUC 999008889) y SIN funciones desplegadas:
- [ ] Añadir un producto al carrito → `/carrito.html` → «Tramitar pedido» → `/pago.html`.
- [ ] El formulario muestra tarjeta/Bizum activos (métodos de los ajustes).
- [ ] Rellenar los datos de envío y pagar con una tarjeta de test de Redsys.
- [ ] El navegador salta a `sis-t.redsys.es:25443` y luego a `pago-ok.html`.
- [ ] Panel → Pedidos: el pedido existe (creado por la Edge Function si está desplegada; si solo hay firma en cliente, el pedido se registra cuando se despliegue la fase 2 — anotar el resultado obtenido).
- [ ] (Solo con fase 2 desplegada) el estado pasa solo a «pagado» y llegan los emails automáticos (o quedan en Bandeja de salida como .eml).
- [ ] Admin cambia el estado a «enviado» con el desplegable.

## 10 · Ajustes y secretos

- [ ] Panel → Ajustes: 7 pestañas visibles (solo admin).
- [ ] SMTP: el campo contraseña muestra el placeholder «Hay una contraseña guardada…» solo si hay valor; guardar vacío NO borra el valor guardado.
- [ ] Redsys: igual con la «Clave secreta». Cambiar «Envío gratis desde» a `90` → en el carrito, un pedido de 80 € ahora muestra 5,90 € de envío; volver a `80`.
- [ ] La web pública NUNCA ve secretos: abrir en el navegador `https://TU_REF.supabase.co/rest/v1/ajustes_publicos?select=*` con la anon key (apikey header) → aparecen redes/envío/redsys público, pero NI smtp NI la clave (salvo `clave_pago_test` si el entorno es test).

## 11 · Usuarios

- [ ] Panel → Usuarios: aparece tu perfil con chip «tú».
- [ ] Crear un SEGUNDO usuario en Supabase (Authentication → Users → Add user) → ese usuario entra al panel como **lector** (sin secciones de escritura en el menú).
- [ ] Desde el admin, editar ese usuario → rol «editor» → al recargar, el editor ya ve Productos/Ofertas/etc.
- [ ] Desactivarlo → su siguiente acceso falla con «cuenta desactivada».

## 12 · Degradación estática (seguridad ante fallos)

- [ ] Vaciar temporalmente `js/config-supabase.js` (los dos valores a `""`) y Ctrl+F5:
  - la tienda muestra el HTML estático con los 3 productos de `datos-tienda.js`;
  - el contacto abre el correo (mailto); el boletín confirma en local;
  - el pago firma en cliente con la clave de test local (flujo de siempre);
  - `/admin/` muestra el aviso claro de «Falta conectar con Supabase».
- [ ] Restaurar los valores y recargar.

## Notas

- Si algo no aparece en la web pública, primero Ctrl+F5 (caché) y revisa la consola del navegador.
- Si el panel muestra «Tu rol no tiene permiso…», el rol del perfil no alcanza para esa acción (revisar en Panel → Usuarios).
- Resultados de la fase 2 (funciones desplegadas): repetir las pruebas 8.9/10 con `pagos-firma`, `redsys-notificacion` y `enviar-campana`; el importe del pedido debe calcularse en servidor (probar a modificar el precio en el carrito con trucos de consola: el total firmado SIEMPRE es el de la base de datos).
