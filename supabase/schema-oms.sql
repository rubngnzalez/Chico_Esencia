-- ============================================================================
-- Esquema OMS (tienda SHADDAI · Esencia de Umbral) para proyecto COMPARTIDO
-- ============================================================================
-- Todas las tablas, vistas y funciones llevan prefijo oms_ para convivir con
-- otras apps (ga13_*, sha_*…) dentro del mismo proyecto Supabase, sin
-- mezclarse con ellas.
--
-- Diferencias respecto a supabase/schema.sql (proyecto dedicado xtnza…):
--   · Prefijo oms_ en TODO.
--   · SIN trigger sobre auth.users: los perfiles del panel se crean de forma
--     explícita (migración inicial o Edge Function gestion-usuarios). Así no
--     se toca el flujo de autenticación de las otras apps del proyecto.
--   · SIN semillas: el catálogo llega de la migración de datos.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================================

-- ─── 1 · PERFILES DEL PANEL ────────────────────────────────────────────────
-- El alta real vive en auth.users (Supabase Auth, compartido con otras apps).
-- Solo existen aquí las cuentas que pueden entrar al panel oms.

create table if not exists public.oms_usuarios (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null default '',
  email text not null,
  rol text not null default 'lector' check (rol in ('admin', 'editor', 'lector')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  ultimo_acceso timestamptz
);
comment on table public.oms_usuarios is 'Perfiles del panel SHADDAI (oms); el alta real vive en auth.users compartido.';

create or replace function public.oms_rol_de(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select rol from public.oms_usuarios where id = uid and activo limit 1;
$$;

create or replace function public.oms_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rol from public.oms_usuarios where id = auth.uid() and activo limit 1) = 'admin', false);
$$;

create or replace function public.oms_es_editor_o_mas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rol from public.oms_usuarios where id = auth.uid() and activo limit 1) in ('admin', 'editor'), false);
$$;

-- Marca el último acceso del usuario actual (el panel la llama al entrar).
create or replace function public.oms_tocar_acceso()
returns void
language sql
security definer
set search_path = public
as $$
  update public.oms_usuarios set ultimo_acceso = now() where id = auth.uid();
$$;

-- ─── 2 · CATÁLOGO: categorías, productos, ofertas ──────────────────────────

