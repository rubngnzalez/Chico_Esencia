-- ============================================================================
-- SHADDAI · Esencia de Umbral — esquema completo (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------------
-- CÓMO APLICARLO (una sola vez):
--   1. Entra en https://supabase.com/dashboard y abre tu proyecto.
--   2. Menú lateral → SQL Editor → New query.
--   3. Pega este archivo COMPLETO y pulsa «Run».
--   4. Verifica en Table Editor que existen las tablas y en Storage el bucket
--      «recursos». Pasos completos: supabase/LEEME-INSTALACION.md
--
-- El archivo es IDEMPOTENTE: puedes volver a ejecutarlo sin romper nada
-- (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO NOTHING / drop policy if exists).
--
-- Convenciones seguidas: mismas que supabase/schema.sql de Chimeneas-Sierra
-- (tablas en schema public, RLS en todo, vistas públicas sobre columnas
-- seleccionadas, bucket de storage público para las imágenes del panel).
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1 · USUARIOS DEL PANEL (Supabase Auth + tabla de perfiles con rol)
-- ============================================================================
-- La cuenta se crea en Authentication → Users (dashboard). Este trigger añade
-- el perfil automáticamente: el PRIMER usuario que exista queda como «admin»
-- y los siguientes como «lector». Así, la primera cuenta que cree el dueño
-- desde el dashboard administra el panel; después puede promover roles desde
-- el propio panel (sección Usuarios).

create table if not exists public.usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null default '',
  email text not null,
  rol text not null default 'lector' check (rol in ('admin', 'editor', 'lector')),
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);
comment on table public.usuarios is 'Perfiles del panel; el alta real vive en auth.users (Supabase Auth).';

-- Función SECURITY DEFINER: sin RLS recursion (lee usuarios como propietario).
create or replace function public.crear_perfil_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cuantos bigint;
begin
  select count(*) into cuantos from public.usuarios;
  insert into public.usuarios (id, email, nombre, rol)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(coalesce(new.email, ''), '@', 1)),
    case when cuantos = 0 then 'admin' else 'lector' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil_usuario();

-- Helpers de rol (SECURITY DEFINER = no recursión de RLS al usarlos en policies)
create or replace function public.rol_de(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.usuarios where id = uid and activo limit 1;
$$;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rol from public.usuarios where id = auth.uid() and activo limit 1) = 'admin', false);
$$;

create or replace function public.es_editor_o_mas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rol from public.usuarios where id = auth.uid() and activo limit 1) in ('admin', 'editor'), false);
$$;

-- ============================================================================
-- 2 · CATÁLOGO: categorías, productos, ofertas
-- ============================================================================

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text not null unique,
  descripcion text default '',
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  codigo text default '',
  nombre text not null,
  slug text not null unique,
  descripcion text default '',
  historia text default '',
  precio numeric(10, 2) not null default 0,
  precio_oferta numeric(10, 2),
  stock integer not null default 0,
  categoria uuid references public.categorias (id) on delete set null,
  imagenes text[] not null default '{}',
  destacado boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on column public.productos.imagenes is 'Rutas o URLs completas; las subidas al bucket «recursos» se guardan como URL pública completa. La primera imagen es la principal.';

create index if not exists productos_categoria_idx on public.productos (categoria);
create index if not exists productos_activo_idx on public.productos (activo);
create index if not exists productos_codigo_idx on public.productos (codigo);

create table if not exists public.ofertas (
  id uuid primary key default gen_random_uuid(),
  producto uuid not null references public.productos (id) on delete cascade,
  tipo text not null check (tipo in ('precio', 'porcentaje')),
  valor numeric(10, 2) not null,
  inicio timestamptz,
  fin timestamptz,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);
comment on table public.ofertas is 'El precio efectivo de la web es el mínimo entre precio_oferta y las ofertas activas ahora.';

create index if not exists ofertas_producto_idx on public.ofertas (producto);
create index if not exists ofertas_activa_idx on public.ofertas (activa);

-- ============================================================================
-- 3 · CONTENIDO: testimonios, artículos del blog
-- ============================================================================

