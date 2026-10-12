import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { setSeo } from '../lib/seo'

export default function ManifiestoPage() {
  useEffect(() => { setSeo({ title: 'Manifiesto — Que nos busquen por dentro' }) }, [])
  return (
    <div className="seccion">
      <div className="contenedor contenedor-estrecho manifiesto">
        <span className="etiqueta">Manifiesto del Diario</span>
        <h1 className="titulo">Que nos <span className="oro">busquen por dentro</span></h1>
        <div className="prose">
          <p className="texto-grande">
            Vivimos conduciendo en piloto automático. El mundo llama a la puerta del ruido,
            y nosotros respondemos corriendo. Este diario nace para lo contrario:
            para que nos <em>busquen por dentro</em>.
          </p>
          <p>
            SHADDAI, Esencia de Umbral, se sostiene sobre un principio de acción sencillo y profundo:
            el olfato es el único sentido con línea directa al sistema límbico, la sede de la memoria
            y la emoción. Cada inhalación es un atajo al presente; cada exhalación, una puerta que se
            cierra al ruido. No vendemos un aroma: proponemos una pausa líquida que ancla.
          </p>
          <p>
            Aquí escribimos sobre eso: presencia, alquimia, ritual y todo lo que florece cuando alguien
            se atreve a habitar su instante. Compartimos ensayos, prácticas, lecturas de interés y voces
            de la comunidad. Y siempre, al final de cada artículo, un micro-ritual de sesenta segundos
            para volver a uno mismo.
          </p>
          <blockquote>Inhala el presente. Exhala el ruido.</blockquote>
        </div>
        <div className="acciones-manifiesto">
          <Link className="boton lleno" to="/">Leer el diario</Link>
          <a className="boton" href="https://omshaddai.com/" target="_blank" rel="noreferrer">Descubrir Esencias</a>
        </div>
        <p className="micro-ritual">
          <strong>Micro-ritual de ahora:</strong> tres respiraciones. Inhala cuatro tiempos, sostén cuatro,
          exhala ocho. Al terminar, nota dónde están tus pies. Eso es todo. Ya estás aquí.
        </p>
      </div>
    </div>
  )
}
