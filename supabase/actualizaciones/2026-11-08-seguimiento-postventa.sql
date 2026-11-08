-- ============================================================================
-- 2026-11-08 · Seguimiento post-venta (journey de 4 correos automáticos)
-- ============================================================================
-- Qué añade:
--   1. Columnas en oms_pedidos: enviado_en, entregado_en, seguimiento_url y
--      plazo_entrega.
--   2. Tabla oms_seguimientos: un correo programado por pedido y tipo
--      (envio / cuidado / opinion), con fecha de envío y estado.
--   3. Trigger sobre oms_pedidos:
--        · estado → «enviado»   → programa «En camino» (inmediato).
--        · estado → «entregado» → programa «Consejos de uso» (+diasCuidado)
--                                 y «Opinión» (+diasOpinion), según ajustes.
--        · estado → «cancelado» → cancela los seguimientos pendientes.
--   4. oms_procesar_seguimientos(): toma los vencidos, aplica la plantilla de
--      Ajustes → Emails automáticos (variables {{nombre}} {{pedido}}
--      {{total}} {{articulos}} {{seguimientoUrl}} {{plazo}}
--      {{bloqueSeguimiento}}) y envía con Resend si existen pg_net y el
--      secreto de vault «resend_api_key»; si no, deja el correo en la bandeja
--      de salida (oms_outbox) descargable como .eml desde el panel.
--   5. Cron horario (si pg_cron está activa) que llama a la función anterior.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar). Para el envío automático cada hora,
-- activa las extensiones pg_cron y pg_net (Dashboard → Database → Extensions)
-- y vuelve a ejecutar este fichero. Para el envío REAL automático añade la
-- clave de Resend en vault:
--     select vault.create_secret('re_tu_api_key_de_resend', 'resend_api_key');
-- ============================================================================

-- ─── 1 · Columnas nuevas en pedidos ────────────────────────────────────────

alter table public.oms_pedidos add column if not exists enviado_en timestamptz;
alter table public.oms_pedidos add column if not exists entregado_en timestamptz;
alter table public.oms_pedidos add column if not exists seguimiento_url text not null default '';
alter table public.oms_pedidos add column if not exists plazo_entrega text not null default '';

comment on column public.oms_pedidos.seguimiento_url is 'Enlace de seguimiento del transporte; lo pide el panel al marcar el pedido «enviado».';
comment on column public.oms_pedidos.plazo_entrega is 'Tiempo estimado de entrega (texto libre) que se muestra en el correo «En camino».';
comment on column public.oms_pedidos.enviado_en is 'Fecha en la que el pedido pasó a «enviado» (la fija el trigger de seguimiento).';
comment on column public.oms_pedidos.entregado_en is 'Fecha en la que el pedido pasó a «entregado» (la fija el trigger de seguimiento).';

-- ─── 2 · Tabla de seguimientos programados ─────────────────────────────────

create table if not exists public.oms_seguimientos (
  id uuid primary key default gen_random_uuid(),
  pedido uuid not null references public.oms_pedidos (id) on delete cascade,
  tipo text not null check (tipo in ('envio', 'cuidado', 'opinion')),
  para text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'cancelado')),
  enviar_desde timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  procesado_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (pedido, tipo)
);
comment on table public.oms_seguimientos is 'Correos post-venta programados: envio (al salir el pedido), cuidado y opinion (tras la entrega). El cron o el botón del panel los convierten en envío real o en outbox.';
create index if not exists oms_seguimientos_pendientes_idx
  on public.oms_seguimientos (enviar_desde)
  where estado = 'pendiente';

alter table public.oms_seguimientos enable row level security;

drop policy if exists "oms lectura gestion" on public.oms_seguimientos;
create policy "oms lectura gestion" on public.oms_seguimientos
  for select to authenticated using (public.oms_es_editor_o_mas());
drop policy if exists "oms escritura gestion" on public.oms_seguimientos;
create policy "oms escritura gestion" on public.oms_seguimientos
  for all to authenticated using (public.oms_es_editor_o_mas()) with check (public.oms_es_editor_o_mas());
drop policy if exists "oms borrado solo admin" on public.oms_seguimientos;
create policy "oms borrado solo admin" on public.oms_seguimientos
  for delete to authenticated using (public.oms_es_admin());