create table if not exists public.testimonios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  ciudad text default '',
  producto text default '',
  texto text not null,
  estrellas integer not null default 5 check (estrellas between 1 and 5),
  aprobado boolean not null default false,
  fecha timestamptz not null default now(),
  creado_en timestamptz not null default now()
);
create index if not exists testimonios_aprobado_idx on public.testimonios (aprobado);

create table if not exists public.articulos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  slug text not null unique,
  extracto text default '',
  contenido text default '',
  imagen_portada text default '',
  etiquetas text[] not null default '{}',
  estado text not null default 'borrador' check (estado in ('borrador', 'programado', 'publicado')),
  fecha_publicacion timestamptz,
  autor text default 'SHADDAI',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists articulos_estado_idx on public.articulos (estado);
create index if not exists articulos_fecha_idx on public.articulos (fecha_publicacion desc);

-- ============================================================================
-- 4 · COMUNICACIÓN: mensajes (contacto), suscriptores, campañas, outbox
-- ============================================================================

create table if not exists public.mensajes (
  id uuid primary key default gen_random_uuid(),
  nombre text default '',
  email text default '',
  telefono text default '',
  mensaje text default '',
  web text not null default '',
  leido boolean not null default false,
  archivado boolean not null default false,
  nota text default '',
  creado_en timestamptz not null default now()
);
comment on column public.mensajes.web is 'Honeypot anti-spam: los humanos no lo rellenan; la RLS rechaza inserts con web rellena.';

create index if not exists mensajes_leido_idx on public.mensajes (leido);
create index if not exists mensajes_creado_idx on public.mensajes (creado_en desc);

create table if not exists public.suscriptores (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  etiquetas text[] not null default '{}',
  creado_en timestamptz not null default now()
);

create table if not exists public.campanas (
  id uuid primary key default gen_random_uuid(),
  asunto text not null,
  html text not null default '',
  estado text not null default 'borrador' check (estado in ('borrador', 'pendiente', 'enviada')),
  destinatarios jsonb not null default '{"tipo": "todos"}'::jsonb,
  estadisticas jsonb,
  enviada_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists campanas_estado_idx on public.campanas (estado);

create table if not exists public.outbox (
  id uuid primary key default gen_random_uuid(),
  para text not null,
  asunto text default '',
  html text default '',
  eml text default '',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado')),
  ref_pedido text,
  ref_campana uuid references public.campanas (id) on delete set null,
  creado_en timestamptz not null default now()
);
comment on table public.outbox is 'Bandeja de salida: correos pendientes cuando no hay Resend/SMTP; el panel los descarga como .eml.';
create index if not exists outbox_estado_idx on public.outbox (estado);
create index if not exists outbox_pedido_idx on public.outbox (ref_pedido);

-- ============================================================================
-- 5 · VENTAS: pedidos y líneas
-- ============================================================================

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  cliente jsonb not null default '{}'::jsonb,
  subtotal numeric(10, 2) not null default 0,
  envio numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  metodo text default 'tarjeta',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'enviado', 'entregado', 'cancelado')),
  respuesta_redsys jsonb,
  pagado_en timestamptz,
  creado_en timestamptz not null default now()
);
comment on table public.pedidos is 'Se crean SOLO desde la Edge Function pagos-firma (service_role); nadie más inserta.';
create index if not exists pedidos_estado_idx on public.pedidos (estado);
create index if not exists pedidos_creado_idx on public.pedidos (creado_en desc);

create table if not exists public.pedidos_lineas (
  id uuid primary key default gen_random_uuid(),
  pedido uuid not null references public.pedidos (id) on delete cascade,
  codigo text default '',
  nombre text default '',
  cantidad integer not null default 1,
  precio_unitario numeric(10, 2) not null default 0,
  creado_en timestamptz not null default now()
);
create index if not exists pedidos_lineas_pedido_idx on public.pedidos_lineas (pedido);

-- ============================================================================
-- 6 · AJUSTES (una sola fila id='general', una columna jsonb por sección)
-- ============================================================================
-- Columnas: contacto, redes, smtp, redsys, envio, emails_automaticos,
-- notificaciones. La lectura/escritura completa es SOLO admin (RLS); la web
-- pública lee la vista ajustes_publicos, que nunca expone secretos.

