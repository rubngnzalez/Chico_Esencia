import { useState } from 'react'
import { articleUrl } from '../lib/utils'

interface Props {
  title: string
  authorName?: string | null
}

export default function ShareBar({ title, authorName }: Props) {
  const [copiado, setCopiado] = useState(false)
  const url = articleUrl(location.pathname.replace(/^\/news/, '') || '/')
  const absoluta = `${location.origin}/news${location.pathname.replace(/^\/news/, '')}`
  const firma = authorName ? ` — por ${authorName}` : ''
  const texto = `«${title}»${firma} · SHADDAI, El Umbral`
  const encodedUrl = encodeURIComponent(absoluta)
  const encodedText = encodeURIComponent(texto)

  const enlaces = [
    { red: 'facebook', etiqueta: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { red: 'x', etiqueta: 'X', href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}&hashtags=QueNosBusquenPorDentro` },
    { red: 'whatsapp', etiqueta: 'WhatsApp', href: `https://wa.me/?text=${encodedText}%20${encodedUrl}` },
    { red: 'telegram', etiqueta: 'Telegram', href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}` }
  ]

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`${texto}\n${url.startsWith('http') ? absoluta : absoluta}`)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* portapapeles no disponible */ }
  }

  return (
    <div className="share-bar">
      <span className="share-titulo">Comparte este artículo</span>
      <div className="share-botones">
        {enlaces.map(e => (
          <a key={e.red} className={`share-boton ${e.red}`} href={e.href} target="_blank" rel="noreferrer" title={`Compartir en ${e.etiqueta}`}>
            {e.etiqueta}
          </a>
        ))}
        <button className="share-boton copiar" onClick={copiar}>
          {copiado ? '¡Copiado!' : 'Copiar enlace'}
        </button>
      </div>
    </div>
  )
}
