import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/store'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { session, loading } = useAuth()

  useEffect(() => {
    if (!loading && session) navigate(location.state?.from ?? '/admin', { replace: true })
  }, [session, loading, navigate, location.state])

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setEnviando(false)
    if (err) {
      setError(err.message === 'Invalid login credentials'
        ? 'Credenciales incorrectas. Comprueba email y contraseña.'
        : `No se pudo iniciar sesión: ${err.message}`)
    }
  }

  return (
    <div className="login-fondo">
      <form className="login-caja" onSubmit={entrar}>
        <span className="shin-login">ש</span>
        <h1>SHADDAI · El Umbral</h1>
        <p className="login-subtitulo">Panel de administración del diario</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button className="boton lleno" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar al panel'}
        </button>
        <Link to="/" className="login-volver">← Volver al diario</Link>
      </form>
    </div>
  )
}
