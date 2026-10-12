import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import AttributionBox from '../components/AttributionBox'
import AuthorCard from '../components/AuthorCard'
import CommentsSection from '../components/CommentsSection'
import FavoriteButton from '../components/FavoriteButton'
import ShareBar from '../components/ShareBar'
import WidgetRenderer from '../components/WidgetRenderer'
import { fetchArticleBySlug, queryArticles } from '../lib/queries'
import { jsonLdArticulo, setSeo } from '../lib/seo'
import { supabase } from '../lib/supabase'
import { formatDate, stripHtml } from '../lib/utils'
import type { Article } from '../lib/types'

export default function ArticlePage() {
  const { slug = '' } = useParams()
  const [article, setArticle] = useState<Article | null>(null)
  const [cargando, setCargando] = useState(true)
  const [relacionados, setRelacionados] = useState<Article[]>([])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setRelacionados([])
    fetchArticleBySlug(slug).then(async a => {
      if (!vivo) return
      setArticle(a)
      setCargando(false)
      if (!a) return
      const url = `${location.origin}/news/articulo/${a.slug}`
      const descripcion = a.seo_description || a.excerpt || stripHtml(a.content).slice(0, 160)
      setSeo({
        title: a.seo_title || a.title,
        description: descripcion,
        image: a.og_image || a.cover_image_url,
        url,
        author: a.show_author ? a.author?.display_name : null,
        publishedTime: a.published_at,
        modifiedTime: a.updated_at,
        section: a.category?.name ?? null,
        tags: a.tags,
        jsonLd: jsonLdArticulo({
          titulo: a.seo_title || a.title,
          descripcion,
          imagen: (a.og_image || a.cover_image_url || '/img/shin-logo.png').startsWith('http')
            ? (a.og_image || a.cover_image_url)!
            : location.origin + (a.og_image || a.cover_image_url || '/img/shin-logo.png'),
          url,
          autor: a.show_author ? a.author?.display_name ?? null : null,
          publicado: a.published_at,
          modificado: a.updated_at,
          seccion: a.category?.name ?? null,
          tags: a.tags
        })
      })
      const clave = `sha_vista_${a.id}`
      if (!sessionStorage.getItem(clave)) {
        sessionStorage.setItem(clave, '1')
        supabase.rpc('sha_register_view', { p_article: a.id }).then(() => {}, () => {})
      }
      if (a.category) {
        const mas = await queryArticles({ categorySlug: a.category.slug, limit: 4, excludeId: a.id })
        if (vivo) setRelacionados(mas.slice(0, 3))
      }
    })
    return () => { vivo = false }
  }, [slug])

  if (cargando) return <div className="contenedor seccion"><p className="cargando">Abriendo el umbral…</p></div>
  if (!article) {
    return (
      <div className="contenedor seccion centrar">
        <h1 className="titulo">Artículo no encontrado</h1>
        <p>El texto que buscas no está publicado o se ha desvanecido.</p>
        <Link className="boton" to="/">Volver al diario</Link>
      </div>
    )
  }

  const autorNombre = article.show_author ? article.author?.display_name : null

  return (
    <article className="pagina-articulo">
      {article.cover_image_url && (
        <div className="articulo-portada" style={{ backgroundImage: `url(${article.cover_image_url})` }} />
      )}
      <div className="contenedor layout-articulo">
        <div className="columna-principal">
          <nav className="miga">
            <Link to="/">Diario</Link>
            {article.category && <><span> / </span><Link to={`/categoria/${article.category.slug}`}>{article.category.name}</Link></>}
          </nav>

          <h1 className="articulo-titulo">{article.title}</h1>

          <div className="articulo-meta">
            {article.show_author && article.author && (
              <span className="articulo-autor">
                {article.author.avatar_url
                  ? <img className="avatar-mini img" src={article.author.avatar_url} alt="" />
                  : <span className="avatar-mini">{(article.author.display_name || 'S')[0].toUpperCase()}</span>}
                {article.author.display_name || 'La redacción'}
              </span>
            )}
            <time dateTime={article.published_at ?? undefined}>{formatDate(article.published_at)}</time>
            <span>· {article.reading_time} min de lectura</span>
            <span>· {article.views} lecturas</span>
            <FavoriteButton articleId={article.id} compacta />
          </div>

          <AttributionBox article={article} />

          {article.content && (
            <div className="prose" dangerouslySetInnerHTML={{ __html: article.content }} />
          )}

          {article.tags.length > 0 && (
            <div className="articulo-tags">
              {article.tags.map(t => <span key={t} className="tag">{t}</span>)}
            </div>
          )}

          {article.allow_share && <ShareBar title={article.title} authorName={autorNombre} />}

          {article.show_author && article.author && <AuthorCard author={article.author} />}

          {article.allow_comments && <CommentsSection article={article} />}
        </div>

        <aside className="columna-sidebar">
          <WidgetRenderer zone="article_sidebar" />
          <div className="widget widget-esencias">
            <h3 className="widget-titulo">Esencias — la web</h3>
            <p>El Eau de Parfum Neurosensorial hecho a mano.</p>
            <a className="boton lleno peque" href="https://omshaddai.com/" target="_blank" rel="noreferrer">Visitar Esencias</a>
          </div>
        </aside>
      </div>

      {relacionados.length > 0 && (
        <section className="seccion relacionados">
          <div className="contenedor">
            <h2 className="titulo-seccion">Sigues en el umbral</h2>
            <div className="rejilla rejilla-3">
              {relacionados.map(a => <ArticleCard key={a.id} article={a} />)}
            </div>
          </div>
        </section>
      )}
    </article>
  )
}
