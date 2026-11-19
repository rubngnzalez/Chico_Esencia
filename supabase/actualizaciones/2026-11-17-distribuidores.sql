-- ============================================================================
-- 2026-11-17 · Sección DISTRIBUIDORES: alianza B2B con precios gestionables
-- ============================================================================
-- Qué añade:
--   1. Tabla «oms_distribuidores_packs»: los packs de la propuesta de alianza
--      B2B (Pack "Umbral", Pack "Ceremonia"…). La web pública ya NO los muestra:
--      los lee solo el área privada distribuidor.html con sesión de
--      distribuidor; todos los costes y valores
--      (inversión, PVP, beneficio, contenido, argumento) se editan desde el
--      panel (Distribuidores → Packs), sin tocar la web.
--   2. Tabla «oms_distribuidores»: cuentas de acceso del área privada de
--      distribuidores (usuario + contraseña reales de Supabase Auth, creados
--      desde el panel con la Edge Function oms-gestion-distribuidores).
--      Cada cuenta lleva su % de descuento sobre la inversión de los packs.
--   3. Tabla «oms_distribuidores_solicitudes»: solicitudes de alianza que
--      llegan del formulario de la web; el panel las revisa y, con
--      «Crear acceso», les abre cuenta de distribuidor.
--   4. RLS: los packs NO tienen lectura anon (guardan inversión, PVP y beneficio);
--      las cuentas solo las ve
--      cada distribuidor (y la administración); las solicitudes entran desde
--      la web (anon) y solo las lee el equipo (editor+). Como este cambio
--      crea los PRIMEROS usuarios autenticados ajenos al panel (los propios
--      distribuidores), también estrecha las lecturas «de personal»
--      preexistentes (pedidos, mensajes, stock, cupones…) con el nuevo helper
--      oms_es_personal(), para que un distribuidor no herede el acceso del
--      equipo.
--   5. Función oms_notificar_credenciales_distribuidor: envía por email las
--      credenciales al crear la cuenta o resetear la contraseña (con Resend
--      si está configurado; si no, quedan en oms_outbox). La llama la Edge
--      Function oms-gestion-distribuidores tras crear el usuario.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar).
-- ============================================================================

-- ─── 1 · Packs de la alianza B2B ───────────────────────────────────────────

create table if not exists public.oms_distribuidores_packs (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique,
  nombre text not null,
  etiqueta text default '',
  ideal_para text default '',
  contenido text default '',
  inversion_min numeric(10, 2),
  inversion_max numeric(10, 2),
  inversion_nota text default '',
  pvp numeric(10, 2),
  beneficio numeric(10, 2),
  beneficio_nota text default '',
  argumento text default '',
  destacado boolean not null default false,
  activo boolean not null default true,
  orden integer not null default 0,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint oms_distribuidores_packs_rango check (
    inversion_min is null or inversion_max is null or inversion_min <= inversion_max
  )
);
comment on table public.oms_distribuidores_packs is
  'Packs de la alianza B2B (web pública: distribuidores.html). Todo se edita en el panel: Distribuidores → Packs.';
comment on column public.oms_distribuidores_packs.etiqueta is 'Lema corto bajo el nombre (p. ej. «Riesgo cero / Entrada rápida»).';
comment on column public.oms_distribuidores_packs.inversion_min is 'Inversión de la tienda: precio del pack. Si min y max difieren se pinta un rango (145 € - 150 €).';
comment on column public.oms_distribuidores_packs.inversion_nota is 'Nota junto a la inversión (p. ej. «descuento aplicado»).';
comment on column public.oms_distribuidores_packs.beneficio_nota is 'Nota junto al beneficio (p. ej. «aprox. 50 % de margen»).';
comment on column public.oms_distribuidores_packs.destacado is 'El pack recomendado: recibe el sello dorado en la web.';

create index if not exists oms_distribuidores_packs_activo_idx on public.oms_distribuidores_packs (activo);
create index if not exists oms_distribuidores_packs_orden_idx on public.oms_distribuidores_packs (orden);

