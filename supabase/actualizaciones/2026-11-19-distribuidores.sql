-- ============================================================================
-- Actualización 2026-11-19 · Red de Distribuidores SHADDAI
-- ============================================================================
-- Qué añade:
--   1. Tablas del programa de distribuidores:
--        · oms_distrib_solicitudes       → captación "Hazte distribuidor"
--                                          (banco de emails + cola de solicitudes
--                                          con verificación autogestionada).
--        · oms_distribuidores            → distribuidores aceptados
--                                          (% descuento, territorios, acceso).
--        · oms_distrib_recursos          → material comercial (logos, posters,
--                                          fichas PDF, intención/ventas reales).
--        · oms_distrib_recursos_accesos  → carpetas (zonas) autorizadas por
--                                          distribuidor.
--   2. Columnas ADITIVAS en oms_pedidos: canal / distribuidor_id /
--      descuento_pct (con DEFAULT; el flujo de clientes no cambia).
--   3. Guard post-venta: los pedidos canal='distribuidor' NO generan los
--      correos post-venta de clientes finales (oms_programar_seguimiento).
--   4. RLS completa + ajuste de las policies de lectura de pedidos/líneas/
--      stock para que un distribuidor solo vea SUS pedidos (el resto del
--      equipo del panel sigue viéndolo todo, igual que hoy).
--   5. Bucket privado de storage «oms-distrib» para el material comercial.
--   6. Sección nueva de ajustes «distribucion» (emails destino, IBAN,
--      plantillas de correos de marca y textos legales con versión).
--
-- Instalación: SQL Editor del proyecto → pegar TODO y ejecutar. Idempotente.
-- NO se modifica nada del flujo de compra de clientes: las columnas nuevas de
-- oms_pedidos tienen DEFAULT y ningún trigger existente cambia de conducta
-- para pedidos de clientes.
-- ============================================================================

-- ─── 1 · SOLICITUDES de distribuidor (captación web) ───────────────────────

create table if not exists public.oms_distrib_solicitudes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  estado text not null default 'pendiente_verificacion' check (estado in (
    'pendiente_verificacion', 'verificada', 'completada', 'aceptada', 'rechazada', 'descartada'
  )),
  -- Contacto básico (obligatorios en el paso 1; solo el email se verifica)
  persona_contacto text not null default '',
  telefono text not null default '',
  -- Verificación autogestionada: token de un uso, 24 h, solo hash en BD
  token_hash text,
  token_expira timestamptz,
  verificado_en timestamptz,
  reenvios integer not null default 0,
  ultimo_reenvio timestamptz,
  -- Formulario completo (empresa + cuestionario) al completar el paso 2
  datos jsonb not null default '{}'::jsonb,
  -- Aceptaciones legales (bloque visible obligatorio antes de enviar)
  legal_aceptado_en timestamptz,
  privacidad_aceptado_en timestamptz,
  textos_version integer,
  aceptacion_ip text,
  -- Enlace con el distribuidor creado al aceptar la solicitud
  distribuidor_id uuid,
  -- Notas internas del equipo (solo panel)
  notas_personal text not null default '',
  origen_ip text,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.oms_distrib_solicitudes is
  'Captación "Hazte distribuidor": banco de emails sin verificar + cola de solicitudes completas pendientes de aceptar. Las escrituras públicas SOLO vía Edge Functions (service_role); el token de verificación se guarda solo como hash.';
create index if not exists oms_distrib_solicitudes_estado_idx
  on public.oms_distrib_solicitudes (estado, creado_en desc);
create index if not exists oms_distrib_solicitudes_email_idx
  on public.oms_distrib_solicitudes (lower(btrim(email)));
-- Un registro ACTIVO por email (rechazadas/descartadas permiten reintentar luego)
create unique index if not exists oms_distrib_solicitudes_email_activo_uniq
  on public.oms_distrib_solicitudes (lower(btrim(email)))
  where estado not in ('rechazada', 'descartada');

