// js/modules/legal.js - KVKK Privacy Policy, Cookie Policy, Terms of Use & About/Contact Modal

const LEGAL_DOCS = {
    privacy: {
        title: 'Gizlilik Politikası ve KVKK Aydınlatma Metni',
        updated: '2026',
        html: `
            <p><strong>TravellerMobi</strong> olarak kişisel verilerinizin güvenliğine önem veriyoruz. Bu metin, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında hangi verilerin hangi amaçla işlendiğini açıkça bilgilendirmek amacıyla hazırlanmıştır.</p>

            <h4>1. İşlenen Veriler ve Amaçları</h4>
            <ul>
                <li><strong>Üyelik ve Kimlik Bilgileri:</strong> Kayıt ve giriş işlemleri için e-posta adresiniz ve şifreniz (şifrelenmiş olarak Supabase Authentication üzerinde) işlenir.</li>
                <li><strong>Seyahat, Mekan, Masraf ve Anı Kayıtları:</strong> Uygulamayı kullanabilmeniz için eklediğiniz rota, mekan koordinatı, harcama, fotoğraf ve rezervasyon bilgileri yalnızca sizin hesabınızla ilişkilendirilir ve Row Level Security (RLS) politikalarıyla diğer kullanıcılardan izole edilir.</li>
                <li><strong>Rezervasyon / PNR Güvenliği:</strong> Rezervasyon kayıtlarına eklediğiniz PNR kodları hassas nitelik taşıyabilir. Paylaşılan rotalara rezervasyon veya PNR verisi dahil edilmez.</li>
                <li><strong>İsteğe Bağlı Kullanım ve Ziyaretçi Analitiği:</strong> Yalnızca <em>"Analitiği Kabul Et"</em> diyerek açık rıza vermeniz halinde; cihaz/tarayıcı türü, okunan blog yazıları, sayfa etkileşimleri, sunucu başlığından elde edilen yaklaşık ülke/şehir bilgisi (üçüncü taraf IP-konum servisi kullanılmadan Vercel edge başlığıyla) ve giriş yaptığınızda üyelik yolculuğu eşleştirmesi işlenir. Açık rıza vermediğinizde ("Sadece Zorunlu") hiçbir analitik kaydı gönderilmez.</li>
            </ul>

            <h4>2. Üçüncü Taraf Hizmetler ve Yurt Dışı Aktarım</h4>
            <ul>
                <li><strong>Supabase:</strong> Kimlik doğrulama, veritabanı ve özel fotoğraf depolama (private storage) altyapısı.</li>
                <li><strong>Vercel:</strong> Web barındırma, sunucu tarafı haber akışı ve anonimleştirilmiş sunucu başlığıyla şehir/ülke tespiti.</li>
                <li><strong>Google Gemini API (Yalnızca Mobi AI Kullanırsanız):</strong> Ayarlar'dan kendi API anahtarınızı girip Mobi AI asistanını kullandığınızda, sohbete yazdığınız seyahat/konum istemleri doğrudan Google Gemini API'ye iletilir. Google'ın ücretsiz katman veri işleme koşullarını incelemeniz önerilir.</li>
                <li><strong>Harita ve Döviz Servisleri:</strong> Harita katmanları (Esri), adres arama (OpenStreetMap Nominatim), hava durumu (Open-Meteo) ve döviz kurları (open.er-api / Frankfurter) yalnızca ilgili ekran kullanıldığında sorgulanır.</li>
            </ul>

            <h4>3. Saklama Süresi, Haklarınız ve Veri Silme</h4>
            <p>Hesap ve seyahat verileriniz hesabınız aktif olduğu sürece; açık rızaya bağlı analitik kayıtları ise en fazla <strong>12 ay</strong> süreyle saklanır. KVKK madde 11 uyarınca <strong>Ayarlar → Veri Yedekleme</strong> bölümünden tüm kayıtlarınızı JSON olarak indirebilir, <strong>Çerez Tercihleri</strong> / <strong>Ayarlar</strong> üzerinden analitik rızanızı geri çekebilir ve <strong>Ayarlar → Hesabı Kalıcı Sil</strong> seçeneğiyle hesabınızı, tüm kayıtlarınızı, fotoğraflarınızı ve analitik kimlik eşleştirmelerinizi kalıcı olarak silebilirsiniz.</p>
            <p>Ayrıca bu metinlere doğrudan <a href="/gizlilik" target="_blank" rel="noopener">/gizlilik</a>, <a href="/cerez-politikasi" target="_blank" rel="noopener">/cerez-politikasi</a>, <a href="/kullanim-sartlari" target="_blank" rel="noopener">/kullanim-sartlari</a> ve <a href="/hakkimizda" target="_blank" rel="noopener">/hakkimizda</a> adreslerinden de ulaşabilirsiniz.</p>
        `
    },
    cookies: {
        title: 'Çerez ve Yerel Depolama Politikası',
        updated: '2026',
        html: `
            <p>TravellerMobi, çevrimdışı (offline-first) çalışma ve oturum güvenliği için tarayıcınızın <code>localStorage</code>, <code>sessionStorage</code> ve Service Worker önbelleğini kullanır.</p>

            <h4>1. Zorunlu Depolama (Kapatılamaz)</h4>
            <ul>
                <li><strong>Oturum ve Güvenlik:</strong> Supabase giriş oturumu ve yetkilendirme belirteci.</li>
                <li><strong>Tema ve Tercihler:</strong> Açık/koyu tema seçimi, varsayılan para birimi ve gizlilik tercihi durumu.</li>
                <li><strong>Çevrimdışı Çalışma Önbelleği:</strong> İnternet kesildiğinde verilerinize erişebilmeniz için yerel önbellek ve senkronizasyon kuyruğu (çıkış yaptığınızda cihazdan temizlenir).</li>
            </ul>

            <h4>2. İsteğe Bağlı Analitik Depolama (Açık Rızanıza Bağlı)</h4>
            <ul>
                <li><strong>Ziyaretçi ve Oturum Tanımlayıcısı:</strong> Yalnızca <em>"Analitiği Kabul Et"</em> onayınız varsa oluşturulur; içerik okuma derinliği, site içi arama ve oturum açıldığında üye dönüşüm yolculuğu ölçümünde kullanılır.</li>
                <li>Bu tercihi dilediğiniz zaman <strong>Ayarlar</strong> sayfasından kapatabilirsiniz.</li>
            </ul>
        `
    },
    terms: {
        title: 'Kullanım Şartları',
        updated: '2026',
        html: `
            <p>TravellerMobi'yi kullanarak aşağıdaki temel koşulları kabul etmiş sayılırsınız:</p>
            <ul>
                <li><strong>Hizmet Kapsamı:</strong> TravellerMobi kişisel seyahat planlama, mekan kaydetme, grup masraf takibi, anı günlüğü ve seyahat içerikleri sunar.</li>
                <li><strong>Üyelik Onayı:</strong> Uygulama içi kişisel planlama araçları yönetici onaylı üyelik modeliyle çalışır; Keşfet (Blog ve Haberler) bölümü herkese açıktır.</li>
                <li><strong>İçerik ve Bilgi Doğruluğu:</strong> Blog yazılarındaki ulaşım, fiyat, vize bilgileri ve döviz kurları bilgilendirme amaçlıdır; seyahat öncesinde resmi kurumlardan teyit edilmelidir.</li>
                <li><strong>Paylaşılan Rotalar:</strong> PIN ile paylaştığınız rotalara yalnızca bağlantıyı ve PIN kodunu verdiğiniz kişiler erişebilir; paylaştığınız içeriklerin sorumluluğu size aittir.</li>
                <li><strong>Kötüye Kullanım:</strong> Otomatik bot trafiği, yetkisiz veri çekme veya sistem kaynaklarını zorlayıcı girişimler engellenir ve ilgili hesaplar sonlandırılabilir.</li>
            </ul>
        `
    },
    about: {
        title: 'Hakkımızda ve İletişim',
        updated: '2026',
        html: `
            <p><strong>TravellerMobi</strong>, gerçek gezi deneyimlerini düzenli bir şehir rehberine, harita rotasına, bölüşmeli masraf tablosuna ve çevrimdışı çalışan bir seyahat günlüğüne dönüştürmek için geliştirilmiş bağımsız bir web & PWA platformudur.</p>

            <h4>Neler Sunar?</h4>
            <ul>
                <li><strong>Harita & Rota Planlama:</strong> Gezilecek yerleri kategorize etme, yürüyüş rotası sıralama ve PIN korumalı grup paylaşımı.</li>
                <li><strong>Masraf & Bütçe Yönetimi:</strong> Çoklu para birimi desteği, işlem anı kuru kaydı ve grup içi otomatik borç hesaplaşması.</li>
                <li><strong>Anı Günlüğü & Biletler:</strong> Çevrimdışı fotoğraf günlüğü ve uçuş/otel rezervasyon takibi.</li>
                <li><strong>Keşfet:</strong> Pratik şehir rehberleri ve güvenilir kaynaklardan derlenen güncel seyahat haberleri.</li>
            </ul>

            <h4>İletişim ve KVKK Başvuruları</h4>
            <p>Geri bildirim, içerik düzeltme talepleri, telif/kaynak bildirimleri veya KVKK kapsamındaki başvurularınız için uygulama içi Ayarlar bölümündeki veri yönetimi araçlarını kullanabilir veya proje deposu üzerinden bizimle iletişime geçebilirsiniz.</p>
        `
    }
};

