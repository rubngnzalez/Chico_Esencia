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
shaddai-web/
├── index.html         Inicio: héroe, manifiesto, beneficios, cita
├── concepto.html      El nombre Shaddai y la letra hebrea Shin (ש)
├── producto.html      Presentación, notas olfativas, ficha y galería
├── ritual.html        Los 4 pasos del ritual e inhalar/exhalar
├── contacto.html      Formulario de contacto
├── css/estilos.css    Identidad visual (verde bosque, dorado, serif)
├── js/main.js         Navegación, menú móvil y animaciones
└── img/               Imágenes extraídas del PDF
```

## Actualizar la web

1. Editar las páginas o estilos en `shaddai-web/`.
2. Probar en local con el servidor indicado arriba.
3. Commit y push — GitHub sincroniza el repositorio.
