const SITE = 'SHADDAI · El Umbral'
const SITE_URL = 'https://omshaddai.com'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertJsonLd(data: Record<string, unknown> | Record<string, unknown>[]) {
  let script = document.head.querySelector<HTMLScriptElement>('script[id="sha-ld-json"]')
  if (!script) {
    script = document.createElement('script')
    script.id = 'sha-ld-json'
    script.type = 'application/ld+json'
    document.head.appendChild(script)
  }
  script.textContent = JSON.stringify(data)
}

export interface SeoInput {
  title: string
  description?: string
  image?: string | null
  url?: string
  type?: string
  author?: string | null
  publishedTime?: string | null
  modifiedTime?: string | null
  section?: string | null
  tags?: string[]
  jsonLd?: Record<string, unknown> | Record<string, unknown>[]
}

export function setSeo(input: SeoInput) {
  const fullTitle = input.title.includes(SITE) ? input.title : `${input.title} — ${SITE}`
  document.title = fullTitle
  const desc = input.description || 'Que nos busquen por dentro. Artículos sobre presencia, alquimia y ritual de SHADDAI.'
  const image = input.image || '/img/shin-logo.png'
  const esArticulo = (input.type || 'article') === 'article'

  upsertMeta('name', 'description', desc)
  upsertMeta('name', 'robots', 'index, follow, max-image-preview:large, max-snippet:-1')
  upsertMeta('property', 'og:title', fullTitle)
  upsertMeta('property', 'og:description', desc)
  upsertMeta('property', 'og:type', input.type || 'article')
  upsertMeta('property', 'og:image', image)
  upsertMeta('property', 'og:site_name', SITE)
  upsertMeta('property', 'og:locale', 'es_ES')
  upsertMeta('name', 'twitter:card', 'summary_large_image')
  upsertMeta('name', 'twitter:title', fullTitle)
  upsertMeta('name', 'twitter:description', desc)
  upsertMeta('name', 'twitter:image', image)
  if (input.author) upsertMeta('name', 'author', input.author)
  if (esArticulo && input.publishedTime) upsertMeta('property', 'article:published_time', input.publishedTime)
  if (esArticulo && input.modifiedTime) upsertMeta('property', 'article:modified_time', input.modifiedTime)
  if (esArticulo && input.section) upsertMeta('property', 'article:section', input.section)
  if (esArticulo && input.tags?.length) {
    for (const t of input.tags.slice(0, 8)) upsertMeta('property', 'article:tag', t)
  }
  if (input.url) {
    upsertMeta('property', 'og:url', input.url)
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    link.href = input.url
  }
  if (input.jsonLd) upsertJsonLd(input.jsonLd)
}

export interface DatosArticuloSeo {
  titulo: string
  descripcion: string
  imagen: string
  url: string
  autor: string | null
  publicado: string | null
  modificado: string
  seccion: string | null
  tags: string[]
}

export function jsonLdArticulo(d: DatosArticuloSeo): Record<string, unknown>[] {
  const articulo: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: d.titulo,
    description: d.descripcion,
    image: [d.imagen],
    datePublished: d.publicado ?? undefined,
    dateModified: d.modificado,
    inLanguage: 'es-ES',
    mainEntityOfPage: { '@type': 'WebPage', '@id': d.url },
    author: d.autor
      ? { '@type': 'Person', name: d.autor }
      : { '@type': 'Organization', name: SITE, url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: SITE,
      url: SITE_URL + '/news/',
      logo: { '@type': 'ImageObject', url: SITE_URL + '/img/shin-logo.png' }
    },
    ...(d.seccion ? { articleSection: d.seccion } : {}),
    ...(d.tags.length ? { keywords: d.tags.join(', ') } : {})
  }
  const migas = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Diario', item: SITE_URL + '/news/' },
      ...(d.seccion ? [{ '@type': 'ListItem', position: 2, name: d.seccion }] : []),
      { '@type': 'ListItem', position: d.seccion ? 3 : 2, name: d.titulo, item: d.url }
    ]
  }
  return [articulo, migas]
}

export function jsonLdWebSite(): Record<string, unknown>[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE,
      alternateName: 'SHADDAI',
      url: SITE_URL + '/news/',
      inLanguage: 'es-ES',
      description: 'Diario de SHADDAI, Esencia de Umbral: presencia, alquimia y ritual. Que nos busquen por dentro.',
      publisher: { '@type': 'Organization', name: SITE, url: SITE_URL }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: SITE,
      url: SITE_URL + '/news/',
      logo: SITE_URL + '/img/shin-logo.png',
      sameAs: ['https://omshaddai.com/']
    }
  ]
}
