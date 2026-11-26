// api/blog-seo.js - Server-Rendered SEO & Open Graph Page for /blog/:slug

const DEFAULT_SUPABASE_URL = 'https://pbfriozhmtyspfzgnkkq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM';
const SITE_URL = (process.env.SITE_URL || 'https://traveller-mobi.vercel.app').replace(/\/+$/, '');

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJsonLd(obj) {
    return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function formatDateTR(dateStr) {
    if (!dateStr) return '';
    try {
        return new Date(dateStr).toLocaleDateString('tr-TR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    } catch {
        return '';
    }
}

function renderSafeMarkdown(raw) {
    if (!raw) return '';
    const escaped = escapeHtml(raw);
    const lines = escaped.split(/\r?\n/);
    const blocks = [];
    let listMode = null;

    const formatInline = (text) => text
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<figure class="post-figure"><img src="$2" alt="$1" loading="lazy"><figcaption>$1</figcaption></figure>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/\[([^\]]+)\]\((#post\?slug=([a-zA-Z0-9_-]+))\)/g, '<a href="/blog/$3">$1</a>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');

    const closeList = () => {
        if (listMode) {
            blocks.push(`</${listMode}>`);
            listMode = null;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) {
            closeList();
            continue;
        }
        if (/^(-{3,}|\*{3,})$/.test(line)) {
            closeList();
            blocks.push('<hr>');
        } else if (line.startsWith('### ')) {
            closeList();
            blocks.push(`<h3>${formatInline(line.slice(4))}</h3>`);
        } else if (line.startsWith('## ')) {
            closeList();
            blocks.push(`<h2>${formatInline(line.slice(3))}</h2>`);
        } else if (line.startsWith('# ')) {
            closeList();
            blocks.push(`<h2>${formatInline(line.slice(2))}</h2>`);
        } else if (line.startsWith('&gt; ')) {
            closeList();
            blocks.push(`<blockquote>${formatInline(line.slice(5))}</blockquote>`);
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
            if (listMode !== 'ul') {
                closeList();
                blocks.push('<ul>');
                listMode = 'ul';
            }
            blocks.push(`<li>${formatInline(line.slice(2))}</li>`);
        } else if (/^\d+\.\s+/.test(line)) {
            if (listMode !== 'ol') {
                closeList();
                blocks.push('<ol>');
                listMode = 'ol';
            }
            blocks.push(`<li>${formatInline(line.replace(/^\d+\.\s+/, ''))}</li>`);
        } else {
            closeList();
            blocks.push(`<p>${formatInline(line)}</p>`);
        }
    }
    closeList();
    return blocks.join('\n');
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const rawSlug = String(req.query?.slug || '').trim().replace(/^\/+|\/+$/g, '');
    const slug = rawSlug.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 140);

    if (!slug) {
        return res.redirect(302, '/#explore');
    }

    const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || DEFAULT_SUPABASE_ANON_KEY;

    try {
        const postRes = await fetch(
            `${supabaseUrl}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*&limit=1`,
            {
                headers: {
                    apikey: supabaseAnonKey,
                    Authorization: `Bearer ${supabaseAnonKey}`
                }
            }
        );

        const rows = postRes.ok ? await postRes.json() : [];
        const post = Array.isArray(rows) ? rows[0] : null;

        if (!post) {
            res.setHeader('Cache-Control', 'public, s-maxage=60');
            return res.status(404).send(`<!DOCTYPE html>
<html lang="tr"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yazı Bulunamadı | TravellerMobi</title>
<meta name="robots" content="noindex">
<style>body{font-family:Inter,system-ui,sans-serif;max-width:680px;margin:80px auto;padding:0 20px;color:#111827;text-align:center}a{display:inline-block;margin-top:20px;padding:10px 18px;border-radius:8px;background:#111827;color:#fff;text-decoration:none}</style>
</head><body><h1>Yazı Bulunamadı</h1><p>Aradığınız blog yazısı kaldırılmış veya henüz yayınlanmamış olabilir.</p><a href="/#explore">Keşfet Sayfasına Dön</a></body></html>`);
        }

        const canonicalUrl = `${SITE_URL}/blog/${encodeURIComponent(post.slug)}`;
        const title = `${post.title} | TravellerMobi`;
        const description = (post.summary || post.content || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        const safeCover = /^https?:\/\//i.test(String(post.cover_image_url || '').trim())
            ? post.cover_image_url.trim()
            : `${SITE_URL}/icons/icon-512.png`;
        const pubIso = post.published_at || post.created_at || new Date().toISOString();
        const modIso = post.updated_at || pubIso;
        const pubStr = formatDateTR(pubIso);
        const modStr = formatDateTR(modIso);
        const showUpdated = modStr && pubStr && modStr !== pubStr;
        const author = post.author_name || 'TravellerMobi Editör';

        const jsonLd = {
            '@context': 'https://schema.org',
            '@type': 'Article',
            headline: post.title,
            description,
            image: [safeCover],
            datePublished: pubIso,
            dateModified: modIso,
            author: { '@type': 'Person', name: author },
            publisher: {
                '@type': 'Organization',
                name: 'TravellerMobi',
                logo: { '@type': 'ImageObject', url: `${SITE_URL}/icons/icon-512.png` }
            },
            mainEntityOfPage: { '@type': 'WebPage', '@id': canonicalUrl }
        };

        const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
            ? `<div class="tags">${post.tags.map(t => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>`
            : '';

        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
        return res.status(200).send(`<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <meta property="og:type" content="article">
  <meta property="og:locale" content="tr_TR">
  <meta property="og:site_name" content="TravellerMobi">
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(safeCover)}">
  <meta property="og:image:alt" content="${escapeHtml(post.title)}">
  <meta property="article:author" content="${escapeHtml(author)}">
  <meta property="article:published_time" content="${escapeHtml(pubIso)}">
  <meta property="article:modified_time" content="${escapeHtml(modIso)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(safeCover)}">
  <meta name="twitter:image:alt" content="${escapeHtml(post.title)}">
  <link rel="icon" type="image/svg+xml" href="/icons/icon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
  <style>
    :root{--bg:#ffffff;--fg:#111827;--muted:#6b7280;--border:#e5e7eb;--surface:#f9fafb;--accent:#4f46e5}
    *{box-sizing:border-box}
    body{margin:0;font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);line-height:1.75}
    .topbar{border-bottom:1px solid var(--border);background:#fff;position:sticky;top:0;z-index:20}
    .topbar-inner{max-width:860px;margin:0 auto;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px}
    .brand{font-weight:800;font-size:17px;color:var(--fg);text-decoration:none;letter-spacing:-.02em}
    .nav-actions{display:flex;gap:8px;align-items:center}
    .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid var(--border);color:var(--fg);background:#fff}
    .btn-primary{background:var(--fg);color:#fff;border-color:var(--fg)}
    main{max-width:760px;margin:0 auto;padding:36px 20px 72px}
    .meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:var(--muted);margin-bottom:12px}
    .kicker{color:var(--accent);font-weight:700;text-transform:uppercase;font-size:11.5px;letter-spacing:.04em}
    h1{font-size:clamp(26px,4vw,38px);line-height:1.2;letter-spacing:-.025em;margin:0 0 14px}
    .lead{font-size:17px;color:#374151;margin:0 0 22px;line-height:1.65}
    .cover{width:100%;max-height:420px;object-fit:cover;border-radius:14px;margin:0 0 28px;border:1px solid var(--border)}
    article h2{font-size:22px;margin:30px 0 12px;letter-spacing:-.015em}
    article h3{font-size:18px;margin:24px 0 10px}
    article p{margin:0 0 16px;font-size:16px;color:#1f2937}
    article ul,article ol{margin:0 0 18px;padding-left:22px}
    article li{margin-bottom:8px;color:#1f2937}
    article blockquote{margin:20px 0;padding:14px 18px;border-left:3px solid var(--accent);background:var(--surface);border-radius:0 10px 10px 0;color:#374151}
    .post-figure{margin:22px 0;text-align:center}
    .post-figure img{max-width:100%;border-radius:10px}
    .post-figure figcaption{font-size:12px;color:var(--muted);margin-top:6px}
    .tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
    .tag{background:var(--surface);border:1px solid var(--border);padding:4px 10px;border-radius:999px;font-size:12px;color:var(--muted)}
    .cta{margin-top:38px;padding:24px;border-radius:14px;background:var(--surface);border:1px solid var(--border);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px}
    .cta h3{margin:0 0 6px;font-size:18px}
    .cta p{margin:0;font-size:14px;color:var(--muted)}
    footer{border-top:1px solid var(--border);margin-top:48px;padding:22px 20px;text-align:center;font-size:12.5px;color:var(--muted)}
    footer a{color:var(--muted);margin:0 8px;text-decoration:none}
    footer a:hover{color:var(--fg)}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/#explore" class="brand">TravellerMobi</a>
      <div class="nav-actions">
        <a href="/#explore" class="btn">Tüm Yazılar &amp; Haberler</a>
        <a href="/#auth?tab=register" class="btn btn-primary">Üyelik Başvurusu</a>
      </div>
    </div>
  </header>
  <main>
    <article>
      <div class="meta">
        <span class="kicker">${escapeHtml(post.category || 'Şehir Rehberi')}</span>
        <span>·</span>
        <span>${escapeHtml(author)}</span>
        ${pubStr ? `<span>·</span><time datetime="${escapeHtml(pubIso)}">${escapeHtml(pubStr)}</time>` : ''}
        ${showUpdated ? `<span>·</span><span>Son güncelleme: ${escapeHtml(modStr)}</span>` : ''}
        <span>·</span>
        <span>${Number(post.read_time_minutes) || 3} dk okuma</span>
      </div>
      <h1>${escapeHtml(post.title)}</h1>
      ${post.summary ? `<p class="lead">${escapeHtml(post.summary)}</p>` : ''}
      ${/^https?:\/\//i.test(String(post.cover_image_url || '').trim()) ? `<img class="cover" src="${escapeHtml(post.cover_image_url.trim())}" alt="${escapeHtml(post.title)}">` : ''}
      ${renderSafeMarkdown(post.content)}
      ${tagsHtml}
    </article>
    <section class="cta">
      <div>
        <h3>Seyahat rotanı, mekanlarını ve bütçeni tek yerden yönet</h3>
        <p>Haritada mekanlarını işaretle, grup masraflarını bölüş ve çevrimdışı modda yanında taşı.</p>
      </div>
      <a href="/#post?slug=${encodeURIComponent(post.slug)}" class="btn btn-primary">Uygulamada Aç</a>
    </section>
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
    } catch {
        return res.redirect(302, `/#post?slug=${encodeURIComponent(slug)}`);
    }
}
