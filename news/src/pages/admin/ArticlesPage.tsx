import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'
import type { Article, ArticleStatus } from '../../lib/types'
import { formatDate } from '../../lib/utils'

const ESTADOS: { valor: string; texto: string }[] = [
  { valor: '', texto: 'Todos' },
  { valor: 'published', texto: 'Publicados' },
  { valor: 'draft', texto: 'Borradores' },
  { valor: 'pending', texto: 'En revisión' },
  { valor: 'scheduled', texto: 'Programados' }
]

const ESTADO_ETIQUETA: Record<ArticleStatus, string> = {
  draft: 'Borrador', pending: 'En revisión', scheduled: 'Programado', published: 'Publicado'
}

export default function ArticlesPage() {
  const { isStaff } = useAuth()
  const [estado, setEstado] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [articulos, setArticulos] = useState<Article[]>([])
  const [cargando, setCargando] = useState(true)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    let q = supabase
      .from('sha_articles')
      .select('*, category:sha_categories(name)')
      .order('updated_at', { ascending: false })
      .limit(100)
    if (estado) q = q.eq('status', estado)
    if (busqueda.trim()) q = q.ilike('title', `%${busqueda.trim()}%`)
    const { data } = await q
    setArticulos((data ?? []) as unknown as Article[])
    setCargando(false)
  }, [estado, busqueda])

  useEffect(() => { cargar() }, [cargar])

  async function actualizar(id: string, cambios: Partial<Article>) {
    const { error } = await supabase.from('sha_articles').update(cambios).eq('id', id)
    if (error) { setMensaje(`Error: ${error.message}`); return }
    setMensaje(null)
    cargar()
  }

  async function eliminar(a: Article) {
    if (!confirm(`¿Eliminar definitivamente «${a.title}»?`)) return
    await supabase.from('sha_articles').delete().eq('id', a.id)
    cargar()
  }

  async function publicar(a: Article) {
    await actualizar(a.id, {
      status: 'published',
      published_at: a.published_at ?? new Date().toISOString(),
      scheduled_for: null
    })
  }

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Artículos</h1>
        <Link className="boton lleno" to="/admin/articulos/nuevo">Nuevo artículo</Link>
      </div>

      <div className="filtros">
        <select value={estado} onChange={e => setEstado(e.target.value)}>
          {ESTADOS.map(e => <option key={e.valor} value={e.valor}>{e.texto}</option>)}
        </select>
        <input
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por título…"
        />
      </div>

      {mensaje && <p className="login-error">{mensaje}</p>}
      {cargando && <p className="cargando">Cargando artículos…</p>}
      {!cargando && articulos.length === 0 && <p className="vacio">No hay artículos con estos filtros.</p>}

      {articulos.length > 0 && (
        <table className="tabla">
          <thead>
            <tr>
              <th>Título</th><th>Categoría</th><th>Estado</th><th>Publicación</th><th>Lecturas</th><th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {articulos.map(a => (
              <tr key={a.id} className={a.featured ? 'fila-destacada' : ''}>
                <td>
                  {a.title}
                  {a.featured && <span className="destacada-marca"> ★ destacado</span>}
                  {a.provenance !== 'native' && <span className="procedencia-marca">{a.provenance === 'imported_copy' ? ' · copia' : ' · IA'}</span>}
                </td>
                <td>{a.category?.name ?? '—'}</td>
                <td><span className={`estado estado-${a.status}`}>{ESTADO_ETIQUETA[a.status]}</span></td>
                <td>{formatDate(a.published_at ?? a.scheduled_for)}</td>
                <td>{a.views}</td>
                <td className="acciones-tabla">
                  <Link className="enlace-accion" to={`/admin/articulos/${a.id}/editar`}>Editar</Link>
                  {a.status === 'published' && (
                    <a className="enlace-accion" href={`/news/articulo/${a.slug}`} target="_blank" rel="noreferrer">Ver</a>
                  )}
                  {isStaff && a.status !== 'published' && a.status !== 'scheduled' && (
                    <button className="enlace-accion" onClick={() => publicar(a)}>Publicar</button>
                  )}
                  {isStaff && (a.status === 'draft' || a.status === 'pending') && (
                    <button className="enlace-accion" onClick={() => actualizar(a.id, { status: 'scheduled', scheduled_for: a.scheduled_for ?? new Date(Date.now() + 864e5).toISOString() })}>
                      Programar +24h
                    </button>
                  )}
                  {isStaff && a.status === 'scheduled' && (
                    <button className="enlace-accion" onClick={() => actualizar(a.id, { status: 'draft', scheduled_for: null })}>Anular</button>
                  )}
                  {isStaff && a.status === 'published' && (
                    <button className="enlace-accion" onClick={() => actualizar(a.id, { status: 'draft' })}>Despublicar</button>
                  )}
                  {isStaff && (
                    <button className="enlace-accion" onClick={() => actualizar(a.id, { featured: !a.featured })}>
                      {a.featured ? 'Quitar ★' : 'Destacar ★'}
                    </button>
                  )}
                  {!isStaff && a.status === 'draft' && (
                    <button className="enlace-accion" onClick={() => actualizar(a.id, { status: 'pending' })}>Enviar a revisión</button>
                  )}
                  {isStaff && <button className="enlace-accion peligro" onClick={() => eliminar(a)}>Eliminar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