drop trigger if exists oms_distribuidores_packs_actualizado on public.oms_distribuidores_packs;
create trigger oms_distribuidores_packs_actualizado
  before update on public.oms_distribuidores_packs
  for each row execute function public.oms_set_actualizado_en();

-- Si una iteración previa creó la tabla sin la validación del rango, la añadimos
do $$
begin
  alter table public.oms_distribuidores_packs
    add constraint oms_distribuidores_packs_rango
    check (inversion_min is null or inversion_max is null or inversion_min <= inversion_max);
exception
  when duplicate_object then null; -- ya existía: nada que hacer
end $$;

-- Semilla: los dos packs del documento «Propuestas de Alianza B2B Shaddai»
insert into public.oms_distribuidores_packs
  (clave, nombre, etiqueta, ideal_para, contenido, inversion_min, inversion_max,
   inversion_nota, pvp, beneficio, beneficio_nota, argumento, destacado, activo, orden)
values
  ('umbral',
   'Pack «Umbral»',
   'Riesgo cero / Entrada rápida',
   'Ideal para tiendas de ropa pequeñas, estudios de yoga boutique o concept stores que nunca han vendido perfumería.',
   '3 Perfumes (50 ml) + 5 Bálsamos (12 g) + 1 Tester de cada uno de regalo',
   145, 150, '', 290, 140, 'aprox. 50 % de margen',
   '«Es una inversión mínima. Con que vendas un perfume y un par de bálsamos, ya has recuperado tu coste. El resto es beneficio puro para tu espacio.»',
   false, true, 1),
  ('ceremonia',
   'Pack «Ceremonia»',
   'El estándar recomendado',
   'Ideal para centros de terapias holísticas, spas o concept stores con mayor rotación.',
   '6 Perfumes (50 ml) + 10 Bálsamos (12 g) + Testers + Material PLV (Expositor)',
   275, 275, 'descuento aplicado', 580, 305, '',
   '«Este pack incluye material de exposición para que el producto hable por sí solo y respire la filosofía de la marca en tu estantería.»',
   true, true, 2)
on conflict (clave) do nothing;

-- ─── 2 · Cuentas de distribuidor (acceso al área privada) ──────────────────
-- El alta real vive en auth.users (Supabase Auth compartido); la fila aquí es
-- su ficha: empresa, contacto y SU descuento sobre los packs. La crean desde
-- el panel con la Edge Function «oms-gestion-distribuidores» (solo admin).

create table if not exists public.oms_distribuidores (
  id uuid primary key references auth.users (id) on delete cascade,
  empresa text not null default '',
  contacto text default '',
  email text not null,
  telefono text default '',
  ciudad text default '',
  descuento numeric(5, 2) not null default 0 check (descuento between 0 and 100),
  notas text default '',
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  ultimo_acceso timestamptz
);
comment on table public.oms_distribuidores is
  'Cuentas del área privada de distribuidores (usuario y contraseña de Supabase Auth, dados desde el panel).';
comment on column public.oms_distribuidores.descuento is
  'Porcentaje que se aplica sobre la inversión de cada pack para sus condiciones privadas (0 = precio de lista).';

-- ¿Quién es un distribuidor activo? (helper SECURITY DEFINER: sin recursión RLS)
create or replace function public.oms_es_distribuidor_activo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.oms_distribuidores
     where id = auth.uid() and activo
  );
$$;

-- ¿Quién es personal del panel (cualquier rol activo de oms_usuarios)?
-- A partir de esta migración existen usuarios autenticados ajenos al equipo
-- (los distribuidores): las policies de lectura «de personal» deben distinguir
-- ambos mundos para que un distribuidor no herede el acceso del equipo.
create or replace function public.oms_es_personal()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.oms_usuarios
     where id = auth.uid() and activo
  );
$$;

