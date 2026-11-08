-- ============================================================================
-- 2026-11-08 · Envío por zonas: España / Unión Europea / Latinoamérica / Resto
-- ============================================================================
-- Qué añade:
--   · La vista pública expone el modelo de zonas guardado en la columna
--     ajustes.envio (jsonb):
--       envio_zonas          → {espana:{coste,gratisDesde}, unionEuropea:…,
--                               latinoamerica:…, resto:…}
--       envio_paises         → {unionEuropea:[países], latinoamerica:[…],
--                               resto:[…]} (España siempre es zona «espana»)
--       envio_disponibilidad → {zona:[códigos de producto]} (vacío = todos)
--   · Se mantienen las columnas anteriores (envio_coste, envio_coste_
--     internacional…) por compatibilidad con la web ya publicada.
--   · Los valores se gestionan desde el panel: Ajustes → Envío. La zona se
--     decide con el país del formulario de pago en el checkout.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar). Este fichero SUSTITUYE al anterior
-- «2026-11-08-envio-internacional.sql» (no llegó a ejecutarse).
-- ============================================================================

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
