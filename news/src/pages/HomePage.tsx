import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import WidgetRenderer from '../components/WidgetRenderer'
import { queryArticles } from '../lib/queries'
import { jsonLdWebSite, setSeo } from '../lib/seo'
import { useFavorites } from '../lib/favorites'
import type { Article } from '../lib/types'

export default function HomePage() {
  const [hero, setHero] = useState<Article | null>(null)
  const [articulos, setArticulos] = useState<Article[]>([])
  const [favoritos, setFavoritos] = useState<Article[]>([])
  const [hayMas, setHayMas] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [offset, setOffset] = useState(0)
  const { ids: favIds } = useFavorites()

  useEffect(() => {
    setSeo({ title: 'SHADDAI · El Umbral — Diario', type: 'website', url: location.origin + '/news/', jsonLd: jsonLdWebSite() })
    let vivo = true
    Promise.all([
      queryArticles({ featuredOnly: true, limit: 1 }),
      queryArticles({ limit: 9, offset: 0 }),
      queryArticles({ featuredOnly: true, limit: 2, offset: 1 })
    ]).then(([destacados, ultimos, siguientes]) => {
      if (!vivo) return
      const principal = destacados[0] ?? null
      setHero(principal)
      setArticulos(principal ? siguientes.concat(ultimos.filter(a => a.id !== principal.id)) : ultimos)
      setHayMas(ultimos.length >= 9)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    if (!favIds.length) { setFavoritos([]); return }
    queryArticles({ ids: favIds, limit: 24 }).then(setFavoritos)
  }, [favIds])

  async function cargarMas() {
    const siguiente = offset + 9
    const mas = await queryArticles({ limit: 9, offset: siguiente })
    setArticulos(prev => [...prev, ...mas])
    setOffset(siguiente)
    setHayMas(mas.length >= 9)
  }

  return (
    <div className="home">
      {hero && (
        <section className="hero-editorial">
          <div className="contenedor">
            <span className="etiqueta">Artículo destacado</span>
            <ArticleCard article={hero} grande />
          </div>
        </section>
      )}

      <section className="seccion">
        <div className="contenedor layout-home">
          <div className="columna-principal">
            <h2 className="titulo-seccion">Últimos artículos</h2>
            {cargando && <p className="cargando">Destilando artículos…</p>}
            <div className="rejilla rejilla-2">
              {articulos.map(a => <ArticleCard key={a.id} article={a} />)}
            </div>
            {!cargando && articulos.length === 0 && (
              <p className="vacio">Aún no hay artículos publicados. El umbral se abrirá muy pronto.</p>
            )}
            {hayMas && (
              <div className="centrar" style={{ marginTop: '2rem' }}>
                <button className="boton" onClick={cargarMas}>Leer más artículos</button>
              </div>
            )}

            {favoritos.length > 0 && (
              <div className="bloque-favoritos">
                <h2 className="titulo-seccion">Tus favoritos <span className="corazon-mini">♥</span></h2>
                <div className="rejilla rejilla-2">
                  {favoritos.map(a => <ArticleCard key={a.id} article={a} />)}
                </div>
              </div>
            )}
          </div>

          <aside className="columna-sidebar">
            <WidgetRenderer zone="home_sidebar" />
            <div className="widget widget-esencias">
              <h3 className="widget-titulo">Esencias — la web</h3>
              <p>Descubre el Eau de Parfum Neurosensorial y su principio de acción.</p>
              <a className="boton lleno peque" href="https://omshaddai.com/" target="_blank" rel="noreferrer">Visitar Esencias</a>
            </div>
          </aside>
        </div>
      </section>

      <section className="cita-manifiesto">
        <div className="contenedor centrar">
          <blockquote>“Que nos busquen por dentro”</blockquote>
          <p className="autor">SHADDAI · Esencia de Umbral</p>
          <Link className="boton" to="/manifiesto">Leer el manifiesto</Link>
        </div>
      </section>
    </div>
  )
}