drop trigger if exists oms_distrib_solicitudes_touch on public.oms_distrib_solicitudes;
create trigger oms_distrib_solicitudes_touch before update on public.oms_distrib_solicitudes
  for each row execute function public.oms_set_actualizado_en();

-- ─── 2 · DISTRIBUIDORES aceptados ──────────────────────────────────────────

create table if not exists public.oms_distribuidores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique,                    -- cuenta de Supabase Auth (zona VIP)
  solicitud_id uuid references public.oms_distrib_solicitudes (id) on delete set null,
  empresa text not null default '',
  razon_social text not null default '',
  cif text not null default '',
  persona_contacto text not null default '',
  email text not null unique,
  telefono text not null default '',
  direccion jsonb not null default '{}'::jsonb,
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  -- Interruptor puntual de acceso a la zona VIP (habilitar / deshabilitar)
  acceso_habilitado boolean not null default true,
  -- Territorios geográficos asignados (provincias, comunidades o países)
  zonas_territorio text[] not null default '{}',
  notas_personal text not null default '',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.oms_distribuidores is
  'Distribuidores aceptados: cuenta de zona VIP (user_id), % de descuento aplicado en servidor al firmar, territorios y acceso habilitado/deshabilitado puntualmente.';
create index if not exists oms_distribuidores_user_idx on public.oms_distribuidores (user_id);

drop trigger if exists oms_distribuidores_touch on public.oms_distribuidores;
create trigger oms_distribuidores_touch before update on public.oms_distribuidores
  for each row execute function public.oms_set_actualizado_en();

-- ─── 3 · RECURSOS comerciales y accesos por carpeta ────────────────────────

create table if not exists public.oms_distrib_recursos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  tipo text not null default 'otro' check (tipo in (
    'logo', 'poster', 'ficha_producto', 'intencion_ventas', 'ventas_reales', 'otro'
  )),
  zona text not null default 'general',   -- carpeta temática (ej. marca, producto, formacion)
  archivo text not null default '',       -- ruta dentro del bucket privado oms-distrib
  descripcion text not null default '',
  visible boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.oms_distrib_recursos is
  'Material comercial para distribuidores: logos, posters, fichas de producto, hojas de intención de ventas y ventas reales. El archivo vive en el bucket privado oms-distrib con ruta zona/nombre.';
create index if not exists oms_distrib_recursos_zona_idx on public.oms_distrib_recursos (zona, visible);

drop trigger if exists oms_distrib_recursos_touch on public.oms_distrib_recursos;
create trigger oms_distrib_recursos_touch before update on public.oms_distrib_recursos
  for each row execute function public.oms_set_actualizado_en();

create table if not exists public.oms_distrib_recursos_accesos (
  distribuidor_id uuid not null references public.oms_distribuidores (id) on delete cascade,
  zona text not null,
  creado_en timestamptz not null default now(),
  primary key (distribuidor_id, zona)
);
comment on table public.oms_distrib_recursos_accesos is
  'A qué carpetas (zonas) de material comercial accede cada distribuidor. Sin fila = sin acceso a esa carpeta.';

-- ─── 4 · PEDIDOS: columnas ADITIVAS (el flujo de clientes no cambia) ───────

alter table public.oms_pedidos add column if not exists canal text not null default 'web';
alter table public.oms_pedidos add column if not exists distribuidor_id uuid references public.oms_distribuidores (id) on delete set null;
alter table public.oms_pedidos add column if not exists descuento_pct numeric(5, 2) not null default 0;

comment on column public.oms_pedidos.canal is 'Origen del pedido: «web» (clientes, como siempre) o «distribuidor» (zona VIP). Los inserts los controlan solo las Edge Functions; el valor por defecto mantiene el flujo de clientes intacto.';
comment on column public.oms_pedidos.distribuidor_id is 'Distribuidor del pedido (zona VIP); null en pedidos de clientes.';
comment on column public.oms_pedidos.descuento_pct is '% de descuento del distribuidor aplicado en servidor al calcular el importe; 0 en pedidos de clientes.';
create index if not exists oms_pedidos_distribuidor_idx on public.oms_pedidos (distribuidor_id);

