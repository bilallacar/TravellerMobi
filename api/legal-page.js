// api/legal-page.js - Server-Rendered Legal & Info Pages (/gizlilik, /cerez-politikasi, /kullanim-sartlari, /hakkimizda)

const SITE_URL = (process.env.SITE_URL || 'https://traveller-mobi.vercel.app').replace(/\/+$/, '');

const PAGES = {
    privacy: {
        slug: 'gizlilik',
        title: 'Gizlilik Politikası ve KVKK Aydınlatma Metni',
        description: 'TravellerMobi kişisel verilerin işlenmesi, saklama süreleri, analitik açık rıza ve KVKK kapsamındaki haklarınız.',
        body: `
            <p><strong>TravellerMobi</strong> olarak 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında hangi verilerin hangi amaçla, ne kadar süreyle işlendiğini ve verilerinizi nasıl yönetebileceğinizi şeffaf biçimde açıklıyoruz.</p>
            <h2>1. İşlenen Veriler ve Amaçları</h2>
            <ul>
                <li><strong>Üyelik ve Kimlik Bilgileri:</strong> Kayıt, giriş ve şifre yenileme için e-posta adresiniz ve şifreniz (şifrelenmiş olarak Supabase Authentication üzerinde) işlenir.</li>
                <li><strong>Seyahat, Mekan, Masraf, Rezervasyon ve Anı Kayıtları:</strong> Uygulama işlevlerini kullanmanız için eklediğiniz kayıtlar yalnızca sizin hesabınıza özeldir ve Row Level Security (RLS) ile diğer kullanıcılardan izole edilir. Paylaşılan rotalara rezervasyon veya PNR verisi dahil edilmez.</li>
                <li><strong>İsteğe Bağlı Kullanım Analitiği (Açık Rızaya Bağlı):</strong> Yalnızca <em>"Tümünü Kabul Et"</em> veya <em>"İzin Tercihlerini Özelleştir"</em> üzerinden açık rıza vermeniz halinde; cihaz/tarayıcı türü, okunan blog yazıları, arama terimleri, sunucu başlığından elde edilen yaklaşık şehir/ülke (üçüncü taraf IP-konum servisi kullanılmadan Vercel edge başlığıyla) ve oturum açıldığında üyelik yolculuğu eşleştirmesi işlenir. Açık rıza vermediğinizde hiçbir analitik isteği gönderilmez.</li>
            </ul>
            <h2>2. Saklama Süreleri</h2>
            <ul>
                <li><strong>Hesap ve Seyahat Verileri:</strong> Hesabınız aktif olduğu sürece saklanır; hesabınızı sildiğinizde kalıcı olarak silinir.</li>
                <li><strong>İsteğe Bağlı Analitik Kayıtları:</strong> En fazla <strong>12 ay</strong> süreyle saklanır. Hesabınızı sildiğinizde analitik kayıtlarındaki kullanıcı kimliği ve e-posta bağlantıları derhal silinerek anonimleştirilir.</li>
            </ul>
            <h2>3. Üçüncü Taraf Altyapı Sağlayıcıları</h2>
            <ul>
                <li><strong>Supabase:</strong> Kimlik doğrulama, veritabanı ve özel fotoğraf depolama (private storage).</li>
                <li><strong>Vercel:</strong> Web barındırma, sunucu taraflı haber akışı ve üçüncü taraf servis kullanmadan yaklaşık şehir/ülke başlığı okuma.</li>
                <li><strong>Google Gemini API (Yalnızca Kullanıcı Tercihiyle):</strong> Ayarlar'dan kendi API anahtarınızı girip Mobi AI asistanını kullandığınızda sohbet istemleriniz doğrudan Google Gemini API'ye iletilir.</li>
                <li><strong>Harita, Hava Durumu ve Döviz Servisleri:</strong> Esri harita katmanları, OpenStreetMap Nominatim adres arama, Open-Meteo hava durumu ve döviz kuru sağlayıcıları yalnızca ilgili ekran açıldığında sorgulanır.</li>
            </ul>
            <h2>4. KVKK Madde 11 Kapsamındaki Haklarınız ve Silme</h2>
            <p>İstediğiniz zaman <strong>Ayarlar → Veri Yedekleme</strong> üzerinden verilerinizi JSON formatında indirebilir, <strong>Çerez Tercihleri</strong> veya <strong>Ayarlar → Gizlilik</strong> üzerinden analitik izninizi geri çekebilir, <strong>Ayarlar → Hesabı ve Verileri Kalıcı Sil</strong> ile hesabınızı, tüm uygulama kayıtlarınızı, fotoğraflarınızı ve analitik kimlik eşleştirmelerinizi kalıcı olarak silebilirsiniz.</p>
            <p>KVKK başvuruları için <a href="/hakkimizda">Hakkımızda &amp; İletişim</a> sayfasındaki başvuru kanalını kullanabilirsiniz.</p>
        `
    },
    cookies: {
        slug: 'cerez-politikasi',
        title: 'Çerez ve Yerel Depolama Politikası',
        description: 'TravellerMobi zorunlu oturum/çevrimdışı depolama ve açık rızaya bağlı analitik çerez politikası.',
        body: `
            <p>TravellerMobi, çevrimdışı (offline-first) çalışma ve oturum güvenliği için tarayıcı yerel depolama alanlarını (<code>localStorage</code>, <code>sessionStorage</code>, Service Worker önbelleği) kullanır.</p>
            <h2>1. Zorunlu Depolama (Her Zaman Aktif)</h2>
            <ul>
                <li><strong>Oturum ve Güvenlik:</strong> Supabase giriş oturumu ve erişim belirteci.</li>
                <li><strong>Çevrimdışı Önbellek:</strong> İnternet bağlantısı yokken verilerinize erişebilmeniz için yerel önbellek (çıkış yaptığınızda cihazdan tamamen temizlenir).</li>
                <li><strong>Tema ve Tercihler:</strong> Açık/koyu tema, varsayılan para birimi ve gizlilik rızası kaydı.</li>
            </ul>
            <h2>2. Analitik ve Kullanım İstatistikleri (Açık Rızaya Bağlı)</h2>
            <ul>
                <li>Varsayılan olarak <strong>kapalıdır</strong>. Yalnızca açık rıza verdiğinizde ziyaretçi/oturum tanımlayıcısı oluşturulur ve içerik performansı ile ürün deneyimi ölçülür.</li>
                <li>Üçüncü taraf reklam veya yeniden pazarlama çerezi <strong>kullanılmaz</strong>.</li>
                <li>Tercihinizi dilediğiniz zaman sayfa altındaki <strong>Çerez Tercihleri</strong> bağlantısından veya <strong>Ayarlar</strong> sayfasından değiştirebilirsiniz.</li>
            </ul>
        `
    },
    terms: {
        slug: 'kullanim-sartlari',
        title: 'Kullanım Şartları',
        description: 'TravellerMobi web uygulaması ve içerik platformu kullanım koşulları.',
        body: `
            <p>TravellerMobi'yi kullanarak aşağıdaki koşulları kabul etmiş sayılırsınız:</p>
            <ul>
                <li><strong>Hizmet Kapsamı:</strong> TravellerMobi kişisel seyahat planlama, mekan haritalama, grup masraf takibi, anı günlüğü, rezervasyon takibi ve seyahat rehberleri sunar.</li>
                <li><strong>Üyelik Onayı:</strong> Keşfet (Blog ve Haberler) bölümü herkese açıktır. Kişisel seyahat planlama araçları e-posta doğrulaması ve yönetici onayı ile aktif edilir.</li>
                <li><strong>İçerik ve Bilgi Doğruluğu:</strong> Blog yazılarındaki ulaşım, ücret, vize bilgileri ve döviz kurları bilgilendirme amaçlıdır; seyahat öncesinde resmi kurumlardan teyit edilmelidir.</li>
                <li><strong>Paylaşılan Rotalar:</strong> PIN korumalı veya açık rota paylaşım linklerinin sorumluluğu paylaşan kullanıcıya aittir; hassas kişisel adres/konum bilgilerini paylaşmamanız önerilir.</li>
                <li><strong>Kötüye Kullanım:</strong> Otomatik bot trafiği, yetkisiz erişim girişimi veya sistem kaynaklarını zorlayıcı kullanım engellenir ve ilgili hesaplar sonlandırılabilir.</li>
            </ul>
        `
    },
    about: {
        slug: 'hakkimizda',
        title: 'Hakkımızda ve İletişim',
        description: 'TravellerMobi hakkında bilgi, yayın ilkeleri ve iletişim / KVKK başvuru kanalı.',
        body: `
            <p><strong>TravellerMobi</strong>, seyahat planlama, harita üzerinde mekan/rota düzenleme, çoklu para birimli grup masraf bölüşümü ve çevrimdışı anı günlüğünü tek bir sade web &amp; PWA deneyiminde bir araya getiren bağımsız bir platformdur.</p>
            <h2>Yayın ve İçerik İlkeleri</h2>
            <ul>
                <li>Blog rehberleri editör kontrolünden geçirilerek pratik gezi bilgileri sunacak şekilde hazırlanır; güncellenme tarihleri yazı başında belirtilir.</li>
                <li>Seyahat haberleri bölümü güvenilir haber kaynaklarından yalnızca başlık, kısa özet ve orijinal kaynağa doğrudan bağlantı biçiminde derlenir.</li>
            </ul>
            <h2>İletişim ve KVKK Başvuru Kanalı</h2>
            <p>Görüş, içerik düzeltme, telif/görsel atıf bildirimi veya KVKK kapsamındaki talepleriniz için:</p>
            <ul>
                <li><strong>Veri Yönetimi ve Hesap Silme:</strong> Giriş yaptıktan sonra <strong>Ayarlar</strong> sayfasındaki JSON yedekleme, gizlilik tercihi ve kalıcı hesap silme araçlarını doğrudan kullanabilirsiniz.</li>
                <li><strong>İletişim / Bildirim:</strong> Proje destek kanalı — <a href="https://github.com/bilallacar/TravellerMobi/issues" target="_blank" rel="noopener noreferrer">github.com/bilallacar/TravellerMobi/issues</a></li>
            </ul>
        `
    }
};

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export default function handler(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    const key = String(req.query?.page || 'privacy').toLowerCase();
    const doc = PAGES[key] || PAGES.privacy;
    const canonical = `${SITE_URL}/${doc.slug}`;

    return res.status(200).send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(doc.title)} | TravellerMobi</title>
  <meta name="description" content="${escapeHtml(doc.description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="tr_TR">
  <meta property="og:site_name" content="TravellerMobi">
  <meta property="og:title" content="${escapeHtml(doc.title)} | TravellerMobi">
  <meta property="og:description" content="${escapeHtml(doc.description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${SITE_URL}/icons/icon-512.png">
  <link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#ffffff;--fg:#111827;--muted:#6b7280;--border:#e5e7eb;--surface:#f9fafb;--accent:#4f46e5}
    *{box-sizing:border-box}
    body{margin:0;font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);line-height:1.75}
    .topbar{border-bottom:1px solid var(--border);background:#fff;position:sticky;top:0;z-index:20}
    .topbar-inner{max-width:860px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .brand{font-weight:800;font-size:17px;color:var(--fg);text-decoration:none}
    .btn{display:inline-flex;align-items:center;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid var(--border);color:var(--fg);background:#fff}
    .btn-primary{background:var(--fg);color:#fff;border-color:var(--fg)}
    main{max-width:760px;margin:0 auto;padding:36px 20px 64px}
    .tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px}
    .tab{padding:6px 12px;border-radius:999px;border:1px solid var(--border);font-size:12.5px;font-weight:600;color:var(--muted);text-decoration:none}
    .tab.active{background:var(--fg);color:#fff;border-color:var(--fg)}
    h1{font-size:clamp(24px,3.5vw,32px);line-height:1.25;margin:0 0 18px}
    h2{font-size:18px;margin:26px 0 10px}
    p,li{font-size:15px;color:#374151}
    ul{padding-left:20px;margin:0 0 16px}
    li{margin-bottom:8px}
    a{color:var(--accent)}
    footer{border-top:1px solid var(--border);padding:20px;text-align:center;font-size:12.5px;color:var(--muted)}
    footer a{color:var(--muted);margin:0 8px;text-decoration:none}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/#explore" class="brand">TravellerMobi</a>
      <a href="/#explore" class="btn btn-primary">Uygulamaya Dön</a>
    </div>
  </header>
  <main>
    <nav class="tabs" aria-label="Yasal Sayfalar">
      <a href="/gizlilik" class="tab ${key === 'privacy' ? 'active' : ''}">Gizlilik &amp; KVKK</a>
      <a href="/cerez-politikasi" class="tab ${key === 'cookies' ? 'active' : ''}">Çerez Politikası</a>
      <a href="/kullanim-sartlari" class="tab ${key === 'terms' ? 'active' : ''}">Kullanım Şartları</a>
      <a href="/hakkimizda" class="tab ${key === 'about' ? 'active' : ''}">Hakkımızda &amp; İletişim</a>
    </nav>
    <h1>${escapeHtml(doc.title)}</h1>
    ${doc.body}
  </main>
  <footer>
    <span>© ${new Date().getFullYear()} TravellerMobi</span>
    <a href="/#explore">Keşfet</a>
    <a href="/gizlilik">Gizlilik &amp; KVKK</a>
    <a href="/cerez-politikasi">Çerez Politikası</a>
    <a href="/kullanim-sartlari">Kullanım Şartları</a>
    <a href="/hakkimizda">Hakkımızda</a>
  </footer>
</body>
</html>`);
}
