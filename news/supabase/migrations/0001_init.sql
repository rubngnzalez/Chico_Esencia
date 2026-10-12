-- ============================================================
-- SHADDAI · El Umbral — Blog (prefijo sha_ sobre proyecto ARENA13)
-- Migración inicial: tablas, RLS, triggers, RPC, storage y seeds.
-- Idempotente: sólo crea objetos sha_* / bucket sha-blog.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Tablas ----------

create table if not exists public.sha_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'colaborador' check (role in ('superadmin','admin','colaborador')),
  display_name text,
  bio text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sha_categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sha_articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  excerpt text,
  content text not null default '',
  cover_image_url text,
  status text not null default 'draft' check (status in ('draft','pending','scheduled','published')),
  author_id uuid references public.sha_profiles(id) on delete set null,
  category_id uuid references public.sha_categories(id) on delete set null,
  show_author boolean not null default true,
  allow_share boolean not null default true,
  allow_comments boolean not null default true,
  featured boolean not null default false,
  reading_time int not null default 1,
  views bigint not null default 0,
  published_at timestamptz,
  scheduled_for timestamptz,
  seo_title text,
  seo_description text,
  og_image text,
  tags text[] not null default '{}',
  provenance text not null default 'native' check (provenance in ('native','imported_copy','imported_ai')),
  original_author text,
  original_source_url text,
  original_published_at timestamptz,
  source_license_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sha_articles_status_published_idx on public.sha_articles (status, published_at desc);
create index if not exists sha_articles_category_idx on public.sha_articles (category_id, published_at desc);
create index if not exists sha_articles_featured_idx on public.sha_articles (featured) where featured;

create table if not exists public.sha_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.sha_articles(id) on delete cascade,
  author_name text not null,
  author_email text,
  body text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);
create index if not exists sha_comments_article_idx on public.sha_comments (article_id, status);

create table if not exists public.sha_social_posts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.sha_articles(id) on delete cascade,
  network text not null check (network in ('facebook','instagram')),
  external_post_id text not null,
  permalink text,
  published_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (network, external_post_id)
);

create table if not exists public.sha_social_interactions (
  id uuid primary key default gen_random_uuid(),
  social_post_id uuid not null references public.sha_social_posts(id) on delete cascade,
  network text not null,
  external_id text not null unique,
  type text not null check (type in ('comment','reaction')),
  reaction_kind text,
  author_name text,
  author_url text,
  body text,
  external_created_at timestamptz,
  hidden boolean not null default false,
  synced_at timestamptz not null default now()
);
create index if not exists sha_social_interactions_post_idx on public.sha_social_interactions (social_post_id, hidden);

