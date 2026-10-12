import { corsHeaders, errorJson, json, requireStaff, restFetch } from '../_shared/mod.ts'

/** Rutas que casi nunca son artículos: categorías, tags, feeds, legales, tienda… */
const NO_ARTICULO = /\/(category|categories|tag|tags|author|autor|feed|feeds|rss|wp-json|wp-content|wp-admin|page\/|comment|comments|search|busqueda|about|acerca|contact|contacto|aviso-legal|politica|privacidad|cookies|carrito|checkout|mi-cuenta|shop|tienda|producto|catalogo|sitemap)(\/|$|\?)|\.(jpg|jpeg|png|gif|webp|svg|ico|pdf|zip|mp4|mp3)(\?|$)/i

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü'
  }
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => named[name] ?? m)
}

function meta(html: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = html.match(p)
    if (m?.[1]) return decodeEntities(m[1].trim())
  }
  return null
}

function extractArticle(html: string): string {
  let work = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(nav|footer|header|aside|form|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ')

  const articleMatch = work.match(/<article[\s\S]*?<\/article>/i)
  const scope = articleMatch ? articleMatch[0] : work
  const paragraphs: string[] = []
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(scope))) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
    if (text.length > 40) paragraphs.push(text)
  }
  if (paragraphs.length === 0) {
    const bodyText = decodeEntities(scope.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
    return bodyText.slice(0, 20000)
  }
  return paragraphs.join('\n\n').slice(0, 40000)
}

async function fetchPage(url: string, timeoutMs = 15000): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; SHADDAIUmbralBot/1.0; +https://omshaddai.com/news)',
      'Accept-Language': 'es,es-ES;q=0.9,en;q=0.5'
    },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`La web respondió ${res.status}`)
  return await res.text()
}

/** Extrae enlaces internos de una página: url limpia → texto del enlace. */
function enlacesInternos(html: string, baseUrl: string): Map<string, string> {
  const mapa = new Map<string, string>()
  const host = new URL(baseUrl).hostname.replace(/^www\./, '')
  const re = /<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], baseUrl)
      if (!/^https?:$/.test(u.protocol)) continue
      if (u.hostname.replace(/^www\./, '') !== host) continue
      u.hash = ''
      if (u.pathname === '/' || u.pathname === '') continue
      if (NO_ARTICULO.test(u.pathname + u.search)) continue
      const clave = u.toString()
      if (!mapa.has(clave)) {
        const texto = decodeEntities(m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim()
        mapa.set(clave, texto)
      }
    } catch { /* href inválido */ }
  }
  return mapa
}

/** Busca URLs de artículos en sitemaps (sitemap.xml, índices y wp-sitemap). */
async function urlsDeSitemap(origen: string): Promise<string[]> {
  const candidatos = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']
  const host = new URL(origen).hostname.replace(/^www\./, '')
  for (const ruta of candidatos) {
    try {
      const res = await fetch(origen + ruta, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SHADDAIUmbralBot/1.0)' },
        signal: AbortSignal.timeout(12000)
      })
      if (!res.ok) continue
      const xml = await res.text()
      const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1])
      let urls: string[] = []
      if (/<sitemapindex/i.test(xml)) {
        for (const sub of locs.slice(0, 6)) {
          try {
            const r2 = await fetch(sub, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SHADDAIUmbralBot/1.0)' },
              signal: AbortSignal.timeout(12000)
            })
            if (!r2.ok) continue
            const x2 = await r2.text()
            urls.push(...[...x2.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1]))
          } catch { /* sub-sitemap caído */ }
        }
      } else {
        urls = locs
      }
      const limpias: string[] = []
      const vistas = new Set<string>()
      for (const u of urls) {
        try {
          const parsed = new URL(u)
          if (parsed.hostname.replace(/^www\./, '') !== host) continue
          if (parsed.pathname === '/' || parsed.pathname === '') continue
          if (NO_ARTICULO.test(parsed.pathname + parsed.search)) continue
          if (/\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(parsed.pathname)) continue
          parsed.hash = ''
          if (vistas.has(parsed.toString())) continue
          vistas.add(parsed.toString())
          limpias.push(parsed.toString())
        } catch { /* loc inválida */ }
      }
      if (limpias.length > 0) return limpias
    } catch { /* sin sitemap en esta ruta */ }
  }
  return []
}

