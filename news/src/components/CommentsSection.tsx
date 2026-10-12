import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Article, SocialInteraction, SocialPost } from '../lib/types'
import { timeAgo } from '../lib/utils'

const REACTION_EMOJI: Record<string, string> = {
  like: '👍', love: '❤️', care: '🥰', haha: '😆', wow: '😮', sad: '😢', angry: '😡', none: '·'
}

interface Props {
  article: Article
}

export default function CommentsSection({ article }: Props) {
  const [nativos, setNativos] = useState<{ id: string; author_name: string; body: string; created_at: string }[]>([])
  const [sociales, setSociales] = useState<SocialInteraction[]>([])
  const [permalinks, setPermalinks] = useState<Record<string, string>>({})
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [cuerpo, setCuerpo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('sha_comments')
      .select('id, author_name, body, created_at')
      .eq('article_id', article.id)
      .eq('status', 'approved')
      .order('created_at', { ascending: true })
      .then(({ data }) => setNativos((data ?? []) as typeof nativos))

    supabase
      .from('sha_social_posts')
      .select('id, network, permalink')
      .eq('article_id', article.id)
      .then(async ({ data: posts }) => {
        const lista = (posts ?? []) as Pick<SocialPost, 'id' | 'network' | 'permalink'>[]
        if (!lista.length) return
        const mapa: Record<string, string> = {}
        for (const p of lista) if (p.permalink) mapa[p.id] = p.permalink
        setPermalinks(mapa)
        const { data: interacciones } = await supabase
          .from('sha_social_interactions')
          .select('*')
          .in('social_post_id', lista.map(p => p.id))
          .eq('hidden', false)
          .order('external_created_at', { ascending: true })
        setSociales((interacciones ?? []) as SocialInteraction[])
      })
  }, [article.id])

  const reacciones = useMemo(() => {
    const conteo = new Map<string, number>()
    for (const i of sociales) {
      if (i.type !== 'reaction') continue
      const kind = i.reaction_kind || 'like'
      conteo.set(kind, (conteo.get(kind) ?? 0) + 1)
    }
    return [...conteo.entries()]
  }, [sociales])

  const comentariosSociales = sociales.filter(i => i.type === 'comment')

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (!nombre.trim() || !cuerpo.trim()) return
    setEnviando(true)
    setAviso(null)
    const { error } = await supabase.from('sha_comments').insert({
      article_id: article.id,
      author_name: nombre.trim().slice(0, 80),
      author_email: email.trim() || null,
      body: cuerpo.trim().slice(0, 4000)
    })
    setEnviando(false)
    if (error) { setAviso('No se pudo enviar el comentario. Inténtalo más tarde.'); return }
    setNombre(''); setEmail(''); setCuerpo('')
    setAviso('Gracias. Tu comentario aparecerá cuando lo apruebe la redacción.')
  }

  return (
    <section className="comentarios">
      <h2>Conversación en el umbral</h2>

      {reacciones.length > 0 && (
        <div className="reacciones-resumen">
          {reacciones.map(([kind, n]) => (
            <span key={kind} className="reaccion">{REACTION_EMOJI[kind] ?? '·'} {n}</span>
          ))}
          <span className="reacciones-nota">reacciones desde redes sociales</span>
        </div>
      )}

      {comentariosSociales.length > 0 && (
        <div className="comentarios-sociales">
          <h3>Desde las redes</h3>
          {comentariosSociales.map(i => (
            <div key={i.id} className={`comentario-social red-${i.network}`}>
              <div className="comentario-social-cabecera">
                <span className="badge-red">{i.network === 'facebook' ? 'Facebook' : 'Instagram'}</span>
                <strong>{i.author_name || 'Seguidor'}</strong>
                {permalinks[i.social_post_id] && (
                  <a href={permalinks[i.social_post_id]} target="_blank" rel="noreferrer" title="Ver en la red social">↗</a>
                )}
                <time>{timeAgo(i.external_created_at)}</time>
              </div>
              <p>{i.body}</p>
            </div>
          ))}
        </div>
      )}

      {nativos.length > 0 && (
        <div className="comentarios-nativos">
          <h3>En el diario</h3>
          {nativos.map(c => (
            <div key={c.id} className="comentario-nativo">
              <strong>{c.author_name}</strong>
              <time>{timeAgo(c.created_at)}</time>
              <p>{c.body}</p>
            </div>
          ))}
        </div>
      )}

      {nativos.length === 0 && comentariosSociales.length === 0 && (
        <p className="comentarios-vacio">Todavía no hay comentarios. Sé quien abra el diálogo.</p>
      )}

      <form className="formulario-comentario" onSubmit={enviar}>
        <h3>Deja tu comentario</h3>
        <div className="fila">
          <input
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            placeholder="Tu nombre *"
            maxLength={80}
            required
          />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Tu email (no se publica)"
            maxLength={120}
          />
        </div>
        <textarea
          value={cuerpo}
          onChange={e => setCuerpo(e.target.value)}
          placeholder="¿Qué despierta en ti este artículo? *"
          rows={4}
          maxLength={4000}
          required
        />
        <div className="fila acciones-comentario">
          <button className="boton lleno" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar comentario'}</button>
          {aviso && <span className="aviso-comentario">{aviso}</span>}
        </div>
        <p className="nota-moderacion">Los comentarios pasan revisión de la redacción antes de publicarse.</p>
      </form>
    </section>
  )
}
