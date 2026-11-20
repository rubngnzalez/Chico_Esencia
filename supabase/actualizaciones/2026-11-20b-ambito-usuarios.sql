-- Ajuste 2026-11-20b · Ámbito de las cuentas (staff / cliente / distribuidor)
-- ---------------------------------------------------------------------------
-- La lista «Usuarios» del panel es SOLO para el staff. Los clientes y los
-- distribuidores se separan con el campo «ambito»:
--   · Usuarios (panel)   → ambito = 'staff'
--   · Sección Clientes   → ambito = 'cliente'
--   · Distribuidores     → ambito = 'distribuidor' (su página dedicada)
-- Idempotente. Clasifica las cuentas existentes conocidas.

alter table public.oms_usuarios
  add column if not exists ambito text not null default 'staff';

-- Clasificación inicial de cuentas conocidas
update public.oms_usuarios set ambito = 'distribuidor'
 where email in ('aj.movil73@gmail.com', 'distribuidor@omshaddai.com');
update public.oms_usuarios set ambito = 'cliente'
 where email = 'omshaddai2026@gmail.com';

comment on column public.oms_usuarios.ambito is
  'Ámbito de la cuenta: staff (panel), cliente (zona de clientes) o distribuidor (zona VIP). La lista Usuarios del panel solo muestra staff.';
