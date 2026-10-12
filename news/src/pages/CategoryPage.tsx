import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import { fetchCategoriesCached, queryArticles } from '../lib/queries'
import { setSeo } from '../lib/seo'
import type { Article, Category } from '../lib/types'

export default function CategoryPage() {
  const { slug = '' } = useParams()
  const [categoria, setCategoria] = useState<Category | null>(null)
  const [articulos, setArticulos] = useState<Article[]>([])
  const [cargando, setCargando] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hayMas, setHayMas] = useState(false)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setArticulos([])
    setOffset(0)
    fetchCategoriesCached().then(cats => {
      const c = cats.find(c => c.slug === slug) ?? null
      if (!vivo) return
      setCategoria(c)
      setSeo({ title: c ? c.name : 'Categoría', description: c?.description ?? undefined })
    })
    queryArticles({ categorySlug: slug, limit: 9, offset: 0 }).then(mas => {
      if (!vivo) return
      setArticulos(mas)
      setHayMas(mas.length >= 9)
      setCargando(false)
    })
    return () => { vivo = false }
  }, [slug])

  async function cargarMas() {
    const siguiente = offset + 9
    const mas = await queryArticles({ categorySlug: slug, limit: 9, offset: siguiente })
    setArticulos(prev => [...prev, ...mas])
    setOffset(siguiente)
    setHayMas(mas.length >= 9)
  }

  return (
    <div className="seccion">
      <div className="contenedor">
        <header className="cabecera-categoria">
          <span className="etiqueta">Categoría</span>
          <h1 className="titulo">{categoria?.name ?? 'Categoría'}</h1>
          {categoria?.description && <p className="texto-grande">{categoria.description}</p>}
        </header>

        {cargando && <p className="cargando">Buscando artículos…</p>}
        {!cargando && articulos.length === 0 && (
          <p className="vacio">Todavía no hay artículos en esta categoría.</p>
        )}
        <div className="rejilla rejilla-3">
          {articulos.map(a => <ArticleCard key={a.id} article={a} />)}
        </div>
        {hayMas && (
          <div className="centrar" style={{ marginTop: '2rem' }}>
            <button className="boton" onClick={cargarMas}>Cargar más</button>
          </div>
        )}
      </div>
    </div>
  )
}
