import { corsHeaders, errorJson, json, requireStaff, serviceAdmin } from '../_shared/mod.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const staff = await requireStaff(req)
  if (staff instanceof Response) return staff

  const { url } = await req.json()
  const pasos: Record<string, string> = {}
  const imagen: string = url

  try {
    const r1 = await fetch(imagen, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SHADDAIUmbralBot/1.0)' }, signal: AbortSignal.timeout(15000) })
    pasos.directo = `status=${r1.status} tipo=${r1.headers.get('content-type')} len=${r1.headers.get('content-length')}`
    if (r1.ok) {
      const buf = await r1.arrayBuffer()
      pasos.directoBuf = `${buf.byteLength} bytes`
    }
  } catch (e) {
    pasos.directo = `EXCEPCIÓN: ${(e as Error).message}`
  }

  try {
    const weserv = `https://images.weserv.nl/?url=${encodeURIComponent(imagen)}&n=-1`
    const r2 = await fetch(weserv, { signal: AbortSignal.timeout(15000) })
    pasos.weserv = `status=${r2.status} tipo=${r2.headers.get('content-type')}`
    if (r2.ok) {
      const buf = await r2.arrayBuffer()
      pasos.weservBuf = `${buf.byteLength} bytes`
      const { url: base, key } = serviceAdmin()
      const up = await fetch(`${base}/storage/v1/object/sha-blog/importados/debug-${Date.now()}.jpg`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/jpeg' },
        body: buf
      })
      pasos.subida = `status=${up.status}${up.ok ? '' : ' ' + (await up.text()).slice(0, 200)}`
    }
  } catch (e) {
    pasos.weserv = `EXCEPCIÓN: ${(e as Error).message}`
  }

  return json({ pasos })
})
