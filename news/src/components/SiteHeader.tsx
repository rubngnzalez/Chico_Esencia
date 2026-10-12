import { useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { fetchCategoriesCached } from '../lib/queries'
import type { Category } from '../lib/types'

export default function SiteHeader() {
  const [categories, setCategories] = useState<Category[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetchCategoriesCached().then(setCategories).catch(() => {})
  }, [])

  return (
    <header className="cabecera">
      <div className="barra">
        <Link to="/" className="marca" onClick={() => setOpen(false)}>
          <span className="shin">ש</span>
          <span className="nombre">
            SHADDAI
            <small>El Umbral · Diario</small>
          </span>
        </Link>
        <button className="menu-boton" aria-label="Abrir menú" onClick={() => setOpen(o => !o)}>☰</button>
        <nav className={`navegacion${open ? ' abierta' : ''}`}>
          <ul>
            {categories.map(c => (
              <li key={c.id}>
                <NavLink to={`/categoria/${c.slug}`} onClick={() => setOpen(false)}>{c.name}</NavLink>
              </li>
            ))}
            <li><NavLink to="/manifiesto" onClick={() => setOpen(false)}>Manifiesto</NavLink></li>
            <li><NavLink to="/busqueda" onClick={() => setOpen(false)}>Buscar</NavLink></li>
            <li>
              <a href="https://omshaddai.com/" className="enlace-esencias" target="_blank" rel="noreferrer">
                Esencias ↗
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  )
}
