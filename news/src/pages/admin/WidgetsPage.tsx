import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Widget, WidgetType, WidgetZone } from '../../lib/types'
import { randomId } from '../../lib/utils'

const ZONAS: { valor: WidgetZone; texto: string }[] = [
  { valor: 'home_sidebar', texto: 'Portada — barra lateral' },
  { valor: 'home_hero', texto: 'Portada — banda superior' },
  { valor: 'article_sidebar', texto: 'Artículo — barra lateral' },
  { valor: 'footer', texto: 'Pie de página' }
]

const TIPOS: { valor: WidgetType; texto: string }[] = [
  { valor: 'html', texto: 'Texto / HTML libre' },
  { valor: 'links', texto: 'Lista de enlaces' },
  { valor: 'video', texto: 'Vídeo (YouTube / Vimeo)' },
  { valor: 'ad', texto: 'Publicidad (imagen + enlace)' },
  { valor: 'quote', texto: 'Cita rotatoria' },
  { valor: 'social_follow', texto: 'Síguenos en redes' },
  { valor: 'featured', texto: 'Artículos destacados' },
  { valor: 'newsletter', texto: 'Suscripción' }
]

interface Borrador {
  id?: string
  zone: WidgetZone
  type: WidgetType
  title: string
  content: Record<string, unknown>
  active: boolean
  position: number
  starts_at: string
  ends_at: string
}

const VACIO = (zone: WidgetZone): Borrador => ({
  zone, type: 'html', title: '', content: {}, active: true, position: 99, starts_at: '', ends_at: ''
})

function aBorrador(w: Widget): Borrador {
  return {
    id: w.id, zone: w.zone, type: w.type, title: w.title ?? '', content: w.content ?? {},
    active: w.active, position: w.position,
    starts_at: w.starts_at ? w.starts_at.slice(0, 16) : '',
    ends_at: w.ends_at ? w.ends_at.slice(0, 16) : ''
  }
}