create table if not exists public.ajustes (
  id text primary key default 'general' check (id = 'general'),
  contacto jsonb not null default '{}'::jsonb,
  redes jsonb not null default '{}'::jsonb,
  smtp jsonb not null default '{}'::jsonb,
  redsys jsonb not null default '{}'::jsonb,
  envio jsonb not null default '{}'::jsonb,
  emails_automaticos jsonb not null default '{}'::jsonb,
  notificaciones jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

-- ============================================================================
-- 7 · updated_at automático
-- ============================================================================

create or replace function public.set_actualizado_en()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_en = now();
  return new;
end $$;

do $$
declare
  tabla text;
begin
  foreach tabla in array array['categorias', 'productos', 'articulos', 'ajustes'] loop
    execute format('drop trigger if exists %I on public.%I', tabla || '_actualizado', tabla);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_actualizado_en()',
      tabla || '_actualizado', tabla
    );
  end loop;
end $$;

-- ============================================================================
-- 8 · VISTA PÚBLICA de productos con precio efectivo
-- ============================================================================
-- El precio efectivo es el MÍNIMO entre precio_oferta y las ofertas activas
-- ahora (mismo cálculo que firmaba el Worker: worker/src/precios.js).
-- La vista NO es security_invoker: corre como propietaria y expone solo estas
-- columnas seguras; anon no puede leer productos/ofertas directamente.

drop view if exists public.productos_publicos;
create view public.productos_publicos as
select
  p.id,
  p.codigo,
  p.nombre,
  p.slug,
  p.descripcion,
  p.historia,
  p.precio,
  p.precio_oferta,
  p.stock,
  (coalesce(p.stock, 0) <= 0) as agotado,
  p.categoria,
  p.imagenes,
  p.destacado,
  p.activo,
  c.slug as categoria_slug,
  c.nombre as categoria_nombre,
  c.orden as categoria_orden,
  round((
    select min(candidato)
    from (
      -- base: precio_oferta si existe (y es mayor que cero); si no, precio normal
      select case when p.precio_oferta is not null and p.precio_oferta > 0 then p.precio_oferta else p.precio end as candidato
      union all
      -- ofertas activas ahora: precio fijo o porcentaje sobre el precio normal
      select case o.tipo
               when 'porcentaje' then round(p.precio * (1 - o.valor / 100), 2)
               else round(o.valor, 2)
             end as candidato
      from public.ofertas o
      where o.producto = p.id
        and o.activa
        and (o.inicio is null or o.inicio <= now())
        and (o.fin is null or o.fin >= now())
        and (case o.tipo
               when 'porcentaje' then round(p.precio * (1 - o.valor / 100), 2)
               else round(o.valor, 2)
             end) >= 0
    ) candidatos
  ), 2) as precio_efectivo,
  coalesce((
    select jsonb_agg(
             jsonb_build_object('tipo', o.tipo, 'valor', o.valor, 'inicio', o.inicio, 'fin', o.fin)
             order by o.creado_en
           )
    from public.ofertas o
    where o.producto = p.id
      and o.activa
      and (o.inicio is null or o.inicio <= now())
      and (o.fin is null or o.fin >= now())
  ), '[]'::jsonb) as ofertas_activas
from public.productos p
left join public.categorias c on c.id = p.categoria
where p.activo;

comment on view public.productos_publicos is 'Catálogo público con precio_efectivo (min entre precio_oferta y ofertas activas) y marca de agotado.';

-- ============================================================================
-- 9 · VISTA PÚBLICA de ajustes (SOLO datos públicos; nunca secretos)
-- ============================================================================
-- La clave Redsys SOLO se expone cuando entorno = 'test' (clave de pruebas
-- pública en la doc de Redsys, sin riesgo real) para que el pago de pruebas
-- funcione sin funciones desplegadas. En producción la vista la oculta.

