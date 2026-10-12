import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'
import type { Profile, Role } from '../../lib/types'

const ROLES: { valor: Role; texto: string }[] = [
  { valor: 'colaborador', texto: 'Colaborador (borradores propios)' },
  { valor: 'admin', texto: 'Editor (gestiona todo el contenido)' },
  { valor: 'superadmin', texto: 'Superadmin (control total)' }
]

export default function UsersPage() {
  const { session } = useAuth()
  const [perfiles, setPerfiles] = useState<Profile[]>([])
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [nuevo, setNuevo] = useState({ email: '', password: '', display_name: '', role: 'colaborador' as Role })

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('sha_profiles').select('*').order('created_at')
    setPerfiles((data ?? []) as Profile[])
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function crearColaborador(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMensaje(null)
    if (!session) return
    setCreando(true)
    const sesionAdmin = (await supabase.auth.getSession()).data.session

    const { data, error: errSignUp } = await supabase.auth.signUp({
      email: nuevo.email.trim(),
      password: nuevo.password
    })
    const nuevoUsuario = data?.user
    if (errSignUp || !nuevoUsuario) {
      setError(errSignUp?.message ?? 'No se pudo crear el usuario.')
      if (sesionAdmin) await supabase.auth.setSession({ access_token: sesionAdmin.access_token, refresh_token: sesionAdmin.refresh_token })
      setCreando(false)
      return
    }
    if (!data.session && nuevoUsuario) {
      setError('Ese email ya tiene cuenta. Usa otro o pide restablecer su contraseña.')
      if (sesionAdmin) await supabase.auth.setSession({ access_token: sesionAdmin.access_token, refresh_token: sesionAdmin.refresh_token })
      setCreando(false)
      return
    }
    // Restaurar la sesión del administrador antes de tocar el rol (lo protege el trigger)
    if (sesionAdmin) await supabase.auth.setSession({ access_token: sesionAdmin.access_token, refresh_token: sesionAdmin.refresh_token })

    const { error: errPerfil } = await supabase.from('sha_profiles').update({
      role: nuevo.role,
      display_name: nuevo.display_name.trim() || nuevo.email.split('@')[0]
    }).eq('id', nuevoUsuario.id)

    setCreando(false)
    if (errPerfil) { setError(`Usuario creado, pero no se pudo asignar el rol: ${errPerfil.message}`); return }
    setMensaje(`Cuenta creada para ${nuevo.email} con rol ${nuevo.role}.`)
    setNuevo({ email: '', password: '', display_name: '', role: 'colaborador' })
    await supabase.auth.refreshSession()
    cargar()
  }

  async function cambiarRol(p: Profile, role: Role) {
    const { error: err } = await supabase.from('sha_profiles').update({ role }).eq('id', p.id)
    if (err) { setError(`No se pudo cambiar el rol: ${err.message}`); return }
    setError(null)
    setMensaje(`Rol de ${p.email} actualizado.`)
    cargar()
  }

  async function alternarActivo(p: Profile) {
    const { error: err } = await supabase.from('sha_profiles').update({ active: !p.active }).eq('id', p.id)
    if (err) { setError(`No se pudo cambiar el estado: ${err.message}`); return }
    setError(null)
    cargar()
  }

  async function guardarFicha(p: Profile) {
    const { error: err } = await supabase.from('sha_profiles').update({
      display_name: p.display_name, bio: p.bio, avatar_url: p.avatar_url
    }).eq('id', p.id)
    if (err) { setError(`No se pudo guardar la ficha: ${err.message}`); return }
    setError(null)
    setMensaje(`Ficha de ${p.email} guardada.`)
    cargar()
  }

  function actualizarFila(id: string, cambios: Partial<Profile>) {
    setPerfiles(prev => prev.map(p => p.id === id ? { ...p, ...cambios } : p))
  }

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Colaboradores y administradores</h1>
      </div>
      {mensaje && <p className="login-ok">{mensaje}</p>}
      {error && <p className="login-error">{error}</p>}

      <form className="panel-seccion crear-usuario" onSubmit={crearColaborador}>
        <h2>Dar acceso a una nueva persona</h2>
        <div className="editor-grid">
          <div>
            <label className="campo">Email
              <input type="email" required value={nuevo.email} onChange={e => setNuevo({ ...nuevo, email: e.target.value })} />
            </label>
            <label className="campo">Contraseña provisional
              <input type="text" required minLength={8} value={nuevo.password} onChange={e => setNuevo({ ...nuevo, password: e.target.value })} placeholder="mínimo 8 caracteres" />
            </label>
          </div>
          <div>
            <label className="campo">Nombre visible
              <input value={nuevo.display_name} onChange={e => setNuevo({ ...nuevo, display_name: e.target.value })} />
            </label>
            <label className="campo">Rol
              <select value={nuevo.role} onChange={e => setNuevo({ ...nuevo, role: e.target.value as Role })}>
                {ROLES.map(r => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
              </select>
            </label>
            <button className="boton lleno" disabled={creando}>{creando ? 'Creando…' : 'Crear cuenta'}</button>
          </div>
        </div>
      </form>

      <table className="tabla">
        <thead>
          <tr><th>Email</th><th>Nombre / Bio / Avatar</th><th>Rol</th><th>Activo</th><th /></tr>
        </thead>
        <tbody>
          {perfiles.map(p => (
            <tr key={p.id} className={p.active ? '' : 'fila-inactiva'}>
              <td>{p.email}</td>
              <td className="ficha-usuario">
                <input value={p.display_name ?? ''} placeholder="Nombre" onChange={e => actualizarFila(p.id, { display_name: e.target.value })} />
                <input value={p.bio ?? ''} placeholder="Bio corta" onChange={e => actualizarFila(p.id, { bio: e.target.value })} />
                <input value={p.avatar_url ?? ''} placeholder="URL del avatar" onChange={e => actualizarFila(p.id, { avatar_url: e.target.value })} />
              </td>
              <td>
                <select value={p.role} onChange={e => cambiarRol(p, e.target.value as Role)}>
                  {ROLES.map(r => <option key={r.valor} value={r.valor}>{r.valor}</option>)}
                </select>
              </td>
              <td>
                <button className={`chip${p.active ? ' activo' : ''}`} onClick={() => alternarActivo(p)}>
                  {p.active ? 'Sí' : 'No'}
                </button>
              </td>
              <td><button className="enlace-accion" onClick={() => guardarFicha(p)}>Guardar ficha</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
