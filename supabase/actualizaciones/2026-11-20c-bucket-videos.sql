-- ============================================================================
-- 2026-11-20c · Bucket «recursos»: permitir vídeos de producto hasta 80 MB
-- ============================================================================
-- El panel ahora acepta vídeos de producto (MP4/WebM/MOV hasta 80 MB en el
-- formulario). El bucket «recursos» trae por defecto el límite de Supabase
-- (50 MB): esta actualización lo sube a 80 MB para que quepan.
--
-- Alternativa en el panel de Supabase: Storage → recursos → Settings →
-- «File size limit» → 80 MB.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar.
-- ============================================================================

update storage.buckets
set file_size_limit = 83886080  -- 80 * 1024 * 1024
where id = 'recursos';

-- ─── Comprobación ───────────────────────────────────────────────────────────

select id, file_size_limit from storage.buckets where id = 'recursos';