drop view if exists public.ajustes_publicos;
create view public.ajustes_publicos as
select
  a.id,
  a.contacto -> 'telefono'       as contacto_telefono,
  a.contacto -> 'direccion'      as contacto_direccion,
  a.contacto -> 'horario'        as contacto_horario,
  a.contacto -> 'emailsDestino'  as contacto_emails,
  a.redes,
  a.envio -> 'coste'             as envio_coste,
  a.envio -> 'gratisDesde'       as envio_gratis_desde,
  a.envio -> 'plazos'            as envio_plazos,
  a.envio -> 'activo'            as envio_activo,
  a.redsys -> 'nombreComercio'   as nombre_comercio,
  a.redsys -> 'entorno'          as entorno_pago,
  a.redsys -> 'fuc'              as fuc,
  a.redsys -> 'terminal'         as terminal,
  a.redsys -> 'moneda'           as moneda,
  a.redsys -> 'metodoTarjeta'    as metodo_tarjeta,
  a.redsys -> 'metodoBizum'      as metodo_bizum,
  a.redsys -> 'urlOk'            as url_ok,
  a.redsys -> 'urlKo'            as url_ko,
  a.redsys -> 'urlNotificacion'  as url_notificacion,
  case when coalesce(a.redsys ->> 'entorno', 'test') = 'test' then a.redsys -> 'clave' else null end as clave_pago_test
from public.ajustes a
where a.id = 'general';

comment on view public.ajustes_publicos is 'Solo lo público de los ajustes. SMTP nunca; la clave Redsys solo en test (clave de pruebas pública).';

-- ============================================================================
-- 10 · ROW LEVEL SECURITY
-- ============================================================================
-- anon:     lee catálogo público y escribe formularios (contacto, boletín).
-- authenticated: lee todo el panel según su rol; escribe según rol.
-- admin:    todo (ajustes, usuarios, pedidos, borrados).
-- editor:   catálogo, ofertas, testimonios, blog, campañas, suscriptores,
--           outbox y bandeja de entrada (sin borrar mensajes).
-- lector:   solo lectura + gestionar la bandeja (leído/archivado/nota).

alter table public.usuarios        enable row level security;
alter table public.categorias      enable row level security;
alter table public.productos       enable row level security;
alter table public.ofertas         enable row level security;
alter table public.testimonios     enable row level security;
alter table public.articulos       enable row level security;
alter table public.mensajes        enable row level security;
alter table public.suscriptores    enable row level security;
alter table public.campanas        enable row level security;
alter table public.outbox          enable row level security;
alter table public.pedidos         enable row level security;
alter table public.pedidos_lineas  enable row level security;
alter table public.ajustes         enable row level security;

-- ---- usuarios ----
drop policy if exists "perfil propio" on public.usuarios;
create policy "perfil propio" on public.usuarios
  for select to authenticated using (id = auth.uid());
drop policy if exists "admin gestiona usuarios" on public.usuarios;
create policy "admin gestiona usuarios" on public.usuarios
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- ---- categorías ----
drop policy if exists "lectura publica" on public.categorias;
create policy "lectura publica" on public.categorias
  for select to anon, authenticated using (true);
drop policy if exists "escritura gestion" on public.categorias;
create policy "escritura gestion" on public.categorias
  for all to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());

-- ---- productos ----
drop policy if exists "lectura gestion" on public.productos;
create policy "lectura gestion" on public.productos
  for select to authenticated using (true);
drop policy if exists "escritura gestion" on public.productos;
create policy "escritura gestion" on public.productos
  for all to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());
-- anon solo a través de la vista productos_publicos.

-- ---- ofertas ----
drop policy if exists "lectura gestion" on public.ofertas;
create policy "lectura gestion" on public.ofertas
  for select to authenticated using (true);
drop policy if exists "escritura gestion" on public.ofertas;
create policy "escritura gestion" on public.ofertas
  for all to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());

-- ---- testimonios ----
drop policy if exists "lectura aprobados publico" on public.testimonios;
create policy "lectura aprobados publico" on public.testimonios
  for select to anon using (aprobado);
drop policy if exists "lectura gestion" on public.testimonios;
create policy "lectura gestion" on public.testimonios
  for select to authenticated using (true);
drop policy if exists "escritura gestion" on public.testimonios;
create policy "escritura gestion" on public.testimonios
  for all to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());