function WidgetForm({ borrador, setBorrador }: { borrador: Borrador; setBorrador: (b: Borrador) => void }) {
  const c = borrador.content
  const setContenido = (cambios: Record<string, unknown>) =>
    setBorrador({ ...borrador, content: { ...borrador.content, ...cambios } })

  const items = (c.items as { label: string; url: string }[] | undefined) ?? []
  const quotes = (c.quotes as string[] | undefined) ?? []

  switch (borrador.type) {
    case 'html':
      return (
        <label className="campo">Contenido HTML
          <textarea rows={6} value={String(c.html ?? '')} onChange={e => setContenido({ html: e.target.value })} />
        </label>
      )
    case 'links':
      return (
        <div className="campo">
          Enlaces
          {items.map((item, i) => (
            <div className="fila" key={i}>
              <input placeholder="Texto" value={item.label}
                onChange={e => { const n = [...items]; n[i] = { ...item, label: e.target.value }; setContenido({ items: n }) }} />
              <input placeholder="https://…" value={item.url}
                onChange={e => { const n = [...items]; n[i] = { ...item, url: e.target.value }; setContenido({ items: n }) }} />
              <button type="button" className="enlace-accion peligro"
                onClick={() => setContenido({ items: items.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button type="button" className="enlace-accion"
            onClick={() => setContenido({ items: [...items, { label: '', url: '' }] })}>+ Añadir enlace</button>
        </div>
      )
    case 'video':
      return (
        <label className="campo">URL del vídeo
          <input value={String(c.url ?? '')} onChange={e => setContenido({ url: e.target.value })} placeholder="https://youtube.com/watch?v=…" />
        </label>
      )
    case 'ad':
      return (
        <>
          <label className="campo">Imagen (URL)
            <input value={String(c.image_url ?? '')} onChange={e => setContenido({ image_url: e.target.value })} />
          </label>
          <label className="campo">Enlace destino
            <input value={String(c.url ?? '')} onChange={e => setContenido({ url: e.target.value })} />
          </label>
          <label className="campo">Texto
            <textarea rows={2} value={String(c.text ?? '')} onChange={e => setContenido({ text: e.target.value })} />
          </label>
          <label className="campo">Botón
            <input value={String(c.button_label ?? '')} onChange={e => setContenido({ button_label: e.target.value })} />
          </label>
        </>
      )
    case 'quote':
      return (
        <label className="campo">Citas (una por línea)
          <textarea rows={4} value={quotes.join('\n')}
            onChange={e => setContenido({ quotes: e.target.value.split('\n').filter(Boolean) })} />
        </label>
      )
    case 'featured':
      return (
        <label className="campo">Cuántos artículos mostrar
          <input type="number" min={1} max={8} value={Number(c.limit ?? 4)}
            onChange={e => setContenido({ limit: Number(e.target.value) })} />
        </label>
      )
    case 'newsletter':
      return (
        <label className="campo">Texto de acompañamiento
          <textarea rows={2} value={String(c.text ?? '')} onChange={e => setContenido({ text: e.target.value })} />
        </label>
      )
    default:
      return <p className="campo-nota">Este widget usa los enlaces de redes definidos en Ajustes.</p>
  }
}

export default function WidgetsPage() {
  const [zona, setZona] = useState<WidgetZone>('home_sidebar')
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from('sha_widgets').select('*').eq('zone', zona).order('position')
    setWidgets((data ?? []) as Widget[])
  }, [zona])

  useEffect(() => { setBorrador(null); cargar() }, [cargar])

  async function guardar() {
    if (!borrador) return
    const payload = {
      zone: borrador.zone,
      type: borrador.type,
      title: borrador.title || null,
      content: borrador.content,
      active: borrador.active,
      position: borrador.position,
      starts_at: borrador.starts_at ? new Date(borrador.starts_at).toISOString() : null,
      ends_at: borrador.ends_at ? new Date(borrador.ends_at).toISOString() : null
    }
    const { error } = borrador.id
      ? await supabase.from('sha_widgets').update(payload).eq('id', borrador.id)
      : await supabase.from('sha_widgets').insert(payload)
    if (error) { setMensaje(`Error: ${error.message}`); return }
    setMensaje('Widget guardado.')
    setBorrador(null)
    cargar()
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar este widget?')) return
    await supabase.from('sha_widgets').delete().eq('id', id)
    cargar()
  }

  async function alternarActivo(w: Widget) {
    await supabase.from('sha_widgets').update({ active: !w.active }).eq('id', w.id)
    cargar()
  }

  async function mover(w: Widget, delta: number) {
    const i = widgets.findIndex(x => x.id === w.id)
    const j = i + delta
    if (j < 0 || j >= widgets.length) return
    await supabase.from('sha_widgets').update({ position: widgets[j].position }).eq('id', w.id)
    await supabase.from('sha_widgets').update({ position: widgets[i].position }).eq('id', widgets[j].id)
    cargar()
  }

  const tipoTexto = (t: WidgetType) => TIPOS.find(x => x.valor === t)?.texto ?? t

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Widgets</h1>
        <button className="boton lleno" onClick={() => setBorrador(VACIO(zona))}>+ Nuevo widget</button>
      </div>

      <div className="filtros">
        {ZONAS.map(z => (
          <button
            key={z.valor}
            className={`chip${zona === z.valor ? ' activo' : ''}`}
            onClick={() => setZona(z.valor)}
          >
            {z.texto}
          </button>
        ))}
      </div>

      {mensaje && <p className="login-ok">{mensaje}</p>}

      {borrador && (
        <div className="panel-seccion widget-editor">
          <h2>{borrador.id ? 'Editar widget' : 'Nuevo widget'}</h2>
          <div className="editor-grid">
            <div>
              <label className="campo">Título (opcional)
                <input value={borrador.title} onChange={e => setBorrador({ ...borrador, title: e.target.value })} />
              </label>
              {!borrador.id && (
                <label className="campo">Tipo
                  <select value={borrador.type} onChange={e => setBorrador({ ...borrador, type: e.target.value as WidgetType })}>
                    {TIPOS.map(t => <option key={t.valor} value={t.valor}>{t.texto}</option>)}
                  </select>
                </label>
              )}
              <WidgetForm borrador={borrador} setBorrador={setBorrador} />
              {borrador.type === 'ad' && (
                <div className="fila">
                  <label className="campo">Visible desde
                    <input type="datetime-local" value={borrador.starts_at} onChange={e => setBorrador({ ...borrador, starts_at: e.target.value })} />
                  </label>
                  <label className="campo">Hasta
                    <input type="datetime-local" value={borrador.ends_at} onChange={e => setBorrador({ ...borrador, ends_at: e.target.value })} />
                  </label>
                </div>
              )}
            </div>
            <div>
              <label className="campo-casilla">
                <input type="checkbox" checked={borrador.active} onChange={e => setBorrador({ ...borrador, active: e.target.checked })} />
                Activo
              </label>
              <div className="acciones-fila">
                <button className="boton lleno" onClick={guardar}>Guardar widget</button>
                <button className="boton peque" onClick={() => setBorrador(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <table className="tabla">
        <thead><tr><th>Título</th><th>Tipo</th><th>Orden</th><th>Activo</th><th>Acciones</th></tr></thead>
        <tbody>
          {widgets.map((w, i) => (
            <tr key={w.id}>
              <td>{w.title ?? <em>sin título</em>}</td>
              <td>{tipoTexto(w.type)}</td>
              <td>
                <button className="enlace-accion" disabled={i === 0} onClick={() => mover(w, -1)}>↑</button>
                <button className="enlace-accion" disabled={i === widgets.length - 1} onClick={() => mover(w, 1)}>↓</button>
              </td>
              <td>
                <button className={`chip${w.active ? ' activo' : ''}`} onClick={() => alternarActivo(w)}>
                  {w.active ? 'Sí' : 'No'}
                </button>
              </td>
              <td className="acciones-tabla">
                <button className="enlace-accion" onClick={() => setBorrador(aBorrador(w))}>Editar</button>
                <button className="enlace-accion peligro" onClick={() => eliminar(w.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
          {widgets.length === 0 && <tr><td colSpan={5}><p className="vacio">Sin widgets en esta zona.</p></td></tr>}
        </tbody>
      </table>
    </div>
  )
}
