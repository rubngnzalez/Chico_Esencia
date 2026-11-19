-- ============================================================================
-- 2026-11-18 · Aviso por email de cada solicitud de distribuidor
-- ============================================================================
-- Qué hace:
--   Cada vez que alguien pulsa «Enviar solicitud» en distribuidores.html y la
--   solicitud entra en oms_distribuidores_solicitudes, se envía un correo a
--   DISTRIBUIDOR_EMAIL con los datos (empresa, contacto, email, teléfono y
--   mensaje) y con «Responder» apuntando al solicitante.
--
-- Destinatario: la constante DISTRIBUIDOR_EMAIL (más abajo). Para cambiarlo,
--   edita esa línea y vuelve a ejecutar el fichero.
--   Si el dominio omshaddai.com redirige esa dirección a omshaddai2026@gmail.com
--   (redirección del proveedor del dominio: p. ej. Cloudflare → Email → Email
--   Routing, o el panel de tu proveedor de correo), el aviso llega al Gmail.
--
-- Envío real: usa la misma infraestructura del seguimiento post-venta (fichero
--   2026-11-08): clave de Resend en vault («resend_api_key») + pg_net. Si no
--   están configurados, el correo NO se pierde: cae en la Bandeja de salida
--   del panel (Email marketing → Bandeja de entrada) como .eml descargable.
--
-- Garantía: el fallo del correo jamás bloquea la solicitud pública (todo va
--   dentro de bloques de excepción; la solicitud queda siempre guardada).
--
-- Instalación: activar pg_net (Dashboard → Database → Extensions), guardar la
--   clave de Resend si aún no está:
--     select vault.create_secret('re_tu_api_key_de_resend', 'resend_api_key');
--   y pegar TODO en el SQL Editor de Supabase (idempotente).
-- ============================================================================

-- ─── 1 · Función de aviso (trigger tras insertar una solicitud) ─────────────

create or replace function public.oms_aviso_solicitud_distribuidor()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  DISTRIBUIDOR_EMAIL constant text := 'distribuidor@omshaddai.com';
  asunto text;
  html text;
  eml text;
  desde text;
  clave_resend text;
  esquema_http text;
  estado_outbox text;
  smtp_json jsonb := '{}'::jsonb;