-- ---- artículos ----
drop policy if exists "lectura publicados publico" on public.articulos;
create policy "lectura publicados publico" on public.articulos
  for select to anon
  using (estado = 'publicado' or (estado = 'programado' and fecha_publicacion is not null and fecha_publicacion <= now()));
drop policy if exists "lectura gestion" on public.articulos;
create policy "lectura gestion" on public.articulos
  for select to authenticated using (true);
drop policy if exists "escritura gestion" on public.articulos;
create policy "escritura gestion" on public.articulos
  for all to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());

-- ---- mensajes ----
drop policy if exists "alta formulario contacto" on public.mensajes;
create policy "alta formulario contacto" on public.mensajes
  for insert to anon, authenticated with check (coalesce(web, '') = '');
drop policy if exists "lectura equipo" on public.mensajes;
create policy "lectura equipo" on public.mensajes
  for select to authenticated using (true);
drop policy if exists "gestion bandeja" on public.mensajes;
create policy "gestion bandeja" on public.mensajes
  for update to authenticated using (true) with check (true);
drop policy if exists "borrado solo admin" on public.mensajes;
create policy "borrado solo admin" on public.mensajes
  for delete to authenticated using (public.es_admin());

-- ---- suscriptores ----
drop policy if exists "alta boletin" on public.suscriptores;
create policy "alta boletin" on public.suscriptores
  for insert to anon, authenticated with check (email is not null and email <> '');
drop policy if exists "lectura gestion" on public.suscriptores;
create policy "lectura gestion" on public.suscriptores
  for select to authenticated using (public.es_editor_o_mas());
drop policy if exists "borrado gestion" on public.suscriptores;
create policy "borrado gestion" on public.suscriptores
  for delete to authenticated using (public.es_editor_o_mas());

-- ---- campañas ----
drop policy if exists "gestion editor" on public.campanas;
create policy "gestion editor" on public.campanas
  for all to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());
drop policy if exists "borrado solo admin" on public.campanas;
create policy "borrado solo admin" on public.campanas
  for delete to authenticated using (public.es_admin());

-- ---- outbox ----
drop policy if exists "lectura gestion" on public.outbox;
create policy "lectura gestion" on public.outbox
  for select to authenticated using (public.es_editor_o_mas());
drop policy if exists "marcado enviado" on public.outbox;
create policy "marcado enviado" on public.outbox
  for update to authenticated using (public.es_editor_o_mas()) with check (public.es_editor_o_mas());
drop policy if exists "borrado solo admin" on public.outbox;
create policy "borrado solo admin" on public.outbox
  for delete to authenticated using (public.es_admin());
-- La inserción NO tiene policy: solo service_role (las Edge Functions).

-- ---- pedidos ----
drop policy if exists "lectura autenticados" on public.pedidos;
create policy "lectura autenticados" on public.pedidos
  for select to authenticated using (true);
drop policy if exists "estado solo admin" on public.pedidos;
create policy "estado solo admin" on public.pedidos
  for update to authenticated using (public.es_admin()) with check (public.es_admin());
-- Insert NO tiene policy: solo service_role crea pedidos (Edge Function).

-- ---- líneas de pedido ----
drop policy if exists "lectura autenticados" on public.pedidos_lineas;
create policy "lectura autenticados" on public.pedidos_lineas
  for select to authenticated using (true);
drop policy if exists "modificacion solo admin" on public.pedidos_lineas;
create policy "modificacion solo admin" on public.pedidos_lineas
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- ---- ajustes ----
drop policy if exists "solo admin" on public.ajustes;
create policy "solo admin" on public.ajustes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- ---- grants ----
grant usage on schema public to anon, authenticated, service_role;
grant select on public.productos_publicos, public.ajustes_publicos to anon, authenticated;
grant select on public.categorias, public.testimonios, public.articulos, public.mensajes, public.suscriptores to anon, authenticated;
grant insert on public.mensajes, public.suscriptores to anon, authenticated;
grant all on all tables in schema public to service_role;

-- ============================================================================
-- 11 · STORAGE: bucket «recursos» para las imágenes del panel
-- ============================================================================

insert into storage.buckets (id, name, "public")
values ('recursos', 'recursos', true)
on conflict (id) do update set "public" = true;

