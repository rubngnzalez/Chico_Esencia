-- ============================================================================
-- 2026-11-12 · Códigos de descuento (cupones) activables por QR o código
-- ============================================================================
-- Qué añade:
--   1. Tabla «oms_cupones»: códigos que se crean en el panel (Ofertas →
--      Cupones) y se aplican en el checkout. Tipos:
--        · porcentaje → descuenta un % del subtotal (valor = 10 → −10 %).
--        · fijo       → descuenta un importe fijo (valor = 5 → −5,00 €),
--                       sin superar el subtotal.
--        · envio      → envío gratuito (valor se ignora).
--      Límites opcionales: minimo_subtotal, inicio/fin, usos_maximos.
--      La columna «usos» se incrementa SOLO cuando Redsys confirma el pago
--      (la notificación online), no al crear pedidos pendientes.
--   2. Columna «cupon» en oms_pedidos: código aplicado al pedido (texto).
--   3. RLS: los cupones solo los ve el panel (autenticados); el anon no tiene
--     ningún acceso (nadie puede listar códigos desde la web pública). La
--     validación real ocurre en servidor dentro de las Edge Functions con
--     service_role, que ignora RLS.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar).
-- ============================================================================

-- ─── 1 · Tabla de cupones ───────────────────────────────────────────────────

create table if not exists public.oms_cupones (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  tipo text not null default 'porcentaje' check (tipo in ('porcentaje', 'fijo', 'envio')),
  valor numeric(10, 2) not null default 0,
  minimo_subtotal numeric(10, 2) not null default 0,
  inicio timestamptz,
  fin timestamptz,
  usos_maximos integer,
  usos integer not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  constraint oms_cupones_codigo_mayusculas check (codigo = upper(codigo)),
  constraint oms_cupones_usos_validos check (usos >= 0 and (usos_maximos is null or usos_maximos >= 0))
);

comment on table public.oms_cupones is 'Códigos de descuento del panel (Ofertas → Cupones). Se aplican en el checkout y se validan SIEMPRE en servidor (Edge Functions con service_role). El uso se cuenta al confirmar Redsys el pago.';
comment on column public.oms_cupones.tipo is 'porcentaje = −valor % del subtotal; fijo = −valor €; envio = envío gratuito.';
comment on column public.oms_cupones.usos is 'Pedidos PAGADOS con este cupón (lo incrementa oms-redsys-notificacion). Los pendientes no cuentan.';
comment on column public.oms_cupones.minimo_subtotal is 'Subtotal mínimo (sin envío) para que el cupón sea aplicable. 0 = sin mínimo.';

create index if not exists oms_cupones_codigo_idx on public.oms_cupones (codigo);
create index if not exists oms_cupones_activo_idx on public.oms_cupones (activo);

-- ─── 2 · Cupón aplicado en cada pedido ──────────────────────────────────────

alter table public.oms_pedidos add column if not exists cupon text;

comment on column public.oms_pedidos.cupon is
  'Código de descuento aplicado al pedido (tabla oms_cupones). Null si no se usó cupón.';

-- Incremento atómico de usos: lo llama oms-redsys-notificacion cuando Redsys
-- confirma el pago. No supera usos_maximos aunque lleguen notificaciones
-- concurrentes (la condición va dentro del UPDATE).
create or replace function public.oms_cupon_contar_uso(codigo_cupon text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.oms_cupones
     set usos = usos + 1
   where codigo = upper(codigo_cupon)
     and activo
     and (usos_maximos is null or usos < usos_maximos);
$$;

comment on function public.oms_cupon_contar_uso(text) is
  'Suma un uso al cupón (solo si sigue activo y sin agotar). La llama la notificación de Redsys al confirmarse el pago.';

grant execute on function public.oms_cupon_contar_uso(text) to service_role;

-- ─── 3 · ROW LEVEL SECURITY: solo el panel ve los cupones ──────────────────

alter table public.oms_cupones enable row level security;

drop policy if exists "oms lectura gestion" on public.oms_cupones;
create policy "oms lectura gestion" on public.oms_cupones
  for select to authenticated using (true);

drop policy if exists "oms escritura gestion" on public.oms_cupones;
create policy "oms escritura gestion" on public.oms_cupones
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- El anon NO tiene policy: desde la web pública no se pueden listar ni
-- adivinar códigos (la validación va dentro de las Edge Functions).

-- ─── 4 · Grants (service_role = Edge Functions) ─────────────────────────────

grant all on public.oms_cupones to service_role;
grant select on public.oms_pedidos to service_role;
