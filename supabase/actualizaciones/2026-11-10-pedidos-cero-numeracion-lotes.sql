-- ─────────────────────────────────────────────────────────────────────────────
-- SHADDAI · OMS — 2026-11-10 · Pedidos a cero + numeración por lotes
-- ─────────────────────────────────────────────────────────────────────────────
-- QUÉ HACE
--   1. VACÍA el apartado de pedidos: borra todos los pedidos (con sus líneas
--      y sus seguimientos post-venta, por cascada). La bandeja de salida de
--      correos (oms_outbox) NO se toca: es el histórico de emails.
--   2. NUMERACIÓN POR LOTES: los pedidos pagados reciben el número definitivo
--      SHAD01-00001 (lote «SHAD01» + secuencial de 5 dígitos). El número se
--      asigna SOLO cuando la compra queda verificada con su pago (transición
--      de estado a «pagado», vía webhook de Redsys o cambio manual del panel).
--   3. El «numero» interno que va al TPV de Redsys se conserva igual (Redsys
--      solo acepta 4-12 caracteres alfanuméricos, sin guiones): pasa a ser la
--      «referencia de pago». El número de lote es el que ve el cliente.
--   4. Si ya está desplegada la migración de seguimientos (2026-11-08),
--      actualiza sus correos para que muestren el número de lote.
--
-- CÓMO EJECUTARLO
--   Supabase → SQL Editor → New query → pegar TODO este fichero → Run.
--   Es idempotente: se puede lanzar más de una vez sin romper nada.
--   ATENCIÓN: el bloque «RESET» borra los pedidos existentes SIN vuelta atrás.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1 · Columna del número definitivo (de lote) en los pedidos ─────────────

alter table public.oms_pedidos add column if not exists numero_publico text;
comment on column public.oms_pedidos.numero_publico is
  'Número definitivo de pedido por lotes (p. ej. SHAD01-00001). Se asigna al verificarse el pago (estado «pagado»); null mientras el pedido está pendiente o cancelado. La columna «numero» es la referencia interna que va al TPV de Redsys.';
create unique index if not exists oms_pedidos_numero_publico_idx
  on public.oms_pedidos (numero_publico);

-- ─── 2 · Contador de numeración por lotes ───────────────────────────────────
--     Una fila única (id='unica'): «lote» es el prefijo (SHAD01, SHAD02, …)
--     y «ultimo» el último secuencial repartido. Se incrementa con bloqueo
--     de fila, así que dos pagos simultáneos nunca comparten número.

create table if not exists public.oms_numeracion (
  id text primary key default 'unica' check (id = 'unica'),
  lote text not null default 'SHAD01',
  ultimo integer not null default 0,
  actualizado_en timestamptz not null default now(),
  constraint oms_numeracion_lote_formato check (lote ~ '^[A-Z0-9]{3,8}$')
);
comment on table public.oms_numeracion is
  'Contador de números de pedido por lotes (una fila: id=''unica''). «lote» + secuencial de 5 dígitos forma el número definitivo, p. ej. SHAD01-00001. Editable desde el panel: Ajustes → Pedidos (solo admin).';

insert into public.oms_numeracion (id, lote, ultimo)
values ('unica', 'SHAD01', 0)
on conflict (id) do nothing;

alter table public.oms_numeracion enable row level security;
drop policy if exists "oms lectura autenticados" on public.oms_numeracion;
create policy "oms lectura autenticados" on public.oms_numeracion
  for select to authenticated using (true);
drop policy if exists "oms escritura solo admin" on public.oms_numeracion;
create policy "oms escritura solo admin" on public.oms_numeracion
  for all to authenticated using (public.oms_es_admin()) with check (public.oms_es_admin());

grant all on public.oms_numeracion to service_role;

-- ─── 3 · Reparto secuencial (a prueba de pagos simultáneos) ─────────────────

create or replace function public.oms_siguiente_numero_publico()
returns text
language plpgsql
security definer
set search_path = public
as $num$
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
$num$;

