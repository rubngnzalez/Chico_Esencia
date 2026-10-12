import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const envTxt = readFileSync(resolve(aqui, '../.env'), 'utf8')
const env = Object.fromEntries(
  envTxt.split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
  })
)

const URL_BASE = env.SUPABASE_URL
const SERVICE = env.SUPABASE_SERVICE_KEY
const EMAIL = 'superadmin@omshaddai.com'
const PASSWORD = 'Lince2024**'

if (!URL_BASE || !SERVICE) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en news/.env')
  process.exit(1)
}

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' }

async function main() {
  const crear = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true })
  })
  if (crear.ok) {
    console.log(`Usuario ${EMAIL} creado. Contraseña provisional aplicada.`)
  } else if (crear.status === 422) {
    console.log('El usuario ya existía. Restableciendo contraseña…')
    const lista = await fetch(`${URL_BASE}/auth/v1/admin/users?per_page=200`, { headers: H })
    const datos = await lista.json()
    const usuario = (datos.users ?? []).find(u => (u.email ?? '').toLowerCase() === EMAIL)
    if (!usuario) { console.error('No se encontró el usuario existente.'); process.exit(2) }
    const reset = await fetch(`${URL_BASE}/auth/v1/admin/users/${usuario.id}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ password: PASSWORD, email_confirm: true })
    })
    if (!reset.ok) { console.error('No se pudo restablecer la contraseña:', await reset.text()); process.exit(3) }
    console.log('Contraseña restablecida.')
    var userId = usuario.id
  } else {
    console.error('Error creando el usuario:', crear.status, await crear.text())
    process.exit(4)
  }

  if (!userId) {
    const lista = await fetch(`${URL_BASE}/auth/v1/admin/users?per_page=200`, { headers: H })
    const datos = await lista.json()
    const usuario = (datos.users ?? []).find(u => (u.email ?? '').toLowerCase() === EMAIL)
    userId = usuario?.id
  }

  const patch = await fetch(`${URL_BASE}/rest/v1/sha_profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: H,
    body: JSON.stringify({ role: 'superadmin', active: true })
  })
  if (!patch.ok) { console.error('No se pudo asignar el rol:', await patch.text()); process.exit(5) }
  console.log(`Rol superadmin asignado a ${EMAIL}. Listo para entrar en /news/admin.`)
}

main()
