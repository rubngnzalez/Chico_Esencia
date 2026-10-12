import { corsHeaders, errorJson, json, requireStaff, restFetch } from '../_shared/mod.ts'

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', mkernel: ''
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorJson('Método no permitido', 405)

  const staff = await requireStaff(req)
  if (staff instanceof Response) return staff

  let url = ''
  try {
    const body = await req.json()
    url = String(body.url ?? '').trim()
  } catch {
    return errorJson('Cuerpo inválido')
  }
  if (!/^https?:\/\//i.test(url)) return errorJson('URL inválida')

  let html = ''
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SHADDAIUmbralBot/1.0; +https://omshaddai.com/news)',
        'Accept-Language': 'es,es-ES;q=0.9,en;q=0.5'
      },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return errorJson(`La web respondió ${res.status}`, 502)
    html = await res.text()
  } catch (e) {
    return errorJson(`No se pudo descargar la página: ${(e as Error).message}`, 502)
  }

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
  if (text.length < 200) return errorJson('No se pudo extraer un artículo legible de esa URL', 422)

  const extracted = {
    source_url: url,
    title,
    author,
    published_at: publishedAt,
    image,
    text,
    word_count: text.split(/\s+/).filter(Boolean).length
  }

  const existing = await (await restFetch(`sha_import_links?url=${encodeURIComponent(`eq.${url}`)}&select=id,status&limit=1`)).json()
  let link
  if (Array.isArray(existing) && existing.length > 0 && existing[0].status === 'pending') {
    const upd = await restFetch(`sha_import_links?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, extracted })
    })
    if (!upd.ok) return errorJson('No se pudo actualizar el enlace', 500)
    link = { id: existing[0].id, url, title, extracted }
  } else if (Array.isArray(existing) && existing.length > 0) {
    return errorJson('Ese enlace ya está procesado en la cola', 409)
  } else {
    const ins = await restFetch('sha_import_links', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ url, title, extracted, created_by: (staff as { profileId: string }).profileId })
    })
    if (!ins.ok) return errorJson('No se pudo guardar el enlace', 500)
    const rows = await ins.json()
    link = rows[0]
  }

  return json({ link })
})