drop policy if exists "recursos lectura publica" on storage.objects;
create policy "recursos lectura publica" on storage.objects
  for select to anon, authenticated using (bucket_id = 'recursos');

drop policy if exists "recursos escritura gestion" on storage.objects;
create policy "recursos escritura gestion" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recursos' and public.es_editor_o_mas());

drop policy if exists "recursos modificacion gestion" on storage.objects;
create policy "recursos modificacion gestion" on storage.objects
  for update to authenticated
  using (bucket_id = 'recursos' and public.es_editor_o_mas())
  with check (bucket_id = 'recursos' and public.es_editor_o_mas());

drop policy if exists "recursos borrado gestion" on storage.objects;
create policy "recursos borrado gestion" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recursos' and public.es_editor_o_mas());

-- ============================================================================
-- 12 · SEMILLA: categoría, catálogo real y ajustes por defecto
-- ============================================================================
-- Idempotente: ON CONFLICT DO NOTHING. Los UUID fijos son arbitrarios pero
-- estables, para que los productos apunten siempre a la misma categoría.

insert into public.categorias (id, nombre, slug, descripcion, orden)
values (
  '5eed0000-0000-4000-8000-000000000001',
  'Esencias',
  'esencias',
  'Las piezas del Umbral: eau de parfum neurosensorial y perfume sólido, elaborados a mano en lotes numerados.',
  1
)
on conflict (slug) do nothing;

insert into public.productos (id, codigo, nombre, slug, descripcion, historia, precio, precio_oferta, stock, categoria, imagenes, destacado, activo)
values
  (
    '5eed0000-0000-4000-8000-000000000011',
    'esencia-umbral-50',
    'Esencia de Umbral · 50 ml',
    'esencia-de-umbral-50-ml',
    'El Eau de Parfum Neurosensorial original, 1ª Edición especial.',
    'Inhala el Origen — el aroma invisible que abre el encuentro y te devuelve al interior. Exhala tu Esencia — libera el peso, aclara la mente y reconócete en este umbral.',
    55, null, 25,
    '5eed0000-0000-4000-8000-000000000001',
    array['img/esencia-50.webp'],
    true, true
  ),
  (
    '5eed0000-0000-4000-8000-000000000012',
    'perfume-solido',
    'Perfume Sólido Natural · 12 g',
    'perfume-solido-natural-12-g',
    'La Esencia de Umbral en bálsamo: el umbral que cabe en el bolsillo y despierta despacio.',
    'Fragancia sólida — se funde con la piel y libera su aroma al ritmo de tu pulso. Frasco de 12 g para llevar el ritual en el bolsillo, sin pulverizar. Misma alma: inhala el origen, exhala tu esencia, estés donde estés.',
    25, null, 25,
    '5eed0000-0000-4000-8000-000000000001',
    array['img/perfume-solido.webp'],
    false, true
  ),
  (
    '5eed0000-0000-4000-8000-000000000013',
    'duo-ritual',
    'Dúo Ritual · Esencia + Perfume Sólido',
    'duo-ritual-esencia-perfume-solido',
    'La Esencia de Umbral y el Perfume Sólido Natural juntos, con precio de lanzamiento.',
    'Las dos piezas del umbral: el Eau de Parfum Neurosensorial original de 50 ml y el Perfume Sólido Natural de 12 g. Ahorro especial: 75 € en lugar de 80 € por separado.',
    80, 75, 25,
    '5eed0000-0000-4000-8000-000000000001',
    array['img/duo-esencial.webp'],
    false, true
  )
on conflict (slug) do nothing;

