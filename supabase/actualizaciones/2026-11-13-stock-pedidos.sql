-- ============================================================================
-- 2026-11-13 · Sincronía de stock con los pedidos
-- ============================================================================
-- Qué añade:
--   1. Tabla «oms_stock_movimientos»: registro de cada descuento (salida) y
--      cada devolución (entrada) de stock, con el stock que quedaba después.
--      Es lo que el panel muestra en Pedidos → Detalle («Stock sincronizado»).
--   2. Trigger «oms_stock_de_pedido» sobre oms_pedidos (igual que la
--      numeración por lotes, que ya usa este mecanismo):
--        · Al pasar a «pagado» → descuenta el stock de cada línea del pedido
--          (oms_productos.stock, sin bajar de 0).
--        · Al pasar a «cancelado» viniendo de «pagado», «enviado» o
--          «entregado» → devuelve el stock que se descontó.
--      Funciona igual si el pago lo confirma la notificación de Redsys o si
--      lo marca a mano la administración desde el panel.
--
--   Las líneas del pedido guardan el código del producto (columna «codigo»);
--   si el código no coincide con ningún producto (pedido antiguo), se busca
--   por nombre exacto. Si tampoco, esa línea no toca stock.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar).
-- ============================================================================

-- ─── 1 · Tabla de movimientos de stock ──────────────────────────────────────

create table if not exists public.oms_stock_movimientos (
  id uuid primary key default gen_random_uuid(),
  pedido uuid not null references public.oms_pedidos (id) on delete cascade,
  numero text default '',
  producto uuid references public.oms_productos (id) on delete set null,
  codigo text default '',
  nombre text default '',
  cantidad integer not null default 1 check (cantidad > 0),
  tipo text not null check (tipo in ('salida', 'entrada')),
  restaura uuid references public.oms_stock_movimientos (id) on delete set null,
  stock_resultante integer,
  creado_en timestamptz not null default now()
);

comment on table public.oms_stock_movimientos is
  'Sincronía de stock con los pedidos: «salida» al confirmarse el pago (descuento), «entrada» al cancelarse un pedido pagado (devolución). Lo escribe el trigger oms_stock_de_pedido; el panel lo enseña en Pedidos → Detalle.';
comment on column public.oms_stock_movimientos.numero is 'Número del pedido en el momento del movimiento (numero_publico si ya tenía lote, si no la referencia de Redsys).';
comment on column public.oms_stock_movimientos.restaura is 'Salida que devuelve esta entrada (null en las salidas). Evita devoluciones dobles si el estado se toca varias veces.';
comment on column public.oms_stock_movimientos.stock_resultante is 'Stock del producto justo después del movimiento (auditoría).';

create index if not exists oms_stock_movimientos_pedido_idx on public.oms_stock_movimientos (pedido);
create index if not exists oms_stock_movimientos_restaura_idx on public.oms_stock_movimientos (restaura);

-- ─── 2 · Trigger de sincronía sobre oms_pedidos ─────────────────────────────

create or replace function public.oms_stock_sincronizar_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linea record;
  v_mov record;
  v_producto_id uuid;
  v_stock_actual integer;
begin
  -- SALIDA · el pedido queda «pagado»: descontar el stock de cada línea
  if new.estado = 'pagado' and old.estado is distinct from 'pagado' then
    for v_linea in
      select l.codigo, l.nombre, l.cantidad
        from public.oms_pedidos_lineas l
       where l.pedido = new.id
       order by l.creado_en
    loop
      v_producto_id := null;

      -- Localizar el producto: por código (la vía normal) y, si no existe
      -- ese código o viene vacío (pedidos antiguos), por nombre exacto.
      if coalesce(btrim(v_linea.codigo), '') <> '' then
        select p.id, p.stock into v_producto_id, v_stock_actual
          from public.oms_productos p
         where p.codigo = btrim(v_linea.codigo)
         limit 1
         for update;
      end if;
      if v_producto_id is null then
        select p.id, p.stock into v_producto_id, v_stock_actual
          from public.oms_productos p
         where p.nombre = v_linea.nombre
         limit 1
         for update;
      end if;

      -- Sin producto que coincida no hay nada que descontar: se salta la línea
      if v_producto_id is not null then
        update public.oms_productos
           set stock = greatest(stock - v_linea.cantidad, 0)
         where id = v_producto_id;

        insert into public.oms_stock_movimientos
          (pedido, numero, producto, codigo, nombre, cantidad, tipo, stock_resultante)
        values
          (new.id, coalesce(new.numero_publico, new.numero), v_producto_id,
           v_linea.codigo, v_linea.nombre, v_linea.cantidad, 'salida',
           greatest(coalesce(v_stock_actual, 0) - v_linea.cantidad, 0));
      end if;
    end loop;
  end if;

  -- ENTRADA · pedido cancelado después de estar pagado: devolver lo descontado
  if new.estado = 'cancelado' and old.estado in ('pagado', 'enviado', 'entregado') then
    for v_mov in
      select m.*
        from public.oms_stock_movimientos m
       where m.pedido = new.id
         and m.tipo = 'salida'
         and m.producto is not null
         and not exists (
               select 1 from public.oms_stock_movimientos r
                where r.restaura = m.id
             )
       order by m.creado_en
    loop
      select p.id, p.stock into v_producto_id, v_stock_actual
        from public.oms_productos p
       where p.id = v_mov.producto
       limit 1
       for update;
      continue when v_producto_id is null;

      update public.oms_productos
         set stock = stock + v_mov.cantidad
       where id = v_producto_id;

      insert into public.oms_stock_movimientos
        (pedido, numero, producto, codigo, nombre, cantidad, tipo, restaura, stock_resultante)
      values
        (new.id, coalesce(new.numero_publico, new.numero), v_producto_id,
         v_mov.codigo, v_mov.nombre, v_mov.cantidad, 'entrada', v_mov.id,
         coalesce(v_stock_actual, 0) + v_mov.cantidad);
    end loop;
  end if;

  return new;
end;
$$;

comment on function public.oms_stock_sincronizar_pedido() is
  'Sincroniza oms_productos.stock con el ciclo del pedido: descuenta al pasar a «pagado» y devuelve al cancelarse un pedido ya pagado. Registra cada movimiento en oms_stock_movimientos.';

drop trigger if exists oms_stock_de_pedido on public.oms_pedidos;
create trigger oms_stock_de_pedido
  after update of estado on public.oms_pedidos
  for each row
  execute function public.oms_stock_sincronizar_pedido();

-- ─── 3 · ROW LEVEL SECURITY: solo lectura para el panel ─────────────────────

alter table public.oms_stock_movimientos enable row level security;

drop policy if exists "oms lectura gestion" on public.oms_stock_movimientos;
create policy "oms lectura gestion" on public.oms_stock_movimientos
  for select to authenticated using (true);

-- Sin policies de escritura: el stock solo se toca desde el trigger y las
-- Edge Functions (service_role ignora RLS). Nadie escribe movimientos a mano.

-- ─── 4 · Grants ─────────────────────────────────────────────────────────────

grant select on public.oms_stock_movimientos to authenticated;
grant all on public.oms_stock_movimientos to service_role;
