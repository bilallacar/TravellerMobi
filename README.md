# TravellerMobi — Şehir Rehberi, Rota Planlayıcı & Gezi Günlüğü

Yurt içi ve yurt dışı seyahatlerinizde mekanlarınızı haritada işaretleyip rota planlayabileceğiniz, masraflarınızı çoklu para birimiyle bölüşebileceğiniz, anılarınızı ve rezervasyonlarınızı çevrimdışı (offline-first) destekle bulutta saklayabileceğiniz modern PWA uygulamasıdır.

---

## Temel Özellikler

1. **Bulut Veritabanı ve Çevrimdışı Senkronizasyon (Supabase):** Verileriniz RLS (Row Level Security) ile korunan PostgreSQL tablolarında saklanır; internet kesildiğinde yerel önbellekten çalışır ve bağlantı dönünce eşitlenir.
2. **İnteraktif Harita & PIN Korumalı Rota Paylaşımı:** Mekanlarınızı haritada sıralayın, yürüyüş mesafesini hesaplayın ve sunucu tarafında bcrypt PIN doğrulaması + brute-force koruması ile arkadaşlarınızla paylaşın.
3. **Çoklu Para Birimi & Grup Masraf Bölüşümü:** Canlı döviz kurlarıyla harcamalarınızı yönetin ve kim kime ne kadar borçlu otomatik hesaplayın.
4. **Private Fotoğraf Depolama:** Anı fotoğrafları istemcide sıkıştırılarak (EXIF temizlenmiş WebP/JPEG) yalnızca sahibinin erişebildiği private bucket'ta saklanır.
5. **Keşfet (Blog & Seyahat Haberleri):** Özgün şehir rehberleri ve sunucu tarafında filtrelenen güncel seyahat/vize/havacılık haberleri.

---

## Kurulum (Geliştirici Rehberi)

### 1. Supabase Projesi ve Veritabanı Şeması
1. [Supabase](https://supabase.com/) üzerinde yeni bir proje oluşturun.
2. `config.js` dosyasındaki `supabaseUrl`, `supabaseKey` ve `appPublicUrl` değerlerini kendi projenize göre düzenleyin.
3. Supabase **SQL Editor** ekranında:
   - İlk kez kurulum yapıyorsanız önce `supabase/schema.sql`, ardından `supabase/migration_security_v2.sql` dosyasını çalıştırın.
   - Mevcut veritabanını güncelliyorsanız yalnızca `supabase/migration_security_v2.sql` dosyasını çalıştırın.
4. İlk yönetici hesabınızı oluşturduktan sonra Supabase SQL Editor'den tek seferlik manuel olarak admin rolü atayın:
   ```sql
   update public.profiles
   set status = 'approved',
       role_id = (select id from public.roles where name = 'admin' limit 1)
   where email = 'ADMIN_EPOSTA_ADRESINIZ';
   ```

### 2. Supabase Authentication URL Ayarları (OTP / E-posta Onay Linki İçin Zorunlu)
E-posta onay ve şifre sıfırlama bağlantılarının doğru adrese yönlenmesi için **Supabase Dashboard → Authentication → URL Configuration** bölümünden:
- **Site URL:** `https://travellermobi.vercel.app` (veya kendi alan adınız)
- **Redirect URLs:**
  - `https://travellermobi.vercel.app/**`
  - `http://localhost:8000/**` (yalnızca yerel test gerekiyorsa)

### 3. Yerel Çalıştırma
```bash
python -m http.server 8000
```
Tarayıcıda `http://localhost:8000` adresini açın.

### 4. Vercel Yayınlama
Proje Vercel için `vercel.json` ve `api/` serverless fonksiyonlarıyla (`api/travel-news.js`, `api/geo.js`, `api/admin-blog-agent.js`) hazır yapılandırılmıştır. Sunucu tarafı AI blog ajanı için Vercel Environment Variables alanına `GEMINI_API_KEY` (ve isteğe bağlı `SUPABASE_URL`, `SUPABASE_ANON_KEY`) ekleyin.