-- Marca el último acceso del distribuidor actual (la web la llama al entrar).
create or replace function public.oms_tocar_acceso_distribuidor()
returns void
language sql
security definer
set search_path = public
as $$
  update public.oms_distribuidores set ultimo_acceso = now() where id = auth.uid();
$$;

-- Envía el email de credenciales de un distribuidor (alta o contraseña nueva
-- desde el panel). Devuelve true SOLO si el correo salió con Resend (clave
-- «resend_api_key» en vault + pg_net); devuelve false si quedó en oms_outbox
-- (descargable como .eml desde Panel → Correo → Bandeja de salida).
create or replace function public.oms_notificar_credenciales_distribuidor(
  p_distribuidor uuid,
  p_contrasena text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  fila record; smtp_json jsonb := '{}'::jsonb; desde text; clave_resend text;
  esquema_http text; estado_outbox text; asunto text; html text; eml text;
begin
  if p_contrasena is null or btrim(p_contrasena) = '' then return false; end if;
  select * into fila from public.oms_distribuidores where id = p_distribuidor;
  if not found then return false; end if;
  select coalesce(smtp, '{}'::jsonb) into smtp_json from public.oms_ajustes where id = 'general';
  desde := coalesce(nullif(smtp_json ->> 'desde', ''), 'SHADDAI · Esencia de Umbral <sin-configurar@omshaddai.com>');
  begin
    select decrypted_secret into clave_resend from vault.decrypted_secrets where name = 'resend_api_key' limit 1;
  exception when others then clave_resend := null;
  end;
  esquema_http := case when to_regproc('net.http_post') is not null then 'net'
    when to_regproc('extensions.http_post') is not null then 'extensions' else null end;
  asunto := 'Tu acceso de distribuidor · SHADDAI Esencia de Umbral';
  html := concat(
    '<div style="font-family:Verdana,Arial,sans-serif;color:#2b2b2b;max-width:560px;margin:0 auto;">',
    '<p style="font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#c9a45f;">SHADDAI · Esencia de Umbral</p>',
    '<h1 style="font-size:20px;font-weight:normal;">Tu acceso de distribuidor está listo</h1>',
    '<p>Hola ', coalesce(nullif(fila.contacto, ''), fila.empresa), ':</p>',
    '<p>Tu alianza con SHADDAI ya está activada. Estas son tus credenciales para entrar en el <strong>área de distribuidores</strong> y ver tus condiciones personalizadas:</p>',
    '<table style="width:100%;border-collapse:collapse;margin:18px 0;">',
    '<tr><td style="padding:8px;border-top:1px solid #e5dcc4;"><strong>Usuario</strong></td><td style="padding:8px;border-top:1px solid #e5dcc4;">', fila.email, '</td></tr>',
    '<tr><td style="padding:8px;border-top:1px solid #e5dcc4;"><strong>Contraseña</strong></td><td style="padding:8px;border-top:1px solid #e5dcc4;"><code style="font-size:15px;">', p_contrasena, '</code></td></tr>',
    '</table>',
    '<p style="text-align:center;margin:24px 0;">',
    '<a href="https://omshaddai.com/distribuidor.html" style="display:inline-block;background:#16261b;color:#f3eee2;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Entrar al área de distribuidores</a></p>',
    '<p>Te recomendamos cambiar la contraseña desde tu área privada en el primer acceso.</p>',
    '<p style="color:#7a7a6f;font-size:12px;">Si no solicitaste este acceso, ignora este correo y escríbenos a info@omshaddai.com.</p>',
    '</div>');
  estado_outbox := 'pendiente';
  begin
    if clave_resend is not null and esquema_http is not null then
      execute format('select %I.http_post(url := $1, headers := $2, body := $3)', esquema_http)
        using 'https://api.resend.com/emails',
              jsonb_build_object('Authorization', 'Bearer ' || clave_resend, 'Content-Type', 'application/json'),
              jsonb_build_object('from', desde, 'to', jsonb_build_array(fila.email), 'subject', asunto, 'html', html);
      estado_outbox := 'enviado';
    end if;
  exception when others then estado_outbox := 'pendiente';
  end;
  eml := concat('From: ', desde, E'\r\n', 'To: ', fila.email, E'\r\n', 'Subject: ', asunto, E'\r\n',
    'MIME-Version: 1.0', E'\r\n', 'Content-Type: text/html; charset=UTF-8', E'\r\n',
    'Content-Transfer-Encoding: 8bit', E'\r\n',
    'Date: ', to_char(now() at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI:SS "GMT"'), E'\r\n',
    'X-SHADDAI-Estado: ', estado_outbox, E'\r\n', E'\r\n', html, E'\r\n');
  begin
    insert into public.oms_outbox (para, asunto, html, eml, estado) values (fila.email, asunto, html, eml, estado_outbox);
  exception when others then return false;
  end;
  return estado_outbox = 'enviado';
end;
$$;

-- ─── 3 · Solicitudes de alianza (formulario público) ───────────────────────

create table if not exists public.oms_distribuidores_solicitudes (
  id uuid primary key default gen_random_uuid(),
  empresa text default '',
  contacto text default '',
  email text default '',
  telefono text default '',
  mensaje text default '',
  web text not null default '',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'gestionada', 'descartada')),
  creado_en timestamptz not null default now()
);
comment on table public.oms_distribuidores_solicitudes is
  'Solicitudes de alianza del formulario de distribuidores.html. El panel las revisa y «Crear acceso» abre la cuenta.';