export function openLegalModal(docKey = 'privacy') {
    const modal = document.getElementById('modal-legal-doc');
    const titleEl = document.getElementById('legal-modal-title');
    const bodyEl = document.getElementById('legal-modal-body');
    if (!modal || !titleEl || !bodyEl) return;

    const doc = LEGAL_DOCS[docKey] || LEGAL_DOCS.privacy;
    titleEl.textContent = doc.title;
    bodyEl.innerHTML = doc.html;

    // Highlight active tab inside modal
    modal.querySelectorAll('[data-legal-tab]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-legal-tab') === docKey);
    });

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

export function closeLegalModal() {
    const modal = document.getElementById('modal-legal-doc');
    if (modal) modal.classList.add('hidden');
}

export function initLegalEvents() {
    const modal = document.getElementById('modal-legal-doc');
    const closeBtn = document.getElementById('btn-close-legal-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeLegalModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeLegalModal();
        });
        modal.querySelectorAll('[data-legal-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                openLegalModal(btn.getAttribute('data-legal-tab'));
            });
        });
    }

    // Delegated click listener for any [data-open-legal] link across the app
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-open-legal]');
        if (!trigger) return;
        e.preventDefault();
        openLegalModal(trigger.getAttribute('data-open-legal') || 'privacy');
    });
}
