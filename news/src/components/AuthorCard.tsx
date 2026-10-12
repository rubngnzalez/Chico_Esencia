import type { Author } from '../lib/types'
import { initial } from '../lib/utils'

export default function AuthorCard({ author }: { author: Author }) {
  return (
    <aside className="author-card">
      {author.avatar_url
        ? <img className="author-avatar" src={author.avatar_url} alt={author.display_name ?? ''} />
        : <span className="author-avatar inicial">{initial(author.display_name)}</span>}
      <div>
        <span className="author-sello">Escrito por</span>
        <strong className="author-nombre">{author.display_name || 'La redacción'}</strong>
        {author.bio && <p className="author-bio">{author.bio}</p>}
      </div>
    </aside>
  )
}
