import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSiteData } from '../lib/store'
import { queryArticles } from '../lib/queries'
import type { Article, Widget, WidgetZone } from '../lib/types'

interface LinkItem { label: string; url: string }

function SocialFollowWidget() {
  const { social } = useSiteData()
  const enlaces = [
    { red: 'Facebook', url: social.facebook },
    { red: 'Instagram', url: social.instagram },
    { red: 'X', url: social.x },
    { red: 'YouTube', url: social.youtube },
    { red: 'Email', url: social.email ? `mailto:${social.email}` : '' }
  ].filter(e => e.url)
  if (!enlaces.length) return null
  return (
    <div className="follow-us">
      {enlaces.map(e => (
        <a key={e.red} href={e.url} target="_blank" rel="noreferrer" className="follow-enlace">{e.red}</a>
      ))}
    </div>
  )
}

function FeaturedWidget({ widget }: { widget: Widget }) {
  const [articulos, setArticulos] = useState<Article[]>([])
  useEffect(() => {
    queryArticles({ featuredOnly: true, limit: Number(widget.content?.limit) || 4 })
      .then(setArticulos)
  }, [widget])
  if (!articulos.length) return null
  return (
    <ul className="widget-featured">
      {articulos.map(a => (
        <li key={a.id}>
          <a href={`/news/articulo/${a.slug}`}>{a.title}</a>
        </li>
      ))}
    </ul>
  )
}

function QuoteWidget({ widget }: { widget: Widget }) {
  const quotes = (widget.content?.quotes as string[] | undefined) ?? []
  const [i, setI] = useState(0)
  useEffect(() => {
    if (quotes.length < 2) return
    const t = setInterval(() => setI(v => (v + 1) % quotes.length), 6000)
    return () => clearInterval(t)
  }, [quotes.length])
  if (!quotes.length) return null
  return <blockquote className="widget-quote">“{quotes[i]}”</blockquote>
}

function NewsletterWidget({ widget }: { widget: Widget }) {
  const [email, setEmail] = useState('')
  const [ok, setOk] = useState(false)
  const [error, setError] = useState(false)
  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    const { error: err } = await supabase.from('sha_subscribers').insert({ email: email.trim().toLowerCase() })
    if (err) { setError(true); return }
    setOk(true)
  }
  return (
    <form className="widget-newsletter" onSubmit={enviar}>
      {ok
        ? <p className="widget-newsletter-ok">Recibido. Inhala tranquilo: te escribiremos con calma.</p>
        : (
          <>
            {widget.content?.text ? <p>{String(widget.content.text)}</p> : null}
            <div className="fila">
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@email.com"
              />
              <button className="boton lleno" type="submit">Unirme</button>
            </div>
            {error && <p className="widget-newsletter-error">No se pudo suscribir. Prueba más tarde.</p>}
          </>
        )}
    </form>
  )
}

function renderWidget(w: Widget) {
  switch (w.type) {
    case 'html':
      return <div className="widget-html" dangerouslySetInnerHTML={{ __html: String(w.content?.html ?? '') }} />
    case 'links':
      return (
        <ul className="widget-links">
          {((w.content?.items as LinkItem[] | undefined) ?? []).map((item, i) => (
            <li key={i}>
              <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>
            </li>
          ))}
        </ul>
      )
    case 'video': {
      const url = String(w.content?.url ?? '')
      const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/)
      const vimeo = url.match(/vimeo\.com\/(\d+)/)
      const src = yt ? `https://www.youtube.com/embed/${yt[1]}` : vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : url
      return src ? (
        <div className="widget-video">
          <iframe src={src} title={w.title ?? 'Vídeo'} allowFullScreen loading="lazy" />
        </div>
      ) : null
    }
    case 'ad':
      return (
        <a className="widget-ad" href={String(w.content?.url ?? '#')} target="_blank" rel="noreferrer">
          {w.content?.image_url ? <img src={String(w.content.image_url)} alt={w.title ?? 'Publicidad'} loading="lazy" /> : null}
          {w.content?.text ? <p>{String(w.content.text)}</p> : null}
          {w.content?.button_label ? <span className="boton lleno peque">{String(w.content.button_label)}</span> : null}
        </a>
      )
    case 'quote':
      return <QuoteWidget widget={w} />
    case 'social_follow':
      return <SocialFollowWidget />
    case 'featured':
      return <FeaturedWidget widget={w} />
    case 'newsletter':
      return <NewsletterWidget widget={w} />
    default:
      return null
  }
}

export default function WidgetRenderer({ zone }: { zone: WidgetZone }) {
  const [widgets, setWidgets] = useState<Widget[]>([])

  useEffect(() => {
    supabase
      .from('sha_widgets')
      .select('*')
      .eq('zone', zone)
      .eq('active', true)
      .order('position')
      .then(({ data }) => setWidgets((data ?? []) as Widget[]))
  }, [zone])

  if (!widgets.length) return null
  return (
    <>
      {widgets.map(w => (
        <div key={w.id} className={`widget widget-${w.type}`}>
          {w.title && <h3 className="widget-titulo">{w.title}</h3>}
          {renderWidget(w)}
        </div>
      ))}
    </>
  )
}
