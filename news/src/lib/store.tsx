import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile, SiteSettings, SocialLinks } from './types'

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  isStaff: boolean
  isSuperadmin: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  isStaff: false,
  isSuperadmin: false,
  refreshProfile: async () => {},
  signOut: async () => {}
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) { setProfile(null); return }
    const { data } = await supabase.from('sha_profiles').select('*').eq('id', userId).maybeSingle()
    setProfile((data as Profile) ?? null)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      loadProfile(data.session?.user.id).finally(() => setLoading(false))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      loadProfile(newSession?.user.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user.id)
  }, [loadProfile, session])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    loading,
    isStaff: !!profile && (profile.role === 'superadmin' || profile.role === 'admin') && profile.active,
    isSuperadmin: !!profile && profile.role === 'superadmin' && profile.active,
    refreshProfile,
    signOut
  }), [session, profile, loading, refreshProfile, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

// ---------- Ajustes del sitio ----------

export interface SiteData {
  site: SiteSettings
  social: SocialLinks
}

const FALLBACK: SiteData = {
  site: {
    title: 'SHADDAI · El Umbral — Diario',
    tagline: 'Que nos busquen por dentro',
    description: 'Diario de SHADDAI, Esencia de Umbral: presencia, alquimia y ritual.',
    esencias_url: 'https://omshaddai.com/'
  },
  social: { facebook: '', instagram: '', x: '', youtube: '', email: 'hola@omshaddai.com' }
}

export function useSiteData() {
  const [data, setData] = useState<SiteData>(FALLBACK)
  useEffect(() => {
    supabase.from('sha_settings').select('key, value').in('key', ['site', 'social_links'])
      .then(({ data: rows }) => {
        if (!rows) return
        setData(current => {
          const next = { ...current }
          for (const row of rows) {
            if (row.key === 'site') next.site = { ...next.site, ...(row.value as Partial<SiteSettings>) }
            if (row.key === 'social_links') next.social = { ...next.social, ...(row.value as Partial<SocialLinks>) }
          }
          return next
        })
      })
  }, [])
  return data
}
