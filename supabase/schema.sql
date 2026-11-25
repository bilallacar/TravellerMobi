-- ============================================================================
-- TravellerMobi — Tam Veritabanı Şeması (Temiz Kurulum v2.0)
-- ============================================================================
-- Mevcut canlı veritabanını güncellemek için bu dosya yerine
-- supabase/migration_security_v2.sql dosyasını çalıştırın.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. Roller & Profiller
create table if not exists public.roles (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique
);

insert into public.roles (name) values ('admin'), ('member')
on conflict (name) do nothing;

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  status text default 'pending' not null,
  role_id uuid references public.roles,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Kategoriler
create table if not exists public.categories (
  id uuid default uuid_generate_v4() primary key,
  name text not null unique,
  icon text default 'tag' not null,
  color text default 'var(--color-primary)' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

insert into public.categories (name, icon, color) values
  ('Yemek', 'utensils', '#ef4444'),
  ('Konaklama', 'home', '#3b82f6'),
  ('Ulaşım', 'plane', '#10b981'),
  ('Aktivite', 'ticket', '#f59e0b'),
  ('Alışveriş', 'shopping-bag', '#8b5cf6'),
  ('Diğer', 'archive', '#6b7280')
on conflict (name) do nothing;

-- 3. Seyahatler, Masraflar, Anılar, Mekanlar, Rezervasyonlar
create table if not exists public.trips (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  start_date date,
  end_date date,
  budget numeric default 0,
  currency text default 'TRY',
  participants text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.expenses (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trip_id uuid references public.trips on delete cascade not null,
  title text not null,
  amount numeric not null check (amount > 0),
  currency text default 'TRY',
  category text,
  category_id uuid references public.categories,
  date date default current_date not null,
  paid_by text,
  split_with text[] default '{}',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.memories (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trip_id uuid references public.trips on delete cascade not null,
  title text not null,
  description text,
  photo_url text,
  location text,
  date date default current_date not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.places (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users on delete cascade not null,
  trip_id uuid references public.trips on delete cascade,
  name text not null,
  category text not null default 'other',
  status text not null default 'planned' check (status in ('planned', 'visited')),
  latitude double precision not null,
  longitude double precision not null,
  address text,
  notes text,
  opening_hours text,
  estimated_cost numeric default 0,
  currency text default 'EUR',
  visit_order integer default 0,
  rating integer default 0 check (rating >= 0 and rating <= 5),
  visited_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

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

-- 4. Paylaşılan Rotalar (Doğrudan okumaya kapalı; RPC ile PIN doğrulamalı)
create table if not exists public.shared_routes (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  trip_name text not null,
  pin_hash text,
  places jsonb not null default '[]'::jsonb check (octet_length(places::text) <= 250000),
  pin_failed_attempts integer default 0 not null,
  pin_locked_until timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Blog Yazıları & Haber Kaynakları
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

-- 6. Ziyaretçi Analitiği Tabloları (Sadece Admin Okuyabilir)
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

-- 7. RLS Aktifleştirme
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

-- 8. Storage Buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('traveller-photos', 'traveller-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('public-content', 'public-content', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can view public content images" on storage.objects;
create policy "Anyone can view public content images" on storage.objects
  for select using (bucket_id = 'public-content');

drop policy if exists "Only admins can upload public content images" on storage.objects;
create policy "Only admins can upload public content images" on storage.objects
  for insert with check (bucket_id = 'public-content' and public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can delete public content images" on storage.objects;
create policy "Only admins can delete public content images" on storage.objects
  for delete using (bucket_id = 'public-content' and public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can read site visitors" on public.site_visitors;
create policy "Only admins can read site visitors" on public.site_visitors
  for select using (public.is_admin_user((select auth.uid())));

drop policy if exists "Only admins can read site events" on public.site_events;
create policy "Only admins can read site events" on public.site_events
  for select using (public.is_admin_user((select auth.uid())));

-- NOT: Tablolar oluşturulduktan sonra politikalar, RPC'ler ve indeksler için
-- supabase/migration_security_v2.sql dosyasını çalıştırın ve ardından ilk admini
-- Supabase SQL Editor'den manuel olarak atayın.
