-- ============================================================================
-- Actualización 2026-11-06 · Pestaña «Sistema (oculto)» en Ajustes (solo admin)
-- ============================================================================
-- Añade a oms_ajustes la columna jsonb «sistema»: inventario editable de toda
-- la configuración que vive hardcodeada en el repo (Supabase, Worker, GitHub,
-- Redsys de reserva, emails por defecto). Idempotente.
--
-- Seguridad:
--   · La política RLS «oms solo admin» de la tabla cubre la columna nueva:
--     solo administradores pueden leerla o escribirla.
--   · La vista pública oms_ajustes_publicos selecciona columnas concretas, así
--     que «sistema» NUNCA se expone a la web pública.
--
-- Se aplica con:  npx supabase db execute -f supabase/actualizaciones/2026-11-06-ajustes-sistema.sql
-- ============================================================================

alter table public.oms_ajustes add column if not exists sistema jsonb not null default '{}'::jsonb;

comment on column public.oms_ajustes.sistema is 'Inventario editable (solo admin) de la configuración hardcodeada: Supabase, Worker, GitHub, Redsys de reserva y emails por defecto. Nunca se expone en la vista pública.';
