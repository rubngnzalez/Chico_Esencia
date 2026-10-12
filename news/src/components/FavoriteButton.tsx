import { useState } from 'react'
import { useFavorites } from '../lib/favorites'

interface Props {
  articleId: string
  compacta?: boolean
}

export default function FavoriteButton({ articleId, compacta = false }: Props) {
  const { has, toggle } = useFavorites()
  const [animada, setAnimada] = useState(false)
  const fav = has(articleId)

  return (
    <button
      className={`boton-favorito${fav ? ' activo' : ''}${compacta ? ' compacto' : ''}`}
      title={fav ? 'Quitar de tus favoritos' : 'Guardar en tus favoritos'}
      aria-pressed={fav}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        toggle(articleId)
        setAnimada(true)
        setTimeout(() => setAnimada(false), 350)
      }}
    >
      <span className={`corazon${animada ? ' latido' : ''}`}>{fav ? '♥' : '♡'}</span>
      {!compacta && <span className="favorito-texto">{fav ? 'En favoritos' : 'Guardar'}</span>}
    </button>
  )
}