grant all on public.oms_seguimientos to service_role;

-- ─── 3 · Utilidades de plantillas ──────────────────────────────────────────

-- Sustituye {{clave}} por el valor correspondiente del jsonb
create or replace function public.oms_reemplazar_variables(plantilla text, variables jsonb)
returns text
language plpgsql
stable
as $$
declare
  texto text := coalesce(plantilla, '');
  clave text;
  valor text;
begin
  for clave, valor in
    select clave, valor from jsonb_each_text(variables) as t(clave, valor)
  loop
    texto := replace(texto, '{{' || clave || '}}', coalesce(valor, ''));
  end loop;
  return texto;
end;
$$;

-- Lista de artículos en HTML (igual que en redsys-notificacion)
create or replace function public.oms_lista_articulos(lineas jsonb)
returns text
language plpgsql
stable
as $$
declare
  resultado text := '';
  linea jsonb;
begin
  for linea in select * from jsonb_array_elements(coalesce(lineas, '[]'::jsonb)) loop
    resultado := resultado || format(
      '<li>%s × %s — %s €</li>',
      coalesce(linea ->> 'cantidad', '1'),
      coalesce(linea ->> 'nombre', 'Artículo'),
      replace(to_char(coalesce(nullif(linea ->> 'precio_unitario', '')::numeric, 0), 'FM999999990.00'), '.', ',')
    );
  end loop;
  if resultado = '' then
    return '';
  end if;
  return '<ul style="padding-left:18px;margin:8px 0;">' || resultado || '</ul>';
end;
$$;

-- Plantillas por defecto (se usan cuando la de ajustes está vacía)
create or replace function public.oms_plantilla_seguimiento_defecto(tipo text)
returns jsonb
language sql
stable
as $$
select case tipo
  when 'envio' then jsonb_build_object(
    'asunto', 'Tu pedido {{pedido}} ya va en camino 📦',
    'html', $tpl$<p>Hola, {{nombre}}:</p>
<p>Tu paquete acaba de salir. Queremos que el trayecto sea tan fluido como esperas.</p>
{{bloqueSeguimiento}}
<p>Tiempo estimado de entrega: {{plazo}}.</p>
<p>Prepara un momento de calma para cuando lo recibas; nos hemos asegurado de cuidar cada detalle del embalaje.</p>
<p>Nos seguimos leyendo,<br>SHADDAI · Esencia de Umbral</p>$tpl$)
  when 'cuidado' then jsonb_build_object(
    'asunto', '¿Cómo ha sido tu primer contacto con tu pedido?',
    'html', $tpl$<p>Hola, {{nombre}}:</p>
<p>Hace unos días que tu pedido debió llegar a tus manos. Esperamos que la llegada haya ido sobre ruedas.</p>
<p>Para que le saques el máximo partido desde el primer momento, hemos preparado una breve guía con algunos consejos esenciales de uso y conservación:</p>
<ul>
<li><strong>Conservación:</strong> guarda tu esencia lejos de la luz solar directa y de fuentes de calor; así el aroma se mantiene intacto mucho más tiempo.</li>
<li><strong>Aplicación:</strong> aplícala sobre piel hidratada (muñecas, cuello o interior de los codos): la fragancia fija mejor y se desarrolla por capas.</li>
<li><strong>Truco:</strong> espera unos segundos tras aplicarla antes de acercarla a la nariz; las notas de salida se abren con la calidez de la piel.</li>
</ul>
<p>Si te ha surgido cualquier duda sobre cómo integrarlo en tu rutina, solo tienes que responder a este mensaje. Estamos aquí para ayudarte.</p>
<p>Con aprecio,<br>SHADDAI · Esencia de Umbral</p>$tpl$)
  else jsonb_build_object(
    'asunto', 'Tu opinión nos importa (de verdad)',
    'html', $tpl$<p>Hola, {{nombre}}:</p>
<p>Esperamos que estés disfrutando de tu pedido {{pedido}}.</p>
<p>Para nosotros, el trabajo no termina cuando entregamos un pedido; nos importa conocer el impacto real que tiene en quien lo recibe. Tu experiencia nos ayuda a seguir afinando cada fórmula y cada detalle.</p>
<p>¿Nos dedicarías 2 minutos para contarnos tus impresiones?</p>
<p style="text-align:center;margin:24px 0;"><a href="https://omshaddai.com/contacto.html" style="display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;">Dejar mi valoración</a></p>
<p>Gracias por formar parte de esto.</p>
<p>Un abrazo,<br>SHADDAI · Esencia de Umbral</p>$tpl$)
end;
$$;

