-- Ajuste 2026-11-19c · Zona de clientes (acceso por email)
-- ---------------------------------------------------------------------------
-- El cliente accede con su correo (enlace mágico de marca) y ve SUS pedidos.
-- RLS: un usuario autenticado cuyo email de Supabase coincide con el email
-- del pedido (cliente->>'email') puede leer ese pedido y sus líneas.
-- El panel y los distribuidores mantienen exactamente lo mismo que ya tenían.
-- Idempotente.

-- ── Pedidos: añade la vía del cliente por email ────────────────────────────
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
    or (
      (select auth.email()) is not null
      and lower(coalesce(cliente ->> 'email', '')) = lower((select auth.email())::text)
    )
  );

-- ── Líneas del pedido: la misma vía ────────────────────────────────────────
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
    or exists (
      select 1
        from public.oms_pedidos p
       where p.id = pedido
         and (select auth.email()) is not null
         and lower(coalesce(p.cliente ->> 'email', '')) = lower((select auth.email())::text)
    )
  );

-- ── Plantilla del correo de acceso del cliente (con logo de marca) ─────────
update public.oms_ajustes
   set distribucion = jsonb_set(
         coalesce(distribucion, '{}'::jsonb),
         '{plantillas,accesoCliente}',
         $accesocliente${
  "asunto": "Acceso a tu zona de clientes — SHADDAI",
  "html": "<p>Hola:</p><p>Pulsa el botón para entrar en tu zona de clientes y ver el estado de tus pedidos de SHADDAI · Esencia de Umbral. El enlace es personal y caduca en una hora.</p><p style=\"text-align:center;margin:24px 0;\"><a href=\"{{enlace}}\" style=\"display:inline-block;background:#16261b;color:#f3eee2;font-family:Verdana,Arial,sans-serif;font-size:14px;padding:12px 22px;text-decoration:none;border-radius:4px;\">Ver mis pedidos</a></p><p>Si tú no solicitaste este acceso, ignora este mensaje.</p><p>SHADDAI · Esencia de Umbral</p>"
}$accesocliente$::jsonb
       )
 where id = 'general';

comment on policy "oms lectura autenticados" on public.oms_pedidos is
  'Panel activo: todo. Distribuidor: sus pedidos. Cliente: los pedidos cuyo email de compra coincide con su email de Supabase (acceso por enlace mágico).';
