-- Ajuste 2026-11-19b · Plantilla de aceptación del distribuidor
-- El acceso ahora entrega una CONTRASEÑA TEMPORAL por correo (la
-- autoconfirmación del proyecto hace que el enlace de invitación no cree
-- sesión). La contraseña se cambia desde la propia zona VIP.
-- Idempotente y acotado: solo sustituye la plantilla «aceptacion».

update public.oms_ajustes
   set distribucion = jsonb_set(
         coalesce(distribucion, '{}'::jsonb),
         '{plantillas,aceptacion}',
         $aceptacion${
  "asunto": "Bienvenido al programa de distribuidores — SHADDAI",
  "html": "<p>Hola, {{persona_contacto}}:</p><p>Nos alegra confirmarte que <strong>{{empresa}}</strong> ha sido aceptada en el programa de distribuidores de SHADDAI · Esencia de Umbral.</p><p>Tus datos de acceso a la zona privada (tienda de distribuidor, material comercial y tus pedidos):</p><ul><li><strong>Correo:</strong> {{email}}</li><li><strong>Contraseña temporal:</strong> <code>{{contrasena}}</code></li></ul><p>Entra desde este botón y, por seguridad, cambia la contraseña desde tu zona cuando quieras:</p><p style=\"text-align:center;margin:24px 0;\"><a href=\"{{enlace}}\" style=\"display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;\">Entrar en mi zona</a></p><p>Tu descuento de distribuidor aplicado: <strong>{{descuento}}%</strong>.</p><p>Bienvenido al Umbral.<br>SHADDAI · Esencia de Umbral</p>"
}$aceptacion$::jsonb
       )
 where id = 'general';
