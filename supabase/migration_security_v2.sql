-- ============================================================================
-- TravellerMobi — Güvenlik & Performans Migration Scripti (v2.0)
-- ============================================================================
-- KULLANIM: Supabase Dashboard -> SQL Editor -> New Query -> Yapıştır & RUN
-- Bu script mevcut verileri KORUR ve yalnızca güvenlik açıklarını, RLS
-- politikalarını, RPC fonksiyonlarını, indeksleri ve kısıtları günceller.
-- Mevcut admin kullanıcıların rol ve onay durumlarına DOKUNULMAZ.
-- ============================================================================

-- 0. Gerekli eklentiler
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 0B. Sonradan eklenen opsiyonel tablolar canlı DB'de yoksa güvenle oluştur (42P01 önlemi)
create table if not exists public.reservations (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trip_id uuid references public.trips on delete cascade,
  type text not null default 'other',
  title text not null,
  provider text,
  pnr text,
  start_datetime text,
  end_datetime text,
  location text,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.shared_routes (
  id text primary key,
  user_id uuid references auth.users on delete cascade,
  trip_name text not null,
  pin_hash text,
  places jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.blog_posts (
  id uuid default uuid_generate_v4() primary key,
  slug text not null unique,
  title text not null,
  summary text,
  content text not null,
  cover_image_url text,
  category text default 'Şehir Rehberi' not null,
  tags text[] default '{}',
  author_name text default 'TravellerMobi Editör',
  author_id uuid references auth.users on delete set null,
  status text default 'draft' not null,
  is_featured boolean default false not null,
  read_time_minutes integer default 3,
  view_count integer default 0 not null,
  published_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.news_sources (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  rss_url text not null,
  category text default 'Seyahat' not null,
  is_enabled boolean default true not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.site_visitors (
  visitor_id text primary key,
  user_id uuid references auth.users on delete set null,
  user_email text,
  first_seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
  last_seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
  visit_count integer default 1 not null,
  first_referrer text,
  first_referrer_domain text,
  first_landing_page text,
  last_page text,
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  device_type text,
  os text,
  browser text,
  language text,
  screen_resolution text,
  timezone text,
  country text,
  city text,
  region text,
  is_pwa boolean default false,
  clicked_auth boolean default false,
  max_scroll_depth integer default 0,
  total_read_seconds integer default 0
);

create table if not exists public.site_events (
  id uuid default uuid_generate_v4() primary key,
  visitor_id text references public.site_visitors(visitor_id) on delete cascade not null,
  session_id text,
  user_id uuid references auth.users on delete set null,
  event_type text default 'page_view' not null,
  page_path text,
  post_slug text,
  post_title text,
  referrer_domain text,
  country text,
  city text,
  device_type text,
  scroll_depth integer,
  duration_seconds integer,
  search_query text,
  search_results_count integer,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Tüm tablolarda RLS aktif olduğundan emin ol
alter table public.roles enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.trips enable row level security;
alter table public.expenses enable row level security;
alter table public.memories enable row level security;
alter table public.places enable row level security;
alter table public.reservations enable row level security;
alter table public.shared_routes enable row level security;
alter table public.blog_posts enable row level security;
alter table public.news_sources enable row level security;
alter table public.site_visitors enable row level security;
alter table public.site_events enable row level security;

revoke insert, update, delete on public.site_visitors, public.site_events from anon, authenticated;

-- Eksik olabilecek kolonlar
alter table public.places add column if not exists rating integer default 0;
alter table public.site_visitors add column if not exists clicked_auth boolean default false;
alter table public.site_visitors add column if not exists max_scroll_depth integer default 0;
alter table public.site_visitors add column if not exists total_read_seconds integer default 0;
alter table public.site_events add column if not exists scroll_depth integer;
alter table public.site_events add column if not exists duration_seconds integer;
alter table public.site_events add column if not exists search_query text;
alter table public.site_events add column if not exists search_results_count integer;

-- ============================================================================
-- 1. Güvenli Yardımcı Fonksiyonlar (search_path sabitli)
-- ============================================================================

create or replace function public.is_approved_user(user_uuid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if user_uuid is null then
    return false;
  end if;
  return exists (
    select 1 from public.profiles
    where id = user_uuid and status = 'approved'
  );
end;
$$;

create or replace function public.is_admin_user(user_uuid uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if user_uuid is null then
    return false;
  end if;
  return exists (
    select 1 from public.profiles p
    join public.roles r on p.role_id = r.id
    where p.id = user_uuid
      and p.status = 'approved'
      and r.name = 'admin'
  );
end;
$$;

-- ============================================================================
-- 2. Yeni Kullanıcı Tetikleyicisi (Hardcode admin e-postası ve oto-admin KALDIRILDI)
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  member_role_id uuid;
begin
  select id into member_role_id from public.roles where name = 'member' limit 1;

  insert into public.profiles (id, email, status, role_id)
  values (
    new.id,
    coalesce(new.email, ''),
    'pending',
    member_role_id
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Eksik profili olan kullanıcıları güvenli şekilde 'pending' + 'member' olarak tamamla
-- (Mevcut admin ve onaylı profillere ON CONFLICT DO NOTHING sayesinde dokunulmaz)
insert into public.profiles (id, email, status, role_id)
select
  u.id,
  coalesce(u.email, ''),
  'pending',
  (select id from public.roles where name = 'member' limit 1)
from auth.users u
on conflict (id) do nothing;

-- ============================================================================
-- 3. RLS Politikaları Sertleştirme + Performans ((select auth.uid()))
--    + Çapraz Referans (trip_id sahiplik) Kontrolü
-- ============================================================================

-- Roles
drop policy if exists "Authenticated users can read roles" on public.roles;
create policy "Authenticated users can read roles" on public.roles
  for select using ((select auth.uid()) is not null);

-- Profiles
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select using ((select auth.uid()) = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile" on public.profiles
  for insert with check (
    (select auth.uid()) = id
    and status = 'pending'
    and (role_id is null or role_id <> (select id from public.roles where name = 'admin' limit 1))
  );

drop policy if exists "Admins can perform all actions on all profiles" on public.profiles;
create policy "Admins can perform all actions on all profiles" on public.profiles
  for all
  using (public.is_admin_user((select auth.uid())))
  with check (public.is_admin_user((select auth.uid())));

-- Trips
drop policy if exists "Users can perform all actions on their own trips" on public.trips;
create policy "Users can perform all actions on their own trips" on public.trips
  for all
  using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())))
  with check ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())));

-- Expenses (trip_id mutlaka aynı kullanıcıya ait olmalı)
drop policy if exists "Users can perform all actions on their own expenses" on public.expenses;
create policy "Users can perform all actions on their own expenses" on public.expenses
  for all
  using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())))
  with check (
    (select auth.uid()) = user_id
    and public.is_approved_user((select auth.uid()))
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.user_id = (select auth.uid())
    )
  );

