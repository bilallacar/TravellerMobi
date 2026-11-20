// js/modules/explore.js - Public Discover View (Manual Blog Posts + Automatic Travel News)

import * as db from '../../db.js';
import { state } from '../state.js';
import { showToast, escapeHtml } from '../utils.js';
import { trackEvent, startReadingSession, trackSearchQuery, trackAuthCtaClick } from './analytics.js';

const NEWS_CACHE_KEY = 'travellermobi_travel_news_cache_v2';
const NEWS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 min client cache

let cachedBlogPosts = [];
let cachedNewsItems = [];
let newsUpdatedAt = null;
let activeExploreTab = 'all'; // 'all' | 'blog' | 'news'
let activeNewsCategory = 'all';
let activeBlogCategory = 'all';
let exploreSearchQuery = '';
let isNewsLoading = false;
let searchAnalyticsTimer = null;

const CATEGORY_COLORS = {
    'Havacılık': '#3b82f6',
    'Vize & Pasaport': '#f59e0b',
    'Turizm': '#10b981',
    'Destinasyon': '#8b5cf6',
    'Şehir Rehberi': '#4f46e5',
    'Rota Önerisi': '#06b6d4',
    'Bütçe & İpucu': '#10b981',
    'Yeme İçme': '#ef4444',
    'Konaklama': '#3b82f6',
    'Deneyim': '#ec4899',
    'Rehber': '#4f46e5',
    'Seyahat': '#14b8a6'
};

function getCategoryColor(cat) {
    return CATEGORY_COLORS[cat] || '#4f46e5';
}

