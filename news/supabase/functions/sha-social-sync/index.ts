import { corsHeaders, errorJson, json, requireStaff, restFetch, serviceAdmin } from '../_shared/mod.ts'

const GRAPH = 'https://graph.facebook.com/v21.0'

interface SocialPostRow {
  id: string
  network: 'facebook' | 'instagram'
  external_post_id: string
  last_synced_at: string | null
}

interface Interaccion {
  social_post_id: string
  network: string
  external_id: string
  type: 'comment' | 'reaction'
  reaction_kind: string | null
  author_name: string | null
  author_url: string | null
  body: string | null
  external_created_at: string | null
}

async function graphGet(path: string, token: string): Promise<Record<string, unknown>> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, {
    signal: AbortSignal.timeout(20000)
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error?.message ?? `Graph respondió ${res.status}`)
  return data
}

async function autorizado(req: Request): Promise<boolean> {
  const secreto = Deno.env.get('CRON_SECRET')
  const header = req.headers.get('x-cron-secret')
  if (secreto && header && header === secreto) return true
  const staff = await requireStaff(req)
  return !(staff instanceof Response)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorJson('Método no permitido', 405)
  if (!(await autorizado(req))) return errorJson('No autorizado', 401)

  const token = Deno.env.get('META_PAGE_TOKEN')
  if (!token) return json({ ok: true, aviso: 'META_PAGE_TOKEN no configurado: no hay nada que sincronizar todavía' })

  const postsRes = await restFetch('sha_social_posts?select=*')
  const posts = await postsRes.json() as SocialPostRow[]
  if (!Array.isArray(posts) || posts.length === 0) return json({ ok: true, sincronizados: 0 })

  let comentarios = 0
  let reacciones = 0
  const errores: string[] = []

  for (const post of posts) {
    try {
      const interacciones: Interaccion[] = []

      if (post.network === 'facebook') {
        const comments = await graphGet(
          `${post.external_post_id}/comments?fields=id,message,from{id,name},created_time&limit=100`,
          token
        ) as { data?: { id: string; message?: string; from?: { name?: string }; created_time?: string }[] }
        for (const c of comments.data ?? []) {
          interacciones.push({
            social_post_id: post.id,
            network: 'facebook',
            external_id: `fb_comment_${c.id}`,
            type: 'comment',
            reaction_kind: null,
            author_name: c.from?.name ?? null,
            author_url: null,
            body: c.message ?? null,
            external_created_at: c.created_time ?? null
          })
        }
        const reactions = await graphGet(
          `${post.external_post_id}/reactions?fields=id,name,type,pic&limit=100`,
          token
        ) as { data?: { id: string; name?: string; type?: string; pic?: string }[] }
        for (const r of reactions.data ?? []) {
          interacciones.push({
            social_post_id: post.id,
            network: 'facebook',
            external_id: `fb_reaction_${post.external_post_id}_${r.id}`,
            type: 'reaction',
            reaction_kind: r.type?.toLowerCase() ?? 'like',
            author_name: r.name ?? null,
            author_url: r.pic ?? null,
            body: null,
            external_created_at: null
          })
        }
      } else {
        const comments = await graphGet(
          `${post.external_post_id}/comments?fields=id,text,username,timestamp&limit=100`,
          token
        ) as { data?: { id: string; text?: string; username?: string; timestamp?: string }[] }
        for (const c of comments.data ?? []) {
          interacciones.push({
            social_post_id: post.id,
            network: 'instagram',
            external_id: `ig_comment_${c.id}`,
            type: 'comment',
            reaction_kind: null,
            author_name: c.username ?? null,
            author_url: null,
            body: c.text ?? null,
            external_created_at: c.timestamp ?? null
          })
        }
      }

      for (let i = 0; i < interacciones.length; i += 50) {
        const lote = interacciones.slice(i, i + 50)
        const up = await restFetch('sha_social_interactions', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(lote)
        })
        if (!up.ok) throw new Error(`No se pudieron guardar interacciones: ${await up.text()}`)
      }
      comentarios += interacciones.filter(i => i.type === 'comment').length
      reacciones += interacciones.filter(i => i.type === 'reaction').length

      await restFetch(`sha_social_posts?id=eq.${post.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ last_synced_at: new Date().toISOString() })
      })
    } catch (e) {
      errores.push(`${post.network}/${post.external_post_id}: ${(e as Error).message}`)
    }
  }

  return json({ ok: true, comentarios, reacciones, errores })
})