-- Ajustes por defecto: mismos valores que worker/src/ajustes-defecto.js.
-- NOTA Redsys: la clave sq7HjrUOBf2m7spUjazlA es la clave de TEST pública
-- documentada por Redsys; NO es un secreto real. En producción se sustituye
-- por la clave privada desde el panel (Ajustes → Pago).
insert into public.ajustes (id, contacto, redes, smtp, redsys, envio, emails_automaticos, notificaciones)
values (
  'general',
  $j${"emailsDestino": ["hola@shaddai.es"], "telefono": "", "direccion": "", "horario": "Respondemos en 24–48 h laborables."}$j$::jsonb,
  $j${"instagram": "", "tiktok": "", "pinterest": "", "facebook": "", "youtube": "", "whatsapp": ""}$j$::jsonb,
  $j${"host": "", "puerto": 587, "usuario": "", "contrasena": "", "desde": "SHADDAI · Esencia de Umbral <hola@shaddai.es>", "activo": false}$j$::jsonb,
  $j${"fuc": "999008889", "terminal": "1", "moneda": "978", "entorno": "test", "clave": "sq7HjrUOBf2m7spUjazlA", "nombreComercio": "SHADDAI · Esencia de Umbral", "urlOk": "", "urlKo": "", "urlNotificacion": "", "metodoTarjeta": true, "metodoBizum": true}$j$::jsonb,
  $j${"coste": 5.9, "gratisDesde": 80, "plazos": "Preparación artesanal por orden de solicitud. Envío peninsular en las semanas siguientes a cada lote.", "activo": true}$j$::jsonb,
  $j${"confirmacionCompra": {"activo": true, "asunto": "Pedido {{pedido}} confirmado — SHADDAI · Esencia de Umbral", "html": "<div style=\"font-family:Georgia,serif;color:#16261b;max-width:560px;margin:0 auto;padding:24px;\"><p style=\"letter-spacing:.3em;text-transform:uppercase;font-size:.7rem;color:#c9a45f;margin:0 0 8px;\">SHADDAI · Esencia de Umbral</p><h1 style=\"font-weight:500;font-size:1.6rem;margin:0 0 16px;\">Gracias, {{nombre}}: tu pedido {{pedido}} está confirmado</h1><p style=\"line-height:1.7;\">Hemos recibido tu reserva. Prepararemos tu pedido a mano, con el cuidado de siempre, y te escribiremos cuando esté en camino.</p><div style=\"background:#f3eee2;padding:16px 20px;margin:20px 0;border-left:3px solid #c9a45f;\"><p style=\"margin:0 0 8px;\"><strong>Pedido:</strong> {{pedido}}</p><p style=\"margin:0 0 8px;\"><strong>Artículos:</strong></p>{{articulos}}<p style=\"margin:12px 0 0;font-size:1.1rem;\"><strong>Total:</strong> {{total}}</p></div><p style=\"line-height:1.7;\">Inhala el origen, exhala tu esencia.</p><p style=\"color:#6b7a6e;font-size:.85rem;\">SHADDAI · Esencia de Umbral — Que nos busquen por dentro.</p></div>"}, "agradecimiento": {"activo": true, "asunto": "Gracias por tu compra, {{nombre}}", "html": "<div style=\"font-family:Georgia,serif;color:#16261b;max-width:560px;margin:0 auto;padding:24px;\"><p style=\"letter-spacing:.3em;text-transform:uppercase;font-size:.7rem;color:#c9a45f;margin:0 0 8px;\">SHADDAI · Esencia de Umbral</p><h1 style=\"font-weight:500;font-size:1.6rem;margin:0 0 16px;\">Gracias, {{nombre}}</h1><p style=\"line-height:1.7;\">Cada frasco se prepara a mano, en pequeños lotes numerados. Gracias por honrar los tiempos de la verdadera artesanía y por buscarte por dentro.</p><p style=\"line-height:1.7;\">Cuando tu pedido {{pedido}} llegue a tus manos, detente un momento: inhala, exhala, y vuelve a tu umbral.</p><p style=\"color:#6b7a6e;font-size:.85rem;\">SHADDAI · Esencia de Umbral — Inhala · Exhala</p></div>"}}$j$::jsonb,
  $j${"email": "hola@shaddai.es", "nuevoPedido": true, "nuevoContacto": true, "nuevoMensaje": true}$j$::jsonb
)
on conflict (id) do nothing;

-- ============================================================================
-- FIN · Comprobación rápida (opcional, en el SQL Editor):
--   select * from public.productos_publicos;   → 3 productos con precio efectivo
--   select * from public.ajustes_publicos;     → sin secretos (solo lo público)
-- ============================================================================
