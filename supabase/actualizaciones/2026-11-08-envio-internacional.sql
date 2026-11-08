-- ============================================================================
-- 2026-11-08 · Envío nacional / internacional
-- ============================================================================
-- Qué añade:
--   · La vista pública expone el coste y el umbral de gratuidad
--     INTERNACIONALES de la columna ajustes.envio:
--       envio_coste_internacional, envio_gratis_desde_internacional
--   · La zona se decide en el checkout con el país del formulario:
--     España = nacional; cualquier otro país = internacional.
--   · Los valores viven en Ajustes → Envío del panel (jsonb «envio»):
--       coste, costeInternacional, gratisDesde, gratisDesdeInternacional,
--       plazos, activo. Sin migración de datos: si «costeInternacional» no
--       existe todavía, la web usa el coste nacional como reserva.
--
-- Instalación: pegar TODO en el SQL Editor de Supabase y ejecutar
-- (idempotente: se puede re-ejecutar).
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
  a.envio -> 'coste'             as envio_coste,
  a.envio -> 'costeInternacional'       as envio_coste_internacional,
  a.envio -> 'gratisDesde'       as envio_gratis_desde,
  a.envio -> 'gratisDesdeInternacional' as envio_gratis_desde_internacional,
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
from public.oms_ajustes a
where a.id = 'general';

comment on view public.oms_ajustes_publicos is 'Solo lo público de los ajustes OMS (con envío nacional/internacional). SMTP nunca; la clave Redsys solo en test (clave de pruebas pública).';

grant select on public.oms_ajustes_publicos to anon, authenticated;
