-- ============================================================================
-- 2026-11-18 · Usuario de distribuidor para el panel
-- ============================================================================
-- Da de alta la cuenta con la que se consulta la sección Distribuidores:
--   Email:      distribuidor@omshaddai.com
--   Contraseña: shaddai2026
--   Nombre:     SHADDAI
--   Rol:        editor (Edición) — el mínimo que ve «Distribuidores» en el
--               menú del panel, sin permisos de Administración.
--
-- Qué hace (idempotente: se puede re-ejecutar):
--   1. Alta en auth.users (proyecto compartido) con correo confirmado y
--      contraseña cifrada con crypt/bcrypt.
--   2. Identidad «email» en auth.identities (obligatoria para entrar).
--   3. Perfil en public.oms_usuarios con rol «editor».
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar.
-- ============================================================================

-- ─── 1 · Cuenta en auth.users (compartida del proyecto) ────────────────────

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  coalesce((select id from auth.users where email = 'distribuidor@omshaddai.com'), gen_random_uuid()),
  'authenticated',
  'authenticated',
  'distribuidor@omshaddai.com',
  crypt('shaddai2026', gen_salt('bf')),
  now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{"nombre":"SHADDAI","rol":"editor"}',
  now(), now(), '', '', '', ''
where not exists (
  select 1 from auth.users where email = 'distribuidor@omshaddai.com'
);

-- ─── 2 · Identidad «email» (necesaria para signInWithPassword) ──────────────

insert into auth.identities (
  id, user_id, provider_id, identity_data, last_sign_in_at, created_at, updated_at, email
)
select
  gen_random_uuid(), u.id, 'email',
  json_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now(), u.email
from auth.users u
where u.email = 'distribuidor@omshaddai.com'
  and not exists (
    select 1 from auth.identities i
     where i.user_id = u.id and i.provider_id = 'email'
  );

-- ─── 3 · Perfil del panel SHADDAI con rol Edición ───────────────────────────

insert into public.oms_usuarios (id, email, nombre, rol)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'nombre', 'SHADDAI'), 'editor'
from auth.users u
where u.email = 'distribuidor@omshaddai.com'
on conflict (id) do update
  set rol = 'editor',
      nombre = excluded.nombre,
      activo = true;

-- ─── 4 · Comprobación ───────────────────────────────────────────────────────

select u.email, p.nombre, p.rol, p.activo
from auth.users u
join public.oms_usuarios p on p.id = u.id
where u.email = 'distribuidor@omshaddai.com';