begin
  -- Honeypot: los bots no generan aviso
  if coalesce(new.web, '') <> '' then
    return new;
  end if;

  -- Remitente configurado (Ajustes → Correo) con reserva razonable
  begin
    select coalesce(smtp, '{}'::jsonb) into smtp_json
      from public.oms_ajustes where id = 'general' limit 1;
  exception when others then
    smtp_json := '{}'::jsonb;
  end;
  desde := coalesce(nullif(smtp_json ->> 'desde', ''),
    'SHADDAI · Esencia de Umbral <solicitudes@omshaddai.com>');

  asunto := 'Nueva solicitud de alianza · ' || coalesce(nullif(btrim(new.empresa), ''), 'espacio sin nombre');

  html := concat(
    '<div style="font-family:Georgia,serif;color:#16261b;line-height:1.7;max-width:40rem;">',
    '<p><span style="letter-spacing:.3em;color:#8a7541;font-size:.8rem;">DISTRIBUIDORES</span></p>',
    '<h2 style="margin:.3rem 0 1rem;">Nueva solicitud de alianza</h2>',
    '<table style="border-collapse:collapse;font-family:Verdana,Arial,sans-serif;font-size:.95rem;">',
    '<tr><td style="padding:.35rem .9rem .35rem 0;color:#6b7a6e;">Empresa</td><td><strong>',
      public.oms_texto_plano(new.empresa), '</strong></td></tr>',
    '<tr><td style="padding:.35rem .9rem .35rem 0;color:#6b7a6e;">Contacto</td><td>',
      public.oms_texto_plano(new.contacto), '</td></tr>',
    '<tr><td style="padding:.35rem .9rem .35rem 0;color:#6b7a6e;">Email</td><td>',
      public.oms_texto_plano(new.email), '</td></tr>',
    '<tr><td style="padding:.35rem .9rem .35rem 0;color:#6b7a6e;">Teléfono</td><td>',
      public.oms_texto_plano(new.telefono), '</td></tr>',
    '</table>',
    case when coalesce(btrim(new.mensaje), '') = '' then ''
      else '<p style="margin-top:1rem;"><strong>Mensaje:</strong></p><p style="white-space:pre-wrap;">'
           || public.oms_texto_plano(new.mensaje) || '</p>' end,
    '<p style="margin-top:1.4rem;color:#6b7a6e;font-family:Verdana,Arial,sans-serif;font-size:.85rem;">',
    'Recibida el ', to_char(new.creado_en at time zone 'Europe/Madrid', 'DD/MM/YYYY "a las" HH24:MI'),
    '. Revisa y gestiona la solicitud en el panel, sección <strong>Distribuidores</strong>.</p>',
    '</div>'
  );

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

  -- Envío real con Resend (pg_net); responder al solicitante con reply_to
  estado_outbox := 'pendiente';
  begin
    if clave_resend is not null and esquema_http is not null then
      execute format('select %I.http_post(url := $1, headers := $2, body := $3)', esquema_http)
        using 'https://api.resend.com/emails',
              jsonb_build_object('Authorization', 'Bearer ' || clave_resend, 'Content-Type', 'application/json'),
              jsonb_build_object(
                'from', desde,
                'to', jsonb_build_array(DISTRIBUIDOR_EMAIL),
                'reply_to', jsonb_build_array(coalesce(nullif(btrim(new.email), ''), DISTRIBUIDOR_EMAIL)),
                'subject', asunto,
                'html', html);
      estado_outbox := 'enviado';
    end if;
  exception when others then
    estado_outbox := 'pendiente';
  end;

  -- Copia de seguridad en la Bandeja de salida (siempre, con el estado real)
  eml := concat(
    'From: ', desde, E'\r\n',
    'To: ', DISTRIBUIDOR_EMAIL, E'\r\n',
    'Reply-To: ', coalesce(nullif(btrim(new.email), ''), DISTRIBUIDOR_EMAIL), E'\r\n',
    'Subject: ', asunto, E'\r\n',
    'MIME-Version: 1.0', E'\r\n',
    'Content-Type: text/html; charset=UTF-8', E'\r\n',
    'Content-Transfer-Encoding: 8bit', E'\r\n',
    'Date: ', to_char(now() at time zone 'UTC', 'Dy, DD Mon YYYY HH24:MI:SS "GMT"'), E'\r\n',
    'X-SHADDAI-Estado: ', estado_outbox, E'\r\n',
    E'\r\n',
    html, E'\r\n'
  );

  begin
    insert into public.oms_outbox (para, asunto, html, eml, estado)
    values (DISTRIBUIDOR_EMAIL, asunto, html, eml, estado_outbox);
  exception when others then
    null; -- ni siquiera la bandeja puede romper la solicitud pública
  end;

  return new;
end $$;

comment on function public.oms_aviso_solicitud_distribuidor() is
  'Avisa por email (Resend vía vault, con caída a oms_outbox) de cada nueva solicitud de alianza de distribuidores.html. Nunca bloquea el insert público.';

drop trigger if exists oms_aviso_solicitud_distribuidor on public.oms_distribuidores_solicitudes;
create trigger oms_aviso_solicitud_distribuidor
  after insert on public.oms_distribuidores_solicitudes
  for each row execute function public.oms_aviso_solicitud_distribuidor();

-- ─── 2 · Helper para escapar el texto de la solicitud en el HTML ────────────

create or replace function public.oms_texto_plano(texto text)
returns text
language sql
security definer
set search_path = public
as $$
  select replace(replace(replace(replace(replace(coalesce(texto, ''),
    '&', '&amp;'),
    '<', '&lt;'),
    '>', '&gt;'),
    '"', '&quot;'),
    E'\n', '<br>')
$$;

-- ─── 3 · Degradación en la web: el mailto de reserva apunta al distribuidor ─

-- (cambios en shaddai-web/js/distribuidores.js, fuera de este fichero)
