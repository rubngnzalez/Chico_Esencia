import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'
import { excerptFrom, formatDateTime, randomId, slugify } from '../../lib/utils'
import type { Article, ImportLink } from '../../lib/types'

export default function ImporterPage() {
  const [url, setUrl] = useState('')
  const [cola, setCola] = useState<ImportLink[]>([])
  const [analizando, setAnalizando] = useState(false)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [derechos, setDerechos] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const navigate = useNavigate()
  const { session } = useAuth()

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('sha_import_links')
      .select('*')
      .in('status', ['pending'])
      .order('created_at', { ascending: false })
    setCola((data ?? []) as ImportLink[])
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function analizar(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() || !session) return
    setAnalizando(true)
    setError(null)
    setMensaje(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sha-import-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: url.trim() })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo analizar el enlace')
      setUrl('')
      setMensaje(`Enlace analizado: ${json.link?.title ?? 'contenido extraído'}`)
      await cargar()
    } catch (err) {
      setError(`Error al analizar: ${(err as Error).message}`)
    }
    setAnalizando(false)
  }

  async function copiarIntegro(link: ImportLink) {
    if (!derechos[link.id]) {
      setError('Confirma que tienes permiso para reproducir el artículo antes de copiarlo.')
      return
    }
    setTrabajando(link.id)
    setError(null)
    const extraido = link.extracted
    const parrafos = (extraido?.text ?? '')
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => `<p>${p.replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`)
      .join('\n')
    const titulo = link.title || extraido?.title || 'Artículo importado'
    const { data: articulo, error: errArticulo } = await supabase
      .from('sha_articles')
      .insert({
        title: titulo,
        slug: `${slugify(titulo)}-${randomId()}`,
        excerpt: excerptFrom(parrafos),
        content: parrafos || '<p></p>',
        cover_image_url: extraido?.image ?? null,
        status: 'draft',
        provenance: 'imported_copy',
        original_author: extraido?.author ?? 'Autor original',
        original_source_url: link.url,
        original_published_at: extraido?.published_at ?? null,
        source_license_note: 'Reproducido con permiso de su autor. Verificado por la redacción.',
        author_id: (await supabase.auth.getUser()).data.user?.id ?? null
      })
      .select('id')
      .single()
    if (errArticulo || !articulo) {
      setError(`No se pudo crear la copia: ${errArticulo?.message}`)
      setTrabajando(null)
      return
    }
    await supabase.from('sha_import_links').update({
      status: 'copied', rights_confirmed: true, article_id: (articulo as Article).id
    }).eq('id', link.id)
    setTrabajando(null)
    navigate(`/admin/articulos/${(articulo as Article).id}/editar`)
  }

  async function generarConIa(link: ImportLink) {
    if (!session) return
    setTrabajando(link.id)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sha-import-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ link_id: link.id })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Error de generación')
      await supabase.from('sha_import_links').update({ status: 'generated', article_id: json.article_id }).eq('id', link.id)
      setTrabajando(null)
      navigate(`/admin/articulos/${json.article_id}/editar`)
    } catch (err) {
      setError(`Error al generar con IA: ${(err as Error).message}`)
      setTrabajando(null)
    }
  }

  async function descartar(link: ImportLink) {
    await supabase.from('sha_import_links').update({ status: 'dismissed' }).eq('id', link.id)
    cargar()
  }

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Importador de artículos</h1>
      </div>
      <p className="campo-nota">
        Pega el enlace de un artículo de interés y el sistema lo analizará. Después podrás:
        <strong> copiarlo íntegro</strong> con su autoría y fecha original claramente señaladas,
        o <strong>generar una versión propia con IA</strong> que respeta datos, citas y fechas reales,
        firmada por el Diario.
      </p>

      <form className="importador-forma" onSubmit={analizar}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://…"
          inputMode="url"
        />
        <button className="boton lleno" disabled={analizando}>
          {analizando ? 'Analizando…' : 'Analizar enlace'}
        </button>
      </form>

      {mensaje && <p className="login-ok">{mensaje}</p>}
      {error && <p className="login-error">{error}</p>}

      <h2>Cola de importación</h2>
      {cola.length === 0 && <p className="vacio">No hay enlaces pendientes. Analiza uno arriba.</p>}
      <div className="cola-importacion">
        {cola.map(link => {
          const e = link.extracted
          return (
            <div key={link.id} className="cola-tarjeta">
              <div className="cola-info">
                <strong>{link.title || e?.title || link.url}</strong>
                <span className="cola-meta">
                  {e?.author && <>Por {e.author} · </>}
                  {e?.published_at && <>Publicado {formatDateTime(e.published_at)} · </>}
                  {e?.word_count ? `${e.word_count} palabras · ` : ''}
                  <a href={link.url} target="_blank" rel="noreferrer">fuente ↗</a>
                </span>
                {e?.text && <p className="cola-fragmento">{e.text.slice(0, 260)}…</p>}
              </div>
              <div className="cola-acciones">
                <label className="campo-casilla">
                  <input
                    type="checkbox"
                    checked={!!derechos[link.id]}
                    onChange={ev => setDerechos(d => ({ ...d, [link.id]: ev.target.checked }))}
                  />
                  Confirmo permiso para reproducir este contenido
                </label>
                <div className="acciones-fila">
                  <button
                    className="boton peque"
                    disabled={trabajando === link.id}
                    onClick={() => copiarIntegro(link)}
                    title="Copia íntegra con atribución del autor y fecha originales"
                  >
                    {trabajando === link.id ? '…' : 'Copiar íntegro'}
                  </button>
                  <button
                    className="boton peque"
                    disabled={trabajando === link.id}
                    onClick={() => generarConIa(link)}
                    title="Genera una versión propia con IA, conservando datos y citas reales"
                  >
                    Generar con IA
                  </button>
                  <button className="enlace-accion peligro" onClick={() => descartar(link)}>Descartar</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
