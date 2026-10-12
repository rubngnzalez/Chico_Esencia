import type { Article } from '../lib/types'
import { formatDateTime } from '../lib/utils'

export default function AttributionBox({ article }: { article: Article }) {
  if (article.provenance === 'native') return null

  if (article.provenance === 'imported_copy') {
    return (
      <aside className="attribution-box copia">
        <span className="attribution-sello">ש Artículo reproducido</span>
        <p>
          Este artículo es obra de <strong>{article.original_author || 'su autor original'}</strong>, publicado
          originalmente el <strong>{formatDateTime(article.original_published_at)}</strong>
          {article.original_source_url && (
            <> en <a href={article.original_source_url} target="_blank" rel="noreferrer">{new URL(article.original_source_url).hostname}</a></>
          )}.
          {' '}Se reproduce íntegro conservando su autoría y fecha originales
          {article.source_license_note ? ` — ${article.source_license_note}` : ' con permiso para su difusión'}.
        </p>
      </aside>
    )
  }

  return (
    <aside className="attribution-box ia">
      <span className="attribution-sello">ש Elaborado por el Diario</span>
      <p>
        Artículo elaborado por la redacción de SHADDAI · El Umbral a partir de fuentes de interés
        {article.original_source_url && (
          <> como <a href={article.original_source_url} target="_blank" rel="noreferrer">{new URL(article.original_source_url).hostname}</a></>
        )}.
        {' '}Los datos, citas y fechas reales mencionados proceden de la fuente original y se citan con respeto a su autoría.
      </p>
    </aside>
  )
}
