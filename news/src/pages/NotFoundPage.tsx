import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="seccion centrar">
      <div className="contenedor">
        <span className="sello-404">ש</span>
        <h1 className="titulo">Esta página se ha desvanecido</h1>
        <p className="texto-grande">El umbral que buscas no está aquí. Inhala, exhala, y vuelve al origen.</p>
        <div className="acciones" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link className="boton lleno" to="/">Volver al diario</Link>
          <a className="boton" href="/">Ir a Esencias</a>
        </div>
      </div>
    </div>
  )
}
