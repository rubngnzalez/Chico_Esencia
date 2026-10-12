export type Role = 'superadmin' | 'admin' | 'colaborador'
export type ArticleStatus = 'draft' | 'pending' | 'scheduled' | 'published'
export type Provenance = 'native' | 'imported_copy' | 'imported_ai'
export type WidgetZone = 'home_sidebar' | 'home_hero' | 'article_sidebar' | 'footer'
export type WidgetType = 'html' | 'links' | 'video' | 'ad' | 'quote' | 'social_follow' | 'featured' | 'newsletter'
export type Network = 'facebook' | 'instagram'

export interface Profile {
  id: string
  email: string
  role: Role
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  active: boolean
  created_at: string
}

export interface Author {
  id: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
}

export interface Category {
  id: string
  slug: string
  name: string
  description: string | null
  position: number
  active: boolean
  created_at: string
}

export interface Article {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  cover_image_url: string | null
  status: ArticleStatus
  author_id: string | null
  category_id: string | null
  category?: { id: string; slug: string; name: string } | null
  show_author: boolean
  allow_share: boolean
  allow_comments: boolean
  featured: boolean
  reading_time: number
  views: number
  published_at: string | null
  scheduled_for: string | null
  seo_title: string | null
  seo_description: string | null
  og_image: string | null
  tags: string[]
  provenance: Provenance
  original_author: string | null
  original_source_url: string | null
  original_published_at: string | null
  source_license_note: string | null
  created_at: string
  updated_at: string
  author?: Author | null
}

export interface Comment {
  id: string
  article_id: string
  author_name: string
  author_email: string | null
  body: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

export interface SocialPost {
  id: string
  article_id: string
  network: Network
  external_post_id: string
  permalink: string | null
  published_at: string
  last_synced_at: string | null
}

export interface SocialInteraction {
  id: string
  social_post_id: string
  network: Network
  external_id: string
  type: 'comment' | 'reaction'
  reaction_kind: string | null
  author_name: string | null
  author_url: string | null
  body: string | null
  external_created_at: string | null
  hidden: boolean
  synced_at: string
}

export interface Widget {
  id: string
  zone: WidgetZone
  type: WidgetType
  title: string | null
  content: Record<string, unknown>
  position: number
  active: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

export interface ImportLink {
  id: string
  url: string
  title: string | null
  extracted: Extracted | null
  status: 'pending' | 'copied' | 'generated' | 'dismissed'
  rights_confirmed: boolean
  created_by: string | null
  article_id: string | null
  created_at: string
}

export interface Extracted {
  source_url: string
  title: string | null
  author: string | null
  published_at: string | null
  image: string | null
  tags?: string[]
  text: string
  word_count: number
}

export interface Subscriber {
  id: string
  email: string
  active: boolean
  created_at: string
}

export interface SiteSettings {
  title: string
  tagline: string
  description: string
  esencias_url: string
}

export interface SocialLinks {
  facebook: string
  instagram: string
  x: string
  youtube: string
  email: string
}
