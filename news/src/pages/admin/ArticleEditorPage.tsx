import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'
import { excerptFrom, formatDate, randomId, readingTime, slugify, formatDateTime } from '../../lib/utils'
import type { Article, ArticleStatus, Category, SocialPost } from '../../lib/types'

interface PropsRedSocial { red: 'facebook' | 'instagram' }

export default function ArticleEditorPage() {
  const { id } = useParams()
  const nuevo = !id || id === 'nuevo'
  const navigate = useNavigate()
  const { isStaff, session, profile } = useAuth()

  const [titulo, setTitulo] = useState('')
  const [slug, setSlug] = useState('')
  const [entradilla, setEntradilla] = useState('')
  const [contenido, setContenido] = useState('')
  const [portada, setPortada] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tags, setTags] = useState('')
  const [status, setStatus] = useState<ArticleStatus>('draft')
  const [scheduledFor, setScheduledFor] = useState('')
  const [featured, setFeatured] = useState(false)
  const [showAuthor, setShowAuthor] = useState(true)
  const [allowShare, setAllowShare] = useState(true)
  const [allowComments, setAllowComments] = useState(true)
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [ogImage, setOgImage] = useState('')
  const [categorias, setCategorias] = useState<Category[]>([])
  const [cargando, setCargando] = useState(!nuevo)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [articuloId, setArticuloId] = useState<string | null>(nuevo ? null : id!)
  const [procedencia, setProcedencia] = useState<Article | null>(null)
  const [postsSociales, setPostsSociales] = useState<SocialPost[]>([])
  const [publicando, setPublicando] = useState<string | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Image.configure({ inline: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Escribe aquí el artículo… Inhala, exhala, y empieza.' })
    ],
    content: '',
    onUpdate: ({ editor }) => setContenido(editor.getHTML())
  })

  useEffect(() => {
    supabase.from('sha_categories').select('*').eq('active', true).order('position')
      .then(({ data }) => setCategorias((data ?? []) as Category[]))
  }, [])

  useEffect(() => {
    if (nuevo) return
    supabase.from('sha_articles').select('*').eq('id', id!).maybeSingle()
      .then(async ({ data }) => {
        if (!data) { setError('Artículo no encontrado'); setCargando(false); return }
        const a = data as Article
        setArticuloId(a.id)
        setTitulo(a.title)
        setSlug(a.slug)
        setEntradilla(a.excerpt ?? '')
        setContenido(a.content)
        setPortada(a.cover_image_url ?? '')
        setCategoryId(a.category_id ?? '')
        setTags(a.tags.join(', '))
        setStatus(a.status)
        setScheduledFor(a.scheduled_for ? toLocalInput(a.scheduled_for) : '')
        setFeatured(a.featured)
        setShowAuthor(a.show_author)
        setAllowShare(a.allow_share)
        setAllowComments(a.allow_comments)
        setSeoTitle(a.seo_title ?? '')
        setSeoDescription(a.seo_description ?? '')
        setOgImage(a.og_image ?? '')
        setProcedencia(a)
        editor?.commands.setContent(a.content)
        setCargando(false)
      })
  }, [id, nuevo, editor])

  const cargarPostsSociales = useCallback(async () => {
    if (!articuloId) return
    const { data } = await supabase.from('sha_social_posts').select('*').eq('article_id', articuloId)
    setPostsSociales((data ?? []) as SocialPost[])
  }, [articuloId])

  useEffect(() => { cargarPostsSociales() }, [cargarPostsSociales])

  async function subirImagen(file: File): Promise<string | null> {
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${new Date().getFullYear()}/${randomId()}.${ext}`
    const { error: err } = await supabase.storage.from('sha-blog').upload(path, file, { cacheControl: '3600' })
    if (err) { setError(`No se pudo subir la imagen: ${err.message}`); return null }
    const { data } = supabase.storage.from('sha-blog').getPublicUrl(path)
    return data.publicUrl
  }

  async function anadirImagenPortada(file: File | undefined) {
    if (!file) return
    const url = await subirImagen(file)
    if (url) setPortada(url)
  }

  async function anadirImagenEditor(file: File | undefined) {
    if (!file || !editor) return
    const url = await subirImagen(file)
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }

  function insertarVideo() {
    if (!editor) return
    const url = prompt('URL del vídeo (YouTube o Vimeo):')
    if (!url) return
    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{6,})/)
    const vimeo = url.match(/vimeo\.com\/(\d+)/)
    const src = yt ? `https://www.youtube.com/embed/${yt[1]}` : vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : url
    editor.chain().focus().insertContent(`<div data-video="true"><iframe src="${src}" allowfullscreen="true"></iframe></div><p></p>`).run()
  }

  function anadirEnlace() {
    if (!editor) return
    const previo = editor.getAttributes('link').href as string | undefined
    const url = prompt('URL del enlace:', previo ?? 'https://')
    if (url === null) return
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run()
  }

  const entradillaFinal = useMemo(
    () => entradilla.trim() || excerptFrom(contenido),
    [entradilla, contenido]
  )

  async function guardar() {
    if (!titulo.trim()) { setError('El título es obligatorio.'); return }
    if (status === 'scheduled' && !scheduledFor) { setError('Indica fecha y hora de publicación programada.'); return }
    setGuardando(true)
    setError(null)
    setMensaje(null)

    const payload: Record<string, unknown> = {
      title: titulo.trim(),
      slug: slugify(slug || titulo),
      excerpt: entradillaFinal,
      content: contenido,
      cover_image_url: portada || null,
      category_id: categoryId || null,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      status,
      scheduled_for: status === 'scheduled' ? new Date(scheduledFor).toISOString() : null,
      featured: isStaff ? featured : false,
      show_author: showAuthor,
      allow_share: allowShare,
      allow_comments: allowComments,
      seo_title: seoTitle.trim() || null,
      seo_description: seoDescription.trim() || null,
      og_image: ogImage.trim() || portada || null,
      reading_time: readingTime(contenido),
      author_id: profile?.id ?? null
    }
    if (status === 'published') payload.published_at = new Date().toISOString()

    let intento = 0
    let resultadoId = articuloId
    while (intento < 4) {
      const datos = { ...payload }
      if (intento > 0) datos.slug = `${slugify(slug || titulo)}-${intento + 1}`
      const { data, error: err } = articuloId
        ? await supabase.from('sha_articles').update(datos).eq('id', articuloId).select('id').single()
        : await supabase.from('sha_articles').insert(datos).select('id').single()
      if (err) {
        if (err.code === '23505') { intento++; continue }
        setError(`No se pudo guardar: ${err.message}`)
        setGuardando(false)
        return
      }
      resultadoId = (data as { id: string }).id
      break
    }
    if (!resultadoId) { setError('No se pudo guardar: el slug ya existe.'); setGuardando(false); return }

    if (!articuloId) {
      setArticuloId(resultadoId)
      navigate(`/admin/articulos/${resultadoId}/editar`, { replace: true })
    }
    setGuardando(false)
    setMensaje('Guardado. Inhala tranquilo.')
    if (status === 'published') triggerRebuildSeo()
  }

  async function triggerRebuildSeo() {
    if (!session) return
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sha-seo-rebuild`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` }
    }).catch(() => {})
  }

  async function publicarEnRed(red: PropsRedSocial['red']) {
    if (!session || !articuloId) return
    setPublicando(red)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sha-social-publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ article_id: articuloId, network: red })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error al publicar')
      setMensaje(`Publicado en ${red}: ${json.permalink ?? 'hecho'}`)
      cargarPostsSociales()
    } catch (e) {
      setError(`No se pudo publicar en ${red}: ${(e as Error).message}`)
    }
    setPublicando(null)
  }

  if (cargando) return <p className="cargando">Cargando artículo…</p>

  const estadosDisponibles: ArticleStatus[] = isStaff
    ? ['draft', 'published', 'scheduled']
    : ['draft', 'pending']

  return (
    <div className="editor-articulo">
      <div className="dashboard-cabecera">
        <h1>{nuevo ? 'Nuevo artículo' : 'Editar artículo'}</h1>
        <div className="acciones-fila">
          {articuloId && <a className="boton peque" href={`/news/articulo/${slug}`} target="_blank" rel="noreferrer">Ver en el diario</a>}
          <button className="boton lleno" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      {mensaje && <p className="login-ok">{mensaje}</p>}
      {error && <p className="login-error">{error}</p>}

      <div className="editor-grid">
        <div className="editor-principal">
          <input
            className="input-titulo"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Título del artículo…"
          />
          <div className="editor-toolbar">
            {editor && (
              <>
                <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} title="Negrita"><b>B</b></button>
                <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva"><i>I</i></button>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Sección">H2</button>
                <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Subsección">H3</button>
                <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Cita">❝</button>
                <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista">•—</button>
                <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Lista numerada">1.</button>
                <button type="button" onClick={anadirEnlace} title="Enlace">🔗</button>
                <label className="toolbar-subir" title="Insertar imagen">
                  🖼
                  <input type="file" accept="image/*" hidden onChange={e => anadirImagenEditor(e.target.files?.[0])} />
                </label>
                <button type="button" onClick={insertarVideo} title="Insertar vídeo">▶</button>
                <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Separador">―</button>
                <button type="button" onClick={() => editor.chain().focus().undo().run()} title="Deshacer">↶</button>
                <button type="button" onClick={() => editor.chain().focus().redo().run()} title="Rehacer">↷</button>
              </>
            )}
          </div>
          <EditorContent editor={editor} className="editor-cuerpo" />

          <label className="campo">
            Entradilla (resumen)
            <textarea
              value={entradilla}
              onChange={e => setEntradilla(e.target.value)}
              rows={2}
              placeholder={entradillaFinal || 'Se genera sola a partir del contenido…'}
            />
          </label>
        </div>

        <aside className="editor-lateral">
          <fieldset>
            <legend>Publicación</legend>
            <label className="campo">
              Estado
              <select value={status} onChange={e => setStatus(e.target.value as ArticleStatus)}>
                {estadosDisponibles.map(s => (
                  <option key={s} value={s}>
                    {s === 'draft' ? 'Borrador' : s === 'published' ? 'Publicado' : s === 'scheduled' ? 'Programado' : 'Enviar a revisión'}
                  </option>
                ))}
              </select>
            </label>
            {status === 'scheduled' && (
              <label className="campo">
                Publicar el
                <input type="datetime-local" value={scheduledFor} onChange={e => setScheduledFor(e.target.value)} />
              </label>
            )}
            {isStaff && (
              <label className="campo-casilla">
                <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} />
                Artículo destacado (aparece en la portada)
              </label>
            )}
          </fieldset>

          <fieldset>
            <legend>Clasificación</legend>
            <label className="campo">
              Categoría
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)}>
                <option value="">— Sin categoría —</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="campo">
              Etiquetas (separadas por comas)
              <input value={tags} onChange={e => setTags(e.target.value)} placeholder="presencia, ritual, olfato" />
            </label>
            <label className="campo">
              Slug (URL)
              <input value={slug} onChange={e => setSlug(e.target.value)} placeholder={slugify(titulo) || 'se genera del título'} />
            </label>
          </fieldset>

          <fieldset>
            <legend>Portada</legend>
            {portada && <img src={portada} alt="Portada" className="editor-portada" />}
            <label className="campo">
              Imagen de portada
              <input type="file" accept="image/*" onChange={e => anadirImagenPortada(e.target.files?.[0])} />
            </label>
            <label className="campo">
              …o pega una URL
              <input value={portada} onChange={e => setPortada(e.target.value)} placeholder="https://…" />
            </label>
          </fieldset>

          <fieldset>
            <legend>Opciones del artículo</legend>
            <label className="campo-casilla">
              <input type="checkbox" checked={showAuthor} onChange={e => setShowAuthor(e.target.checked)} />
              Mostrar autoría visible
            </label>
            <label className="campo-casilla">
              <input type="checkbox" checked={allowShare} onChange={e => setAllowShare(e.target.checked)} />
              Permitir compartir en redes
            </label>
            <label className="campo-casilla">
              <input type="checkbox" checked={allowComments} onChange={e => setAllowComments(e.target.checked)} />
              Permitir comentarios
            </label>
          </fieldset>

          {procedencia && procedencia.provenance !== 'native' && (
            <fieldset>
              <legend>Procedencia (no editable)</legend>
              <p className="campo-nota">
                {procedencia.provenance === 'imported_copy'
                  ? <>Copia íntegra de <strong>{procedencia.original_author}</strong>, publicada {formatDateTime(procedencia.original_published_at)}.</>
                  : <>Versión elaborada con IA a partir de la fuente original.</>}
                {procedencia.original_source_url && (
                  <> <a href={procedencia.original_source_url} target="_blank" rel="noreferrer">Ver fuente ↗</a></>
                )}
              </p>
            </fieldset>
          )}

          <details>
            <summary>SEO y redes</summary>
            <label className="campo">
              Título SEO
              <input value={seoTitle} onChange={e => setSeoTitle(e.target.value)} placeholder={titulo} />
            </label>
            <label className="campo">
              Descripción SEO
              <textarea value={seoDescription} onChange={e => setSeoDescription(e.target.value)} rows={3} maxLength={300} placeholder={entradillaFinal} />
            </label>
            <label className="campo">
              Imagen OG (para al compartir)
              <input value={ogImage} onChange={e => setOgImage(e.target.value)} placeholder={portada || 'https://…'} />
            </label>
          </details>
        </aside>
      </div>

      {isStaff && articuloId && (
        <section className="panel-seccion social-panel">
          <h2>Publicar en redes sociales</h2>
          <p className="campo-nota">
            Publica el artículo y sus comentarios y reacciones se sincronizarán automáticamente
            aquí (cada 15 minutos). Requiere configurar las claves de Meta en los ajustes del servidor.
          </p>
          <div className="acciones-fila">
            <button className="boton peque" disabled={publicando !== null} onClick={() => publicarEnRed('facebook')}>
              {publicando === 'facebook' ? 'Publicando…' : 'Publicar en Facebook'}
            </button>
            <button className="boton peque" disabled={publicando !== null} onClick={() => publicarEnRed('instagram')}>
              {publicando === 'instagram' ? 'Publicando…' : 'Publicar en Instagram'}
            </button>
          </div>
          {postsSociales.length > 0 && (
            <table className="tabla">
              <thead><tr><th>Red</th><th>Enlace</th><th>Publicado</th><th>Última sincronización</th></tr></thead>
              <tbody>
                {postsSociales.map(p => (
                  <tr key={p.id}>
                    <td>{p.network === 'facebook' ? 'Facebook' : 'Instagram'}</td>
                    <td>{p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer">Ver post ↗</a>}</td>
                    <td>{formatDate(p.published_at)}</td>
                    <td>{p.last_synced_at ? formatDateTime(p.last_synced_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
