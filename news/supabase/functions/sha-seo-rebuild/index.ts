import { corsHeaders, errorJson, json, requireStaff } from '../_shared/mod.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorJson('Método no permitido', 405)

  const staff = await requireStaff(req)
  if (staff instanceof Response) return staff

  const pat = Deno.env.get('GITHUB_PAT')
  if (!pat) return errorJson('GITHUB_PAT no configurado', 500)

  const repo = Deno.env.get('GITHUB_REPO') ?? 'rubngnzalez/Chico_Esencia'
  const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ event_type: 'news-rebuild' })
  })
  if (res.status !== 204) {
    return errorJson(`GitHub respondió ${res.status}: ${await res.text()}`, 502)
  }
  return json({ ok: true, disparado: 'news-rebuild' })
})
