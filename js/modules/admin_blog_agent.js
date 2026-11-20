// js/modules/admin_blog_agent.js
// Admin-only AI Blog Author & Content Safety Auditor (never precached in sw.js or imported for non-admins)

import { config, saveGeminiConfig } from '../../config.js';
import { state } from '../state.js';
import { showToast, escapeHtml } from '../utils.js';
import { renderMarkdownContent } from './explore.js';

const ALLOWED_BLOG_CATEGORIES = [
    'Şehir Rehberi',
    'Rota Önerisi',
    'Vize & Ulaşım',
    'Seyahat Gündemi',
    'Bütçe & İpucu',
    'Yeme İçme',
    'Konaklama',
    'Deneyim'
];

const RISK_PATTERNS = [
    {
        severity: 'danger',
        label: 'Kesin vize/hukuk garantisi ifadesi',
        regex: /(% ?100\s+vize|100%\s+vize|kesin\s+vize\s+(çık|onay|garanti)|vize\s+garantisi|hukuki\s+danışmanlık\s+yerine)/i,
        detail: 'Resmi vize ve hukuk konularında kesin garanti ifadeleri kullanılmamalıdır.'
    },
    {
        severity: 'danger',
        label: 'Zararlı / yasaklı HTML veya script kalıntısı',
        regex: /<\s*(script|iframe|object|embed|style|form)\b|on[a-z]+\s*=|javascript:/i,
        detail: 'İçerikte güvensiz HTML/script kalıntısı tespit edildi ve temizlendi.'
    },
    {
        severity: 'danger',
        label: 'AdSense / politika riskli konu veya argo',
        regex: /\b(bahis|casino|kumar|iddaa\s+tüyoları|korsan\s+indirme|crackli|porno|kumarhane\s+bonusu)\b/i,
        detail: 'Reklam politikalarına ve yayın ilkelerine aykırı kelime tespit edildi.'
    },
    {
        severity: 'warning',
        label: 'Aşırı büyük harf / clickbait riski',
        regex: /(^|\s)[A-ZÇĞİÖŞÜ]{8,}(\s|$)/,
        detail: 'Tamamı büyük harf kelime veya clickbait başlık tonu sadeleştirilmelidir.'
    },
    {
        severity: 'warning',
        label: 'Güvensiz HTTP (HTTPS olmayan) veya yer tutucu bağlantı',
        regex: /http:\/\/[^\s)]+|https?:\/\/(?:example\.com|localhost|127\.0\.0\.1)/i,
        detail: 'Dış bağlantılar yalnızca geçerli ve güvenli HTTPS adresleri olmalıdır.'
    }
];

function slugifyTRLocal(text) {
    const map = {
        'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u',
        'ş': 's', 'Ş': 's', 'ı': 'i', 'İ': 'i',
        'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c'
    };
    return String(text || '')
        .replace(/[ğĞüÜşŞıİöÖçÇ]/g, ch => map[ch] || ch)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90);
}

function estimateReadMinutesLocal(content) {
    const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 180));
}

function isStrictAdmin() {
    return !!(
        state.activeUser &&
        state.userProfile &&
        state.userProfile.status === 'approved' &&
        state.isAdmin
    );
}