-- ─── 5 · GUARD POST-VENTA (distribuidores no reciben correos de cliente) ───
-- La MISMA función de 2026-11-08 con una condición aditiva al principio:
-- los pedidos canal='distribuidor' no entran en el journey de 4 correos.
-- Los pedidos de clientes se comportan EXACTAMENTE igual que antes.

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

  -- GUARD DISTRIBUIDORES (2026-11-19): los pedidos de la zona VIP no
  -- reciben los correos post-venta pensados para el cliente final.
  if coalesce(new.canal, 'web') = 'distribuidor' then
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

-- ─── 6 · AYUDANTES de pertenencia (para RLS) ───────────────────────────────
-- Panel activo: usuarios de la tabla oms_usuarios con activo = true
-- (administración, edición y lectura del panel, igual que hoy).
-- Un distribuidor NO es personal del panel: su perfil de oms_usuarios se
-- deja con activo = false al crear la cuenta (lo hace la Edge Function).

create or replace function public.oms_panel_activo(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select activo from public.oms_usuarios where id = uid), false);
$$;

comment on function public.oms_panel_activo(uuid) is
  'true si el uid es personal activo del panel (oms_usuarios.activo). Los distribuidores de zona VIP no lo son.';

-- ─── 7 · ROW LEVEL SECURITY de las tablas nuevas ───────────────────────────
-- Patrón schema-oms.sql: anon sin acceso directo (todo vía Edge Functions con
-- service_role); authenticated = personal del panel (gestión) y distribuidores
-- (solo lo suyo).

alter table public.oms_distrib_solicitudes      enable row level security;
alter table public.oms_distribuidores           enable row level security;
alter table public.oms_distrib_recursos         enable row level security;
alter table public.oms_distrib_recursos_accesos enable row level security;

-- ---- solicitudes (solo el equipo del panel) ----
drop policy if exists "oms distrib solicitudes lectura" on public.oms_distrib_solicitudes;
create policy "oms distrib solicitudes lectura" on public.oms_distrib_solicitudes
  for select to authenticated using (public.oms_panel_activo(auth.uid()));
drop policy if exists "oms distrib solicitudes gestion" on public.oms_distrib_solicitudes;
create policy "oms distrib solicitudes gestion" on public.oms_distrib_solicitudes
  for update to authenticated
  using (public.oms_panel_activo(auth.uid()))
  with check (public.oms_panel_activo(auth.uid()));
drop policy if exists "oms distrib solicitudes borrar admin" on public.oms_distrib_solicitudes;
create policy "oms distrib solicitudes borrar admin" on public.oms_distrib_solicitudes
  for delete to authenticated using (public.oms_es_admin());
-- Insert SIN policy: las solicitudes se crean solo desde la Edge Function.

-- ---- distribuidores (panel ve y gestiona; el distribuidor lee lo suyo) ----
drop policy if exists "oms distrib lectura" on public.oms_distribuidores;
create policy "oms distrib lectura" on public.oms_distribuidores
  for select to authenticated using (
    public.oms_panel_activo(auth.uid()) or user_id = auth.uid()
  );
drop policy if exists "oms distrib gestion" on public.oms_distribuidores;
create policy "oms distrib gestion" on public.oms_distribuidores
  for all to authenticated
  using (public.oms_panel_activo(auth.uid()))
  with check (public.oms_panel_activo(auth.uid()));

-- ---- recursos (panel; el distribuidor ve solo sus carpetas visibles) ----
drop policy if exists "oms distrib recursos lectura panel" on public.oms_distrib_recursos;
create policy "oms distrib recursos lectura panel" on public.oms_distrib_recursos
  for select to authenticated using (public.oms_panel_activo(auth.uid()));
