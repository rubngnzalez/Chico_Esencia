import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const webNews = resolve(aqui, '../..', 'shaddai-web/news')
const webRoot = resolve(aqui, '../..', 'shaddai-web')

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

// La cáscara de la SPA: los stubs son ESA página con los metas OG del artículo
// inyectados, de modo que humanos y scrapers entran directo sin redirecciones.
const shell = readFileSync(resolve(webNews, 'index.html'), 'utf8')

function shellConOg(a) {
  const titulo = escapeXml(a.seo_title || a.title)
  const descripcion = escapeXml(String(a.seo_description || a.excerpt || 'Que nos busquen por dentro.').slice(0, 300))
  const destino = `${ORIGEN}/news/articulo/${a.slug}`
  const fecha = a.published_at ? new Date(a.published_at).toISOString() : ''
  const modificado = a.updated_at ? new Date(a.updated_at).toISOString() : fecha
  let html = shell
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${titulo} — SHADDAI · El Umbral</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${descripcion}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${titulo}">`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${descripcion}">`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${destino}">`)
    .replace(/<meta property="og:type"[^>]*>/, `<meta property="og:type" content="article">\n  <meta property="article:published_time" content="${fecha}">\n  <meta property="article:modified_time" content="${modificado}">`)
    .replace(/(<meta property="og:image"[^>]*>)/, `$1\n  <link rel="canonical" href="${destino}">`)
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.seo_title || a.title,
    description: a.seo_description || a.excerpt || '',
    image: [a.og_image || a.cover_image_url || `${ORIGEN}/img/shin-logo.png`].map(u => u.startsWith('http') ? u : ORIGEN + u),
    datePublished: fecha || undefined,
    dateModified: modificado,
    inLanguage: 'es-ES',
    mainEntityOfPage: { '@type': 'WebPage', '@id': destino },
    publisher: { '@type': 'Organization', name: 'SHADDAI · El Umbral', url: `${ORIGEN}/news/` }
  }
  return html.replace('</head>', `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`)
}

for (const a of articulos) {
  slugsValidos.add(a.slug)
  const dir = resolve(articuloDir, a.slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'index.html'), shellConOg(a))
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
