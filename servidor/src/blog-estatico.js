'use strict';

const path = require('path');
const { guardarTexto, existeRuta, eliminarRuta, leerJson, escribirAtomico, Coleccion } = require('./almacen');

const RAIZ_WEB = path.join(__dirname, '..', '..', 'shaddai-web');
const CARPETA_ARTICULOS = path.join(RAIZ_WEB, 'news', 'articulo');
const RUTA_INDICE = path.join(RAIZ_WEB, 'news', 'articulos.json');

const escapeHtml = (texto) =>
  String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fechaLarga = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '';
  }
};

function plantillaArticulo(articulo) {
  const titulo = escapeHtml(articulo.titulo);
  const extracto = escapeHtml(articulo.extracto || '');
  const portada = articulo.imagenPortada
    ? `<figure class="articulo-portada"><img src="${escapeHtml(articulo.imagenPortada)}" alt="${titulo}"></figure>`
    : '';
  const etiquetas = (articulo.etiquetas || [])
    .map((e) => `<span class="articulo-etiqueta">${escapeHtml(e)}</span>`)
    .join('');
  const fecha = fechaLarga(articulo.fechaPublicacion);
  const autor = escapeHtml(articulo.autor || 'SHADDAI');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titulo} — SHADDAI · El Umbral</title>
  <meta name="description" content="${extracto}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="SHADDAI · El Umbral">
  <meta property="og:title" content="${titulo}">
  <meta property="og:description" content="${extracto}">
  <link rel="icon" href="/img/favicon.ico">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../../../css/estilos.css">
  <style>
    body { background: var(--crema, #f3eee2); color: #2b332c; }
    .articulo-cabecera { padding: clamp(4rem, 9vw, 7rem) 0 2.5rem; text-align: center; }
    .articulo-cabecera h1 { font-family: var(--serif, Georgia, serif); font-weight: 500; color: var(--verde, #16261b); font-size: clamp(1.9rem, 4.5vw, 3rem); line-height: 1.2; max-width: 56rem; margin: 0 auto 1.2rem; }
    .articulo-meta { font-family: var(--sans, sans-serif); font-size: .85rem; letter-spacing: .18em; text-transform: uppercase; color: #6b7a6e; }
    .articulo-meta .separador { color: var(--oro, #c9a45f); margin: 0 .6rem; }
    .articulo-entradilla { font-family: var(--serif, Georgia, serif); font-size: clamp(1.15rem, 2.4vw, 1.45rem); color: #4a564d; font-style: italic; max-width: 46rem; margin: 1.4rem auto 0; line-height: 1.6; }
    .articulo-cuerpo { max-width: 44rem; margin: 0 auto; padding: 1rem 0 clamp(3rem, 7vw, 5rem); font-family: var(--serif, Georgia, serif); font-size: 1.15rem; line-height: 1.85; }
    .articulo-cuerpo p { margin: 0 0 1.2rem; }
    .articulo-cuerpo h2, .articulo-cuerpo h3 { font-family: var(--serif, Georgia, serif); color: var(--verde, #16261b); font-weight: 600; line-height: 1.3; margin: 2.4rem 0 1rem; }
    .articulo-cuerpo h2 { font-size: 1.8rem; }
    .articulo-cuerpo h3 { font-size: 1.4rem; }
    .articulo-cuerpo a { color: #a3823f; text-decoration: underline; text-underline-offset: 3px; }
    .articulo-cuerpo ul, .articulo-cuerpo ol { margin: 0 0 1.2rem; padding-left: 1.4rem; }
    .articulo-cuerpo li { margin-bottom: .5rem; }
    .articulo-cuerpo blockquote { border-left: 3px solid var(--oro, #c9a45f); padding: .4rem 0 .4rem 1.4rem; margin: 1.8rem 0; font-style: italic; color: #4a564d; font-size: 1.25rem; }
    .articulo-cuerpo img { border-radius: 2px; margin: 1.8rem auto; }
    .articulo-portada { max-width: 62rem; margin: 0 auto 2.5rem; }
    .articulo-portada img { width: 100%; border-radius: 2px; }
    .articulo-etiqueta { display: inline-block; font-family: var(--sans, sans-serif); font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; color: #a3823f; border: 1px solid rgba(201, 164, 95, .5); padding: .3rem .8rem; margin: 0 .35rem .6rem 0; }
    .articulo-volver { display: block; text-align: center; padding: 2.5rem 0 4rem; font-family: var(--sans, sans-serif); }
    .articulo-volver a { color: #a3823f; letter-spacing: .18em; text-transform: uppercase; font-size: .82rem; }
    .articulo-pie { background: var(--verde, #16261b); color: var(--texto, #d9d4c5); text-align: center; padding: 2.6rem 0; font-family: var(--sans, sans-serif); font-size: .9rem; }
    .articulo-pie .marca-linea { letter-spacing: .3em; text-transform: uppercase; font-size: .72rem; color: var(--oro, #c9a45f); margin-bottom: .6rem; }
  </style>
</head>
<body>
  <header class="articulo-cabecera">
    <div class="contenedor">
      <p class="etiqueta">SHADDAI · El Umbral</p>
      <h1>${titulo}</h1>
      <p class="articulo-meta">${fecha}<span class="separador">✦</span>${autor}</p>
      ${extracto ? `<p class="articulo-entradilla">${extracto}</p>` : ''}
      ${etiquetas ? `<p style="margin-top:1.4rem;">${etiquetas}</p>` : ''}
    </div>
  </header>
  <main>
    ${portada}
    <article class="articulo-cuerpo contenedor">${articulo.contenido || ''}</article>
    <div class="articulo-volver"><a href="/news/">← Volver al diario</a></div>
  </main>
  <footer class="articulo-pie">
    <p class="marca-linea">SHADDAI · Esencia de Umbral</p>
    <p>Inhala · Exhala — Que nos busquen por dentro.</p>
  </footer>
</body>
</html>
`;
}

function leerIndice() {
  return leerJson(RUTA_INDICE, []);
}

function guardarIndice(entrada) {
  escribirAtomico(RUTA_INDICE, JSON.stringify(entrada, null, 2));
}

function entradaDeArticulo(articulo) {
  return {
    slug: articulo.slug,
    titulo: articulo.titulo,
    extracto: articulo.extracto || '',
    imagenPortada: articulo.imagenPortada || '',
    etiquetas: articulo.etiquetas || [],
    fechaPublicacion: articulo.fechaPublicacion,
    autor: articulo.autor || 'SHADDAI',
    url: `/news/articulo/${articulo.slug}/`,
  };
}

function publicarArticulo(articulo) {
  const carpeta = path.join(CARPETA_ARTICULOS, articulo.slug);
  guardarTexto(path.join(carpeta, 'index.html'), plantillaArticulo(articulo));

  const indice = leerIndice().filter((e) => e.slug !== articulo.slug);
  indice.push(entradaDeArticulo(articulo));
  indice.sort(
    (a, b) => new Date(b.fechaPublicacion || 0) - new Date(a.fechaPublicacion || 0)
  );
  guardarIndice(indice);
  return carpeta;
}

function retirarArticulo(slug) {
  const carpeta = path.join(CARPETA_ARTICULOS, slug);
  if (existeRuta(carpeta)) eliminarRuta(carpeta);
  const indice = leerIndice().filter((e) => e.slug !== slug);
  guardarIndice(indice);
}

function refrescarProgramados() {
  const articulos = new Coleccion('articulos');
  const instante = Date.now();
  let cambios = 0;
  for (const articulo of articulos.leer()) {
    if (
      articulo.estado === 'programado' &&
      articulo.fechaPublicacion &&
      Date.parse(articulo.fechaPublicacion) <= instante
    ) {
      const actualizado = articulos.modificar(articulo.id, { estado: 'publicado' });
      if (actualizado) {
        publicarArticulo(actualizado);
        cambios++;
      }
    }
  }
  return cambios;
}

module.exports = { publicarArticulo, retirarArticulo, leerIndice, refrescarProgramados, RAIZ_WEB };
