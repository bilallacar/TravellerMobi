# 🌍 TravellerMobi - Seyahat Günlüğü ve Masraf Takibi

Yurt dışı seyahatlerinizde masraflarınızı, anılarınızı ve çektiğiniz fotoğrafları güvenle bulutta saklamanız ve takip etmeniz için tasarlanmış, mobil uyumlu ve çevrimdışı (offline-first) çalışan modern bir web uygulamasıdır.

---

## ⚡ Özellikler
1. **Bulut Veritabanı ve Senkronizasyon (Supabase):** Verileriniz 7/24 güvenli bir PostgreSQL veritabanında saklanır. Bilgisayarınızı kapatsanız bile telefonunuzdan veya başka bir cihazdan verilerinize ulaşabilirsiniz.
2. **Çevrimdışı (Offline-First) Mod:** Yurt dışındayken internetiniz olmasa bile seyahat, harcama veya fotoğraf/anı ekleyebilirsiniz. Verileriniz tarayıcı hafızasında saklanır ve internet bağlantısı algılandığı anda otomatik olarak buluta eşitlenir.
3. **Anlık Döviz Çevirici ve Harcama Analizi:** Harcamalarınızı yaptığınız para birimiyle (EUR, USD, GBP, vb.) girin, uygulama canlı döviz kurlarıyla harcamalarınızı belirlediğiniz ana para birimine (örneğin TRY) çevirsin ve bütçe aşım oranlarınızı hesaplasın.
4. **Resim Depolama (Cloud Storage):** Günlüklerinize eklediğiniz fotoğraflar otomatik olarak bulut sunucunuza yüklenir.
5. **Kullanıcı Giriş Sistemi (Auth):** Üye kayıt ve giriş sistemi sayesinde kişisel seyahat günlüklerinize yalnızca siz erişebilirsiniz.

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
4. **Public** seçeneğini işaretleyin (bu sayede resim linkleriniz erişilebilir olacaktır).
5. **Save** diyerek kaydedin.

### 3. SQL Şemasını Çalıştırın
1. Supabase sol menüsünden **SQL Editor** sekmesine gidin.
2. **New Query** tuşuna basın.
3. Aşağıdaki SQL kodlarını yapıştırın ve **Run** tuşuna basın:

```sql
-- 1. UUID Eklentisini aktif et
create extension if not exists "uuid-ossp";

-- 2. Seyahatler Tablosu
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

-- 3. Masraflar Tablosu
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

-- 4. Anılar / Günlük Tablosu
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

-- 5. Row Level Security (RLS) Aktifleştirme (Güvenlik için)
alter table trips enable row level security;
alter table expenses enable row level security;
alter table memories enable row level security;

-- 6. Güvenlik Politikaları (Kullanıcılar sadece kendi verilerini görebilir/değiştirebilir)
create policy "Users can perform all actions on their own trips" on trips
  for all using (auth.uid() = user_id);

create policy "Users can perform all actions on their own expenses" on expenses
  for all using (auth.uid() = user_id);

create policy "Users can perform all actions on their own memories" on memories
  for all using (auth.uid() = user_id);
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
Eğer kodları GitHub'a yüklerseniz, proje ayarlarından **GitHub Pages** seçeneğini aktif ederek projenizi anında ücretsiz olarak yayınlayabilirsiniz.
