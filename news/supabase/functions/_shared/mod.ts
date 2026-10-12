export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

export function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status)
}

export function serviceAdmin(): { url: string; key: string } {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_KEY') ?? ''
  if (!url || !key) throw new Error('SUPABASE_URL o SERVICE_KEY no configuradas')
  return { url, key }
}

export function tableUrl(path: string): string {
  return `${serviceAdmin().url}/rest/v1/${path}`
}

export async function restFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { key } = serviceAdmin()
  return fetch(tableUrl(path), {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
}

/** Comprueba que la petición viene de un usuario autenticado con rol staff. */
export async function requireStaff(req: Request): Promise<{ profileId: string } | Response> {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return errorJson('Falta el token de autenticación', 401)

  const { key } = serviceAdmin()
  const userRes = await fetch(`${serviceAdmin().url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` }
  })
  if (!userRes.ok) return errorJson('Token inválido', 401)
  const { id } = await userRes.json() as { id: string }

  const profRes = await restFetch(`sha_profiles?id=eq.${id}&select=id,role,active`)
  const profiles = await profRes.json() as { id: string; role: string; active: boolean }[]
  const profile = profiles[0]
  if (!profile || !profile.active || !['superadmin', 'admin'].includes(profile.role)) {
    return errorJson('Sólo personal del diario puede usar esta operación', 403)
  }
  return { profileId: profile.id }
}
