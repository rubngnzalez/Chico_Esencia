-- ============================================================================
-- 2026-11-08 · Envío por zonas: España / Unión Europea / Latinoamérica / Resto
-- ============================================================================
-- Qué añade:
--   1. Columna «zonas_envio» en oms_productos (text[]): zonas a las que se
--      puede enviar cada producto. Vacía = todas (sin restricción). Valores
--      válidos: espana, unionEuropea, latinoamerica, resto.
--      Valores iniciales acordados:
--        · Bálsamo Sólido (Balsamo-solido) → todas las zonas.
--        · Perfume (esencia-umbral-50) y Dúo Ritual (duo-ritual) → todas
--          menos Latinoamérica.
--   2. La vista pública de productos expone zonas_envio.
--   3. La vista pública de ajustes expone el modelo de zonas de la columna
--      ajustes.envio (jsonb): costes y países por zona (se gestionan en el
--      panel: Ajustes → Envío; la disponibilidad se marca en cada producto:
--      Productos → Editar → Zonas de envío).
--   4. Se mantienen columnas anteriores (envio_coste…) por compatibilidad.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar). Este fichero SUSTITUYE al anterior
-- «2026-11-08-envio-internacional.sql» (no llegó a ejecutarse).
-- ============================================================================

-- ─── 1 · Disponibilidad de envío por producto ──────────────────────────────

alter table public.oms_productos add column if not exists zonas_envio text[] not null default '{}';

comment on column public.oms_productos.zonas_envio is
  'Zonas de envío disponibles para el producto (espana, unionEuropea, latinoamerica, resto). Vacío = todas. Se gestiona en el panel: Productos → Editar.';

-- Valores iniciales: solo se rellenan si la columna está vacía (idempotente
-- y sin sobrescribir lo que la administración haya marcado después)
update public.oms_productos
   set zonas_envio = array['espana', 'unionEuropea', 'latinoamerica', 'resto']::text[]
 where zonas_envio = '{}'::text[]
   and (lower(codigo) like 'balsamo%' or lower(slug) like 'balsamo%');

update public.oms_productos
   set zonas_envio = array['espana', 'unionEuropea', 'resto']::text[]
 where zonas_envio = '{}'::text[]
   and not (lower(codigo) like 'balsamo%' or lower(slug) like 'balsamo%');

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

comment on view public.oms_productos_publicos is 'Catálogo público OMS con precio_efectivo, marca de agotado y zonas_envio (disponibilidad de envío por destino).';

-- ─── 2 · Zonas de envío en la vista pública de ajustes ─────────────────────

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

comment on view public.oms_ajustes_publicos is 'Solo lo público de los ajustes OMS (envío por zonas: costes, países y disponibilidad de productos). SMTP nunca; la clave Redsys solo en test (clave de pruebas pública).';

grant select on public.oms_ajustes_publicos to anon, authenticated;
