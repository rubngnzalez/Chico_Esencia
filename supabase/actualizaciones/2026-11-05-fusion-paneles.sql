-- ============================================================================
-- Actualización 2026-11-05 · Fusión de paneles (/panel local → /admin oficial)
-- ============================================================================
-- Añade a la tabla usuarios la marca de último acceso y la función segura que
-- la escribe. Idempotente: se puede ejecutar sin romper nada.
--
-- El panel /admin usa:
--   · usuarios.ultimo_acceso → columna «Último acceso» de la sección Usuarios.
--   · tocar_acceso()         → el panel la llama tras cada inicio de sesión.
--   · Edge Function «gestion-usuarios» con la acción nueva «eliminar»
--     (hay que redesplegarla: npx supabase functions deploy gestion-usuarios).
-- ============================================================================

alter table public.usuarios add column if not exists ultimo_acceso timestamptz;
comment on column public.usuarios.ultimo_acceso is 'Fecha del último inicio de sesión (la escribe tocar_acceso); visible en la sección Usuarios.';

create or replace function public.tocar_acceso()
returns void
language sql
security definer
set search_path = public
as $$
  update public.usuarios set ultimo_acceso = now() where id = auth.uid();
$$;
