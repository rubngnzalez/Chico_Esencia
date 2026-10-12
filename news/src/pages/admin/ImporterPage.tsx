import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'
import { excerptFrom, formatDateTime, randomId, slugify } from '../../lib/utils'
import type { Article, ImportLink } from '../../lib/types'

const ESTADO_ETIQUETA: Record<string, string> = {
  pending: 'Pendiente',
  copied: 'Copiado',
  generated: 'Con IA',
  dismissed: 'Descartado'
}

export default function ImporterPage() {
  const [url, setUrl] = useState('')
  const [cola, setCola] = useState<ImportLink[]>([])
  const [historial, setHistorial] = useState<ImportLink[]>([])
  const [pestana, setPestana] = useState<'pendientes' | 'historial'>('pendientes')
  const [analizando, setAnalizando] = useState(false)
  const [rastreando, setRastreando] = useState(false)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const [derechos, setDerechos] = useState<Record<string, boolean>>({})
  const [encontrados, setEncontrados] = useState<{ url: string; titulo: string }[]>([])
  const [origenRastro, setOrigenRastro] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [guardandoLote, setGuardandoLote] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const navigate = useNavigate()
  const { session } = useAuth()

  const cargar = useCallback(async () => {
    const [pendientes, todos] = await Promise.all([
      supabase.from('sha_import_links').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('sha_import_links').select('*').order('created_at', { ascending: false }).limit(200)
    ])
    setCola((pendientes.data ?? []) as ImportLink[])
    setHistorial((todos.data ?? []) as ImportLink[])
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

  async function rastrear(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim() || !session) return
    setRastreando(true)
    setError(null)
    setMensaje(null)
    setEncontrados([])
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sha-import-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ url: url.trim(), mode: 'discover' })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo rastrear la web')
      setOrigenRastro(String(json.origen ?? url))
      setEncontrados(json.encontrados ?? [])
      setMensaje(`Rastreo completo: ${json.total ?? 0} artículos localizados. Marca los que quieras añadir a la cola.`)
      setUrl('')
    } catch (err) {
      setError(`Error al rastrear: ${(err as Error).message}`)
    }
    setRastreando(false)
  }

  async function anadirSeleccionados() {
    if (!seleccion.size) return
    setGuardandoLote(true)
    setError(null)
    const urlsExistentes = new Set(historial.map(l => l.url))
    const { data: usuarioActual } = await supabase.auth.getUser()
    const nuevas = [...seleccion].filter(u => !urlsExistentes.has(u)).map(u => ({
      url: u,
      title: encontrados.find(e => e.url === u)?.titulo ?? null,
      created_by: usuarioActual?.user?.id ?? null
    }))
    if (nuevas.length > 0) {
      const { error: err } = await supabase.from('sha_import_links').insert(nuevas)
      if (err) { setError(`No se pudieron añadir: ${err.message}`); setGuardandoLote(false); return }
    }
    const repetidos = seleccion.size - nuevas.length
    setMensaje(`${nuevas.length} enlaces añadidos a la cola${repetidos > 0 ? ` (${repetidos} ya estaban)` : ''}. Pulsa "Analizar" en cada uno para extraer su contenido.`)
    setEncontrados([])
    setSeleccion(new Set())
    setGuardandoLote(false)
    await cargar()
    setPestana('pendientes')
  }

  async function analizarLink(link: ImportLink) {
    if (!session) return
    setTrabajando(link.id)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sha-import-extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ link_id: link.id })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo extraer')
      setMensaje(`Contenido extraído: ${json.link?.title ?? link.url}`)
      await cargar()
    } catch (err) {
      setError(`Error al extraer: ${(err as Error).message}`)
    }
    setTrabajando(null)
  }

  async function eliminar(link: ImportLink) {
    if (!confirm(`¿Eliminar de la cola «${link.title || link.url}»?`)) return
    await supabase.from('sha_import_links').delete().eq('id', link.id)
    cargar()
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

  function alternarSeleccion(urlSel: string) {
    setSeleccion(prev => {
      const next = new Set(prev)
      if (next.has(urlSel)) next.delete(urlSel)
      else next.add(urlSel)
      return next
    })
  }

  const lista = pestana === 'pendientes' ? cola : historial

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Importador de artículos</h1>
      </div>
      <p className="campo-nota">
        Pega la portada de una web para <strong>rastrear sus artículos</strong>, o la URL de un artículo
        concreto para analizarlo. Después podrás: <strong>copiarlo íntegro</strong> con su autoría y fecha
        original claramente señaladas, o <strong>generar una versión propia con IA</strong> que respeta
        datos, citas y fechas reales, firmada por la redacción.
      </p>

      <form className="importador-forma" onSubmit={analizar}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://… (portada de la web o artículo concreto)"
          inputMode="url"
        />
        <button className="boton" disabled={analizando || rastreando} onClick={rastrear}>
          {rastreando ? 'Rastreando…' : 'Rastrear web'}
        </button>
        <button className="boton lleno" disabled={analizando || rastreando}>
          {analizando ? 'Analizando…' : 'Analizar artículo'}
        </button>
      </form>

      {mensaje && <p className="login-ok">{mensaje}</p>}
      {error && <p className="login-error">{error}</p>}

      {encontrados.length > 0 && (
        <div className="panel-seccion rastro-resultados">
          <h2>Artículos encontrados en {origenRastro} <span className="campo-nota">({encontrados.length})</span></h2>
          <div className="acciones-fila" style={{ marginBottom: '0.8rem' }}>
            <button className="enlace-accion" onClick={() => setSeleccion(new Set(encontrados.map(e => e.url)))}>Marcar todos</button>
            <button className="enlace-accion" onClick={() => setSeleccion(new Set())}>Desmarcar</button>
          </div>
          <div className="rastro-lista">
            {encontrados.map(e => (
              <label key={e.url} className="campo-casilla rastro-item">
                <input
                  type="checkbox"
                  checked={seleccion.has(e.url)}
                  onChange={() => alternarSeleccion(e.url)}
                />
                <span>
                  {e.titulo}
                  <a className="rastro-url" href={e.url} target="_blank" rel="noreferrer"> ↗</a>
                </span>
              </label>
            ))}
          </div>
          <div className="acciones-fila" style={{ marginTop: '0.8rem' }}>
            <button className="boton lleno" disabled={guardandoLote || seleccion.size === 0} onClick={anadirSeleccionados}>
              {guardandoLote ? 'Añadiendo…' : `Añadir ${seleccion.size || ''} a la cola`}
            </button>
            <button className="boton peque" onClick={() => setEncontrados([])}>Cerrar</button>
          </div>
        </div>
      )}

      <div className="filtros">
        <button className={`chip${pestana === 'pendientes' ? ' activo' : ''}`} onClick={() => setPestana('pendientes')}>
          Cola pendiente ({cola.length})
        </button>
        <button className={`chip${pestana === 'historial' ? ' activo' : ''}`} onClick={() => setPestana('historial')}>
          Historial ({historial.length})
        </button>
      </div>

      {lista.length === 0 && (
        <p className="vacio">
          {pestana === 'pendientes'
            ? 'No hay enlaces pendientes. Rastrea una web o analiza un artículo arriba.'
            : 'Todavía no se ha guardado ningún enlace.'}
        </p>
      )}

      <div className="cola-importacion">
        {lista.map(link => {
          const e = link.extracted
          const pendienteSinExtraer = link.status === 'pending' && !e?.text
          return (
            <div key={link.id} className="cola-tarjeta">
              <div className="cola-info">
                <strong>{link.title || e?.title || link.url}</strong>
                <span className="cola-meta">
                  <span className={`estado estado-${link.status === 'pending' ? 'pending' : 'published'}`}>
                    {ESTADO_ETIQUETA[link.status] ?? link.status}
                  </span>
                  {' · '}
                  {e?.author && <>Por {e.author} · </>}
                  {e?.published_at && <>Publicado {formatDateTime(e.published_at)} · </>}
                  {e?.word_count ? `${e.word_count} palabras · ` : ''}
                  {formatDateTime(link.created_at)} ·{' '}
                  <a href={link.url} target="_blank" rel="noreferrer">fuente ↗</a>
                  {link.article_id && <> · <a href={`/admin/articulos/${link.article_id}/editar`}>artículo creado ↗</a></>}
                </span>
                {e?.text && <p className="cola-fragmento">{e.text.slice(0, 260)}…</p>}
              </div>
              <div className="cola-acciones">
                {pendienteSinExtraer ? (
                  <div className="acciones-fila">
                    <button className="boton peque" disabled={trabajando === link.id} onClick={() => analizarLink(link)}>
                      {trabajando === link.id ? 'Extrayendo…' : 'Analizar'}
                    </button>
                    <button className="enlace-accion peligro" onClick={() => eliminar(link)}>Eliminar</button>
                  </div>
                ) : link.status === 'pending' ? (
                  <>
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
                      <button className="enlace-accion peligro" onClick={() => eliminar(link)}>Eliminar</button>
                    </div>
                  </>
                ) : (
                  <div className="acciones-fila">
                    <button className="enlace-accion peligro" onClick={() => eliminar(link)}>Eliminar del historial</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
