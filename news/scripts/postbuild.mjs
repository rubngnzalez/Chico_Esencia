import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const newsDist = resolve(here, '../..', 'shaddai-web/news')
const webRoot = resolve(here, '../..', 'shaddai-web')

const indexHtml = readFileSync(resolve(newsDist, 'index.html'), 'utf8')

const notFoundPage = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Página no encontrada — SHADDAI</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#16261b;color:#d9d4c5;font-family:Jost,'Segoe UI',sans-serif;text-align:center;padding:2rem}
.caja{max-width:32rem}
.sello{color:#c9a45f;font-size:3rem;margin-bottom:.5rem}
h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;font-size:2.4rem;color:#f3eee2;margin:0 0 .8rem}
p{line-height:1.7;margin:0 0 2rem}
a{display:inline-block;margin:0 .5rem .8rem;padding:.8rem 1.8rem;border:1px solid #c9a45f;color:#c9a45f;text-decoration:none;letter-spacing:.12em;text-transform:uppercase;font-size:.8rem}
a.lleno{background:#c9a45f;color:#16261b}
</style>
</head>
<body>
<div class="caja">
<div class="sello">&#1499;</div>
<h1>Esta página se ha desvanecido</h1>
<p>El umbral que buscas no está aquí. Inhala, exhala, y vuelve al origen.</p>
<a class="lleno" href="/">Volver al inicio</a>
<a href="/news/">Leer el diario</a>
</div>
</body>
</html>`

const guard = `<script>(function(){if(!/^\\/news(\\/|$)/.test(location.pathname)){try{window.stop()}catch(e){}document.documentElement.textContent='';document.open();document.write(${JSON.stringify(notFoundPage)});document.close();}})();</script>`

const guarded = indexHtml.includes('<head>')
  ? indexHtml.replace('<head>', '<head>\n  ' + guard)
  : guard + indexHtml

writeFileSync(resolve(newsDist, 'index.html'), indexHtml)
writeFileSync(resolve(webRoot, '404.html'), guarded)
if (!existsSync(resolve(webRoot, '.nojekyll'))) writeFileSync(resolve(webRoot, '.nojekyll'), '')
console.log('postbuild: shaddai-web/404.html generado (fallback SPA /news/ + 404 de marca) y .nojekyll comprobado')
