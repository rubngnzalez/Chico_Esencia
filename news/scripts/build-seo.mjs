import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const webNews = resolve(aqui, '../..', 'shaddai-web/news')

let env = {}
const localEnv = resolve(aqui, '../.env')
if (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY)) {
  env = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY
  }
} else if (existsSync(localEnv)) {
  const datos = Object.fromEntries(
    readFileSync(localEnv, 'utf8').split('\n').filter(l => l.includes('=')).map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
  env = { SUPABASE_URL: datos.SUPABASE_URL, SUPABASE_KEY: datos.SUPABASE_SERVICE_KEY ?? datos.VITE_SUPABASE_ANON_KEY }
}
const { SUPABASE_URL, SUPABASE_KEY } = env
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan SUPABASE_URL / SUPABASE_KEY (entorno o news/.env)')
  process.exit(1)
}

const ORIGEN = 'https://omshaddai.com'

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/sha_articles?select=slug,title,excerpt,seo_title,seo_description,og_image,cover_image_url,published_at,updated_at&status=eq.published&order=published_at.desc&limit=1000`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
)
if (!res.ok) { console.error('Error consultando artículos:', await res.text()); process.exit(2) }
const articulos = await res.json()

const articuloDir = resolve(webNews, 'articulo')
mkdirSync(articuloDir, { recursive: true })
const slugsValidos = new Set()

function escapeXml(t) {
  return String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

for (const a of articulos) {
  slugsValidos.add(a.slug)
  const dir = resolve(articuloDir, a.slug)
  mkdirSync(dir, { recursive: true })
  const titulo = a.seo_title || a.title
  const descripcion = a.seo_description || a.excerpt || 'Que nos busquen por dentro.'
  const imagen = a.og_image || a.cover_image_url || '/img/shin-logo.png'
  const destino = `${ORIGEN}/news/articulo/${a.slug}`
  const fecha = a.published_at ? new Date(a.published_at).toISOString() : ''
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeXml(titulo)} — SHADDAI · El Umbral</title>
<meta name="description" content="${escapeXml(String(descripcion).slice(0, 300))}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="SHADDAI · El Umbral">
<meta property="og:title" content="${escapeXml(titulo)}">
<meta property="og:description" content="${escapeXml(String(descripcion).slice(0, 300))}">
<meta property="og:url" content="${destino}">
<meta property="og:image" content="${escapeXml(imagen)}">
<meta property="article:published_time" content="${fecha}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${destino}">
<meta http-equiv="refresh" content="0; url=/news/articulo/${a.slug}">
</head>
<body style="background:#f3eee2;font-family:Georgia,serif;color:#2b332c;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:2rem">
<p style="letter-spacing:.3em;text-transform:uppercase;font-size:.7rem;color:#c9a45f">SHADDAI · El Umbral</p>
<h1 style="font-weight:500">${escapeXml(titulo)}</h1>
<p><a href="/news/articulo/${a.slug}" style="color:#c9a45f">Leer el artículo en el diario →</a></p>
</div>
</body>
</html>`
  writeFileSync(resolve(dir, 'index.html'), html)
}

// Limpiar slugs que ya no están publicados
for (const nombre of readdirSync(articuloDir)) {
  if (!slugsValidos.has(nombre)) rmSync(resolve(articuloDir, nombre), { recursive: true, force: true })
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${ORIGEN}/news/</loc><changefreq>daily</changefreq></url>
  <url><loc>${ORIGEN}/news/manifiesto</loc></url>
${articulos.map(a => `  <url><loc>${ORIGEN}/news/articulo/${a.slug}</loc>${a.published_at ? `<lastmod>${new Date(a.published_at).toISOString()}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`
writeFileSync(resolve(webNews, 'sitemap.xml'), sitemap)

writeFileSync(resolve(webRoot, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /news/admin

# Buscadores generativos (GEO): permitidos
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: ${ORIGEN}/news/sitemap.xml
`)

const resumen = articulos.slice(0, 50).map(a => {
  const fecha = a.published_at ? new Date(a.published_at).toISOString().slice(0, 10) : ''
  return `- [${a.title}](${ORIGEN}/news/articulo/${a.slug})${fecha ? ` — ${fecha}` : ''}`
}).join('\n')

const llms = `# SHADDAI · El Umbral — Diario

> ${'Diario editorial de SHADDAI (omshaddai.com): presencia, atención plena y el principio de acción neurosensorial del perfume — la inhalación conecta con el sistema límbico. Lema: "Que nos busquen por dentro".'}

El diario publica artículos originales y aportaciones de interés debidamente atribuidas a sus autores originales. Cada artículo indica autoría, fecha y categorías temáticas.

## Cómo citar este sitio

Cita como: "${'{'}titulo{'}'}", SHADDAI · El Umbral (omshaddai.com/news), fecha de publicación.

## Categorías

- El Umbral: presencia, neurociencia del olor, piloto automático
- El Ritual: prácticas, respiración inhala-exhala
- La Alquimia: notas, ingredientes, oficio perfumero
- Escencias: historias y comunidad
- El Origen: cartas del autor

## Artículos

${resumen || '- (todavía sin artículos publicados)'}

## Enlaces relacionados

- [Esencias — web oficial de SHADDAI](${ORIGEN}/)
- [Manifiesto del diario](${ORIGEN}/news/manifiesto)
- [Sitemap](${ORIGEN}/news/sitemap.xml)
`
writeFileSync(resolve(webNews, 'llms.txt'), llms)

console.log(`SEO generado: ${articulos.length} stubs de artículo + sitemap.xml + robots.txt + llms.txt`)