comment on column public.oms_distribuidores_solicitudes.web is
  'Honeypot anti-spam: los humanos no lo rellenan; la RLS rechaza inserts con web rellena.';

create index if not exists oms_distribuidores_solicitudes_estado_idx on public.oms_distribuidores_solicitudes (estado);
create index if not exists oms_distribuidores_solicitudes_creado_idx on public.oms_distribuidores_solicitudes (creado_en desc);

-- Si una iteración previa creó la columna «notas» (no la usa nadie), la retiramos
alter table public.oms_distribuidores_solicitudes drop column if exists notas;

-- ─── 4 · ROW LEVEL SECURITY ────────────────────────────────────────────────

alter table public.oms_distribuidores_packs       enable row level security;
alter table public.oms_distribuidores             enable row level security;
alter table public.oms_distribuidores_solicitudes enable row level security;

-- ---- packs: sin lectura anon; el panel (editor+) lo gestiona entero ----
drop policy if exists "oms lectura publica" on public.oms_distribuidores_packs;
-- SIN lectura anon: la tabla guarda inversión, PVP y beneficio; la web pública ya no muestra packs.

drop policy if exists "oms lectura gestion" on public.oms_distribuidores_packs;
create policy "oms lectura gestion" on public.oms_distribuidores_packs
  for select to authenticated
  using (public.oms_es_editor_o_mas() or (public.oms_es_distribuidor_activo() and activo));

drop policy if exists "oms escritura gestion" on public.oms_distribuidores_packs;
create policy "oms escritura gestion" on public.oms_distribuidores_packs
  for all to authenticated
  using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

-- ---- cuentas: cada distribuidor se ve a sí mismo; el equipo las consulta;
-- ---- solo la administración las modifica ----
drop policy if exists "oms ficha propia" on public.oms_distribuidores;
create policy "oms ficha propia" on public.oms_distribuidores
  for select to authenticated using (id = auth.uid() and activo);

drop policy if exists "oms lectura gestion" on public.oms_distribuidores;
create policy "oms lectura gestion" on public.oms_distribuidores
  for select to authenticated using (public.oms_es_editor_o_mas());

drop policy if exists "oms admin gestiona distribuidores" on public.oms_distribuidores;
create policy "oms admin gestiona distribuidores" on public.oms_distribuidores
  for all to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());
-- Insert SIN policy para authenticated: las cuentas se crean solo con la
-- Edge Function (service_role), igual que los usuarios del panel.