-- ─── 4 · Trigger: programa los correos al cambiar de estado ────────────────

create or replace function public.oms_programar_seguimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ajustes_json jsonb := '{}'::jsonb;
  dias_cuidado integer;
  dias_opinion integer;
  correo text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  -- Cancelado: se cancelan también los correos pendientes
  if new.estado = 'cancelado' then
    update public.oms_seguimientos
       set estado = 'cancelado'
     where pedido = new.id and estado = 'pendiente';
    return new;
  end if;

  correo := coalesce(new.cliente ->> 'email', '');
  if correo = '' then
    return new;
  end if;

  select coalesce(emails_automaticos, '{}'::jsonb) into ajustes_json
    from public.oms_ajustes where id = 'general';
  dias_cuidado := greatest(coalesce(nullif(ajustes_json -> 'seguimiento' ->> 'diasCuidado', '')::int, 4), 0);
  dias_opinion := greatest(coalesce(nullif(ajustes_json -> 'seguimiento' ->> 'diasOpinion', '')::int, 12), 0);

  -- Mensaje 2 · En camino (inmediato)
  if new.estado = 'enviado' then
    if new.enviado_en is null then
      new.enviado_en := now();
    end if;
    insert into public.oms_seguimientos (pedido, tipo, para, enviar_desde, payload)
    values (new.id, 'envio', correo, now(), jsonb_build_object(
      'seguimientoUrl', coalesce(new.seguimiento_url, ''),
      'plazo', coalesce(new.plazo_entrega, '')))
    on conflict (pedido, tipo) do nothing;
  end if;

  -- Mensajes 3 y 4 · Consejos y opinión (días después de la entrega)
  if new.estado = 'entregado' then
    if new.entregado_en is null then
      new.entregado_en := now();
    end if;
    insert into public.oms_seguimientos (pedido, tipo, para, enviar_desde, payload)
    values (new.id, 'cuidado', correo, new.entregado_en + make_interval(days => dias_cuidado), jsonb_build_object(
      'seguimientoUrl', coalesce(new.seguimiento_url, ''),
      'plazo', coalesce(new.plazo_entrega, '')))
    on conflict (pedido, tipo) do nothing;

    insert into public.oms_seguimientos (pedido, tipo, para, enviar_desde, payload)
    values (new.id, 'opinion', correo, new.entregado_en + make_interval(days => dias_opinion), jsonb_build_object(
      'seguimientoUrl', coalesce(new.seguimiento_url, ''),
      'plazo', coalesce(new.plazo_entrega, '')))
    on conflict (pedido, tipo) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists oms_pedidos_seguimiento on public.oms_pedidos;
create trigger oms_pedidos_seguimiento
  before update of estado on public.oms_pedidos
  for each row
  execute function public.oms_programar_seguimiento();

-- ─── 5 · Procesador: envía los seguimientos vencidos ───────────────────────

create or replace function public.oms_procesar_seguimientos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
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
           p.numero, p.cliente, p.total, p.seguimiento_url, p.plazo_entrega,
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
      'pedido', fila.numero,
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
$$;

grant execute on function public.oms_procesar_seguimientos() to authenticated;

-- ─── 6 · Cron horario (opcional: requiere pg_cron) ─────────────────────────

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
exception when others then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    create extension if not exists pg_cron with schema extensions;
  end if;
exception when others then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron no está activa: los seguimientos se enviarán con el botón «Procesar pendientes ahora» del panel (o activa la extensión y re-ejecuta este fichero).';
    return;
  end if;
  begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'oms-seguimientos';
  exception when others then null;
  end;
  perform cron.schedule('oms-seguimientos', '9 * * * *', 'select public.oms_procesar_seguimientos();');
exception when others then
  raise notice 'No se pudo programar el cron de seguimientos: activa pg_cron y re-ejecuta.';
end $$;