drop policy if exists "oms distrib recursos lectura distribuidor" on public.oms_distrib_recursos;
create policy "oms distrib recursos lectura distribuidor" on public.oms_distrib_recursos
  for select to authenticated
  using (
    visible and exists (
      select 1
        from public.oms_distribuidores d
        join public.oms_distrib_recursos_accesos a on a.distribuidor_id = d.id
       where d.user_id = auth.uid()
         and d.acceso_habilitado
         and a.zona = zona
    )
  );
drop policy if exists "oms distrib recursos gestion" on public.oms_distrib_recursos;
create policy "oms distrib recursos gestion" on public.oms_distrib_recursos
  for all to authenticated
  using (public.oms_panel_activo(auth.uid()))
  with check (public.oms_panel_activo(auth.uid()));

-- ---- accesos a carpetas (solo panel) ----
drop policy if exists "oms distrib accesos lectura" on public.oms_distrib_recursos_accesos;
create policy "oms distrib accesos lectura" on public.oms_distrib_recursos_accesos
  for select to authenticated using (
    public.oms_panel_activo(auth.uid())
    or exists (
      select 1 from public.oms_distribuidores d
       where d.id = distribuidor_id and d.user_id = auth.uid()
    )
  );
drop policy if exists "oms distrib accesos gestion" on public.oms_distrib_recursos_accesos;
create policy "oms distrib accesos gestion" on public.oms_distrib_recursos_accesos
  for all to authenticated
  using (public.oms_panel_activo(auth.uid()))
  with check (public.oms_panel_activo(auth.uid()));

-- ---- pedidos: lectura restringida para distribuidores ----
-- El personal del panel sigue viéndolo TODO (igual que hoy). Un distribuidor
-- solo ve SUS pedidos (canal='distribuidor' y su distribuidor_id). Los
-- compradores de la tienda no están autenticados: ni notan el cambio.
drop policy if exists "oms lectura autenticados" on public.oms_pedidos;
create policy "oms lectura autenticados" on public.oms_pedidos
  for select to authenticated using (
    public.oms_panel_activo(auth.uid())
    or exists (
      select 1 from public.oms_distribuidores d
       where d.user_id = auth.uid()
         and canal = 'distribuidor'
         and distribuidor_id = d.id
    )
  );

drop policy if exists "oms lectura autenticados" on public.oms_pedidos_lineas;
create policy "oms lectura autenticados" on public.oms_pedidos_lineas
  for select to authenticated using (
    public.oms_panel_activo(auth.uid())
    or exists (
      select 1
        from public.oms_pedidos p
        join public.oms_distribuidores d on d.id = p.distribuidor_id
       where p.id = pedido
         and p.canal = 'distribuidor'
         and d.user_id = auth.uid()
    )
  );

drop policy if exists "oms lectura gestion" on public.oms_stock_movimientos;
create policy "oms lectura gestion" on public.oms_stock_movimientos
  for select to authenticated using (
    public.oms_panel_activo(auth.uid())
    or exists (
      select 1
        from public.oms_pedidos p
        join public.oms_distribuidores d on d.id = p.distribuidor_id
       where p.id = pedido
         and p.canal = 'distribuidor'
         and d.user_id = auth.uid()
    )
  );

-- ─── 8 · STORAGE: bucket privado «oms-distrib» ─────────────────────────────
-- Rutas: <zona>/<nombre-archivo> (la primera carpeta ES la zona/carpetas).

insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values (
  'oms-distrib', 'oms-distrib', false, 20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/zip']
)
on conflict (id) do update
  set "public" = false,
      file_size_limit = 20971520,
      allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/zip'];

-- Lectura: personal del panel o distribuidor habilitado con esa carpeta
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
    )
  );

-- Escritura y borrado: solo personal del panel (admin/editor)
drop policy if exists "oms distrib bucket insert" on storage.objects;
create policy "oms distrib bucket insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'oms-distrib' and public.oms_es_editor_o_mas());

