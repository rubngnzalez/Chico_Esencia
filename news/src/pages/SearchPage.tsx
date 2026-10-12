import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ArticleCard from '../components/ArticleCard'
import { queryArticles } from '../lib/queries'
import { setSeo } from '../lib/seo'
import type { Article } from '../lib/types'

export default function SearchPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [resultados, setResultados] = useState<Article[]>([])
  const [buscando, setBuscando] = useState(false)
  const [buscado, setBuscado] = useState(false)

  useEffect(() => { setSeo({ title: 'Búsqueda' }) }, [])

  async function buscar(valor: string) {
    const term = valor.trim()
    if (!term) return
    setBuscando(true)
    setBuscado(true)
    setParams({ q: term })
    const res = await queryArticles({ search: term, limit: 24 })
    setResultados(res)
    setBuscando(false)
  }

  useEffect(() => {
    const inicial = params.get('q')
    if (inicial) buscar(inicial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="seccion">
      <div className="contenedor">
        <header className="cabecera-categoria">
          <span className="etiqueta">Buscar</span>
          <h1 className="titulo">¿Qué buscas por dentro?</h1>
        </header>
        <form
          className="formulario-busqueda"
          onSubmit={e => { e.preventDefault(); buscar(q) }}
        >
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="presencia, ritual, alquimia…"
            autoFocus
          />
          <button className="boton lleno" type="submit">Buscar</button>
        </form>

        {buscando && <p className="cargando">Recorriendo el umbral…</p>}
        {buscado && !buscando && resultados.length === 0 && (
          <p className="vacio">Sin resultados. Prueba con otras palabras.</p>
        )}
        <div className="rejilla rejilla-3">
          {resultados.map(a => <ArticleCard key={a.id} article={a} />)}
        </div>
      </div>
    </div>
  )
}