create table if not exists public.sha_widgets (
  id uuid primary key default gen_random_uuid(),
  zone text not null check (zone in ('home_sidebar','home_hero','article_sidebar','footer')),
  type text not null check (type in ('html','links','video','ad','quote','social_follow','featured','newsletter')),
  title text,
  content jsonb not null default '{}'::jsonb,
  position int not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.sha_import_links (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text,
  extracted jsonb,
  status text not null default 'pending' check (status in ('pending','copied','generated','dismissed')),
  rights_confirmed boolean not null default false,
  created_by uuid references public.sha_profiles(id) on delete set null,
  article_id uuid references public.sha_articles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sha_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sha_subscribers (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Helpers de roles (security definer para evitar recursión RLS) ----------

create or replace function public.sha_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sha_profiles
    where id = auth.uid() and role in ('superadmin','admin') and active
  );
$$;

create or replace function public.sha_is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sha_profiles
    where id = auth.uid() and role = 'superadmin' and active
  );
$$;

-- ---------- Trigger: perfil automático al crear usuario ----------

create or replace function public.sha_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.sha_profiles (id, email, role, display_name)
  values (
    new.id,
    new.email,
    case when lower(new.email) = 'superadmin@omshaddai.com' then 'superadmin' else 'colaborador' end,
    split_part(coalesce(new.email, 'autor'), '@', 1)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.sha_handle_new_user();

-- ---------- Trigger: updated_at ----------

create or replace function public.sha_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sha_articles_touch on public.sha_articles;
create trigger sha_articles_touch before update on public.sha_articles
for each row execute function public.sha_touch_updated_at();

drop trigger if exists sha_settings_touch on public.sha_settings;
create trigger sha_settings_touch before update on public.sha_settings
for each row execute function public.sha_touch_updated_at();

-- ---------- Trigger: evitar auto-elevación de rol / auto-desactivación ----------

create or replace function public.sha_profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.sha_is_superadmin() then
    raise exception 'Sólo un superadmin puede cambiar roles';
  end if;
  if old.id = auth.uid() and new.active is distinct from old.active and not public.sha_is_superadmin() then
    raise exception 'Sólo un superadmin puede activar o desactivar cuentas';
  end if;
  return new;
end;
$$;

drop trigger if exists sha_profiles_guard on public.sha_profiles;
create trigger sha_profiles_guard before update on public.sha_profiles
for each row execute function public.sha_profiles_guard();

-- ---------- RPC: contador de visitas ----------

create or replace function public.sha_register_view(p_article uuid) returns void
language sql security definer set search_path = public as $$
  update public.sha_articles set views = views + 1 where id = p_article;
$$;
grant execute on function public.sha_register_view(uuid) to anon, authenticated;

-- ---------- Vista pública de autores (sin exponer email/rol) ----------

create or replace view public.sha_public_authors as
  select id, display_name, bio, avatar_url
  from public.sha_profiles
  where active;
grant select on public.sha_public_authors to anon, authenticated;

-- ---------- RLS ----------

alter table public.sha_profiles enable row level security;
alter table public.sha_categories enable row level security;
alter table public.sha_articles enable row level security;
alter table public.sha_comments enable row level security;
alter table public.sha_social_posts enable row level security;
alter table public.sha_social_interactions enable row level security;
alter table public.sha_widgets enable row level security;
alter table public.sha_import_links enable row level security;
alter table public.sha_settings enable row level security;
alter table public.sha_subscribers enable row level security;

-- sha_profiles
drop policy if exists sha_profiles_select on public.sha_profiles;
create policy sha_profiles_select on public.sha_profiles for select
  using (id = auth.uid() or public.sha_is_staff());

drop policy if exists sha_profiles_update_self on public.sha_profiles;
create policy sha_profiles_update_self on public.sha_profiles for update
  using (id = auth.uid() or public.sha_is_superadmin())
  with check (id = auth.uid() or public.sha_is_superadmin());

-- sha_categories
drop policy if exists sha_categories_select on public.sha_categories;
create policy sha_categories_select on public.sha_categories for select
  using (active or public.sha_is_staff());

drop policy if exists sha_categories_write on public.sha_categories;
create policy sha_categories_write on public.sha_categories for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- sha_articles
drop policy if exists sha_articles_select on public.sha_articles;
create policy sha_articles_select on public.sha_articles for select
  using (
    status = 'published'
    or (status = 'scheduled' and scheduled_for is not null and scheduled_for <= now())
    or public.sha_is_staff()
    or (auth.uid() is not null and author_id = auth.uid())
  );

drop policy if exists sha_articles_insert on public.sha_articles;
create policy sha_articles_insert on public.sha_articles for insert
  to authenticated
  with check (
    public.sha_is_staff()
    or (auth.uid() is not null and author_id = auth.uid() and status in ('draft','pending'))
  );

drop policy if exists sha_articles_update on public.sha_articles;
create policy sha_articles_update on public.sha_articles for update
  to authenticated
  using (
    public.sha_is_staff()
    or (auth.uid() is not null and author_id = auth.uid() and status in ('draft','pending'))
  );

drop policy if exists sha_articles_delete on public.sha_articles;
create policy sha_articles_delete on public.sha_articles for delete
  to authenticated using (public.sha_is_staff());

-- sha_comments
drop policy if exists sha_comments_insert on public.sha_comments;
create policy sha_comments_insert on public.sha_comments for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and exists (
      select 1 from public.sha_articles a
      where a.id = article_id and a.status = 'published' and a.allow_comments
    )
  );

drop policy if exists sha_comments_select on public.sha_comments;
create policy sha_comments_select on public.sha_comments for select
  using (
    public.sha_is_staff()
    or (
      status = 'approved'
      and exists (
        select 1 from public.sha_articles a
        where a.id = article_id and a.status = 'published'
      )
    )
  );

drop policy if exists sha_comments_manage on public.sha_comments;
create policy sha_comments_manage on public.sha_comments for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- sha_social_posts
drop policy if exists sha_social_posts_select on public.sha_social_posts;
create policy sha_social_posts_select on public.sha_social_posts for select
  using (
    public.sha_is_staff()
    or exists (
      select 1 from public.sha_articles a
      where a.id = article_id and a.status = 'published'
    )
  );

drop policy if exists sha_social_posts_manage on public.sha_social_posts;
create policy sha_social_posts_manage on public.sha_social_posts for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- sha_social_interactions
drop policy if exists sha_social_interactions_select on public.sha_social_interactions;
create policy sha_social_interactions_select on public.sha_social_interactions for select
  using (
    (hidden = false and exists (
      select 1
      from public.sha_social_posts sp
      join public.sha_articles a on a.id = sp.article_id
      where sp.id = social_post_id and a.status = 'published'
    ))
    or public.sha_is_staff()
  );

drop policy if exists sha_social_interactions_manage on public.sha_social_interactions;
create policy sha_social_interactions_manage on public.sha_social_interactions for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- sha_widgets
drop policy if exists sha_widgets_select on public.sha_widgets;
create policy sha_widgets_select on public.sha_widgets for select
  using (
    public.sha_is_staff()
    or (
      active
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at >= now())
    )
  );

