import { corsHeaders, errorJson, json, requireStaff, restFetch } from '../_shared/mod.ts'

const GRAPH = 'https://graph.facebook.com/v21.0'

interface ArticleRow {
  id: string
  slug: string
  title: string
  excerpt: string | null
  cover_image_url: string | null
  status: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorJson('Método no permitido', 405)

  const staff = await requireStaff(req)
  if (staff instanceof Response) return staff

  const token = Deno.env.get('META_PAGE_TOKEN')
  const pageId = Deno.env.get('META_PAGE_ID')
  const igUserId = Deno.env.get('IG_USER_ID')
  if (!token || !pageId) {
    return errorJson('META_PAGE_TOKEN y META_PAGE_ID deben configurarse como secretos del servidor', 500)
  }

  let articleId = ''
  let network = ''
  try {
    const body = await req.json()
    articleId = String(body.article_id ?? '')
    network = String(body.network ?? '')
  } catch {
    return errorJson('Cuerpo inválido')
  }
  if (!articleId || !['facebook', 'instagram'].includes(network)) {
    return errorJson('Se requiere article_id y network (facebook|instagram)')
  }
  if (network === 'instagram' && !igUserId) {
    return errorJson('IG_USER_ID no está configurado', 500)
  }

  const artRes = await restFetch(`sha_articles?id=eq.${articleId}&select=*`)
  const articles = await artRes.json() as ArticleRow[]
  const article = articles[0]
  if (!article) return errorJson('Artículo no encontrado', 404)
  if (article.status !== 'published') return errorJson('El artículo debe estar publicado antes de difundirse', 409)

  const url = `https://omshaddai.com/news/articulo/${article.slug}`
  const mensaje = `«${article.title}»${article.excerpt ? `\n\n${article.excerpt}` : ''}\n\nLee el artículo completo en el diario: ${url}\n\n#QueNosBusquenPorDentro #SHADDAI`

  let externalPostId = ''
  let permalink: string | null = null

  try {
    if (network === 'facebook') {
      const res = await fetch(`${GRAPH}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: mensaje, link: url, access_token: token }),
        signal: AbortSignal.timeout(20000)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message ?? `Facebook respondió ${res.status}`)
      externalPostId = data.id
      permalink = `https://www.facebook.com/${data.id}`
    } else {
      if (!article.cover_image_url) {
        return errorJson('Instagram necesita una imagen de portada en el artículo', 422)
      }
      const container = await fetch(`${GRAPH}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: article.cover_image_url, caption: mensaje, access_token: token }),
        signal: AbortSignal.timeout(20000)
      })
      const cdata = await container.json()
      if (!container.ok) throw new Error(cdata.error?.message ?? `Instagram respondió ${container.status}`)

      let intentos = 0
      let publicacion: { id?: string; error?: { message: string } } = {}
      while (intentos < 5) {
        await new Promise(r => setTimeout(r, 3000))
        const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ creation_id: cdata.id, access_token: token }),
          signal: AbortSignal.timeout(20000)
        })
        publicacion = await pub.json()
        if (pub.ok) break
        intentos++
      }
      if (!publicacion.id) throw new Error(publicacion.error?.message ?? 'No se pudo publicar en Instagram')
      externalPostId = publicacion.id
      const meta = await fetch(`${GRAPH}/${publicacion.id}?fields=permalink&access_token=${token}`)
      const mdata = await meta.json()
      permalink = mdata.permalink ?? null
    }
  } catch (e) {
    return errorJson(`Error publicando en ${network}: ${(e as Error).message}`, 502)
  }

  await restFetch('sha_social_posts', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      article_id: articleId,
      network,
      external_post_id: externalPostId,
      permalink
    })
  })

  return json({ ok: true, network, id: externalPostId, permalink })
})
