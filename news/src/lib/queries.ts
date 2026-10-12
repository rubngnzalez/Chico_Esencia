import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Article, Author, Category } from './types'

const PUB = 'published'

// Nota: los autores se resuelven aparte vía la vista pública (sin exponer email/rol).
export async function fetchAuthorsMap(authorIds: string[]): Promise<Record<string, Author>> {
  if (!authorIds.length) return {}
  const { data } = await supabase
    .from('sha_public_authors')
    .select('*')
    .in('id', authorIds)
  const map: Record<string, Author> = {}
  for (const a of (data ?? []) as Author[]) map[a.id] = a
  return map
}

export interface ArticleQuery {
  categorySlug?: string
  search?: string
  featuredOnly?: boolean
  limit?: number
  offset?: number
  ids?: string[]
  excludeId?: string
}

export async function queryArticles(q: ArticleQuery = {}): Promise<Article[]> {
  let builder = supabase
    .from('sha_articles')
    .select('*, category:sha_categories(id, slug, name)')
    .eq('status', PUB)
    .order('published_at', { ascending: false })
    .range(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 12) - 1)

  if (q.categorySlug) builder = builder.eq('category.slug', q.categorySlug)
  if (q.featuredOnly) builder = builder.eq('featured', true)
  if (q.ids) builder = builder.in('id', q.ids)
  if (q.excludeId) builder = builder.neq('id', q.excludeId)
  if (q.search) {
    const term = `%${q.search.replace(/[%_,()]/g, ' ')}%`
    builder = builder.or(`title.ilike.${term},excerpt.ilike.${term},content.ilike.${term}`)
  }

  const { data, error } = await builder
  if (error) { console.error(error); return [] }
  const articles = (data ?? []) as unknown as Article[]

  const authorIds = [...new Set(articles.map(a => a.author_id).filter(Boolean) as string[])]
  const authors = await fetchAuthorsMap(authorIds)
  for (const a of articles) a.author = a.author_id ? authors[a.author_id] ?? null : null
  return articles
}

export async function fetchArticleBySlug(slug: string): Promise<Article | null> {
  const { data, error } = await supabase
    .from('sha_articles')
    .select('*, category:sha_categories(id, slug, name)')
    .eq('slug', slug)
    .eq('status', PUB)
    .maybeSingle()
  if (error || !data) return null
  const article = data as unknown as Article
  if (article.author_id) {
    const authors = await fetchAuthorsMap([article.author_id])
    article.author = authors[article.author_id] ?? null
  }
  return article
}

export async function fetchCategories(): Promise<Category[]> {
  const { data } = await supabase
    .from('sha_categories')
    .select('*')
    .eq('active', true)
    .order('position')
  return (data ?? []) as Category[]
}

let categoriesCache: Category[] | null = null
export async function fetchCategoriesCached(): Promise<Category[]> {
  if (!categoriesCache) categoriesCache = await fetchCategories()
  return categoriesCache
}
