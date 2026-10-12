import { Link } from 'react-router-dom'
import { useSiteData } from '../lib/store'
import WidgetRenderer from './WidgetRenderer'

export default function SiteFooter() {
  const { site } = useSiteData()
  return (
    <footer className="pie">
      <div className="contenedor">
        <div className="pie-widgets" data-zone="footer">
          <WidgetRenderer zone="footer" />
        </div>
        <div className="pie-final">
          <span className="shin-mini">ש</span>
          <p>
            {site.title} — <em>{site.tagline}</em>
          </p>
          <nav className="pie-enlaces">
            <Link to="/">Diario</Link>
            <Link to="/manifiesto">Manifiesto</Link>
            <a href={site.esencias_url} target="_blank" rel="noreferrer">Esencias</a>
            <Link to="/admin">Panel</Link>
          </nav>
          <p className="pie-nota">© {new Date().getFullYear()} SHADDAI · Esencia de Umbral</p>
        </div>
      </div>
    </footer>
  )
}
