import { corsHeaders, errorJson, json, requireStaff, restFetch } from '../_shared/mod.ts'

const GLM_URL = 'https://api.z.ai/api/paas/v4/chat/completions'

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'articulo'
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim()
}

const SYSTEM_PROMPT = `Eres el editor del diario "SHADDAI · El Umbral". Recibes el texto extraído de un artículo de otra web. Tu trabajo: escribir una versión NUEVA, original y propia del diario, en español, que:

1. NO sea una copia: cambia estructura, redacción y enfoque por completo. No reutilices frases del original salvo citas literales breves entre comillas.
2. CONSERVE con exactitud todos los datos reales: nombres propios, cifras, fechas, estudios, lugares y hechos. No inventes ni alteres ningún dato. Si el original cita fuentes, personas o noticias, mantenlas y atribúyelas claramente ("según X", "como publicó Y").
3. Mantenga una extensión similar al original.
4. Respete fielmente la temática del original: habla de lo que habla el artículo, con redacción clara, elegante y cercana. NO fuerces referencias a la marca, al perfume, al ritual, a inhalar/exhalar, a la presencia ni a ningún simbolismo del diario: sólo si el tema del original es directamente bienestar, atención plena o perfumería (y siempre con mucha mesura).
5. NO añadas iconos, emojis, símbolos, sellos, categorías ni secciones que no existan en el contenido original.
6. El HTML de salida usa sólo etiquetas <p>, <h2>, <h3>, <blockquote>, <ul>, <li>, <strong>, <em>. Sin <h1>. Sin emojis.

Responde EXCLUSIVAMENTE con un objeto JSON válido con esta forma:
{"title": "título atractivo y propio", "excerpt": "entradilla de 1-2 frases", "html": "cuerpo del artículo en HTML"}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorJson('Método no permitido', 405)

  const staff = await requireStaff(req)
  if (staff instanceof Response) return staff

  const apiKey = Deno.env.get('GLM_API_KEY')
  if (!apiKey) return errorJson('GLM_API_KEY no está configurada en el servidor', 500)

  let linkId = ''
  try {
    const body = await req.json()
    linkId = String(body.link_id ?? '')
  } catch {
    return errorJson('Cuerpo inválido')
  }
  if (!linkId) return errorJson('Falta link_id')

  const linkRes = await restFetch(`sha_import_links?id=eq.${linkId}&select=*`)
  const links = await linkRes.json() as {
    id: string; url: string; title: string | null; extracted: {
      source_url: string; title: string | null; author: string | null
      published_at: string | null; image: string | null; text: string
    } | null
  }[]
  const link = links[0]
  if (!link?.extracted) return errorJson('No se encontró el enlace o no tiene contenido extraído', 404)

  const origen = link.extracted
  const userPrompt = `Título original: ${origen.title ?? link.title ?? '(sin título)'}
Autor original: ${origen.author ?? 'desconocido'}
Fecha original: ${origen.published_at ?? 'desconocida'}

CONTENIDO ORIGINAL:
${origen.text.slice(0, 24000)}`

  let contenido: { title?: string; excerpt?: string; html?: string }
  try {
    const res = await fetch(GLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: Deno.env.get('GLM_MODEL') ?? 'glm-4.6',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.75,
        max_tokens: 8000,
        response_format: { type: 'json_object' }
      }),
      signal: AbortSignal.timeout(120000)
    })
    if (!res.ok) return errorJson(`GLM respondió ${res.status}: ${await res.text()}`, 502)
    const data = await res.json()
    contenido = JSON.parse(stripFences(data.choices?.[0]?.message?.content ?? '{}'))
  } catch (e) {
    return errorJson(`Error generando con IA: ${(e as Error).message}`, 502)
  }

  if (!contenido.title || !contenido.html) return errorJson('La IA no devolvió un artículo válido', 502)

  const slug = `${slugify(contenido.title)}-${Math.random().toString(36).slice(2, 8)}`
  const ins = await restFetch('sha_articles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      title: contenido.title,
      slug,
      excerpt: contenido.excerpt ?? null,
      content: contenido.html,
      cover_image_url: origen.image ?? null,
      og_image: origen.image ?? null,
      status: 'draft',
      provenance: 'imported_ai',
      original_source_url: link.url,
      original_published_at: origen.published_at ?? null,
      author_id: (staff as { profileId: string }).profileId
    })
  })
  if (!ins.ok) return errorJson(`No se pudo crear el borrador: ${await ins.text()}`, 500)
  const articulos = await ins.json() as { id: string }[]

  await restFetch(`sha_import_links?id=eq.${link.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'generated', article_id: articulos[0].id })
  })

  return json({ article_id: articulos[0].id, title: contenido.title })
})
