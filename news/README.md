# SHADDAI · El Umbral — Diario (blog + panel)

Blog editorial de SHADDAI con panel de administración propio, publicado en
`https://omshaddai.com/news/` (GitHub Pages, misma carpeta que la web actual).

## Estructura

- `news/` — aplicación Vite + React + TypeScript (blog público y panel `/news/admin`).
- `news/supabase/` — migraciones SQL (tablas `sha_*` en el proyecto ARENA13) y edge functions.
- `shaddai-web/news/` — build del blog que sirve GitHub Pages (se commitea).
- `shaddai-web/404.html` — fallback SPA inteligente: rutas `/news/*` abren el blog; el resto, 404 de marca.
- `.github/workflows/news-seo.yml` — regenera stubs OG y sitemap al publicar (dispatch `news-rebuild`).

## Desarrollo

```powershell
cd news
npm install
npm run dev        # requiere news/.env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
npm run build      # typecheck + build hacia ../shaddai-web/news + postbuild 404
```

## Publicar

El sitio se sirve desde la rama **`gh-pages`** (copia de `shaddai-web/` en la raíz).

1. `npm run build` en `news/` (genera `shaddai-web/news/` + `shaddai-web/404.html`).
2. Commit + push del código en `main`.
3. Espejo a producción (automatizado, conserva assets antiguos y el `.env`/`node_modules`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File news\scripts\publicar.ps1 -Mensaje "Descripcion del cambio"
   ```
   El script mata los procesos `esbuild` que bloquean el renombrado y devuelve el
   árbol a `main` al terminar. En `gh-pages`, `news/` es solo el build; el código
   vive en `main`. De vez en cuando, limpiar a mano los assets con hash antiguo.

## Migraciones

El proyecto ARENA13 es compartido y su historial de migraciones pertenece a otro
proyecto, así que las migraciones de `news/supabase/migrations/` se aplican con
`npx supabase db query --linked -f supabase/migrations/XXXX.sql` (con
`SUPABASE_ACCESS_TOKEN` en el entorno). No usar `db push` aquí.

## Edge functions (proyecto ARENA13)

- `sha-import-extract` — analiza una URL y guarda el contenido en la cola.
- `sha-import-generate` — reescribe con GLM (z.ai) un enlace de la cola.
- `sha-social-publish` — publica el artículo en Facebook / Instagram.
- `sha-social-sync` — sincroniza comentarios y reacciones (cron 15 min).
- `sha-seo-rebuild` — dispara el workflow `news-seo` en GitHub.

Secretos necesarios en el proyecto: `GLM_API_KEY`, `META_PAGE_TOKEN`, `META_PAGE_ID`,
`IG_USER_ID` (opcional), `CRON_SECRET`, `GITHUB_PAT`.

## Primer acceso

Superadmin provisional: `superadmin@omshaddai.com` / `Lince2024**`
(cambiarla tras el primer login desde el panel).