-- ---- solicitudes: alta pública con honeypot; gestión en el panel ----
drop policy if exists "oms alta solicitud" on public.oms_distribuidores_solicitudes;
create policy "oms alta solicitud" on public.oms_distribuidores_solicitudes
  for insert to anon, authenticated with check (coalesce(web, '') = '');

drop policy if exists "oms lectura gestion" on public.oms_distribuidores_solicitudes;
create policy "oms lectura gestion" on public.oms_distribuidores_solicitudes
  for select to authenticated using (public.oms_es_editor_o_mas());

drop policy if exists "oms escritura gestion" on public.oms_distribuidores_solicitudes;
create policy "oms escritura gestion" on public.oms_distribuidores_solicitudes
  for update to authenticated
  using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());

drop policy if exists "oms borrado solo admin" on public.oms_distribuidores_solicitudes;
create policy "oms borrado solo admin" on public.oms_distribuidores_solicitudes
  for delete to authenticated using (public.oms_es_admin());

-- ─── 5 · ESTRECHAR LECTURAS «DE PERSONAL» (distribuidores ≠ equipo) ────────
-- Hasta hoy «authenticated» equivalía a personal del panel y varias policies
-- usaban using (true). Con cuentas de distribuidor reales (ajenas al equipo),
-- esas policies les darían lectura de pedidos con PII de clientes, bandeja de
-- contacto, borradores, stock y códigos de descuento. Se reemplazan por
-- oms_es_personal(): el equipo conserva TODO su acceso (admin/editor/lector),
-- la web pública no usa estas policies (lee vistas owner-rights) y los
-- distribuidores solo ven lo suyo (packs activos y su ficha).

drop policy if exists "oms lectura gestion" on public.oms_productos;
create policy "oms lectura gestion" on public.oms_productos
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura gestion" on public.oms_ofertas;
create policy "oms lectura gestion" on public.oms_ofertas
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura gestion" on public.oms_testimonios;
create policy "oms lectura gestion" on public.oms_testimonios
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura gestion" on public.oms_articulos;
create policy "oms lectura gestion" on public.oms_articulos
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura equipo" on public.oms_mensajes;
create policy "oms lectura equipo" on public.oms_mensajes
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms gestion bandeja" on public.oms_mensajes;
create policy "oms gestion bandeja" on public.oms_mensajes
  for update to authenticated using (public.oms_es_personal()) with check (public.oms_es_personal());

drop policy if exists "oms lectura autenticados" on public.oms_pedidos;
create policy "oms lectura autenticados" on public.oms_pedidos
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura autenticados" on public.oms_pedidos_lineas;
create policy "oms lectura autenticados" on public.oms_pedidos_lineas
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura gestion" on public.oms_stock_movimientos;
create policy "oms lectura gestion" on public.oms_stock_movimientos
  for select to authenticated using (public.oms_es_personal());

drop policy if exists "oms lectura autenticados" on public.oms_numeracion;
create policy "oms lectura autenticados" on public.oms_numeracion
  for select to authenticated using (public.oms_es_personal());

-- Política añadida por 2026-11-12-cupones-descuento.sql con using (true)
drop policy if exists "oms lectura gestion" on public.oms_cupones;
create policy "oms lectura gestion" on public.oms_cupones
  for select to authenticated using (public.oms_es_personal());

-- ─── 6 · Grants ────────────────────────────────────────────────────────────

revoke select on public.oms_distribuidores_packs from anon;
grant select on public.oms_distribuidores_packs to authenticated;
grant insert on public.oms_distribuidores_solicitudes to anon, authenticated;
grant all on public.oms_distribuidores_packs to service_role;
grant all on public.oms_distribuidores to service_role;
grant all on public.oms_distribuidores_solicitudes to service_role;
grant execute on function public.oms_tocar_acceso_distribuidor() to authenticated;

-- ============================================================================
-- Comprobación rápida (opcional, en el SQL Editor):
--   select clave, nombre, inversion_min, inversion_max, pvp, beneficio
--     from public.oms_distribuidores_packs order by orden;   → 2 packs
-- ============================================================================
