-- ============================================================
-- 0002: claves de integración editables desde el panel.
-- Las filas de sha_settings cuya key empiece por 'secret_'
-- sólo son legibles por el personal (superadmin/admin).
-- ============================================================

drop policy if exists sha_settings_select on public.sha_settings;
create policy sha_settings_select on public.sha_settings for select
  using (not key like 'secret\_%' or public.sha_is_staff());