function stripDangerousArtifacts(rawText) {
    return String(rawText || '')
        .replace(/\u00a0|&nbsp;/gi, ' ')
        .replace(/<\s*(script|style|iframe|object|embed)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/javascript:/gi, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractTrailingSeoBlock(markdownText) {
    let text = String(markdownText || '');
    let extractedTitle = '';
    let extractedSummary = '';
    let extractedTags = [];

    // Detect AI-appended SEO package sections at the bottom of articles
    const seoMarkerRegex = /(?:^|\n)(?:#{1,4}\s*.*(?:Yayın ve SEO Paketi|SEO Paketi|Meta Bilgileri|SEO Önerileri)|(?:\*\*|__)?(?:Alternatif SEO Başlıkları|Meta Açıklama|Önerilen Etiketler)(?:\*\*|__)?\s*:)/i;
    const match = text.match(seoMarkerRegex);
    if (match && typeof match.index === 'number') {
        const tail = text.slice(match.index);
        text = text.slice(0, match.index).replace(/\n---\s*$/, '').trim();

        const metaMatch = tail.match(/Meta Açıklama[^:]*:\s*(?:\n|\s)*[*_]?([^\n*]+)[*_]?/i);
        if (metaMatch) {
            extractedSummary = metaMatch[1].replace(/^\*+|\*+$/g, '').trim();
        }

        const tagsMatch = tail.match(/Önerilen Etiketler[^:]*:\s*(?:\n|\s)*([^\n]+)/i);
        if (tagsMatch) {
            extractedTags = tagsMatch[1]
                .replace(/`/g, '')
                .split(',')
                .map(t => t.replace(/^#/, '').trim())
                .filter(Boolean);
        }

        const altTitleMatch = tail.match(/1\.\s*\*?([^\n*]+)\*?/);
        if (altTitleMatch) {
            extractedTitle = altTitleMatch[1].trim();
        }
    }

    return { cleanBody: text, extractedTitle, extractedSummary, extractedTags };
}

/**
 * Pure audit & cleanup pipeline applied to BOTH AI-generated drafts and externally pasted articles
 */
export function auditAndCleanBlogDraft({
    title = '',
    summary = '',
    content = '',
    category = 'Şehir Rehberi',
    tags = [],
    sourceNotes = '',
    aiFactNotes = []
} = {}) {
    const issues = [];
    let body = String(content || '').trim();
    let cleanTitle = stripDangerousArtifacts(title);
    let cleanSummary = stripDangerousArtifacts(summary);
    let cleanTags = Array.isArray(tags)
        ? tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean)
        : String(tags || '').split(',').map(t => t.replace(/^#/, '').trim()).filter(Boolean);

    // 1. Check raw text BEFORE sanitization for unsafe artifacts
    for (const rule of RISK_PATTERNS) {
        if (rule.regex.test(`${cleanTitle}\n${cleanSummary}\n${body}`)) {
            issues.push({ severity: rule.severity, label: rule.label, detail: rule.detail });
        }
    }

    // 2. Sanitize HTML / non-breaking spaces / scripts
    body = stripDangerousArtifacts(body);

    // 3. Remove trailing SEO package if AI glued one inside the article body
    const seoExtract = extractTrailingSeoBlock(body);
    if (seoExtract.cleanBody.length !== body.length) {
        body = seoExtract.cleanBody;
        issues.push({
            severity: 'info',
            label: 'Yazı sonu SEO paketi ayrıştırıldı',
            detail: 'Makale sonuna yapışmış SEO/Meta açıklaması içerikten temizlenip form alanlarına aktarıldı.'
        });
    }
    if (!cleanSummary && seoExtract.extractedSummary) cleanSummary = seoExtract.extractedSummary;
    if (cleanTags.length === 0 && seoExtract.extractedTags.length > 0) cleanTags = seoExtract.extractedTags;
    if (!cleanTitle && seoExtract.extractedTitle) cleanTitle = seoExtract.extractedTitle;

    // 4. Deduplicate leading "# Heading" so the page H1 doesn't appear twice
    const lines = body.split('\n');
    if (lines[0] && /^#\s+/.test(lines[0])) {
        const leadingH1 = lines[0].replace(/^#\s+/, '').trim();
        if (!cleanTitle) cleanTitle = leadingH1;
        lines.shift();
        while (lines.length > 0 && !lines[0].trim()) lines.shift();
        body = lines.join('\n').trim();
        issues.push({
            severity: 'info',
            label: 'Tekrarlanan H1 ana başlık düzeltildi',
            detail: 'Yazı gövdesi başındaki # H1 başlığı üst başlık alanına alınıp çift başlık görünümü önlendi.'
        });
    }

    // 5. Fallback summary extraction if still empty
    if (!cleanSummary) {
        const firstPara = body
            .split('\n\n')
            .map(p => p.trim())
            .find(p => p && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('---') && !p.startsWith('* ') && !p.startsWith('- '));
        if (firstPara) {
            cleanSummary = firstPara.replace(/\*\*|\*|`/g, '').slice(0, 175).trim();
            if (cleanSummary.length >= 170) cleanSummary += '...';
        }
    }

    // 6. Detect specific percentages / numeric survey stats not grounded in admin's sourceNotes
    const statMatches = body.match(/%\s*\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s*%|\b\d{1,3}(?:\.\d{3})+\+?\b/g) || [];
    const uniqueStats = Array.from(new Set(statMatches.map(s => s.replace(/\s+/g, ' ').trim())));
    const normalizedNotes = String(sourceNotes || '').toLowerCase();
    const ungroundedStats = sourceNotes
        ? uniqueStats.filter(st => !normalizedNotes.includes(st.toLowerCase()))
        : uniqueStats;

    if (ungroundedStats.length > 0) {
        issues.push({
            severity: 'warning',
            label: `Doğrulanması gereken ${ungroundedStats.length} sayısal veri / yüzde`,
            detail: `Kaynak notunuzda doğrudan geçmeyen istatistikler (${ungroundedStats.slice(0, 5).join(', ')}). Yayınlamadan önce doğruluğunu kontrol etmeniz önerilir.`
        });
    }

    // 7. Add AI-self-reported fact checks if provided
    if (Array.isArray(aiFactNotes)) {
        for (const note of aiFactNotes.slice(0, 4)) {
            const trimmed = String(note || '').trim();
            if (trimmed) {
                issues.push({
                    severity: 'info',
                    label: 'Teyit Notu',
                    detail: trimmed
                });
            }
        }
    }

    // 8. Check structural SEO & image readiness
    if (cleanTitle.length > 75) {
        issues.push({
            severity: 'info',
            label: 'Başlık uzunluğu (SEO)',
            detail: `Başlık ${cleanTitle.length} karakter. Arama sonuçları için 55–70 karakter arası idealdir.`
        });
    }

    const coverUrlVal = document.getElementById('blog-form-cover-url')?.value?.trim() || '';
    const hasCoverFile = (document.getElementById('blog-form-cover-file')?.files?.length || 0) > 0;
    if (!coverUrlVal && !hasCoverFile) {
        issues.push({
            severity: 'info',
            label: 'Kapak fotoğrafı eksik',
            detail: 'Kırık veya telifli link oluşmaması için kapak görseli otomatik eklenmedi; cihazınızdan bir fotoğraf yükleyebilirsiniz.'
        });
    }

    const safeCategory = ALLOWED_BLOG_CATEGORIES.includes(category) ? category : 'Şehir Rehberi';
    const hasDanger = issues.some(i => i.severity === 'danger');

    if (issues.length === 0) {
        issues.push({
            severity: 'info',
            label: 'Kalite & güvenlik kontrolü temiz',
            detail: 'Zararlı HTML, yasaklı ifade veya teknik biçim sorunu bulunamadı.'
        });
    }

    return {
        cleaned: {
            title: cleanTitle,
            slug: slugifyTRLocal(cleanTitle) || `yazi-${Date.now()}`,
            summary: cleanSummary,
            category: safeCategory,
            tags: cleanTags.slice(0, 8),
            content: body,
            readTime: estimateReadMinutesLocal(body)
        },
        issues,
        passedCritical: !hasDanger
    };
}

function buildBlogAgentPrompt({ topicOrSource, mode, tone, lengthKey }) {
    const lengthTargets = {
        short: '450-650 kelime arası öz ve net',
        medium: '750-1050 kelime arası dengeli ve akıcı',
        long: '1200-1600 kelime arası kapsamlı rehber'
    };

    const toneGuides = {
        editorial: 'TravellerMobi okuyucusuna hitap eden sıcak, deneyime dayalı, sade İskandinav dergi üslubu',
        analytical: 'Net, güvenilir, gereksiz süsten arınmış bilgilendirici seyahat analizi üslubu',
        budget: 'Pratik, fiyat/performans ve zaman tasarrufu odaklı gezi ipucu üslubu'
    };

    const modeInstruction = mode === 'audit_rewrite'
        ? 'Kullanıcının verdiği ham/taslak yazıyı koruyup dilini özgünleştir, bozuk yapıları düzelt, tekrar H1 başlığı ile yazı sonundaki SEO/meta bloklarını içerikten ayır ve yalnızca temiz meta alanlarına yerleştir.'
        : 'Kullanıcının verdiği konu veya kaynak notlarından yola çıkarak tamamen özgün, sıfırdan kurulmuş yeni bir Türkçe seyahat makalesi yaz. Kaynak metin varsa asla cümleleri birebir kopyalama (intihalsiz özgün sentez).';

    return `Sen TravellerMobi platformunun kıdemli baş editörü ve içerik güvenliği denetçisisin.

GÖREV:
${modeInstruction}

ZORUNLU YAZIM VE GÜVENLİK KURALLARI (İHLAL EDİLEMEZ):
1. DİL VE ÜSLUP: Doğal, akıcı Türkçe kullan. ${toneGuides[tone] || toneGuides.editorial}. Uzunluk hedefi: ${lengthTargets[lengthKey] || lengthTargets.medium}.
2. TELİF VE ÖZGÜNLÜK: Başka sitelerden birebir cümle kopyalama. Tamamen özgün anlatım kur.
3. HALÜSİNASYON YASAĞI: Kaynak notlarında geçmeyen kesin anket yüzdeleri (%35, %152 gibi), kesin bilet/vize ücretleri veya çalışma saatleri UYDURMA. Güncel ücret/kural gerekirse "güncel tutar ve kuralları resmi kaynaktan doğrulayın" ifadesi kullan. Doğrulanması gereken noktaları JSON'daki "fact_check_notes" dizisine yaz.
4. POLİTİKA VE HUKUK: "%100 vize garantisi", tıbbi/hukuki kesin tavsiye, marka karalama, argo, küfür, kumar/bahis, clickbait TAMAMI BÜYÜK HARF başlık ASLA kullanma.
5. TEKNİK MARKDOWN KURALLARI:
   - "content_markdown" içinde ASLA en üste "# Başlık" (H1) koyma; sadece "## Bölüm Başlığı" ve "### Alt Başlık" kullan.
   - ASLA HTML etiketi (<script>, <p>, <br>, <div>, &nbsp;) yazma.
   - ASLA sahte veya harici görsel linki (![...](http...)) uydurma.
   - Karşılaştırma özetlerinde temiz Markdown tablosu (| Sütun 1 | Sütun 2 |) kullanabilirsin.
   - "content_markdown" sonuna ASLA "SEO Paketi / Meta Açıklama / Etiketler" bölümü yazma; bunları ilgili JSON alanlarına ver.

KATEGORİ SEÇENEKLERİ (bunlardan tam biri):
${ALLOWED_BLOG_CATEGORIES.join(', ')}

YALNIZCA AŞAĞIDAKİ JSON FORMATINDA CEVAP VER:
{
  "title": "60-70 karakteri geçmeyen net, özgün SEO başlığı",
  "summary": "130-160 karakter arası akıcı meta/kart özeti",
  "category": "Yukarıdaki kategorilerden biri",
  "tags": ["etiket1", "etiket2", "etiket3", "etiket4"],
  "content_markdown": "## Giriş veya ilk bölüm...",
  "fact_check_notes": ["Eğer varsa yazarın yayınlamadan teyit etmesi gereken somut tarih/ücret/istatistik notları"]
}

KULLANICININ KONUSU / KAYNAK NOTLARI:
${topicOrSource}`;
}

async function callGeminiBlogAgent({ topicOrSource, mode, tone, lengthKey }) {
    const apiKey = (config.geminiApiKey || '').trim();
    if (!apiKey) {
        throw new Error('Gemini API anahtarı tanımlı değil. Aşağıdaki hızlı anahtar alanından veya Ayarlar sayfasından ekleyebilirsiniz.');
    }

    const model = (config.geminiModel || 'gemini-2.5-flash').trim();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const prompt = buildBlogAgentPrompt({ topicOrSource, mode, tone, lengthKey });

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.45,
                responseMimeType: 'application/json'
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || `Gemini API hatası (${response.status})`);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) {
        throw new Error('Model boş yanıt döndürdü.');
    }

    const cleanedJsonStr = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    return JSON.parse(cleanedJsonStr);
}

function applyCleanedDraftToForm(cleaned, sourceLabel = 'AI Blog Ajanı Taslağı') {
    const titleEl = document.getElementById('blog-form-title');
    const slugEl = document.getElementById('blog-form-slug');
    const catEl = document.getElementById('blog-form-category');
    const summaryEl = document.getElementById('blog-form-summary');
    const contentEl = document.getElementById('blog-form-content');
    const tagsEl = document.getElementById('blog-form-tags');
    const statusEl = document.getElementById('blog-form-status');
    const readTimeEl = document.getElementById('blog-form-read-time');
    const headingEl = document.getElementById('blog-form-heading');
    const idEl = document.getElementById('blog-form-id');

    if (idEl) idEl.value = '';
    if (titleEl) titleEl.value = cleaned.title || '';
    if (slugEl) {
        slugEl.value = cleaned.slug || '';
        slugEl.dataset.manual = '';
    }
    if (catEl && ALLOWED_BLOG_CATEGORIES.includes(cleaned.category)) {
        catEl.value = cleaned.category;
    }
    if (summaryEl) summaryEl.value = cleaned.summary || '';
    if (contentEl) contentEl.value = cleaned.content || '';
    if (tagsEl) tagsEl.value = (cleaned.tags || []).join(', ');
    if (readTimeEl) readTimeEl.value = cleaned.readTime || 3;
    // Enforce human-in-the-loop: always default AI output to draft so admin reviews before publishing
    if (statusEl) statusEl.value = 'draft';
    if (headingEl) headingEl.textContent = `${sourceLabel} (Önce İnceleyin)`;

    const previewBox = document.getElementById('blog-markdown-preview');
    const previewToggle = document.getElementById('btn-blog-toggle-preview');
    if (previewBox && contentEl) {
        previewBox.innerHTML = renderMarkdownContent(contentEl.value);
        previewBox.classList.remove('hidden');
        if (previewToggle) previewToggle.textContent = 'Önizlemeyi Gizle';
    }
}

function renderAuditReport(report) {
    const reportEl = document.getElementById('admin-blog-agent-report');
    if (!reportEl) return;

    const badgeClass = report.passedCritical ? 'badge-success' : 'badge-danger';
    const badgeText = report.passedCritical
        ? 'Kritik Risk Bulunmadı (Taslağa Aktarıldı)'
        : 'Dikkat: Riskli İfade Tespit Edildi';

    const itemsHtml = report.issues.map(item => {
        const icon = item.severity === 'danger' ? 'shield-alert' : item.severity === 'warning' ? 'alert-triangle' : 'check-circle-2';
        return `
            <div class="agent-audit-item agent-audit-${escapeHtml(item.severity)}">
                <i data-lucide="${icon}"></i>
                <div>
                    <strong>${escapeHtml(item.label)}:</strong>
                    <span>${escapeHtml(item.detail)}</span>
                </div>
            </div>
        `;
    }).join('');

    reportEl.innerHTML = `
        <div class="agent-audit-header">
            <span class="badge ${badgeClass}">${badgeText}</span>
            <span class="text-xs text-muted">Tahmini okuma: ${report.cleaned.readTime} dk · Durum: Taslak</span>
        </div>
        <div class="agent-audit-list">${itemsHtml}</div>
    `;
    reportEl.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

export function prefillBlogAgentInput(text) {
    const input = document.getElementById('admin-blog-agent-input');
    if (input) {
        input.value = String(text || '');
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus();
    }
}

export function unmountAdminBlogAgent() {
    const slot = document.getElementById('admin-blog-agent-slot');
    if (slot) {
        slot.innerHTML = '';
        slot.classList.add('hidden');
    }
}

export function mountAdminBlogAgent() {
    const slot = document.getElementById('admin-blog-agent-slot');
    if (!slot) return;

    if (!isStrictAdmin()) {
        unmountAdminBlogAgent();
        return;
    }

    slot.classList.remove('hidden');
    if (slot.dataset.mounted === '1') {
        syncAgentKeyBox();
        return;
    }
    slot.dataset.mounted = '1';

    slot.innerHTML = `
        <div class="card glass admin-blog-agent-card">
            <div class="admin-blog-agent-head">
                <div>
                    <h3 style="margin:0; display:flex; align-items:center; gap:8px;">
                        <i data-lucide="sparkles" style="color:var(--color-primary);"></i>
                        <span>AI Editör & İçerik Güvenliği Ajanı</span>
                        <span class="editorial-kicker">Sadece Admin</span>
                    </h3>
                    <p class="text-xs text-muted" style="margin-top:4px;">
                        Konu veya başka yerden bulduğunuz ham metni yapıştırın. Kopya/intihal, telif, zararlı HTML, uydurma istatistik ve politika risklerini eleyip doğrudan taslak formunu doldurur.
                    </p>
                </div>
                <button type="button" id="btn-agent-toggle-body" class="btn btn-secondary btn-sm">Gizle / Aç</button>
            </div>

            <div id="admin-blog-agent-body" class="admin-blog-agent-body">
                <div id="admin-agent-key-warning" class="agent-key-bar hidden">
                    <span class="text-xs"><strong>Gemini API Anahtarı gerekli:</strong> "AI ile Özgün Blog Yaz" için anahtarınızı girin (yalnızca bu tarayıcıya kaydedilir).</span>
                    <div style="display:flex; gap:6px; flex:1; max-width:420px;">
                        <input type="password" id="admin-agent-quick-key" class="text-input" placeholder="AIzaSy... Gemini API anahtarı" style="height:34px;">
                        <button type="button" id="btn-admin-save-agent-key" class="btn btn-primary btn-sm">Kaydet</button>
                    </div>
                </div>

                <div class="form-group" style="margin-bottom:10px;">
                    <label for="admin-blog-agent-input">Konu Başlığı, Araştırma Notları veya Denetlenecek Hazır Yazı</label>
                    <textarea id="admin-blog-agent-input" rows="5" class="textarea-input" placeholder="Örn: Belgrad hafta sonu gezisi için ulaşım, nakit dinar, Knez Mihailova ve Dorcol kafeleri hakkında özgün bir gezi rehberi yaz... (veya dışarıdan aldığınız uzun metni buraya yapıştırıp 'Denetle & Forma Aktar'a basın)"></textarea>
                </div>

                <div class="admin-form-grid-3" style="margin-bottom:12px;">
                    <div class="form-group">
                        <label for="admin-agent-tone">Yazı Üslubu</label>
                        <select id="admin-agent-tone" class="select-input">
                            <option value="editorial" selected>Samimi & Dergi Üslubu</option>
                            <option value="analytical">Bilgilendirici & Analiz (Vize/Trend)</option>
                            <option value="budget">Pratik & Bütçe Odaklı</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="admin-agent-length">Uzunluk Hedefi</label>
                        <select id="admin-agent-length" class="select-input">
                            <option value="short">Kısa (~500 kelime)</option>
                            <option value="medium" selected>Orta (~900 kelime)</option>
                            <option value="long">Detaylı Rehber (~1400 kelime)</option>
                        </select>
                    </div>
                    <div class="form-group" style="display:flex; align-items:flex-end; gap:8px; flex-wrap:wrap;">
                        <button type="button" id="btn-agent-generate" class="btn btn-primary btn-sm" style="height:40px; flex:1;">
                            <i data-lucide="wand-2"></i> AI ile Özgün Yaz
                        </button>
                        <button type="button" id="btn-agent-audit-only" class="btn btn-secondary btn-sm" style="height:40px; flex:1;" title="API harcamadan elinizdeki yazıyı temizler, SEO paketini ayırır ve risk kontrolü yapıp forma aktarır">
                            <i data-lucide="shield-check"></i> Denetle & Forma Aktar
                        </button>
                    </div>
                </div>

                <div id="admin-blog-agent-report" class="admin-blog-agent-report hidden"></div>
            </div>
        </div>
    `;

    syncAgentKeyBox();

    const toggleBtn = document.getElementById('btn-agent-toggle-body');
    const bodyEl = document.getElementById('admin-blog-agent-body');
    if (toggleBtn && bodyEl) {
        toggleBtn.addEventListener('click', () => {
            bodyEl.classList.toggle('hidden');
        });
    }

    const saveKeyBtn = document.getElementById('btn-admin-save-agent-key');
    const keyInput = document.getElementById('admin-agent-quick-key');
    if (saveKeyBtn && keyInput) {
        saveKeyBtn.addEventListener('click', () => {
            const val = keyInput.value.trim();
            if (!val) {
                showToast('Lütfen geçerli bir Gemini API anahtarı girin.', 'warning');
                return;
            }
            saveGeminiConfig(val, config.geminiModel || 'gemini-2.5-flash');
            keyInput.value = '';
            syncAgentKeyBox();
            showToast('Gemini API anahtarı kaydedildi.', 'success');
        });
    }

    const auditOnlyBtn = document.getElementById('btn-agent-audit-only');
    if (auditOnlyBtn) {
        auditOnlyBtn.addEventListener('click', () => {
            if (!isStrictAdmin()) return;
            const rawText = document.getElementById('admin-blog-agent-input')?.value?.trim() || '';
            if (!rawText) {
                showToast('Denetlemek için metin alanına bir yazı yapıştırın.', 'warning');
                return;
            }
            const report = auditAndCleanBlogDraft({ content: rawText });
            applyCleanedDraftToForm(report.cleaned, 'Denetlenmiş Taslak');
            renderAuditReport(report);
            showToast('Yazı temizlendi, güvenlik kontrolü yapıldı ve taslak formuna aktarıldı.', 'success');
        });
    }

    const generateBtn = document.getElementById('btn-agent-generate');
    if (generateBtn) {
        generateBtn.addEventListener('click', async () => {
            if (!isStrictAdmin()) return;
            const rawText = document.getElementById('admin-blog-agent-input')?.value?.trim() || '';
            if (rawText.length < 10) {
                showToast('Lütfen en az birkaç kelimelik konu veya kaynak notu girin.', 'warning');
                return;
            }
            const tone = document.getElementById('admin-agent-tone')?.value || 'editorial';
            const lengthKey = document.getElementById('admin-agent-length')?.value || 'medium';
            const mode = rawText.length > 450 ? 'audit_rewrite' : 'from_topic';

            const prevHtml = generateBtn.innerHTML;
            generateBtn.disabled = true;
            generateBtn.textContent = 'AI Yazıyor & Denetliyor...';

            try {
                const aiResult = await callGeminiBlogAgent({ topicOrSource: rawText, mode, tone, lengthKey });
                const report = auditAndCleanBlogDraft({
                    title: aiResult.title,
                    summary: aiResult.summary,
                    content: aiResult.content_markdown,
                    category: aiResult.category,
                    tags: aiResult.tags,
                    sourceNotes: rawText,
                    aiFactNotes: aiResult.fact_check_notes
                });
                applyCleanedDraftToForm(report.cleaned, 'AI Blog Ajanı Taslağı');
                renderAuditReport(report);
                showToast('Özgün blog taslağı oluşturuldu ve önizlemeye alındı!', 'success');
            } catch (err) {
                showToast('AI Blog Ajanı hatası: ' + (err.message || err), 'danger');
            } finally {
                generateBtn.disabled = false;
                generateBtn.innerHTML = prevHtml;
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    if (window.lucide) window.lucide.createIcons();
}

function syncAgentKeyBox() {
    const box = document.getElementById('admin-agent-key-warning');
    if (!box) return;
    box.classList.toggle('hidden', !!(config.geminiApiKey && config.geminiApiKey.trim()));
}
