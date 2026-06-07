# 🌍 TravellerMobi - Seyahat Günlüğü ve Masraf Takibi

Yurt dışı seyahatlerinizde masraflarınızı, anılarınızı ve çektiğiniz fotoğrafları güvenle bulutta saklamanız ve takip etmeniz için tasarlanmış, mobil uyumlu ve çevrimdışı (offline-first) çalışan modern bir web uygulamasıdır.

---

## ⚡ Özellikler
1. **Bulut Veritabanı ve Senkronizasyon (Supabase):** Verileriniz 7/24 güvenli bir PostgreSQL veritabanında saklanır. Bilgisayarınızı kapatsanız bile telefonunuzdan veya başka bir cihazdan verilerinize ulaşabilirsiniz.
2. **Çevrimdışı (Offline-First) Mod:** İnternetiniz olmasa bile seyahat, harcama veya fotoğraf/anı ekleyebilirsiniz. Verileriniz tarayıcı hafızasında saklanır ve internet bağlantısı algılandığı anda otomatik olarak buluta eşitlenir.
3. **Anlık Döviz Çevirici ve Harcama Analizi:** Harcamalarınızı yaptığınız para birimiyle (EUR, USD, GBP, vb.) girin, uygulama canlı döviz kurlarıyla harcamalarınızı belirlediğiniz ana para birimine (örneğin TRY) çevirsin ve bütçe aşım oranlarınızı hesaplasın.
4. **Güvenli Resim Depolama (Private Storage):** Günlüklerinize eklediğiniz fotoğraflar otomatik olarak bulut sunucunuzdaki kapalı (Private) klasörde saklanır. Yalnızca onaylı kullanıcılar kendi fotoğraflarını çekip görebilir.
5. **Kullanıcı Giriş ve Yönetici Onay Sistemi:** Üye kayıt ve giriş sistemi sayesinde kişisel seyahat günlüklerinize yalnızca siz erişebilirsiniz. Arkadaşlarınız kayıt olabilir ancak yönetici (ilk kayıt olan kullanıcı) onay verene kadar bekleme modunda kalırlar.

---

## 🛠️ Kurulum Adımları

Uygulamanın çalışabilmesi için ücretsiz bir bulut sunucu (Supabase) oluşturup anahtarları uygulamaya girmeniz gerekmektedir:

### 1. Supabase Projesi Oluşturun (Ücretsizdir ve Kredi Kartı İstemez)
1. [Supabase.com](https://supabase.com/) adresine gidin ve **Sign Up** diyerek ücretsiz hesap açın.
2. Açılan panelde **New Project** tuşuna basarak yeni bir proje oluşturun (Örn: `TravellerMobi`). Veritabanı şifrenizi belirleyin ve projenin kurulmasını (1-2 dakika sürer) bekleyin.
3. Proje açıldığında sol menüdeki **Settings** (Çark simgesi) -> **API** sekmesine gidin.
4. Buradaki **Project URL** ve **anon public key** değerlerini kopyalayın.

### 2. Fotoğraf Deposunu (Storage Bucket) Aktif Edin
1. Supabase sol menüsünden **Storage** (Kova simgesi) sekmesine gidin.
2. **New Bucket** tuşuna basın.
3. Bucket adını tam olarak **`traveller-photos`** yapın.
4. **Public** seçeneğini KAPALI (işaretsiz) bırakın (güvenli/private olması için).
5. **Save** diyerek kaydedin.

### 3. SQL Şemasını Çalıştırın
1. Supabase sol menüsünden **SQL Editor** sekmesine gidin.
2. **New Query** tuşuna basın.
3. Aşağıdaki SQL kodunun tamamını yapıştırın ve **Run** tuşuna basın. Bu kod, gerekli tabloları, otomatik üye onay tetikleyicisini, güvenlik filtrelerini (RLS) ve storage izinlerini kurar:

```sql
-- 1. UUID Eklentisini aktif et
create extension if not exists "uuid-ossp";

-- 2. Üye Profilleri ve Onay Tablosu
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text not null,
  status text default 'pending' not null,
  is_admin boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Seyahatler Tablosu
create table if not exists trips (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  start_date date,
  end_date date,
  budget numeric default 0,
  currency text default 'TRY',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Masraflar Tablosu
create table if not exists expenses (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
  trip_id uuid references trips on delete cascade not null,
  title text not null,
  amount numeric not null,
  currency text default 'TRY',
  category text not null,
  date date default current_date not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Anılar / Günlük Tablosu
create table if not exists memories (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users not null,
  trip_id uuid references trips on delete cascade not null,
  title text not null,
  description text,
  photo_url text,
  location text,
  date date default current_date not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Row Level Security (RLS) Aktifleştirme
alter table public.profiles enable row level security;
alter table trips enable row level security;
alter table expenses enable row level security;
alter table memories enable row level security;

-- 7. Onay Kontrol Fonksiyonu
create or replace function public.is_approved_user(user_uuid uuid)
returns boolean as $$
begin
  return exists (
    select 1 from public.profiles
    where id = user_uuid and status = 'approved'
  );
end;
$$ language plpgsql security definer;

-- 8. Güvenlik Politikaları (Kullanıcılar onaylı ise kendi verilerini okuyabilir/yazabilir)
drop policy if exists "Users can perform all actions on their own trips" on trips;
create policy "Users can perform all actions on their own trips" on trips
  for all using (auth.uid() = user_id and public.is_approved_user(auth.uid()));

drop policy if exists "Users can perform all actions on their own expenses" on expenses;
create policy "Users can perform all actions on their own expenses" on expenses
  for all using (auth.uid() = user_id and public.is_approved_user(auth.uid()));

drop policy if exists "Users can perform all actions on their own memories" on memories;
create policy "Users can perform all actions on their own memories" on memories
  for all using (auth.uid() = user_id and public.is_approved_user(auth.uid()));

-- 9. Profil Güvenlik Politikaları
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile" on public.profiles
  for insert with check (auth.uid() = id and status = 'pending' and is_admin = false);

drop policy if exists "Admins can perform all actions on all profiles" on public.profiles;
create policy "Admins can perform all actions on all profiles" on public.profiles
  for all using (
    exists (
      select 1 from public.profiles
      where public.profiles.id = auth.uid() and public.profiles.is_admin = true
    )
  );

-- 10. Yeni Kayıtlarda Otomatik Profil Oluşturma Tetikleyicisi
create or replace function public.handle_new_user()
returns trigger as $$
declare
  is_first bool;
begin
  -- İlk kayıt olan kullanıcıyı otomatik onaylı ve admin yap
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, status, is_admin)
  values (
    new.id, 
    new.email, 
    case when is_first then 'approved' else 'pending' end, 
    is_first
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 11. Mevcut Kullanıcıları Profile Senkronize Etme ve İlkini Admin Yapma
insert into public.profiles (id, email, status, is_admin)
select id, email, 'approved', true from auth.users
on conflict (id) do nothing;

update public.profiles
set is_admin = true, status = 'approved'
where id in (select id from public.profiles order by created_at asc limit 1);

-- 12. Storage Güvenlik Politikaları (traveller-photos bucket'ı için)
-- Private bucket politikalarını tanımlar (yalnızca onaylı kullanıcılar kendi klasörlerine yükleyebilir/okuyabilir)
insert into storage.buckets (id, name, public)
values ('traveller-photos', 'traveller-photos', false)
on conflict (id) do nothing;

drop policy if exists "Users can read their own photos" on storage.objects;
create policy "Users can read their own photos" on storage.objects
  for select using (bucket_id = 'traveller-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved_user(auth.uid()));

drop policy if exists "Users can upload their own photos" on storage.objects;
create policy "Users can upload their own photos" on storage.objects
  for insert with check (bucket_id = 'traveller-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved_user(auth.uid()));

drop policy if exists "Users can delete their own photos" on storage.objects;
create policy "Users can delete their own photos" on storage.objects
  for delete using (bucket_id = 'traveller-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved_user(auth.uid()));
```

---

## 🚀 Yerel Çalıştırma (Geliştirme Aşaması)

Tarayıcıların güvenlik (CORS) politikaları gereği Javascript modülleri doğrudan çift tıklayarak (`file://` protokolüyle) çalışmaz. Uygulamayı yerel bilgisayarınızda çalıştırmak için küçük bir yerel sunucu başlatmanız gerekir.

Bilgisayarınızda **Python 3** yüklü olduğu için aşağıdaki komutla sunucuyu başlatabilirsiniz:

1. Terminali/PowerShell'i bu klasörün içinde açın.
2. Şu komutu yazıp çalıştırın:
   ```bash
   python -m http.server 8000
   ```
3. Tarayıcınızda [http://localhost:8000](http://localhost:8000) adresine gidin.
4. İlk açılışta sizden Supabase bilgilerinizi isteyecektir. Adım 1'de kopyaladığınız **Project URL** ve **Anon Key** bilgilerini girin.
5. Artık üye kaydı yapabilir, giriş yapabilir ve seyahatlerinizi yönetmeye başlayabilirsiniz!

---

## 🌐 Ücretsiz Bulutta Yayınlama (Deployment)

Bilgisayarınızı kapattığınızda bile uygulamanın telefondan veya tabletten açılabilmesi için HTML/CSS/JS dosyalarını ücretsiz bir statik barındırma platformunda yayınlamamız gerekir.

### Netlify ile Yayınlama (En Kolayı - 1 Dakika):
1. [Netlify.com](https://www.netlify.com/) adresine girin ve ücretsiz hesap oluşturun.
2. Giriş yaptıktan sonra **Sites** menüsüne gidin.
3. Sayfanın en altındaki **"Want to deploy a new site without connecting to Git? Drag and drop your site folder here"** yazan kutuya bu projenin klasörünü (`TravellerMobi` klasörü) sürükleyip bırakın.
4. Netlify size özel bir link üretecektir (Örn: `https://my-trip-journal.netlify.app`). Artık telefonunuzdan bu linke tıklayarak seyahat verilerinize her yerden erişebilirsiniz!

### GitHub Pages ile Yayınlama:
Eğer kodları GitHub'a yükler ve otomatik deploy kurarsanız (Örn: Vercel, Netlify veya GitHub Pages), her kod güncellediğinizde uygulamanız otomatik olarak bulutta derlenecektir.