-- ─── 4 · Trigger: asigna el número de lote al pasar el pedido a «pagado» ────
--     Cubre tanto el webhook de Redsys (compra verificada con su pago) como
--     un cambio manual a «pagado» desde el panel. Es idempotente: un pedido
--     ya numerado nunca recibe otro número.

create or replace function public.oms_numerar_pedido_pagado()
returns trigger
language plpgsql
security definer
set search_path = public
as $num$
begin
  if new.estado = 'pagado'
     and old.estado is distinct from 'pagado'
     and coalesce(new.numero_publico, '') = '' then
    new.numero_publico := public.oms_siguiente_numero_publico();
  end if;
  return new;
end;
$num$;

drop trigger if exists oms_numerar_pedido on public.oms_pedidos;
create trigger oms_numerar_pedido
  before update of estado on public.oms_pedidos
  for each row
  execute function public.oms_numerar_pedido_pagado();

-- ─── 5 · Correos post-venta con el número de lote (si la migración de
--     seguimientos 2026-11-08 está desplegada; si no, se omite sin error) ───

do $seg$
begin
  if to_regclass('public.oms_seguimientos') is not null then
    execute $fn$
create or replace function public.oms_procesar_seguimientos()
returns integer
language plpgsql
security definer
set search_path = public
as $cuerpo$
declare
  ajustes_json jsonb := '{}'::jsonb;
  smtp_json jsonb := '{}'::jsonb;
  plantilla jsonb;
  defecto jsonb;
  asunto text;
  html text;
  eml text;
  desde text;
  clave_resend text;
  esquema_http text;
  estado_outbox text;
  variables jsonb;
  lineas jsonb;
  url_seguimiento text;
  bloque text;
  total integer := 0;
  fila record;