create table if not exists public.oms_categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  slug text not null unique,
  descripcion text default '',
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.oms_productos (
  id uuid primary key default gen_random_uuid(),
  codigo text default '',
  nombre text not null,
  slug text not null unique,
  descripcion text default '',
  historia text default '',
  precio numeric(10, 2) not null default 0,
  precio_oferta numeric(10, 2),
  stock integer not null default 0,
  categoria uuid references public.oms_categorias (id) on delete set null,
  imagenes text[] not null default '{}',
  destacado boolean not null default false,
  activo boolean not null default true,
  zonas_envio text[] not null default '{}',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on column public.oms_productos.imagenes is 'Rutas o URLs completas; las subidas al bucket «recursos» se guardan como URL pública completa. La primera imagen es la principal.';
comment on column public.oms_productos.zonas_envio is 'Zonas de envío disponibles para el producto (espana, unionEuropea, latinoamerica, resto). Vacío = todas. Se gestiona en el panel: Productos → Editar.';

create index if not exists oms_productos_categoria_idx on public.oms_productos (categoria);
create index if not exists oms_productos_activo_idx on public.oms_productos (activo);
create index if not exists oms_productos_codigo_idx on public.oms_productos (codigo);

create table if not exists public.oms_ofertas (
  id uuid primary key default gen_random_uuid(),
  producto uuid not null references public.oms_productos (id) on delete cascade,
  tipo text not null check (tipo in ('precio', 'porcentaje')),
  valor numeric(10, 2) not null,
  inicio timestamptz,
  fin timestamptz,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);
comment on table public.oms_ofertas is 'El precio efectivo de la web es el mínimo entre precio_oferta y las ofertas activas ahora.';

create index if not exists oms_ofertas_producto_idx on public.oms_ofertas (producto);
create index if not exists oms_ofertas_activa_idx on public.oms_ofertas (activa);

-- ─── 3 · CONTENIDO: testimonios, artículos del blog ────────────────────────

create table if not exists public.oms_testimonios (
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
create index if not exists oms_testimonios_aprobado_idx on public.oms_testimonios (aprobado);

create table if not exists public.oms_articulos (
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
create index if not exists oms_articulos_estado_idx on public.oms_articulos (estado);
create index if not exists oms_articulos_fecha_idx on public.oms_articulos (fecha_publicacion desc);

-- ─── 4 · COMUNICACIÓN: mensajes, suscriptores, campañas, outbox ────────────

create table if not exists public.oms_mensajes (
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
comment on column public.oms_mensajes.web is 'Honeypot anti-spam: los humanos no lo rellenan; la RLS rechaza inserts con web rellena.';

create index if not exists oms_mensajes_leido_idx on public.oms_mensajes (leido);
create index if not exists oms_mensajes_creado_idx on public.oms_mensajes (creado_en desc);

create table if not exists public.oms_suscriptores (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  etiquetas text[] not null default '{}',
  creado_en timestamptz not null default now()
);

create table if not exists public.oms_campanas (
  id uuid primary key default gen_random_uuid(),
  asunto text not null,
  html text not null default '',
  estado text not null default 'borrador' check (estado in ('borrador', 'pendiente', 'enviada')),
  destinatarios jsonb not null default '{"tipo": "todos"}'::jsonb,
  estadisticas jsonb,
  enviada_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists oms_campanas_estado_idx on public.oms_campanas (estado);

create table if not exists public.oms_outbox (
  id uuid primary key default gen_random_uuid(),
  para text not null,
  asunto text default '',
  html text default '',
  eml text default '',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado')),
  ref_pedido text,
  ref_campana uuid references public.oms_campanas (id) on delete set null,
  creado_en timestamptz not null default now()
);
comment on table public.oms_outbox is 'Bandeja de salida OMS: correos pendientes cuando no hay Resend/SMTP; el panel los descarga como .eml.';
create index if not exists oms_outbox_estado_idx on public.oms_outbox (estado);
create index if not exists oms_outbox_pedido_idx on public.oms_outbox (ref_pedido);

-- ─── 5 · VENTAS: pedidos y líneas ──────────────────────────────────────────

create table if not exists public.oms_pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  numero_publico text unique,
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
comment on table public.oms_pedidos is 'Se crean SOLO desde la Edge Function pagos-firma (service_role); nadie más inserta.';
comment on column public.oms_pedidos.numero_publico is 'Número definitivo por lotes (p. ej. SHAD01-00001); lo asigna el trigger oms_numerar_pedido al verificar el pago. «numero» es la referencia interna del TPV de Redsys.';
create index if not exists oms_pedidos_estado_idx on public.oms_pedidos (estado);
create index if not exists oms_pedidos_creado_idx on public.oms_pedidos (creado_en desc);

create table if not exists public.oms_pedidos_lineas (
  id uuid primary key default gen_random_uuid(),
  pedido uuid not null references public.oms_pedidos (id) on delete cascade,
  codigo text default '',
  nombre text default '',
  cantidad integer not null default 1,
  precio_unitario numeric(10, 2) not null default 0,
  creado_en timestamptz not null default now()
);
create index if not exists oms_pedidos_lineas_pedido_idx on public.oms_pedidos_lineas (pedido);

-- Numeración por lotes: una fila (id='unica') con el lote y el último
-- secuencial repartido; el número definitivo se forma LOTE-00001.
create table if not exists public.oms_numeracion (
  id text primary key default 'unica' check (id = 'unica'),
  lote text not null default 'SHAD01',
  ultimo integer not null default 0,
  actualizado_en timestamptz not null default now(),
  constraint oms_numeracion_lote_formato check (lote ~ '^[A-Z0-9]{3,8}$')
);
comment on table public.oms_numeracion is
  'Contador de números de pedido por lotes (una fila). Editable desde el panel: Ajustes → Pedidos (solo admin).';

insert into public.oms_numeracion (id, lote, ultimo)
values ('unica', 'SHAD01', 0)
on conflict (id) do nothing;

-- Reparto secuencial a prueba de pagos simultáneos (bloqueo de fila)
create or replace function public.oms_siguiente_numero_publico()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  lote text;
  siguiente integer;
begin
  insert into public.oms_numeracion (id, lote, ultimo)
  values ('unica', 'SHAD01', 0)
  on conflict (id) do nothing;

  select lote, ultimo + 1
    into lote, siguiente
    from public.oms_numeracion
   where id = 'unica'
   for update;

  update public.oms_numeracion
     set ultimo = siguiente, actualizado_en = now()
   where id = 'unica';

  return upper(btrim(coalesce(lote, 'SHAD01'))) || '-' || lpad(siguiente::text, 5, '0');
end;
$$;

-- Asigna el número de lote solo cuando el pedido queda verificado con su pago
create or replace function public.oms_numerar_pedido_pagado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'pagado'
     and old.estado is distinct from 'pagado'
     and coalesce(new.numero_publico, '') = '' then
    new.numero_publico := public.oms_siguiente_numero_publico();
  end if;
  return new;
end;
$$;

drop trigger if exists oms_numerar_pedido on public.oms_pedidos;
create trigger oms_numerar_pedido
  before update of estado on public.oms_pedidos
  for each row
  execute function public.oms_numerar_pedido_pagado();

-- ─── 6 · AJUSTES (una fila id='general', una columna jsonb por sección) ────

create table if not exists public.oms_ajustes (
  id text primary key default 'general' check (id = 'general'),
  contacto jsonb not null default '{}'::jsonb,
  redes jsonb not null default '{}'::jsonb,
  smtp jsonb not null default '{}'::jsonb,
  redsys jsonb not null default '{}'::jsonb,
  envio jsonb not null default '{}'::jsonb,
  emails_automaticos jsonb not null default '{}'::jsonb,
  notificaciones jsonb not null default '{}'::jsonb,
  sistema jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

-- ─── 7 · updated_at automático (función y triggers propios de OMS) ─────────

create or replace function public.oms_set_actualizado_en()
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
  foreach tabla in array array['oms_categorias', 'oms_productos', 'oms_articulos', 'oms_ajustes'] loop
    execute format('drop trigger if exists %I on public.%I', tabla || '_actualizado', tabla);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.oms_set_actualizado_en()',
      tabla || '_actualizado', tabla
    );
  end loop;
end $$;

-- ─── 8 · VISTA PÚBLICA de productos con precio efectivo ────────────────────
-- No es security_invoker: corre como propietaria y expone solo estas columnas.

drop view if exists public.oms_productos_publicos;
create view public.oms_productos_publicos as
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
  p.zonas_envio,
  c.slug as categoria_slug,
  c.nombre as categoria_nombre,
  c.orden as categoria_orden,
  round((
    select min(candidato)
    from (
      select case when p.precio_oferta is not null and p.precio_oferta > 0 then p.precio_oferta else p.precio end as candidato
      union all
      select case o.tipo
               when 'porcentaje' then round(p.precio * (1 - o.valor / 100), 2)
               else round(o.valor, 2)
             end as candidato
      from public.oms_ofertas o
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
    from public.oms_ofertas o
    where o.producto = p.id
      and o.activa
      and (o.inicio is null or o.inicio <= now())
      and (o.fin is null or o.fin >= now())
  ), '[]'::jsonb) as ofertas_activas
from public.oms_productos p
left join public.oms_categorias c on c.id = p.categoria
where p.activo;

comment on view public.oms_productos_publicos is 'Catálogo público OMS con precio_efectivo (min entre precio_oferta y ofertas activas) y marca de agotado.';

-- ─── 9 · VISTA PÚBLICA de ajustes (SOLO datos públicos; nunca secretos) ────
-- La clave Redsys SOLO se expone cuando entorno = 'test'.

drop view if exists public.oms_ajustes_publicos;
create view public.oms_ajustes_publicos as
select
  a.id,
  a.contacto -> 'telefono'       as contacto_telefono,
  a.contacto -> 'direccion'      as contacto_direccion,
  a.contacto -> 'horario'        as contacto_horario,
  a.contacto -> 'emailsDestino'  as contacto_emails,
  a.redes,
  a.envio -> 'activo'            as envio_activo,
  a.envio -> 'plazos'            as envio_plazos,
  a.envio -> 'zonas'             as envio_zonas,
  a.envio -> 'paises'            as envio_paises,
  a.envio -> 'disponibilidad'    as envio_disponibilidad,
  a.envio -> 'coste'             as envio_coste,
  a.envio -> 'costeInternacional'       as envio_coste_internacional,
  a.envio -> 'gratisDesde'       as envio_gratis_desde,
  a.envio -> 'gratisDesdeInternacional' as envio_gratis_desde_internacional,
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
from public.oms_ajustes a
where a.id = 'general';

comment on view public.oms_ajustes_publicos is 'Solo lo público de los ajustes OMS. SMTP nunca; la clave Redsys solo en test (clave de pruebas pública).';

-- ─── 10 · ROW LEVEL SECURITY ───────────────────────────────────────────────
-- Igual que el proyecto dedicado, pero con las funciones oms_es_admin() y
-- oms_es_editor_o_mas(), que solo miran la tabla oms_usuarios.

alter table public.oms_usuarios        enable row level security;
alter table public.oms_categorias      enable row level security;
alter table public.oms_productos       enable row level security;
alter table public.oms_ofertas         enable row level security;
alter table public.oms_testimonios     enable row level security;
alter table public.oms_articulos       enable row level security;
alter table public.oms_mensajes        enable row level security;
alter table public.oms_suscriptores    enable row level security;
alter table public.oms_campanas        enable row level security;
alter table public.oms_outbox          enable row level security;
alter table public.oms_pedidos         enable row level security;
alter table public.oms_pedidos_lineas  enable row level security;
alter table public.oms_ajustes         enable row level security;

-- ---- usuarios del panel ----
drop policy if exists "oms perfil propio" on public.oms_usuarios;
create policy "oms perfil propio" on public.oms_usuarios
  for select to authenticated using (id = auth.uid());
drop policy if exists "oms admin gestiona usuarios" on public.oms_usuarios;
create policy "oms admin gestiona usuarios" on public.oms_usuarios
  for all to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());

-- ---- categorías ----
drop policy if exists "oms lectura publica" on public.oms_categorias;
create policy "oms lectura publica" on public.oms_categorias
  for select to anon, authenticated using (true);
drop policy if exists "oms escritura gestion" on public.oms_categorias;
create policy "oms escritura gestion" on public.oms_categorias
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- ---- productos ----
drop policy if exists "oms lectura gestion" on public.oms_productos;
create policy "oms lectura gestion" on public.oms_productos
  for select to authenticated using (true);
drop policy if exists "oms escritura gestion" on public.oms_productos;
create policy "oms escritura gestion" on public.oms_productos
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- ---- ofertas ----
drop policy if exists "oms lectura gestion" on public.oms_ofertas;
create policy "oms lectura gestion" on public.oms_ofertas
  for select to authenticated using (true);
drop policy if exists "oms escritura gestion" on public.oms_ofertas;
create policy "oms escritura gestion" on public.oms_ofertas
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- ---- testimonios ----
drop policy if exists "oms lectura aprobados publico" on public.oms_testimonios;
create policy "oms lectura aprobados publico" on public.oms_testimonios
  for select to anon using (aprobado);
drop policy if exists "oms lectura gestion" on public.oms_testimonios;
create policy "oms lectura gestion" on public.oms_testimonios
  for select to authenticated using (true);
drop policy if exists "oms escritura gestion" on public.oms_testimonios;
create policy "oms escritura gestion" on public.oms_testimonios
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- ---- artículos ----
drop policy if exists "oms lectura publicados publico" on public.oms_articulos;
create policy "oms lectura publicados publico" on public.oms_articulos
  for select to anon
  using (estado = 'publicado' or (estado = 'programado' and fecha_publicacion is not null and fecha_publicacion <= now()));
drop policy if exists "oms lectura gestion" on public.oms_articulos;
create policy "oms lectura gestion" on public.oms_articulos
  for select to authenticated using (true);
drop policy if exists "oms escritura gestion" on public.oms_articulos;
create policy "oms escritura gestion" on public.oms_articulos
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- ---- mensajes ----
drop policy if exists "oms alta formulario contacto" on public.oms_mensajes;
create policy "oms alta formulario contacto" on public.oms_mensajes
  for insert to anon, authenticated with check (coalesce(web, '') = '');
drop policy if exists "oms lectura equipo" on public.oms_mensajes;
create policy "oms lectura equipo" on public.oms_mensajes
  for select to authenticated using (true);
drop policy if exists "oms gestion bandeja" on public.oms_mensajes;
create policy "oms gestion bandeja" on public.oms_mensajes
  for update to authenticated using (true) with check (true);
drop policy if exists "oms borrado solo admin" on public.oms_mensajes;
create policy "oms borrado solo admin" on public.oms_mensajes
  for delete to authenticated using (public.oms_es_admin());

-- ---- suscriptores ----
drop policy if exists "oms alta boletin" on public.oms_suscriptores;
create policy "oms alta boletin" on public.oms_suscriptores
  for insert to anon, authenticated with check (email is not null and email <> '');
drop policy if exists "oms lectura gestion" on public.oms_suscriptores;
create policy "oms lectura gestion" on public.oms_suscriptores
  for select to authenticated using (public.oms_es_editor_o_mas());
drop policy if exists "oms borrado gestion" on public.oms_suscriptores;
create policy "oms borrado gestion" on public.oms_suscriptores
  for delete to authenticated using (public.oms_es_editor_o_mas());

-- ---- campañas ----
drop policy if exists "oms gestion editor" on public.oms_campanas;
create policy "oms gestion editor" on public.oms_campanas
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());
drop policy if exists "oms borrado solo admin" on public.oms_campanas;
create policy "oms borrado solo admin" on public.oms_campanas
  for delete to authenticated using (public.oms_es_admin());

-- ---- outbox ----
drop policy if exists "oms lectura gestion" on public.oms_outbox;
create policy "oms lectura gestion" on public.oms_outbox
  for select to authenticated using (public.oms_es_editor_o_mas());
drop policy if exists "oms marcado enviado" on public.oms_outbox;
create policy "oms marcado enviado" on public.oms_outbox
  for update to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());
drop policy if exists "oms borrado solo admin" on public.oms_outbox;
create policy "oms borrado solo admin" on public.oms_outbox
  for delete to authenticated using (public.oms_es_admin());

-- ---- pedidos ----
drop policy if exists "oms lectura autenticados" on public.oms_pedidos;
create policy "oms lectura autenticados" on public.oms_pedidos
  for select to authenticated using (true);
drop policy if exists "oms estado solo admin" on public.oms_pedidos;
create policy "oms estado solo admin" on public.oms_pedidos
  for update to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());
-- Insert NO tiene policy: solo service_role crea pedidos (Edge Function).

-- ---- líneas de pedido ----
drop policy if exists "oms lectura autenticados" on public.oms_pedidos_lineas;
create policy "oms lectura autenticados" on public.oms_pedidos_lineas
  for select to authenticated using (true);
drop policy if exists "oms modificacion solo admin" on public.oms_pedidos_lineas;
create policy "oms modificacion solo admin" on public.oms_pedidos_lineas
  for all to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());

-- ---- numeración por lotes ----
drop policy if exists "oms lectura autenticados" on public.oms_numeracion;
create policy "oms lectura autenticados" on public.oms_numeracion
  for select to authenticated using (true);
drop policy if exists "oms escritura solo admin" on public.oms_numeracion;
create policy "oms escritura solo admin" on public.oms_numeracion
  for all to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());

