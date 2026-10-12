import { useCallback, useState, useSyncExternalStore } from 'react'

const KEY = 'sha_favoritos'

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function write(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify(ids))
}

const listeners = new Set<() => void>()
let snapshot = read()

function emit() {
  snapshot = read()
  listeners.forEach(l => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function toggleFavorite(articleId: string): boolean {
  const ids = read()
  const now = ids.includes(articleId)
  write(now ? ids.filter(i => i !== articleId) : [...ids, articleId])
  emit()
  return !now
}

export function useFavorites() {
  const ids = useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
  const has = useCallback((id: string) => ids.includes(id), [ids])
  return { ids, has, toggle: toggleFavorite }
}