function formatDateTR(dateStr) {
    if (!dateStr) return '';
    try {
        return new Date(dateStr).toLocaleDateString('tr-TR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return '';
    }
}

function formatRelativeTimeTR(dateStr) {
    if (!dateStr) return '';
    try {
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diffMs / 60000);
        if (mins < 2) return 'Az önce';
        if (mins < 60) return `${mins} dk önce`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} saat önce`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `${days} gün önce`;
        return formatDateTR(dateStr);
    } catch {
        return '';
    }
}

function readCachedNews() {
    try {
        const raw = localStorage.getItem(NEWS_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) return parsed;
    } catch (_) {}
    return null;
}

function writeCachedNews(items, updatedAt) {
    try {
        localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify({
            items: items || [],
            updatedAt: updatedAt || new Date().toISOString(),
            savedAt: Date.now()
        }));
    } catch (_) {}
}

export async function fetchAutomaticTravelNews(forceRefresh = false) {
    const cached = readCachedNews();
    if (!forceRefresh && cached && (Date.now() - (cached.savedAt || 0)) < NEWS_CACHE_TTL_MS && cached.items.length > 0) {
        cachedNewsItems = cached.items;
        newsUpdatedAt = cached.updatedAt;
        return cachedNewsItems;
    }

    if (!db.hasInternet()) {
        if (cached && cached.items.length > 0) {
            cachedNewsItems = cached.items;
            newsUpdatedAt = cached.updatedAt;
        }
        return cachedNewsItems;
    }

    isNewsLoading = true;
    renderNewsSection();

    try {
        // Attach admin-defined custom RSS sources and blocked source names if available
        let customQuery = '';
        let blockedQuery = '';
        try {
            const allSources = await db.getNewsSources(true);
            if (Array.isArray(allSources) && allSources.length > 0) {
                const customRss = allSources.filter(s => s.category !== '__block__' && String(s.rss_url || '').startsWith('https://'));
                const blockedSources = allSources.filter(s => s.category === '__block__').map(s => s.name).filter(Boolean);

                if (customRss.length > 0) {
                    const lean = customRss.slice(0, 6).map(s => ({
                        name: s.name,
                        category: s.category || 'Seyahat',
                        url: s.rss_url
                    }));
                    customQuery = `&custom=${encodeURIComponent(JSON.stringify(lean))}`;
                }
                if (blockedSources.length > 0) {
                    blockedQuery = `&blocked=${encodeURIComponent(blockedSources.join(','))}`;
                }
            }
        } catch (_) {}

        const cacheBust = forceRefresh ? `&t=${Date.now()}` : '';
        const res = await fetch(`/api/travel-news?limit=24${customQuery}${blockedQuery}${cacheBust}`, {
            cache: forceRefresh ? 'no-store' : 'default'
        });

        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) {
            throw new Error('local-or-unavailable');
        }

        const data = await res.json();
        if (data && data.ok && Array.isArray(data.items)) {
            cachedNewsItems = data.items;
            newsUpdatedAt = data.updatedAt || new Date().toISOString();
            writeCachedNews(cachedNewsItems, newsUpdatedAt);
            return cachedNewsItems;
        }
        throw new Error('empty-news');
    } catch (err) {
        console.warn('[Explore] Live news API unavailable, using cache/fallback:', err?.message);
        if (cached && cached.items.length > 0) {
            cachedNewsItems = cached.items;
            newsUpdatedAt = cached.updatedAt;
        }
        return cachedNewsItems;
    } finally {
        isNewsLoading = false;
        renderNewsSection();
    }
}

export function renderMarkdownContent(raw) {
    if (!raw) return '';
    const escaped = escapeHtml(raw);
    const lines = escaped.split(/\r?\n/);
    const htmlBlocks = [];
    let inList = false;

    const formatInline = (text) => {
        return text
            .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<figure class="post-inline-figure"><img src="$2" alt="$1" loading="lazy"><figcaption>$1</figcaption></figure>')
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*]+)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>');
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (inList) {
                htmlBlocks.push('</ul>');
                inList = false;
            }
            continue;
        }

        if (line.startsWith('### ')) {
            if (inList) { htmlBlocks.push('</ul>'); inList = false; }
            htmlBlocks.push(`<h3>${formatInline(line.slice(4))}</h3>`);
        } else if (line.startsWith('## ')) {
            if (inList) { htmlBlocks.push('</ul>'); inList = false; }
            htmlBlocks.push(`<h2>${formatInline(line.slice(3))}</h2>`);
        } else if (line.startsWith('# ')) {
            if (inList) { htmlBlocks.push('</ul>'); inList = false; }
            htmlBlocks.push(`<h2>${formatInline(line.slice(2))}</h2>`);
        } else if (line.startsWith('&gt; ')) {
            if (inList) { htmlBlocks.push('</ul>'); inList = false; }
            htmlBlocks.push(`<blockquote>${formatInline(line.slice(5))}</blockquote>`);
        } else if (line.startsWith('- ') || line.startsWith('* ')) {
            if (!inList) {
                htmlBlocks.push('<ul>');
                inList = true;
            }
            htmlBlocks.push(`<li>${formatInline(line.slice(2))}</li>`);
        } else {
            if (inList) { htmlBlocks.push('</ul>'); inList = false; }
            htmlBlocks.push(`<p>${formatInline(line)}</p>`);
        }
    }

    if (inList) htmlBlocks.push('</ul>');
    return htmlBlocks.join('\n');
}

function syncExploreGuestHeader() {
    const guestTopBar = document.getElementById('explore-public-header');
    const authCtaBtn = document.getElementById('btn-explore-auth-cta');
    const registerCtaBtn = document.getElementById('btn-explore-register-cta');
    const postAuthCtaBtn = document.getElementById('btn-post-auth-cta');
    const postTopAuthBtn = document.getElementById('btn-post-top-auth');
    const adminShortcut = document.getElementById('btn-explore-admin-shortcut');
    const isLoggedIn = !!(state.activeUser && state.userProfile?.status === 'approved');

    if (guestTopBar) {
        guestTopBar.classList.toggle('hidden', isLoggedIn);
    }
    if (postTopAuthBtn) {
        postTopAuthBtn.classList.toggle('hidden', isLoggedIn);
    }
    if (authCtaBtn) {
        authCtaBtn.innerHTML = isLoggedIn
            ? '<i data-lucide="layout-dashboard"></i><span>Seyahatlerim</span>'
            : '<i data-lucide="log-in"></i><span>Giriş Yap</span>';
        authCtaBtn.setAttribute('href', isLoggedIn ? '#dashboard' : '#auth');
    }
    if (registerCtaBtn) {
        registerCtaBtn.classList.toggle('hidden', isLoggedIn);
    }
    if (postAuthCtaBtn) {
        postAuthCtaBtn.setAttribute('href', isLoggedIn ? '#dashboard' : '#auth?tab=register');
        postAuthCtaBtn.textContent = isLoggedIn ? 'Seyahat Panelime Git' : 'Ücretsiz Kayıt Ol / Giriş Yap';
    }
    if (adminShortcut) {
        adminShortcut.classList.toggle('hidden', !state.isAdmin);
    }
    if (window.lucide) window.lucide.createIcons();
}

function renderBlogSection() {
    const featuredWrap = document.getElementById('explore-featured-post');
    const gridEl = document.getElementById('explore-blog-grid');
    const catWrap = document.getElementById('explore-blog-categories');
    const countBadge = document.getElementById('explore-blog-count');
    if (!gridEl) return;

    const q = exploreSearchQuery.trim().toLowerCase();
    const filtered = cachedBlogPosts.filter(post => {
        if (activeBlogCategory !== 'all' && (post.category || 'Rehber') !== activeBlogCategory) return false;
        if (!q) return true;
        const hay = `${post.title || ''} ${post.summary || ''} ${post.category || ''} ${(post.tags || []).join(' ')}`.toLowerCase();
        return hay.includes(q);
    });

    if (countBadge) countBadge.textContent = `${filtered.length} yazı`;

    // Dynamic category chips
    if (catWrap) {
        const cats = Array.from(new Set(cachedBlogPosts.map(p => p.category || 'Rehber').filter(Boolean)));
        if (cats.length > 0) {
            catWrap.classList.remove('hidden');
            catWrap.innerHTML = [
                `<button type="button" class="filter-pill ${activeBlogCategory === 'all' ? 'active' : ''}" data-blog-cat="all">Tümü</button>`,
                ...cats.map(c => `<button type="button" class="filter-pill ${activeBlogCategory === c ? 'active' : ''}" data-blog-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
            ].join('');
            catWrap.querySelectorAll('[data-blog-cat]').forEach(btn => {
                btn.addEventListener('click', () => {
                    activeBlogCategory = btn.getAttribute('data-blog-cat') || 'all';
                    renderBlogSection();
                });
            });
        } else {
            catWrap.classList.add('hidden');
        }
    }

    // Featured Hero Card
    const featuredPost = (!q && activeBlogCategory === 'all' && activeExploreTab !== 'news')
        ? (filtered.find(p => p.is_featured) || filtered[0] || null)
        : null;

    if (featuredWrap) {
        if (featuredPost) {
            featuredWrap.classList.remove('hidden');
            const bgCover = featuredPost.cover_image_url
                ? `<img src="${escapeHtml(featuredPost.cover_image_url)}" alt="${escapeHtml(featuredPost.title)}" class="explore-featured-img" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');"><div class="explore-featured-placeholder hidden"><i data-lucide="compass"></i></div>`
                : `<div class="explore-featured-placeholder"><i data-lucide="compass"></i></div>`;
            featuredWrap.innerHTML = `
                <article class="explore-featured-card" data-post-slug="${escapeHtml(featuredPost.slug)}">
                    <div class="explore-featured-media">
                        ${bgCover}
                    </div>
                    <div class="explore-featured-body">
                        <div class="explore-meta-row">
                            <span class="editorial-kicker">${escapeHtml(featuredPost.category || 'Rehber')}</span>
                            <span class="meta-sep">·</span>
                            <span>${formatDateTR(featuredPost.published_at || featuredPost.created_at)}</span>
                            <span class="meta-sep">·</span>
                            <span>${featuredPost.read_time_minutes || 3} dk okuma</span>
                        </div>
                        <h2>${escapeHtml(featuredPost.title)}</h2>
                        <p>${escapeHtml(featuredPost.summary || '')}</p>
                        <div class="explore-featured-footer">
                            <span class="explore-author">${escapeHtml(featuredPost.author_name || 'TravellerMobi Editör')}</span>
                            <span class="explore-read-more">Yazıyı oku <i data-lucide="arrow-right"></i></span>
                        </div>
                    </div>
                </article>
            `;
            featuredWrap.querySelector('[data-post-slug]')?.addEventListener('click', () => {
                window.location.hash = `#post?slug=${encodeURIComponent(featuredPost.slug)}`;
            });
        } else {
            featuredWrap.classList.add('hidden');
            featuredWrap.innerHTML = '';
        }
    }

    const remaining = featuredPost ? filtered.filter(p => p.id !== featuredPost.id) : filtered;

    if (filtered.length === 0) {
        gridEl.innerHTML = `
            <div class="card glass explore-empty-state">
                <i data-lucide="book-open"></i>
                <h3>${q ? 'Aramanızla eşleşen blog yazısı bulunamadı' : 'Henüz yayınlanmış blog yazısı yok'}</h3>
                <p class="text-muted">${q ? 'Farklı bir anahtar kelime deneyebilirsiniz.' : 'Yakında şehir rehberleri, gezi rotaları ve bütçe ipuçları burada yayınlanacak.'}</p>
                ${state.isAdmin ? `<a href="#admin" class="btn btn-primary btn-sm margin-top-12"><i data-lucide="plus"></i> Yönetim Panelinden Yazı Ekle</a>` : ''}
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const listToRender = remaining.length > 0 ? remaining : (featuredPost ? [] : filtered);
    if (listToRender.length === 0) {
        gridEl.innerHTML = '';
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    gridEl.innerHTML = listToRender.map(post => {
        const coverHtml = post.cover_image_url
            ? `<img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.classList.remove('hidden');"><div class="blog-card-cover-placeholder hidden"><i data-lucide="compass"></i></div>`
            : `<div class="blog-card-cover-placeholder"><i data-lucide="compass"></i></div>`;

        const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
            ? `<div class="blog-card-tags">${post.tags.slice(0, 3).map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div>`
            : '';

        return `
            <article class="blog-card" data-post-slug="${escapeHtml(post.slug)}">
                <div class="blog-card-media">
                    ${coverHtml}
                </div>
                <div class="blog-card-body">
                    <div class="blog-card-meta">
                        <span class="editorial-kicker">${escapeHtml(post.category || 'Rehber')}</span>
                        <span class="meta-sep">·</span>
                        <span>${formatDateTR(post.published_at || post.created_at)}</span>
                        <span class="meta-sep">·</span>
                        <span>${post.read_time_minutes || 3} dk</span>
                    </div>
                    <h3 class="blog-card-title">${escapeHtml(post.title)}</h3>
                    <p class="blog-card-summary">${escapeHtml(post.summary || '')}</p>
                    ${tagsHtml}
                    <div class="blog-card-footer">
                        <span class="text-xs text-muted">${escapeHtml(post.author_name || 'TravellerMobi')}</span>
                        <span class="explore-read-more">Oku <i data-lucide="arrow-right"></i></span>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    gridEl.querySelectorAll('[data-post-slug]').forEach(card => {
        card.addEventListener('click', () => {
            const slug = card.getAttribute('data-post-slug');
            if (slug) window.location.hash = `#post?slug=${encodeURIComponent(slug)}`;
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

function renderNewsSection() {
    const listEl = document.getElementById('explore-news-grid');
    const updatedEl = document.getElementById('explore-news-updated');
    const catWrap = document.getElementById('explore-news-categories');
    if (!listEl) return;

    if (updatedEl) {
        updatedEl.textContent = newsUpdatedAt
            ? `Son güncelleme: ${formatRelativeTimeTR(newsUpdatedAt)}`
            : (isNewsLoading ? 'Haberler çekiliyor...' : 'Otomatik canlı akış');
    }

    if (catWrap) {
        const categories = ['all', ...Array.from(new Set(cachedNewsItems.map(n => n.category).filter(Boolean)))];
        catWrap.innerHTML = categories.map(cat => `
            <button type="button" class="filter-pill ${activeNewsCategory === cat ? 'active' : ''}" data-news-cat="${escapeHtml(cat)}">
                ${cat === 'all' ? 'Tüm Haberler' : escapeHtml(cat)}
            </button>
        `).join('');
        catWrap.querySelectorAll('[data-news-cat]').forEach(btn => {
            btn.addEventListener('click', () => {
                activeNewsCategory = btn.getAttribute('data-news-cat') || 'all';
                renderNewsSection();
            });
        });
    }

    if (isNewsLoading && cachedNewsItems.length === 0) {
        listEl.innerHTML = `
            <div class="card glass explore-empty-state">
                <i data-lucide="loader" class="spin-icon"></i>
                <h3>Güncel seyahat haberleri yükleniyor...</h3>
                <p class="text-muted">Havacılık, vize ve turizm kaynaklarından son gelişmeler derleniyor.</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const q = exploreSearchQuery.trim().toLowerCase();
    const filtered = cachedNewsItems.filter(item => {
        if (activeNewsCategory !== 'all' && item.category !== activeNewsCategory) return false;
        if (!q) return true;
        return `${item.title || ''} ${item.summary || ''} ${item.source || ''} ${item.category || ''}`.toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div class="card glass explore-empty-state">
                <i data-lucide="newspaper"></i>
                <h3>${q ? 'Aramanızla eşleşen seyahat haberi yok' : 'Canlı haber akışı şu an görüntülenemiyor'}</h3>
                <p class="text-muted">
                    ${!db.hasInternet()
                        ? 'Çevrimdışı moddasınız. İnternete bağlandığınızda haber akışı otomatik güncellenir.'
                        : (q ? 'Farklı bir filtre deneyebilirsiniz.' : 'Otomatik haber akışı Vercel sunucusu üzerinden çalışır. Yenile butonunu deneyebilirsiniz.')}
                </p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const visibleItems = activeExploreTab === 'all' ? filtered.slice(0, 12) : filtered;

    listEl.innerHTML = visibleItems.map(item => {
        const thumbHtml = item.image_url
            ? `<div class="news-card-thumb"><img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
            : '';

        const summaryHtml = item.summary && item.summary.trim()
            ? `<p class="news-card-summary">${escapeHtml(item.summary)}</p>`
            : '';

        return `
            <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="news-card" data-news-title="${escapeHtml(item.title)}" data-news-source="${escapeHtml(item.source || '')}">
                ${thumbHtml}
                <div class="news-card-body">
                    <div class="news-card-top">
                        <span class="editorial-kicker">${escapeHtml(item.category || 'Seyahat')}</span>
                        <span class="news-time">${formatRelativeTimeTR(item.published_at)}</span>
                    </div>
                    <h4 class="news-card-title">${escapeHtml(item.title)}</h4>
                    ${summaryHtml}
                    <div class="news-card-footer">
                        <span class="news-source">${escapeHtml(item.source || 'Haber Kaynağı')}</span>
                        <span class="news-external">Habere git <i data-lucide="arrow-up-right"></i></span>
                    </div>
                </div>
            </a>
        `;
    }).join('');

    listEl.querySelectorAll('.news-card').forEach(linkEl => {
        linkEl.addEventListener('click', () => {
            trackEvent('news_click', {
                page_path: '#explore',
                post_title: linkEl.getAttribute('data-news-title') || ''
            });
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

function updateExploreTabVisibility() {
    const blogSection = document.getElementById('explore-blog-section');
    const newsSection = document.getElementById('explore-news-section');
    const featuredWrap = document.getElementById('explore-featured-post');

    document.querySelectorAll('.explore-main-tab').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === activeExploreTab);
    });

    if (blogSection) blogSection.classList.toggle('hidden', activeExploreTab === 'news');
    if (featuredWrap && activeExploreTab === 'news') featuredWrap.classList.add('hidden');
    if (newsSection) newsSection.classList.toggle('hidden', activeExploreTab === 'blog');
}

export async function loadExploreView(initialTab = null) {
    if (initialTab === 'blog' || initialTab === 'news' || initialTab === 'all') {
        activeExploreTab = initialTab;
    }

    syncExploreGuestHeader();
    updateExploreTabVisibility();

    // Load cached immediately for snappy UI, then refresh in parallel
    const cachedNews = readCachedNews();
    if (cachedNews && cachedNews.items.length > 0 && cachedNewsItems.length === 0) {
        cachedNewsItems = cachedNews.items;
        newsUpdatedAt = cachedNews.updatedAt;
        renderNewsSection();
    }

    const [posts] = await Promise.all([
        db.getPublishedBlogPosts(),
        fetchAutomaticTravelNews(false)
    ]);

    cachedBlogPosts = posts || [];
    renderBlogSection();
    renderNewsSection();
    updateExploreTabVisibility();
}

export async function loadBlogPostDetailView(hash) {
    const container = document.getElementById('post-detail-container');
    if (!container) return;

    syncExploreGuestHeader();

    const queryIdx = hash.indexOf('?');
    const params = new URLSearchParams(queryIdx >= 0 ? hash.slice(queryIdx + 1) : '');
    const slug = (params.get('slug') || '').trim();

    if (!slug) {
        window.location.hash = '#explore';
        return;
    }

    container.innerHTML = `
        <div class="card glass explore-empty-state">
            <i data-lucide="loader" class="spin-icon"></i>
            <p class="text-muted">Yazı yükleniyor...</p>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons();

    const post = await db.getBlogPostBySlug(slug);
    if (!post) {
        container.innerHTML = `
            <div class="card glass explore-empty-state">
                <i data-lucide="file-x"></i>
                <h2>Yazı Bulunamadı</h2>
                <p class="text-muted">Bu blog yazısı kaldırılmış veya henüz yayınlanmamış olabilir.</p>
                <a href="#explore" class="btn btn-primary margin-top-16"><i data-lucide="arrow-left"></i> Keşfet'e Dön</a>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    // Track read, view count, and scroll/time reading session asynchronously
    db.incrementBlogPostView(post.slug);
    trackEvent('post_view', {
        page_path: `#post?slug=${post.slug}`,
        post_slug: post.slug,
        post_title: post.title
    });
    startReadingSession(post.slug, post.title);

    const coverHtml = post.cover_image_url
        ? `<div class="post-detail-cover"><img src="${escapeHtml(post.cover_image_url)}" alt="${escapeHtml(post.title)}" onerror="this.parentElement.style.display='none'"></div>`
        : '';

    const tagsHtml = Array.isArray(post.tags) && post.tags.length > 0
        ? `<div class="post-detail-tags">${post.tags.map(t => `<span class="badge-pill">#${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

    container.innerHTML = `
        <article class="post-detail-article">
            <div class="post-detail-header">
                <div class="post-detail-meta">
                    <span class="editorial-kicker">${escapeHtml(post.category || 'Rehber')}</span>
                    <span class="meta-sep">·</span>
                    <span>${formatDateTR(post.published_at || post.created_at)}</span>
                    <span class="meta-sep">·</span>
                    <span>${post.read_time_minutes || 3} dk okuma</span>
                    <span class="meta-sep">·</span>
                    <span>${(post.view_count || 0) + 1} okunma</span>
                </div>
                <h1>${escapeHtml(post.title)}</h1>
                ${post.summary ? `<p class="post-detail-lead">${escapeHtml(post.summary)}</p>` : ''}
                <div class="post-detail-author-bar">
                    <span>${escapeHtml(post.author_name || 'TravellerMobi Editör')}</span>
                    <button type="button" id="btn-share-blog-post" class="btn btn-secondary btn-sm">
                        <i data-lucide="share-2"></i> Paylaş
                    </button>
                </div>
            </div>

            ${coverHtml}

            <div class="post-detail-body">
                ${renderMarkdownContent(post.content)}
            </div>

            ${tagsHtml}

            <div class="post-detail-cta">
                <div>
                    <h3>Seyahat rotanı ve bütçeni tek yerden yönet</h3>
                    <p class="text-muted">Haritada mekanlarını işaretle, harcamalarını takip et ve seyahat planını çevrimdışı da yanında taşı.</p>
                </div>
                <a href="${state.activeUser ? '#dashboard' : '#auth'}" id="btn-post-auth-cta" class="btn btn-primary">
                    ${state.activeUser ? 'Seyahat Panelime Git' : 'Ücretsiz Başla'}
                </a>
            </div>
        </article>
    `;

    const shareBtn = document.getElementById('btn-share-blog-post');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const shareUrl = `${window.location.origin}${window.location.pathname}#post?slug=${encodeURIComponent(post.slug)}`;
            try {
                if (navigator.share) {
                    await navigator.share({ title: post.title, text: post.summary || post.title, url: shareUrl });
                } else {
                    await navigator.clipboard.writeText(shareUrl);
                    showToast('Yazı bağlantısı panoya kopyalandı!', 'success');
                }
            } catch (_) {}
        });
    }

    const postCta = document.getElementById('btn-post-auth-cta');
    if (postCta && !state.activeUser) {
        postCta.addEventListener('click', () => {
            trackAuthCtaClick(`#post?slug=${post.slug}`);
        });
    }

    if (window.lucide) window.lucide.createIcons();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function countSearchMatches(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return 0;
    const blogCount = cachedBlogPosts.filter(post => {
        const hay = `${post.title || ''} ${post.summary || ''} ${post.category || ''} ${(post.tags || []).join(' ')}`.toLowerCase();
        return hay.includes(q);
    }).length;
    const newsCount = cachedNewsItems.filter(item => {
        const hay = `${item.title || ''} ${item.summary || ''} ${item.source || ''} ${item.category || ''}`.toLowerCase();
        return hay.includes(q);
    }).length;
    return blogCount + newsCount;
}