drop policy if exists "oms distrib bucket update" on storage.objects;
create policy "oms distrib bucket update" on storage.objects
  for update to authenticated
  using (bucket_id = 'oms-distrib' and public.oms_es_editor_o_mas())
  with check (bucket_id = 'oms-distrib' and public.oms_es_editor_o_mas());

drop policy if exists "oms distrib bucket delete" on storage.objects;
create policy "oms distrib bucket delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'oms-distrib' and public.oms_es_editor_o_mas());

-- ─── 9 · AJUSTES: sección «distribucion» ───────────────────────────────────

alter table public.oms_ajustes add column if not exists distribucion jsonb not null default '{}'::jsonb;

-- Valores por defecto SOLO si la sección está vacía (nunca pisa lo guardado).
-- Las plantillas usan variables {{...}} y el sobre con el logo lo pone el
-- código de las Edge Functions; editables desde el panel (Ajustes → Distribución).
update public.oms_ajustes
   set distribucion = $distrib${
  "emailsDestino": [],
  "iban": "",
  "transferenciaInfo": "Realiza la transferencia a la cuenta que indicamos e incluye el número de pedido en el concepto. Tu pedido se prepara en cuanto recibamos el importe.",
  "logotipo": "https://omshaddai.com/img/shin-logo.png",
  "textosVersion": 1,
  "textos": {
    "legal": "<p><strong>Aviso legal y condiciones del programa de distribuidores.</strong> La presentación de la solicitud no implica compromiso de aceptación: el equipo de SHADDAI revisa cada caso y confirma la aceptación por correo electrónico. Los precios de distribuidor, los territorios y el material comercial autorizado se confirman en el correo de aceptación. SHADDAI · Esencia de Umbral es una marca registrada: la utilización de logotipos e imágenes está autorizada exclusivamente para la promoción y venta de sus productos conforme a las indicaciones recibidas.</p>",
    "privacidad": "<p><strong>Protección de datos.</strong> Los datos facilitados se tratarán por OMSHADDAI con la única finalidad de gestionar tu solicitud de distribución, la relación comercial derivada y las comunicaciones asociadas al programa. No se cederán a terceros salvo obligación legal. Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a info@omshaddai.com. La solicitud implica el consentimiento de este tratamiento mientras no lo revoques.</p>"
  },
  "plantillas": {
    "verificacion": {
      "asunto": "Confirma tu correo para ser distribuidor de SHADDAI",
      "html": "<p>Hola, {{persona_contacto}}:</p><p>Hemos recibido tu interés en el programa de distribuidores de <strong>SHADDAI · Esencia de Umbral</strong>. Para continuar, confirma que este correo es tuyo pulsando el botón (el enlace caduca en 24 horas):</p><p style=\"text-align:center;margin:24px 0;\"><a href=\"{{enlace}}\" style=\"display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;\">Confirmar mi correo y continuar</a></p><p>Si tú no solicitaste esto, ignora este mensaje y no se creará ninguna solicitud.</p><p>Con aprecio,<br>SHADDAI · Esencia de Umbral</p>"
    },
    "solicitudRecibida": {
      "asunto": "Hemos recibido tu solicitud de distribución — SHADDAI",
      "html": "<p>Hola, {{persona_contacto}}:</p><p>Tu solicitud del programa de distribuidores quedó <strong>completada y en revisión</strong>. Nuestro equipo la estudiará con calma y te escribiremos de vuelta para contarte los siguientes pasos.</p><p>Gracias por querer llevar el Umbral más lejos.</p><p>SHADDAI · Esencia de Umbral</p>"
    },
    "avisoInterno": {
      "asunto": "Nueva solicitud de distribuidor: {{empresa}}",
      "html": "<p>Nueva solicitud completada en la web:</p><ul><li><strong>Empresa:</strong> {{empresa}}</li><li><strong>Persona de contacto:</strong> {{persona_contacto}}</li><li><strong>Email:</strong> {{email}}</li><li><strong>Teléfono:</strong> {{telefono}}</li></ul><p>Revísala en el panel: Distribuidores → Solicitudes (pendiente de aceptación).</p>"
    },
    "aceptacion": {
      "asunto": "Bienvenido al programa de distribuidores — SHADDAI",
      "html": "<p>Hola, {{persona_contacto}}:</p><p>Nos alegra confirmarte que <strong>{{empresa}}</strong> ha sido aceptada en el programa de distribuidores de SHADDAI · Esencia de Umbral.</p><p>Define la contraseña de tu zona privada (tienda de distribuidor, material comercial y tus pedidos) desde este enlace:</p><p style=\"text-align:center;margin:24px 0;\"><a href=\"{{enlace}}\" style=\"display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;\">Activar mi acceso</a></p><p>Tu descuento de distribuidor aplicado: <strong>{{descuento}}%</strong>.</p><p>Bienvenido al Umbral.<br>SHADDAI · Esencia de Umbral</p>"
    },
    "rechazo": {
      "asunto": "Sobre tu solicitud de distribución — SHADDAI",
      "html": "<p>Hola, {{persona_contacto}}:</p><p>Gracias por el tiempo dedicado a tu solicitud. Tras revisarla con atención, de momento no podemos seguir adelante con la distribución en tu zona. Guardamos tu contacto por si la situación cambia.</p><p>Gracias por tu interés en SHADDAI.</p>"
    },
    "proformaCreada": {
      "asunto": "Tu pedido por transferencia {{numero_pedido}} — SHADDAI",
      "html": "<p>Hola, {{persona_contacto}}:</p><p>Hemos registrado tu pedido <strong>{{numero_pedido}}</strong> pendiente de transferencia.</p><ul>{{articulos}}</ul><p><strong>Total con tu descuento ({{descuento}}%): {{total}}</strong></p><p>{{transferencia}}</p><p>SHADDAI · Esencia de Umbral</p>"
    },
    "proformaPagada": {
      "asunto": "Transferencia recibida: {{numero_pedido}} en preparación — SHADDAI",
      "html": "<p>Hola, {{persona_contacto}}:</p><p>Hemos recibido el importe del pedido <strong>{{numero_pedido}}</strong>. Ya está en preparación y te avisaremos cuando salga.</p><p>Gracias por confiar en SHADDAI · Esencia de Umbral.</p>"
    }
  }
}$distrib$::jsonb
 where id = 'general'
   and coalesce(distribucion, '{}'::jsonb) = '{}'::jsonb;

comment on column public.oms_ajustes.distribucion is
  'Programa de distribuidores: emails de destino de avisos, datos de transferencia (proformas), logotipo de los correos, textos legales con versión y plantillas de los correos del flujo. Editable en Ajustes → Distribución.';

-- ─── 10 · GRANTS ───────────────────────────────────────────────────────────

grant all on public.oms_distrib_solicitudes,
  public.oms_distribuidores,
  public.oms_distrib_recursos,
  public.oms_distrib_recursos_accesos to service_role;

grant select on public.oms_distrib_solicitudes,
  public.oms_distribuidores,
  public.oms_distrib_recursos,
  public.oms_distrib_recursos_accesos to authenticated;

-- ─── 11 · COMPROBACIONES rápidas ───────────────────────────────────────────
--  · Table Editor: oms_distrib_solicitudes, oms_distribuidores,
--    oms_distrib_recursos, oms_distrib_recursos_accesos existen;
--    oms_pedidos tiene canal / distribuidor_id / descuento_pct.
--  · Storage: bucket privado oms-distrib.
--  · Ajustes → fila general → columna distribucion con las plantillas.
--  · Los pedidos de clientes siguen creándose igual (canal='web' por defecto).
-- ============================================================================
