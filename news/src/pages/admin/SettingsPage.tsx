import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { SocialLinks, SiteSettings } from '../../lib/types'

export default function SettingsPage() {
  const [site, setSite] = useState<SiteSettings>({
    title: '', tagline: '', description: '', esencias_url: 'https://omshaddai.com/'
  })
  const [social, setSocial] = useState<SocialLinks>({ facebook: '', instagram: '', x: '', youtube: '', email: '' })
  const [defaults, setDefaults] = useState({ show_author: true, allow_share: true, allow_comments: true })
  const [glmKey, setGlmKey] = useState('')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    supabase.from('sha_settings').select('key, value').in('key', ['site', 'social_links', 'defaults', 'secret_glm_api_key'])
      .then(({ data }) => {
        for (const row of data ?? []) {
          if (row.key === 'site') setSite(s => ({ ...s, ...(row.value as SiteSettings) }))
          if (row.key === 'social_links') setSocial(s => ({ ...s, ...(row.value as SocialLinks) }))
          if (row.key === 'defaults') setDefaults(d => ({ ...d, ...(row.value as typeof defaults) }))
          if (row.key === 'secret_glm_api_key') setGlmKey(((row.value as { api_key?: string }).api_key) ?? '')
        }
      })
  }, [])

  async function guardar() {
    setGuardando(true)
    setMensaje(null)
    const filas: { key: string; value: unknown }[] = [
      { key: 'site', value: site },
      { key: 'social_links', value: social },
      { key: 'defaults', value: defaults }
    ]
    if (glmKey.trim()) filas.push({ key: 'secret_glm_api_key', value: { api_key: glmKey.trim() } })
    const { error } = await supabase.from('sha_settings').upsert(filas)
    setGuardando(false)
    if (error) { setMensaje(`Error: ${error.message}`); return }
    setMensaje('Ajustes guardados.')
  }

  return (
    <div>
      <div className="dashboard-cabecera">
        <h1>Ajustes del diario</h1>
        <button className="boton lleno" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar todo'}
        </button>
      </div>
      {mensaje && <p className={mensaje.startsWith('Error') ? 'login-error' : 'login-ok'}>{mensaje}</p>}

      <section className="panel-seccion">
        <h2>Identidad</h2>
        <div className="editor-grid">
          <div>
            <label className="campo">Título del diario
              <input value={site.title} onChange={e => setSite({ ...site, title: e.target.value })} />
            </label>
            <label className="campo">Lema
              <input value={site.tagline} onChange={e => setSite({ ...site, tagline: e.target.value })} />
            </label>
          </div>
          <div>
            <label className="campo">Descripción
              <textarea rows={3} value={site.description} onChange={e => setSite({ ...site, description: e.target.value })} />
            </label>
            <label className="campo">URL de Esencias (web actual)
              <input value={site.esencias_url} onChange={e => setSite({ ...site, esencias_url: e.target.value })} />
            </label>
          </div>
        </div>
      </section>

      <section className="panel-seccion">
        <h2>Redes sociales («síguenos»)</h2>
        <p className="campo-nota">Déjalas vacías y no se mostrarán en el blog.</p>
        <div className="editor-grid">
          <div>
            <label className="campo">Página de Facebook
              <input value={social.facebook} onChange={e => setSocial({ ...social, facebook: e.target.value })} placeholder="https://facebook.com/…" />
            </label>
            <label className="campo">Instagram
              <input value={social.instagram} onChange={e => setSocial({ ...social, instagram: e.target.value })} placeholder="https://instagram.com/…" />
            </label>
            <label className="campo">X (Twitter)
              <input value={social.x} onChange={e => setSocial({ ...social, x: e.target.value })} placeholder="https://x.com/…" />
            </label>
          </div>
          <div>
            <label className="campo">YouTube
              <input value={social.youtube} onChange={e => setSocial({ ...social, youtube: e.target.value })} placeholder="https://youtube.com/@…" />
            </label>
            <label className="campo">Email de contacto
              <input value={social.email} onChange={e => setSocial({ ...social, email: e.target.value })} />
            </label>
          </div>
        </div>
      </section>

      <section className="panel-seccion">
        <h2>Integraciones</h2>
        <label className="campo">
          Clave de IA (GLM · z.ai) — para "Generar con IA" en el importador
          <input
            type="password"
            value={glmKey}
            onChange={e => setGlmKey(e.target.value)}
            placeholder="Pega aquí tu API key de z.ai"
            autoComplete="off"
          />
        </label>
        <p className="campo-nota">
          Se guarda de forma privada (sólo la ve el personal del panel) y se aplica al instante,
          sin redeploys. Consíguela en platform.z.ai → API Keys.
        </p>
      </section>

      <section className="panel-seccion">
        <h2>Valores por defecto de los artículos nuevos</h2>
        <label className="campo-casilla">
          <input type="checkbox" checked={defaults.show_author} onChange={e => setDefaults({ ...defaults, show_author: e.target.checked })} />
          Mostrar autoría por defecto
        </label>
        <label className="campo-casilla">
          <input type="checkbox" checked={defaults.allow_share} onChange={e => setDefaults({ ...defaults, allow_share: e.target.checked })} />
          Permitir compartir por defecto
        </label>
        <label className="campo-casilla">
          <input type="checkbox" checked={defaults.allow_comments} onChange={e => setDefaults({ ...defaults, allow_comments: e.target.checked })} />
          Permitir comentarios por defecto
        </label>
      </section>
    </div>
  )
}
