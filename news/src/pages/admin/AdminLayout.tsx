import { useEffect } from 'react'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/store'

const enlacesStaff = [
  { to: '/admin', texto: 'Panel', fin: true },
  { to: '/admin/articulos', texto: 'Artículos' },
  { to: '/admin/importador', texto: 'Importador', staff: true },
  { to: '/admin/widgets', texto: 'Widgets', staff: true },
  { to: '/admin/comentarios', texto: 'Comentarios', staff: true },
  { to: '/admin/categorias', texto: 'Categorías', staff: true },
  { to: '/admin/colaboradores', texto: 'Colaboradores', super: true },
  { to: '/admin/ajustes', texto: 'Ajustes', super: true }
]

export default function AdminLayout() {
  const { session, profile, loading, isStaff, isSuperadmin, signOut } = useAuth()
  const location = useLocation()

  useEffect(() => {
    document.title = 'Panel · SHADDAI El Umbral'
  }, [])

  if (loading) {
    return <div className="admin-carga">Abriendo el panel…</div>
  }
  if (!session) {
    return <Navigate to="/admin/login" state={{ from: location.pathname }} replace />
  }

  return (
    <div className="admin">
      <aside className="admin-sidebar">
        <Link to="/admin" className="admin-marca">
          <span className="shin">ש</span>
          <span>SHADDAI<small>Panel del Diario</small></span>
        </Link>
        <nav>
          {enlacesStaff
            .filter(e => (!e.super || isSuperadmin) && (!e.staff || isStaff))
            .map(e => (
              <NavLink key={e.to} to={e.to} end={e.fin} className={({ isActive }) => isActive ? 'activa' : ''}>
                {e.texto}
              </NavLink>
            ))}
        </nav>
        <div className="admin-sidebar-pie">
          <Link to="/" className="admin-ver-blog">← Ver el diario</Link>
          <button onClick={() => signOut()} className="admin-salir">Cerrar sesión</button>
        </div>
      </aside>
      <div className="admin-contenido">
        <header className="admin-topbar">
          <span className={`rol-badge rol-${profile?.role}`}>{profile?.role}</span>
          <span className="admin-usuario">{profile?.display_name || profile?.email}</span>
        </header>
        <div className="admin-vista">
          {!isStaff && (
            <div className="aviso-rol">
              Eres <strong>colaborador</strong>: puedes escribir y enviar tus borradores a revisión.
              Un editor los publicará tras revisarlos.
            </div>
          )}
          <Outlet />
        </div>
      </div>
    </div>
  )
}