-- ---- ajustes ----
drop policy if exists "oms solo admin" on public.oms_ajustes;
create policy "oms solo admin" on public.oms_ajustes
  for all to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());

-- ---- grants (solo sobre los objetos OMS) ----
grant select on public.oms_productos_publicos, public.oms_ajustes_publicos to anon, authenticated;
grant select on public.oms_categorias, public.oms_testimonios, public.oms_articulos, public.oms_mensajes, public.oms_suscriptores to anon, authenticated;
grant insert on public.oms_mensajes, public.oms_suscriptores to anon, authenticated;
grant all on public.oms_usuarios, public.oms_categorias, public.oms_productos, public.oms_ofertas,
  public.oms_testimonios, public.oms_articulos, public.oms_mensajes, public.oms_suscriptores,
  public.oms_campanas, public.oms_outbox, public.oms_pedidos, public.oms_pedidos_lineas,
  public.oms_numeracion, public.oms_ajustes to service_role;
grant execute on function public.oms_tocar_acceso() to authenticated;

-- ─── 11 · STORAGE: bucket «recursos» para las imágenes del panel ───────────

insert into storage.buckets (id, name, "public")
values ('recursos', 'recursos', true)
on conflict (id) do update set "public" = true;

drop policy if exists "oms recursos lectura publica" on storage.objects;
create policy "oms recursos lectura publica" on storage.objects
  for select to anon, authenticated using (bucket_id = 'recursos');

drop policy if exists "oms recursos escritura gestion" on storage.objects;
create policy "oms recursos escritura gestion" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recursos' and public.oms_es_editor_o_mas());

drop policy if exists "oms recursos modificacion gestion" on storage.objects;
create policy "oms recursos modificacion gestion" on storage.objects
  for update to authenticated
  using (bucket_id = 'recursos' and public.oms_es_editor_o_mas())
  with check (bucket_id = 'recursos' and public.oms_es_editor_o_mas());

drop policy if exists "oms recursos borrado gestion" on storage.objects;
create policy "oms recursos borrado gestion" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recursos' and public.oms_es_editor_o_mas());