-- Memories (trip_id mutlaka aynı kullanıcıya ait olmalı)
drop policy if exists "Users can perform all actions on their own memories" on public.memories;
create policy "Users can perform all actions on their own memories" on public.memories
  for all
  using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())))
  with check (
    (select auth.uid()) = user_id
    and public.is_approved_user((select auth.uid()))
    and exists (
      select 1 from public.trips t
      where t.id = trip_id and t.user_id = (select auth.uid())
    )
  );

-- Places (trip_id null olabilir [Şehir Rehberi] veya aynı kullanıcıya ait olmalı)
drop policy if exists "Users can perform all actions on their own places" on public.places;
create policy "Users can perform all actions on their own places" on public.places
  for all
  using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())))
  with check (
    (select auth.uid()) = user_id
    and public.is_approved_user((select auth.uid()))
    and (
      trip_id is null
      or exists (
        select 1 from public.trips t
        where t.id = trip_id and t.user_id = (select auth.uid())
      )
    )
  );

-- Reservations (is_approved_user + trip_id sahiplik kontrolü eklendi)
drop policy if exists "Users can manage own reservations" on public.reservations;
create policy "Users can manage own reservations" on public.reservations
  for all
  using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())))
  with check (
    (select auth.uid()) = user_id
    and public.is_approved_user((select auth.uid()))
    and (
      trip_id is null
      or exists (
        select 1 from public.trips t
        where t.id = trip_id and t.user_id = (select auth.uid())
      )
    )
  );

