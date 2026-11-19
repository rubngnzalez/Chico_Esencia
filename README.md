# Chico · SHADDAI — Esencia de Umbral

Web multipágina para la marca **SHADDAI · Esencia de Umbral**, creada a partir del documento de marca `SHADDAI final.pdf`.

## Ver la web

Abrir `shaddai-web/index.html` directamente en el navegador, o servir la carpeta:

```powershell
py -m http.server 8734 --directory shaddai-web
# → http://localhost:8734
```

## Estructura

```
SHADDAI final.pdf      Documento de marca original
SHADDAI (13).pdf       Documento de marca ampliado (Eau de Parfum Neurosensorial)
shaddai-web/
├── index.html         Inicio: héroe, manifiesto, escenas, pausa líquida y reserva
├── carta.html         El Origen — Carta del Autor
├── concepto.html      El Umbral — concepto de Shaddai y la Alquimia de la Shin (ש)
├── producto.html      La Alquimia — presentación, neurobiología, notas y edición limitada
├── ritual.html        El Protocolo del Umbral — 4 pasos, audio meditación, inhala/exhala
├── politica.html      Política de Envío Consciente
├── contacto.html      Contacto directo y Altar de Adquisición (reserva)
├── css/estilos.css    Identidad visual (verde bosque, dorado, serif)
├── js/main.js         Navegación, menú móvil, animaciones y boletín
└── img/               Imágenes extraídas de los PDF
```

## Actualizar la web

1. Editar las páginas o estilos en `shaddai-web/`.
2. Probar en local con el servidor indicado arriba.
3. Commit y push — GitHub sincroniza el repositorio.

## Red de distribuidores (2026-11-19)

Programa completo "Hazte distribuidor" con zona VIP privada:

```
shaddai-web/
├── distribuidores.html          Captación: email+contacto+captcha → verificación → formulario
├── zona-distribuidor.html       Zona VIP: tienda con descuento, material comercial, pedidos
├── js/distribuidores.js         Asistente de solicitud (3 pasos)
└── js/zona-distribuidor.js      App privada (login, tienda B2B, recursos, pedidos)
supabase/
├── actualizaciones/2026-11-19-distribuidores.sql   Migración (tablas oms_distrib_*, RLS, bucket, ajustes)
└── functions/oms-distrib-*      7 Edge Functions (captcha, solicitar, verificar, completar,
                                 gestion, pagos-firma del distribuidor, pedido/proforma)
shaddai-web/admin/
├── js/secciones/distribuidores.js  Panel: solicitudes, banco de emails, aceptados, recursos
└── js/secciones/estadisticas.js    Panel: gráficas de ventas clientes + distribuidores
```

Flujo: solicitud con email/persona/teléfono obligatorios + captcha matemático → email de
verificación (24 h, plantilla de marca con logo) → formulario completo con cuestionario y
aceptación legal → el equipo acepta en el panel (crea cuenta + email de activación) → zona
VIP con % de descuento aplicado SIEMPRE en servidor (Redsys o proforma por transferencia).
Material comercial autorizado por carpeta y distribuidor (bucket privado `oms-distrib`).
Instalación y despliegue: `supabase/actualizaciones/2026-11-19-distribuidores.sql`
(migración idempotente) + `npx supabase functions deploy oms-distrib-<nombre>` para cada
función. Detalle completo en el manual del panel (sección Distribuidores).