begin
  select coalesce(emails_automaticos, '{}'::jsonb), coalesce(smtp, '{}'::jsonb)
    into ajustes_json, smtp_json
    from public.oms_ajustes where id = 'general';
  desde := coalesce(nullif(smtp_json ->> 'desde', ''), 'SHADDAI · Esencia de Umbral <sin-configurar@omshaddai.com>');

  -- Clave de Resend en vault (opcional): envío real sin desplegar nada
  begin
    select decrypted_secret into clave_resend
      from vault.decrypted_secrets
     where name = 'resend_api_key'
     limit 1;
  exception when others then
    clave_resend := null;
  end;
  esquema_http := case
    when to_regproc('net.http_post') is not null then 'net'
    when to_regproc('extensions.http_post') is not null then 'extensions'
    else null
  end;

  for fila in
    select s.id, s.pedido, s.tipo, s.para,
           p.numero,
           coalesce(nullif(p.numero_publico, ''), p.numero) as numero_mostrar,
           p.cliente, p.total, p.seguimiento_url, p.plazo_entrega,
           p.id as pedido_id
      from public.oms_seguimientos s
      join public.oms_pedidos p on p.id = s.pedido
     where s.estado = 'pendiente' and s.enviar_desde <= now()
     order by s.enviar_desde
     limit 50
     for update of s skip locked
  loop
    url_seguimiento := coalesce(fila.seguimiento_url, '');
    if btrim(url_seguimiento) <> '' then
      bloque := '<p>Puedes seguir la entrega en tiempo real desde este enlace:</p>' ||
        '<p style="text-align:center;margin:24px 0;">' ||
        '<a href="' || url_seguimiento || '" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">👉 Seguir mi envío</a></p>';
    else
      bloque := '<p>El transporte te mantendrá informado del trayecto; para cualquier cambio de dirección o incidencia con la entrega, responde directamente a este correo y te ayudamos enseguida.</p>';
    end if;

    select coalesce(jsonb_agg(
             jsonb_build_object('cantidad', l.cantidad, 'nombre', l.nombre, 'precio_unitario', l.precio_unitario)
             order by l.creado_en), '[]'::jsonb)
      into lineas
      from public.oms_pedidos_lineas l
     where l.pedido = fila.pedido_id;

    plantilla := ajustes_json -> 'emails_automaticos' -> (
      case fila.tipo
        when 'envio' then 'seguimientoEnvio'
        when 'cuidado' then 'seguimientoCuidado'
        else 'seguimientoOpinion'
      end);

    -- Plantilla desactivada en ajustes: el seguimiento se cancela sin enviar
    if coalesce(plantilla ->> 'activo', 'true')::boolean = false then
      update public.oms_seguimientos
         set estado = 'cancelado', procesado_en = now()
       where id = fila.id;
      continue;
    end if;

    defecto := public.oms_plantilla_seguimiento_defecto(fila.tipo);
    asunto := coalesce(nullif(btrim(coalesce(plantilla ->> 'asunto', '')), ''), defecto ->> 'asunto');
    html := coalesce(nullif(btrim(coalesce(plantilla ->> 'html', '')), ''), defecto ->> 'html');

    variables := jsonb_build_object(
      'nombre', coalesce(fila.cliente ->> 'nombre', ''),
      'pedido', fila.numero_mostrar,
      'total', replace(to_char(fila.total, 'FM999999990.00'), '.', ',') || ' €',
      'articulos', public.oms_lista_articulos(lineas),
      'seguimientoUrl', url_seguimiento,
      'plazo', coalesce(fila.plazo_entrega, ''),
      'bloqueSeguimiento', bloque
    );
    asunto := public.oms_reemplazar_variables(asunto, variables);
    html := public.oms_reemplazar_variables(html, variables);

    -- Envío real con Resend (pg_net) si está configurado; si no, a la bandeja
    estado_outbox := 'pendiente';
    begin
      if clave_resend is not null and esquema_http is not null then
        execute format('select %I.http_post(url := $1, headers := $2, body := $3)', esquema_http)
          using 'https://api.resend.com/emails',
                jsonb_build_object('Authorization', 'Bearer ' || clave_resend, 'Content-Type', 'application/json'),
                jsonb_build_object('from', desde, 'to', jsonb_build_array(fila.para), 'subject', asunto, 'html', html);
        estado_outbox := 'enviado';
      end if;
    exception when others then
      estado_outbox := 'pendiente';
    end;

    eml := concat(
      'From: ', desde, E'\r\n',
      'To: ', fila.para, E'\r\n',
      'Subject: ', asunto, E'\r\n',
      'MIME-Version: 1.0', E'\r\n',
      'Content-Type: text/html; charset=UTF-8', E'\r\n',
      'Content-Transfer-Encoding: 8bit', E'\r\n',
      'Date: ', to_char(now() at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI:SS "GMT"'), E'\r\n',
      'X-SHADDAI-Estado: ', estado_outbox, E'\r\n',
      E'\r\n',
      html, E'\r\n'
    );

    insert into public.oms_outbox (para, asunto, html, eml, estado, ref_pedido)
    values (fila.para, asunto, html, eml, estado_outbox, fila.numero);

    update public.oms_seguimientos
       set estado = 'enviado', procesado_en = now()
     where id = fila.id;
    total := total + 1;
  end loop;

  return total;
end;
$cuerpo$
$fn$;
  end if;
end;
$seg$;

-- ─── 6 · RESET: dejar el apartado de pedidos a cero ─────────────────────────
--     ATENCIÓN SIN VUELTA ATRÁS: borra TODOS los pedidos (las líneas y los
--     seguimientos post-venta se borran en cascada) y reinicia el contador
--     para que el próximo pedido pagado reciba SHAD01-00001.
--     La bandeja de correos (oms_outbox) se conserva: es el histórico de email.

delete from public.oms_pedidos;

insert into public.oms_numeracion (id, lote, ultimo)
values ('unica', 'SHAD01', 0)
on conflict (id) do update set lote = 'SHAD01', ultimo = 0, actualizado_en = now();