-- Categories
drop policy if exists "Approved users can read categories" on public.categories;
create policy "Approved users can read categories" on public.categories
  for select using (public.is_approved_user((select auth.uid())));

drop policy if exists "Only admins can manage categories" on public.categories;
create policy "Only admins can manage categories" on public.categories
  for all
  using (public.is_admin_user((select auth.uid())))
  with check (public.is_admin_user((select auth.uid())));

-- Blog Posts & News Sources
drop policy if exists "Public can read published blog posts" on public.blog_posts;
create policy "Public can read published blog posts" on public.blog_posts
  for select using (status = 'published' or public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can manage blog posts" on public.blog_posts;
create policy "Only admins can manage blog posts" on public.blog_posts
  for all
  using (public.is_admin_user((select auth.uid())))
  with check (public.is_admin_user((select auth.uid())));

drop policy if exists "Anyone can read enabled news sources" on public.news_sources;
create policy "Anyone can read enabled news sources" on public.news_sources
  for select using (is_enabled = true or public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can manage news sources" on public.news_sources;
create policy "Only admins can manage news sources" on public.news_sources
  for all
  using (public.is_admin_user((select auth.uid())))
  with check (public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can read site visitors" on public.site_visitors;
create policy "Only admins can read site visitors" on public.site_visitors
  for select using (public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can read site events" on public.site_events;
create policy "Only admins can read site events" on public.site_events
  for select using (public.is_admin_user((select auth.uid())));

-- ============================================================================
-- 4. Paylaşılan Rotalar (shared_routes) — Doğrudan SELECT Kapatma & Sunucu PIN RPC
-- ============================================================================

alter table public.shared_routes add column if not exists pin_failed_attempts integer default 0 not null;
alter table public.shared_routes add column if not exists pin_locked_until timestamp with time zone;
alter table public.shared_routes add column if not exists updated_at timestamp with time zone default timezone('utc'::text, now()) not null;

-- Aşırı büyük payload engeli (en fazla ~250 KB)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shared_routes_places_size_chk'
  ) then
    alter table public.shared_routes
      add constraint shared_routes_places_size_chk
      check (octet_length(places::text) <= 250000) not valid;
  end if;
end $$;

-- Eski gevşek politikaları tamamen kaldır
drop policy if exists "Anyone can read shared routes" on public.shared_routes;
drop policy if exists "Authenticated users can create shared routes" on public.shared_routes;
drop policy if exists "Users can read own shared routes" on public.shared_routes;
drop policy if exists "Users can update own shared routes" on public.shared_routes;
drop policy if exists "Users can delete own shared routes" on public.shared_routes;

-- Tabloya doğrudan erişim yalnızca rota sahibine (onaylı üye) açık
create policy "Users can read own shared routes" on public.shared_routes
  for select using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())));

create policy "Authenticated users can create shared routes" on public.shared_routes
  for insert with check (
    (select auth.uid()) = user_id
    and public.is_approved_user((select auth.uid()))
  );

create policy "Users can update own shared routes" on public.shared_routes
  for update
  using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())))
  with check ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())));

create policy "Users can delete own shared routes" on public.shared_routes
  for delete using ((select auth.uid()) = user_id and public.is_approved_user((select auth.uid())));