export function initExploreEvents() {
    document.querySelectorAll('.explore-main-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            activeExploreTab = btn.getAttribute('data-tab') || 'all';
            updateExploreTabVisibility();
            renderBlogSection();
            renderNewsSection();
        });
    });

    const searchInput = document.getElementById('explore-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            exploreSearchQuery = e.target.value || '';
            renderBlogSection();
            renderNewsSection();

            if (searchAnalyticsTimer) clearTimeout(searchAnalyticsTimer);
            const qSnapshot = exploreSearchQuery.trim();
            if (qSnapshot.length >= 2) {
                searchAnalyticsTimer = setTimeout(() => {
                    trackSearchQuery(qSnapshot, countSearchMatches(qSnapshot));
                }, 1200);
            }
        });
    }

    const exploreAuthCta = document.getElementById('btn-explore-auth-cta');
    if (exploreAuthCta) {
        exploreAuthCta.addEventListener('click', () => {
            if (!state.activeUser) trackAuthCtaClick('#explore');
        });
    }

    const postTopAuth = document.getElementById('btn-post-top-auth');
    if (postTopAuth) {
        postTopAuth.addEventListener('click', () => {
            if (!state.activeUser) trackAuthCtaClick(window.location.hash || '#post');
        });
    }

    const refreshNewsBtn = document.getElementById('btn-refresh-travel-news');
    if (refreshNewsBtn) {
        refreshNewsBtn.addEventListener('click', async () => {
            refreshNewsBtn.disabled = true;
            await fetchAutomaticTravelNews(true);
            refreshNewsBtn.disabled = false;
            showToast('Seyahat haberleri güncellendi', 'success');
        });
    }

    const guestThemeBtn = document.getElementById('btn-explore-theme-toggle');
    if (guestThemeBtn) {
        guestThemeBtn.addEventListener('click', () => {
            const mobileBtn = document.getElementById('btn-mobile-theme-toggle');
            if (mobileBtn) mobileBtn.click();
        });
    }
}
