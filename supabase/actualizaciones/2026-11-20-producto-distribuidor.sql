-- Ajuste 2026-11-20 · Fichas de producto para distribuidores
-- ---------------------------------------------------------------------------
-- 1. oms_distrib_producto_info: imagen exclusiva + descripción extensa
--    (dossier del distribuidor) y notas comerciales POR PRODUCTO.
-- 2. oms_distrib_recursos.producto_id: vincula un material comercial a un
--    producto concreto (NULL = material general de carpeta).
-- 3. Los distribuidores activos pueden leer las imágenes exclusivas de la
--    carpeta «producto-imagenes» del bucket privado (además de sus carpetas).
-- Idempotente. No toca nada del flujo de clientes.

-- ─── 1 · Ficha por producto ─────────────────────────────────────────────────
create table if not exists public.oms_distrib_producto_info (
  producto_id uuid primary key references public.oms_productos (id) on delete cascade,
  imagen_exclusiva text,
  descripcion_distribuidor text,
  notas_comerciales text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.oms_distrib_producto_info is
  'Ficha de producto para distribuidores: imagen exclusiva (bucket oms-distrib, carpeta producto-imagenes), descripción extensa orientada al distribuidor y notas comerciales. La descripción del cliente final sigue en oms_productos, sin cambios.';

drop trigger if exists oms_distrib_producto_info_touch on public.oms_distrib_producto_info;
create trigger oms_distrib_producto_info_touch before update on public.oms_distrib_producto_info
  for each row execute function public.oms_set_actualizado_en();

alter table public.oms_distrib_producto_info enable row level security;

drop policy if exists "oms distrib ficha lectura" on public.oms_distrib_producto_info;
create policy "oms distrib ficha lectura" on public.oms_distrib_producto_info
  for select to authenticated using (
    public.oms_panel_activo(auth.uid())
    or exists (
      select 1 from public.oms_distribuidores d
       where d.user_id = auth.uid() and d.acceso_habilitado
    )
  );
drop policy if exists "oms distrib ficha gestion" on public.oms_distrib_producto_info;
create policy "oms distrib ficha gestion" on public.oms_distrib_producto_info
  for all to authenticated
  using (public.oms_es_editor_o_mas())
  with check (public.oms_es_editor_o_mas());

-- ─── 2 · Material comercial vinculado a un producto ─────────────────────────
alter table public.oms_distrib_recursos
  add column if not exists producto_id uuid references public.oms_productos (id) on delete cascade;
comment on column public.oms_distrib_recursos.producto_id is
  'Producto concreto al que pertenece el material (NULL = material general de carpeta).';

-- ─── 3 · Imágenes exclusivas de producto legibles por distribuidores ───────
drop policy if exists "oms distrib bucket lectura" on storage.objects;
create policy "oms distrib bucket lectura" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'oms-distrib'
    and (
      public.oms_panel_activo(auth.uid())
      or exists (
        select 1
          from public.oms_distribuidores d
          join public.oms_distrib_recursos_accesos a on a.distribuidor_id = d.id
         where d.user_id = auth.uid()
           and d.acceso_habilitado
           and (storage.foldername(name))[1] = a.zona
      )
      or exists (
        select 1 from public.oms_distribuidores d
         where d.user_id = auth.uid()
           and d.acceso_habilitado
           and (storage.foldername(name))[1] = 'producto-imagenes'
      )
    )
  );

-- ─── Grants ──────────────────────────────────────────────────────────────────
grant all on public.oms_distrib_producto_info to service_role;
grant select on public.oms_distrib_producto_info to authenticated;