-- Rota oluşturma / güncelleme RPC (PIN sunucu tarafında bcrypt ile hash'lenir)
create or replace function public.save_shared_route(
  p_id text,
  p_trip_name text,
  p_places jsonb,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_clean_id text := left(regexp_replace(coalesce(p_id, ''), '[^a-zA-Z0-9_-]', '', 'g'), 64);
  v_clean_name text := left(trim(coalesce(p_trip_name, 'Seyahat Rotası')), 140);
  v_clean_pin text := regexp_replace(coalesce(p_pin, ''), '[^0-9]', '', 'g');
  v_pin_hash text := null;
  v_existing_owner uuid;
begin
  if v_uid is null or not public.is_approved_user(v_uid) then
    raise exception 'Bu işlem için onaylı üyelik gereklidir.';
  end if;

  if length(v_clean_id) < 4 then
    raise exception 'Geçersiz paylaşım bağlantısı kimliği.';
  end if;

  if p_places is null or jsonb_typeof(p_places) <> 'array' then
    raise exception 'Geçersiz rota verisi.';
  end if;

  if octet_length(p_places::text) > 250000 then
    raise exception 'Paylaşılan rota boyutu sınırı aşıyor.';
  end if;

  -- Başkasının slug'ını ezme girişimini engelle
  select user_id into v_existing_owner from public.shared_routes where id = v_clean_id;
  if found and v_existing_owner is distinct from v_uid then
    raise exception 'Bu paylaşım bağlantısı başka bir kullanıcıya ait.';
  end if;

  if length(v_clean_pin) >= 4 then
    v_pin_hash := crypt(left(v_clean_pin, 12), gen_salt('bf', 10));
  end if;

  insert into public.shared_routes (
    id, user_id, trip_name, pin_hash, places,
    pin_failed_attempts, pin_locked_until, updated_at
  )
  values (
    v_clean_id, v_uid, v_clean_name, v_pin_hash, p_places,
    0, null, timezone('utc'::text, now())
  )
  on conflict (id) do update set
    trip_name = excluded.trip_name,
    pin_hash = excluded.pin_hash,
    places = excluded.places,
    pin_failed_attempts = 0,
    pin_locked_until = null,
    updated_at = timezone('utc'::text, now());

  return jsonb_build_object(
    'id', v_clean_id,
    'trip_name', v_clean_name,
    'requires_pin', (v_pin_hash is not null)
  );
end;
$$;

-- Paylaşılan rotayı sunucu tarafında PIN doğrulaması + brute-force kilidi ile okuma RPC
create or replace function public.get_shared_route(
  p_id text,
  p_pin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clean_id text := left(trim(coalesce(p_id, '')), 64);
  v_clean_pin text := left(regexp_replace(coalesce(p_pin, ''), '[^0-9]', '', 'g'), 12);
  r public.shared_routes;
  v_is_bcrypt boolean;
  v_matched boolean := false;
  v_new_attempts integer;
begin
  if length(v_clean_id) < 2 then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into r from public.shared_routes where id = v_clean_id;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  -- PIN koruması yoksa doğrudan döndür (pin_hash ve user_id DÖNDÜRÜLMEZ)
  if r.pin_hash is null or trim(r.pin_hash) = '' then
    return jsonb_build_object(
      'status', 'ok',
      'requires_pin', false,
      'trip_name', r.trip_name,
      'places', r.places
    );
  end if;

  -- Kilitleme kontrolü (5 hatalı deneme -> 15 dakika kilit)
  if r.pin_locked_until is not null and r.pin_locked_until > timezone('utc'::text, now()) then
    return jsonb_build_object(
      'status', 'locked',
      'requires_pin', true,
      'locked_until', r.pin_locked_until
    );
  end if;

  -- PIN henüz girilmediyse yalnızca PIN gerektiğini bildir
  if v_clean_pin = '' then
    return jsonb_build_object(
      'status', 'pin_required',
      'requires_pin', true
    );
  end if;

  v_is_bcrypt := (r.pin_hash like '$2a$%' or r.pin_hash like '$2b$%' or r.pin_hash like '$2y$%');
  if v_is_bcrypt then
    v_matched := (r.pin_hash = crypt(v_clean_pin, r.pin_hash));
  else
    -- Eski (v1) rotalar için geriye uyumlu geçiş kontrolü (yeni kayıtlarda sadece bcrypt kullanılır)
    v_matched := false;
  end if;

  if not v_matched then
    v_new_attempts := coalesce(r.pin_failed_attempts, 0) + 1;
    if v_new_attempts >= 5 then
      update public.shared_routes
      set pin_failed_attempts = 0,
          pin_locked_until = timezone('utc'::text, now()) + interval '15 minutes'
      where id = r.id;

      return jsonb_build_object(
        'status', 'locked',
        'requires_pin', true,
        'locked_until', timezone('utc'::text, now()) + interval '15 minutes'
      );
    else
      update public.shared_routes
      set pin_failed_attempts = v_new_attempts
      where id = r.id;

      return jsonb_build_object(
        'status', 'invalid_pin',
        'requires_pin', true,
        'attempts_left', greatest(0, 5 - v_new_attempts)
      );
    end if;
  end if;

  -- Doğrulama başarılı -> deneme sayacını sıfırla
  if coalesce(r.pin_failed_attempts, 0) > 0 or r.pin_locked_until is not null then
    update public.shared_routes
    set pin_failed_attempts = 0,
        pin_locked_until = null
    where id = r.id;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'requires_pin', true,
    'trip_name', r.trip_name,
    'places', r.places
  );
end;
$$;

-- Misafir kullanıcıların PIN doğrulamalı rotaya güvenli mekan önerisi ekleyebilmesi için RPC
create or replace function public.suggest_shared_route_place(
  p_id text,
  p_pin text default null,
  p_place jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clean_id text := left(trim(coalesce(p_id, '')), 64);
  v_clean_pin text := left(regexp_replace(coalesce(p_pin, ''), '[^0-9]', '', 'g'), 12);
  r public.shared_routes;
  v_sanitized jsonb;
  v_new_places jsonb;
  v_lat double precision;
  v_lng double precision;
begin
  select * into r from public.shared_routes where id = v_clean_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if r.pin_hash is not null and trim(r.pin_hash) <> '' then
    if r.pin_locked_until is not null and r.pin_locked_until > timezone('utc'::text, now()) then
      return jsonb_build_object('ok', false, 'error', 'locked');
    end if;
    if v_clean_pin = '' or r.pin_hash <> crypt(v_clean_pin, r.pin_hash) then
      return jsonb_build_object('ok', false, 'error', 'invalid_pin');
    end if;
  end if;

  if jsonb_array_length(coalesce(r.places, '[]'::jsonb)) >= 120 then
    return jsonb_build_object('ok', false, 'error', 'limit_reached');
  end if;

  v_lat := coalesce((p_place->>'latitude')::double precision, 0);
  v_lng := coalesce((p_place->>'longitude')::double precision, 0);
  if v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180 then
    return jsonb_build_object('ok', false, 'error', 'invalid_coords');
  end if;

  v_sanitized := jsonb_build_object(
    'id', 'guest_' || left(gen_random_uuid()::text, 12),
    'name', left(trim(coalesce(p_place->>'name', '')), 120),
    'category', left(trim(coalesce(p_place->>'category', 'other')), 32),
    'status', 'planned',
    'latitude', v_lat,
    'longitude', v_lng,
    'address', left(trim(coalesce(p_place->>'address', '')), 200),
    'notes', left(trim(coalesce(p_place->>'notes', '[Grup Önerisi]')), 300),
    'is_suggested', true,
    'estimated_cost', 0,
    'currency', 'TRY',
    'visit_order', jsonb_array_length(coalesce(r.places, '[]'::jsonb)) + 1
  );

  if (v_sanitized->>'name') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  v_new_places := coalesce(r.places, '[]'::jsonb) || jsonb_build_array(v_sanitized);
  if octet_length(v_new_places::text) > 250000 then
    return jsonb_build_object('ok', false, 'error', 'size_limit');
  end if;

  update public.shared_routes
  set places = v_new_places,
      updated_at = timezone('utc'::text, now())
  where id = r.id;

  return jsonb_build_object('ok', true, 'place', v_sanitized, 'places', v_new_places);
end;
$$;

grant execute on function public.save_shared_route(text, text, jsonb, text) to authenticated;
grant execute on function public.get_shared_route(text, text) to anon, authenticated;
grant execute on function public.suggest_shared_route_place(text, text, jsonb) to anon, authenticated;

-- ============================================================================
-- 5. Blog Görüntülenme & Analitik RPC Sertleştirme (Kırpma + İzin Listesi + Flood Limiti)
-- ============================================================================

create or replace function public.increment_blog_view(p_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text := left(trim(coalesce(p_slug, '')), 140);
begin
  if length(v_slug) < 2 then
    return;
  end if;

  update public.blog_posts
  set view_count = coalesce(view_count, 0) + 1
  where slug = v_slug and status = 'published';
end;
$$;

create or replace function public.record_site_visit(
  p_visitor_id text,
  p_session_id text default null,
  p_event_type text default 'page_view',
  p_page_path text default '#explore',
  p_post_slug text default null,
  p_post_title text default null,
  p_referrer text default null,
  p_referrer_domain text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_device_type text default null,
  p_os text default null,
  p_browser text default null,
  p_language text default null,
  p_screen_resolution text default null,
  p_timezone text default null,
  p_country text default null,
  p_city text default null,
  p_region text default null,
  p_is_pwa boolean default false,
  p_user_id uuid default null,
  p_user_email text default null,
  p_scroll_depth integer default null,
  p_duration_seconds integer default null,
  p_search_query text default null,
  p_search_results_count integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_visitor_id text := left(trim(coalesce(p_visitor_id, '')), 80);
  v_event_type text := left(trim(coalesce(p_event_type, 'page_view')), 40);
  v_page_path text := left(coalesce(p_page_path, '#explore'), 200);
  v_safe_email text := null;
  v_recent_count integer := 0;
  v_is_auth_click boolean;
  v_safe_scroll integer := case when p_scroll_depth is not null then least(greatest(p_scroll_depth, 0), 100) else null end;
  v_safe_dur integer := case when p_duration_seconds is not null then least(greatest(p_duration_seconds, 0), 3600) else null end;
  v_safe_results integer := case when p_search_results_count is not null then least(greatest(p_search_results_count, 0), 10000) else null end;
begin
  if length(v_visitor_id) < 6 then
    return;
  end if;

  -- İzin verilen olay tipleri listesi
  if v_event_type not in (
    'page_view', 'post_view', 'post_engagement',
    'news_click', 'search', 'auth_cta_click',
    'auth_login', 'auth_signup'
  ) then
    return;
  end if;

  -- Ziyaretçi bazlı temel flood koruması (son 1 dakikada en fazla 30 olay)
  select count(*) into v_recent_count
  from public.site_events
  where visitor_id = v_visitor_id
    and created_at > timezone('utc'::text, now()) - interval '1 minute';

  if v_recent_count >= 30 then
    return;
  end if;

  v_is_auth_click := (v_event_type = 'auth_cta_click' or v_page_path like '#auth%');

  if v_auth_uid is not null then
    select email into v_safe_email from public.profiles where id = v_auth_uid limit 1;
  end if;

  insert into public.site_visitors (
    visitor_id, user_id, user_email, first_seen_at, last_seen_at, visit_count,
    first_referrer, first_referrer_domain, first_landing_page, last_page,
    first_utm_source, first_utm_medium, first_utm_campaign,
    device_type, os, browser, language, screen_resolution, timezone,
    country, city, region, is_pwa, clicked_auth, max_scroll_depth, total_read_seconds
  ) values (
    v_visitor_id, v_auth_uid, left(v_safe_email, 160), timezone('utc'::text, now()), timezone('utc'::text, now()), 1,
    left(p_referrer, 300), left(p_referrer_domain, 120), v_page_path, v_page_path,
    left(p_utm_source, 80), left(p_utm_medium, 80), left(p_utm_campaign, 100),
    left(p_device_type, 24), left(p_os, 80), left(p_browser, 40), left(p_language, 16), left(p_screen_resolution, 32), left(p_timezone, 64),
    left(p_country, 64), left(p_city, 80), left(p_region, 80), coalesce(p_is_pwa, false),
    v_is_auth_click, coalesce(v_safe_scroll, 0), coalesce(v_safe_dur, 0)
  )
  on conflict (visitor_id) do update set
    last_seen_at = timezone('utc'::text, now()),
    visit_count = public.site_visitors.visit_count + case when v_event_type in ('page_view', 'post_view') then 1 else 0 end,
    last_page = coalesce(v_page_path, public.site_visitors.last_page),
    user_id = coalesce(public.site_visitors.user_id, v_auth_uid),
    user_email = coalesce(public.site_visitors.user_email, left(v_safe_email, 160)),
    device_type = coalesce(left(p_device_type, 24), public.site_visitors.device_type),
    os = coalesce(left(p_os, 80), public.site_visitors.os),
    browser = coalesce(left(p_browser, 40), public.site_visitors.browser),
    country = coalesce(left(p_country, 64), public.site_visitors.country),
    city = coalesce(left(p_city, 80), public.site_visitors.city),
    region = coalesce(left(p_region, 80), public.site_visitors.region),
    is_pwa = coalesce(p_is_pwa, public.site_visitors.is_pwa),
    clicked_auth = (public.site_visitors.clicked_auth or v_is_auth_click),
    max_scroll_depth = greatest(coalesce(public.site_visitors.max_scroll_depth, 0), coalesce(v_safe_scroll, 0)),
    total_read_seconds = coalesce(public.site_visitors.total_read_seconds, 0) + coalesce(v_safe_dur, 0);

  insert into public.site_events (
    visitor_id, session_id, user_id, event_type, page_path, post_slug, post_title,
    referrer_domain, country, city, device_type,
    scroll_depth, duration_seconds, search_query, search_results_count
  ) values (
    v_visitor_id, left(p_session_id, 80), v_auth_uid, v_event_type,
    v_page_path, left(p_post_slug, 140), left(p_post_title, 180),
    left(p_referrer_domain, 120), left(p_country, 64), left(p_city, 80), left(p_device_type, 24),
    v_safe_scroll, v_safe_dur, left(p_search_query, 120), v_safe_results
  );
end;
$$;

create or replace function public.link_visitor_to_user(
  p_visitor_id text,
  p_user_id uuid,
  p_user_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_uid uuid := auth.uid();
  v_visitor_id text := left(trim(coalesce(p_visitor_id, '')), 80);
  v_safe_email text;
begin
  if v_auth_uid is null or v_auth_uid <> p_user_id or length(v_visitor_id) < 6 then
    raise exception 'Unauthorized visitor link attempt';
  end if;

  select email into v_safe_email from public.profiles where id = v_auth_uid limit 1;

  -- Yalnızca henüz başka bir üyeye bağlanmamış visitor_id güncellenebilir
  update public.site_visitors
  set user_id = v_auth_uid,
      user_email = coalesce(left(v_safe_email, 160), user_email),
      last_seen_at = timezone('utc'::text, now())
  where visitor_id = v_visitor_id
    and (user_id is null or user_id = v_auth_uid);

  update public.site_events
  set user_id = v_auth_uid
  where visitor_id = v_visitor_id and user_id is null;
end;
$$;

-- ============================================================================
-- 6. Storage Bucket Sertleştirme (Dosya Boyutu & MIME Türü Kısıtı)
-- ============================================================================

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id in ('traveller-photos', 'public-content');

drop policy if exists "Users can read their own photos" on storage.objects;
create policy "Users can read their own photos" on storage.objects
  for select using (
    bucket_id = 'traveller-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_approved_user((select auth.uid()))
  );

drop policy if exists "Users can upload their own photos" on storage.objects;
create policy "Users can upload their own photos" on storage.objects
  for insert with check (
    bucket_id = 'traveller-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_approved_user((select auth.uid()))
  );

drop policy if exists "Users can delete their own photos" on storage.objects;
create policy "Users can delete their own photos" on storage.objects
  for delete using (
    bucket_id = 'traveller-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_approved_user((select auth.uid()))
  );

-- ============================================================================
-- 7. Veri Bütünlüğü Kısıtları (CHECK) & Performans İndeksleri
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'places_rating_range_chk') then
    alter table public.places add constraint places_rating_range_chk check (rating >= 0 and rating <= 5) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_positive_chk') then
    alter table public.expenses add constraint expenses_amount_positive_chk check (amount > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'places_status_valid_chk') then
    alter table public.places add constraint places_status_valid_chk check (status in ('planned', 'visited')) not valid;
  end if;
end $$;

create index if not exists idx_trips_user_id on public.trips(user_id);
create index if not exists idx_expenses_user_trip on public.expenses(user_id, trip_id);
create index if not exists idx_memories_user_trip on public.memories(user_id, trip_id);
create index if not exists idx_places_user_trip on public.places(user_id, trip_id);
create index if not exists idx_reservations_user_trip on public.reservations(user_id, trip_id);
create index if not exists idx_shared_routes_user_id on public.shared_routes(user_id);
create index if not exists idx_site_events_visitor_created on public.site_events(visitor_id, created_at desc);
create index if not exists idx_blog_posts_status_pub on public.blog_posts(status, published_at desc);

-- ============================================================================
-- NOT: Yeni bir kurulumda admin atamak için aşağıdaki bloğu kendi e-postanızla
-- Supabase SQL Editor'de YALNIZCA BİR KEZ manuel çalıştırın:
--
-- update public.profiles
-- set status = 'approved',
--     role_id = (select id from public.roles where name = 'admin' limit 1)
-- where email = 'ADMIN_EPOSTA_ADRESINIZ';
-- ============================================================================
