import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'
import type { Article } from '../../lib/types'
import { formatDate } from '../../lib/utils'

const ESTADO_ETIQUETA: Record<string, string> = {
  draft: 'Borrador', pending: 'En revisión', scheduled: 'Programado', published: 'Publicado'
}

export default function DashboardPage() {
  const { isStaff } = useAuth()
  const [stats, setStats] = useState({ published: 0, draft: 0, pending: 0, scheduled: 0, views: 0, comments: 0, imports: 0, social: 0 })
  const [recientes, setRecientes] = useState<Article[]>([])

  useEffect(() => {
    async function contar(table: string, eq?: Record<string, string>) {
      let q = supabase.from(table).select('*', { count: 'exact', head: true })
      for (const [k, v] of Object.entries(eq ?? {})) q = q.eq(k, v)
      const { count } = await q
      return count ?? 0
    }
    (async () => {
      const published = await contar('sha_articles', { status: 'published' })
      const draft = await contar('sha_articles', { status: 'draft' })
      const pending = await contar('sha_articles', { status: 'pending' })
      const scheduled = await contar('sha_articles', { status: 'scheduled' })
      const comments = isStaff ? await contar('sha_comments', { status: 'pending' }) : 0
      const imports = isStaff ? await contar('sha_import_links', { status: 'pending' }) : 0
      const social = isStaff ? await contar('sha_social_posts') : 0
      let views = 0
      if (isStaff) {
        const { data } = await supabase.from('sha_articles').select('views')
        views = (data ?? []).reduce((acc, r) => acc + (r.views ?? 0), 0)
      }
      setStats({ published, draft, pending, scheduled, views, comments, imports, social })

      let rec = supabase.from('sha_articles')
        .select('id, slug, title, status, published_at, views, category:sha_categories(name)')
        .order('updated_at', { ascending: false })
        .limit(8)
      const { data } = await rec
      setRecientes((data ?? []) as unknown as Article[])
    })()
  }, [isStaff])

  const tarjetas = [
    { etiqueta: 'Publicados', valor: stats.published },
    { etiqueta: 'Borradores', valor: stats.draft },
    { etiqueta: 'En revisión', valor: stats.pending },
    { etiqueta: 'Programados', valor: stats.scheduled },
    ...(isStaff ? [
      { etiqueta: 'Lecturas totales', valor: stats.views },
      { etiqueta: 'Comentarios por moderar', valor: stats.comments },
      { etiqueta: 'En cola de importación', valor: stats.imports },
      { etiqueta: 'Posts en redes', valor: stats.social }
    ] : [])
  ]

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Bienvenido al umbral</h1>
        <Link className="boton lleno" to="/admin/articulos/nuevo">Escribir artículo</Link>
      </div>

      <div className="dashboard-tarjetas">
        {tarjetas.map(t => (
          <div key={t.etiqueta} className="dash-tarjeta">
            <span className="dash-valor">{t.valor}</span>
            <span className="dash-etiqueta">{t.etiqueta}</span>
          </div>
        ))}
      </div>

      <section className="panel-seccion">
        <h2>Actividad reciente</h2>
        {recientes.length === 0
          ? <p className="vacio">Todavía no hay artículos. Empieza escribiendo el primero.</p>
          : (
            <table className="tabla">
              <thead>
                <tr><th>Título</th><th>Estado</th><th>Fecha</th><th>Lecturas</th><th /></tr>
              </thead>
              <tbody>
                {recientes.map(a => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td><span className={`estado estado-${a.status}`}>{ESTADO_ETIQUETA[a.status] ?? a.status}</span></td>
                    <td>{formatDate(a.published_at)}</td>
                    <td>{a.views}</td>
                    <td><Link to={`/admin/articulos/${a.id}/editar`} className="enlace-accion">Editar</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </section>
    </div>
  )
}
