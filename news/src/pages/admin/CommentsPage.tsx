import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Comment } from '../../lib/types'
import { formatDateTime } from '../../lib/utils'

const TABS = [
  { valor: 'pending', texto: 'Pendientes' },
  { valor: 'approved', texto: 'Aprobados' },
  { valor: 'rejected', texto: 'Rechazados' }
]

export default function CommentsPage() {
  const [estado, setEstado] = useState('pending')
  const [comentarios, setComentarios] = useState<(Comment & { articulo?: { title: string; slug: string } | null })[]>([])
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data } = await supabase
      .from('sha_comments')
      .select('*, articulo:sha_articles(title, slug)')
      .eq('status', estado)
      .order('created_at', { ascending: false })
      .limit(200)
    setComentarios((data ?? []) as typeof comentarios)
    setCargando(false)
  }, [estado])

  useEffect(() => { cargar() }, [cargar])

  async function cambiar(id: string, nuevo: 'approved' | 'rejected') {
    await supabase.from('sha_comments').update({ status: nuevo }).eq('id', id)
    cargar()
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este comentario?')) return
    await supabase.from('sha_comments').delete().eq('id', id)
    cargar()
  }

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Comentarios</h1>
      </div>

      <div className="filtros">
        {TABS.map(t => (
          <button key={t.valor} className={`chip${estado === t.valor ? ' activo' : ''}`} onClick={() => setEstado(t.valor)}>
            {t.texto}
          </button>
        ))}
      </div>

      {cargando && <p className="cargando">Cargando…</p>}
      {!cargando && comentarios.length === 0 && <p className="vacio">Nada por aquí. El silencio también dice.</p>}

      {comentarios.map(c => (
        <div key={c.id} className="comentario-moderacion">
          <div className="comentario-moderacion-cabecera">
            <strong>{c.author_name}</strong>
            {c.author_email && <span className="campo-nota"> · {c.author_email}</span>}
            <time> · {formatDateTime(c.created_at)}</time>
            {c.articulo && <span> · en <em>{c.articulo.title}</em></span>}
          </div>
          <p>{c.body}</p>
          <div className="acciones-fila">
            {estado !== 'approved' && <button className="boton peque" onClick={() => cambiar(c.id, 'approved')}>Aprobar</button>}
            {estado !== 'rejected' && <button className="boton peque" onClick={() => cambiar(c.id, 'rejected')}>Rechazar</button>}
            <button className="enlace-accion peligro" onClick={() => eliminar(c.id)}>Eliminar</button>
          </div>
        </div>
      ))}
    </div>
  )
}
