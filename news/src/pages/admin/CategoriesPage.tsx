import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Category } from '../../lib/types'
import { slugify } from '../../lib/utils'

export default function CategoriesPage() {
  const [categorias, setCategorias] = useState<Category[]>([])
  const [nueva, setNueva] = useState({ name: '', description: '' })
  const [mensaje, setMensaje] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('sha_categories').select('*').order('position')
    setCategorias((data ?? []) as Category[])
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function guardar(c: Category) {
    const { error } = await supabase.from('sha_categories').update({
      name: c.name, description: c.description, position: c.position, active: c.active
    }).eq('id', c.id)
    if (error) setMensaje(`Error: ${error.message}`)
    else { setMensaje('Categoría guardada.'); cargar() }
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault()
    if (!nueva.name.trim()) return
    const { error } = await supabase.from('sha_categories').insert({
      name: nueva.name.trim(),
      slug: slugify(nueva.name),
      description: nueva.description.trim() || null,
      position: categorias.length + 1
    })
    if (error) { setMensaje(`Error: ${error.message}`); return }
    setNueva({ name: '', description: '' })
    setMensaje('Categoría creada.')
    cargar()
  }

  async function eliminar(c: Category) {
    if (!confirm(`¿Eliminar la categoría «${c.name}»? Los artículos quedarán sin categoría.`)) return
    await supabase.from('sha_categories').delete().eq('id', c.id)
    cargar()
  }

  function actualizar(id: string, cambios: Partial<Category>) {
    setCategorias(prev => prev.map(c => c.id === id ? { ...c, ...cambios } : c))
  }

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Categorías</h1>
      </div>
      {mensaje && <p className={mensaje.startsWith('Error') ? 'login-error' : 'login-ok'}>{mensaje}</p>}

      <form className="importador-forma" onSubmit={crear}>
        <input value={nueva.name} onChange={e => setNueva({ ...nueva, name: e.target.value })} placeholder="Nombre de la categoría" />
        <input value={nueva.description} onChange={e => setNueva({ ...nueva, description: e.target.value })} placeholder="Descripción (opcional)" />
        <button className="boton lleno">Crear</button>
      </form>

      <table className="tabla">
        <thead><tr><th>Nombre</th><th>Slug</th><th>Descripción</th><th>Orden</th><th>Activa</th><th>Acciones</th></tr></thead>
        <tbody>
          {categorias.map(c => (
            <tr key={c.id}>
              <td><input value={c.name} onChange={e => actualizar(c.id, { name: e.target.value })} /></td>
              <td><code>{c.slug}</code></td>
              <td><input value={c.description ?? ''} onChange={e => actualizar(c.id, { description: e.target.value })} /></td>
              <td>
                <input
                  type="number" style={{ width: '4.5rem' }} value={c.position}
                  onChange={e => actualizar(c.id, { position: Number(e.target.value) })}
                />
              </td>
              <td>
                <button className={`chip${c.active ? ' activo' : ''}`} onClick={() => actualizar(c.id, { active: !c.active })}>
                  {c.active ? 'Sí' : 'No'}
                </button>
              </td>
              <td className="acciones-tabla">
                <button className="enlace-accion" onClick={() => guardar(c)}>Guardar</button>
                <button className="enlace-accion peligro" onClick={() => eliminar(c)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
