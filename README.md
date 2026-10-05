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
