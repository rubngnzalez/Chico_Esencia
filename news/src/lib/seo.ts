const SITE = 'SHADDAI · El Umbral'

function upsertMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

export interface SeoInput {
  title: string
  description?: string
  image?: string | null
  url?: string
  type?: string
  author?: string | null
}

export function setSeo(input: SeoInput) {
  const fullTitle = input.title.includes(SITE) ? input.title : `${input.title} — ${SITE}`
  document.title = fullTitle
  const desc = input.description || 'Que nos busquen por dentro. Artículos sobre presencia, alquimia y ritual de SHADDAI.'
  const image = input.image || '/img/shin-logo.png'
  upsertMeta('name', 'description', desc)
  upsertMeta('property', 'og:title', fullTitle)
  upsertMeta('property', 'og:description', desc)
  upsertMeta('property', 'og:type', input.type || 'article')
  upsertMeta('property', 'og:image', image)
  upsertMeta('property', 'og:site_name', SITE)
  if (input.author) upsertMeta('name', 'author', input.author)
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
}