drop policy if exists sha_widgets_manage on public.sha_widgets;
create policy sha_widgets_manage on public.sha_widgets for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- sha_import_links
drop policy if exists sha_import_links_select on public.sha_import_links;
create policy sha_import_links_select on public.sha_import_links for select
  to authenticated using (public.sha_is_staff());
drop policy if exists sha_import_links_insert on public.sha_import_links;
create policy sha_import_links_insert on public.sha_import_links for insert
  to authenticated with check (public.sha_is_staff());
drop policy if exists sha_import_links_update on public.sha_import_links;
create policy sha_import_links_update on public.sha_import_links for update
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());
drop policy if exists sha_import_links_delete on public.sha_import_links;
create policy sha_import_links_delete on public.sha_import_links for delete
  to authenticated using (public.sha_is_staff());

-- sha_settings
drop policy if exists sha_settings_select on public.sha_settings;
create policy sha_settings_select on public.sha_settings for select
  using (true);

drop policy if exists sha_settings_manage on public.sha_settings;
create policy sha_settings_manage on public.sha_settings for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- sha_subscribers
drop policy if exists sha_subscribers_insert on public.sha_subscribers;
create policy sha_subscribers_insert on public.sha_subscribers for insert
  to anon, authenticated with check (true);

drop policy if exists sha_subscribers_manage on public.sha_subscribers;
create policy sha_subscribers_manage on public.sha_subscribers for all
  to authenticated using (public.sha_is_staff()) with check (public.sha_is_staff());

-- ---------- Storage: bucket público sha-blog ----------

insert into storage.buckets (id, name, public)
values ('sha-blog','sha-blog', true)
on conflict (id) do update set public = true;

drop policy if exists sha_blog_public_read on storage.objects;
create policy sha_blog_public_read on storage.objects for select
  using (bucket_id = 'sha-blog');

drop policy if exists sha_blog_staff_insert on storage.objects;
create policy sha_blog_staff_insert on storage.objects for insert
  to authenticated with check (bucket_id = 'sha-blog');

drop policy if exists sha_blog_staff_update on storage.objects;
create policy sha_blog_staff_update on storage.objects for update
  to authenticated using (bucket_id = 'sha-blog' and public.sha_is_staff())
  with check (bucket_id = 'sha-blog' and public.sha_is_staff());

drop policy if exists sha_blog_staff_delete on storage.objects;
create policy sha_blog_staff_delete on storage.objects for delete
  to authenticated using (bucket_id = 'sha-blog' and public.sha_is_staff());

-- ---------- Seeds ----------

insert into public.sha_categories (slug, name, description, position) values
  ('el-umbral',  'El Umbral',  'Presencia, neurociencia del olor y el arte de romper el piloto automático.', 1),
  ('el-ritual',  'El Ritual',  'Prácticas, respiración inhala-exhala y micro-rituales para el día a día.', 2),
  ('la-alquimia','La Alquimia','Notas, ingredientes, oficio artesanal y la alta formulación neurosensorial.', 3),
  ('escencias',  'Escencias',  'Historias, testimonios y momentos de la comunidad SHADDAI.', 4),
  ('el-origen',  'El Origen',  'Cartas del autor y notas sobre el nacimiento de la marca.', 5)
on conflict (slug) do nothing;

insert into public.sha_settings (key, value) values
  ('site', '{
    "title": "SHADDAI · El Umbral — Diario",
    "tagline": "Que nos busquen por dentro",
    "description": "Diario de SHADDAI, Esencia de Umbral: presencia, alquimia y ritual.",
    "esencias_url": "https://omshaddai.com/"
  }'::jsonb),
  ('social_links', '{
    "facebook": "",
    "instagram": "",
    "x": "",
    "youtube": "",
    "email": "hola@omshaddai.com"
  }'::jsonb),
  ('defaults', '{
    "show_author": true,
    "allow_share": true,
    "allow_comments": true
  }'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if not exists (select 1 from public.sha_widgets) then
    insert into public.sha_widgets (zone, type, title, content, position) values
      ('home_sidebar', 'quote', 'El manifiesto', '{"quotes": ["Que nos busquen por dentro", "Inhala el presente. Exhala el ruido.", "El perfume no se lleva: se habita."]}', 1),
      ('home_sidebar', 'featured', 'Lecturas del umbral', '{}', 2),
      ('footer', 'social_follow', 'Síguenos', '{}', 1);
  end if;
end $$;
