import { Link } from 'react-router-dom'
import type { Article } from '../lib/types'
import { formatDate, initial, stripHtml } from '../lib/utils'
import FavoriteButton from './FavoriteButton'

interface Props {
  article: Article
  grande?: boolean
}

export default function ArticleCard({ article, grande = false }: Props) {
  const authorName = article.show_author ? article.author?.display_name : null
  return (
    <article className={`tarjeta-articulo${grande ? ' grande' : ''}`}>
      <Link to={`/articulo/${article.slug}`} className="tarjeta-portada">
        {article.cover_image_url
          ? <img src={article.cover_image_url} alt={article.title} loading="lazy" />
          : <span className="tarjeta-portada-vacia">ש</span>}
        {article.category && <span className="tarjeta-categoria">{article.category.name}</span>}
      </Link>
      <div className="tarjeta-cuerpo">
        <h3 className={grande ? 'titulo-hero' : undefined}>
          <Link to={`/articulo/${article.slug}`}>{article.title}</Link>
        </h3>
        {article.excerpt && <p className="tarjeta-entradilla">{stripHtml(article.excerpt)}</p>}
        <div className="tarjeta-meta">
          {article.show_author && authorName && (
            <span className="tarjeta-autor">
              <span className="avatar-mini">{initial(authorName)}</span>
              {authorName}
            </span>
          )}
          <time dateTime={article.published_at ?? undefined}>{formatDate(article.published_at)}</time>
          <span>· {article.reading_time} min</span>
          <FavoriteButton articleId={article.id} />
        </div>
      </div>
    </article>
  )
}