function tituloDesdeUrl(u: string): string {
  try {
    const parsed = new URL(u)
    const segmento = parsed.pathname.split('/').filter(Boolean).pop() ?? ''
    return decodeURIComponent(segmento)
      .replace(/[-_]+/g, ' ')
      .replace(/\.\w{2,4}$/, '')
      .replace(/^\w/, c => c.toUpperCase())
  } catch {
    return u
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorJson('Método no permitido', 405)

  const staff = await requireStaff(req)
  if (staff instanceof Response) return staff

  let url = ''
  let linkId = ''
  let modo = 'extract'
  try {
    const body = await req.json()
    url = String(body.url ?? '').trim()
    linkId = String(body.link_id ?? '').trim()
    modo = String(body.mode ?? 'extract').trim()
  } catch {
    return errorJson('Cuerpo inválido')
  }

  // ---- Modo descubrir: rastrea la web y devuelve candidatos a artículo ----
  if (modo === 'discover') {
    if (!/^https?:\/\//i.test(url)) return errorJson('URL inválida')
    try {
      const origen = new URL(url).origin
      const html = await fetchPage(url)
      const anchors = enlacesInternos(html, url)
      let urls = await urlsDeSitemap(origen)
      if (urls.length === 0) urls = [...anchors.keys()]

      const encontrados: { url: string; titulo: string }[] = []
      const vistas = new Set<string>()
      for (const u of urls.slice(0, 150)) {
        if (vistas.has(u) || u === url) continue
        vistas.add(u)
        const titulo = anchors.get(u) || tituloDesdeUrl(u)
        encontrados.push({ url: u, titulo: titulo.slice(0, 160) })
        if (encontrados.length >= 100) break
      }
      return json({ modo: 'discover', origen: url, encontrados, total: encontrados.length })
    } catch (e) {
      return errorJson(`No se pudo rastrear la web: ${(e as Error).message}`, 502)
    }
  }

  // ---- Extraer por link_id de la cola (re-analizar) ----
  if (linkId) {
    const rows = await (await restFetch(`sha_import_links?id=eq.${linkId}&select=id,url,title,extracted,status`)).json() as {
      id: string; url: string; title: string | null; extracted: unknown; status: string
    }[]
    const link = rows[0]
    if (!link) return errorJson('No se encontró el enlace en la cola', 404)

    let html = ''
    try {
      html = await fetchPage(link.url)
    } catch (e) {
      return errorJson(`No se pudo descargar la página: ${(e as Error).message}`, 502)
    }
    const extraido = extraerDeHtml(html, link.url)
    await restFetch(`sha_import_links?id=eq.${link.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: extraido.title ?? link.title, extracted: extraido })
    })
    return json({ link: { ...link, title: extraido.title ?? link.title, extracted: extraido } })
  }

  // ---- Extraer y guardar por URL (alta directa en la cola) ----
  if (!/^https?:\/\//i.test(url)) return errorJson('URL inválida')

  let html = ''
  try {
    html = await fetchPage(url)
  } catch (e) {
    return errorJson(`No se pudo descargar la página: ${(e as Error).message}`, 502)
  }

  const extraido = extraerDeHtml(html, url)
  if (extraido.text.length < 200) {
    return errorJson('No se pudo extraer un artículo legible de esa URL. Prueba con "Rastrear web" si es una portada.', 422)
  }

  const existing = await (await restFetch(`sha_import_links?url=${encodeURIComponent(`eq.${url}`)}&select=id,status&limit=1`)).json()
  let link
  if (Array.isArray(existing) && existing.length > 0 && existing[0].status === 'pending') {
    await restFetch(`sha_import_links?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: extraido.title, extracted: extraido })
    })
    link = { id: existing[0].id, url, title: extraido.title, extracted: extraido }
  } else if (Array.isArray(existing) && existing.length > 0) {
    return errorJson('Ese enlace ya está procesado en la cola', 409)
  } else {
    const ins = await restFetch('sha_import_links', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ url, title: extraido.title, extracted: extraido, created_by: (staff as { profileId: string }).profileId })
    })
    if (!ins.ok) return errorJson('No se pudo guardar el enlace', 500)
    const rows = await ins.json()
    link = rows[0]
  }

  return json({ link })
})

function extraerDeHtml(html: string, url: string) {
  const title = meta(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([^<]+)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i
  ])
  const author = meta(html, [
    /<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i,
    /"author"[^}]*"name"\s*:\s*"([^"]+)"/i
  ])
  const publishedAt = meta(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /<time[^>]+datetime=["']([^"']+)["']/i
  ])
  const image = meta(html, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
  ])
  const text = extractArticle(html)
  return {
    source_url: url,
    title,
    author,
    published_at: publishedAt,
    image,
    text,
    word_count: text.split(/\s+/).filter(Boolean).length
  }
}
