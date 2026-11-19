// js/modules/admin.js - Admin Management Hub (Analytics, Blog CMS, Auto News Sources, Members)

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast, escapeHtml, compressImage } from '../utils.js';
import { renderMarkdownContent, fetchAutomaticTravelNews } from './explore.js';

let activeAdminTab = 'analytics'; // 'analytics' | 'blog' | 'news' | 'users'
let adminBlogPosts = [];
let adminNewsSources = [];
let adminAnalytics = { visitors: [], events: [] };
let visitorFilter = 'all'; // 'all' | 'identified' | 'anonymous'
let selectedBlogCoverFile = null;
let adminEventsInitialized = false;

function slugifyTR(text) {
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

function estimateReadMinutes(content) {
    const words = String(content || '').trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 180));
}

function formatDate(dateString) {
    if (!dateString) return '-';
    try {
        return new Date(dateString).toLocaleDateString('tr-TR', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return dateString;
    }
}

function formatDateTime(dateString) {
    if (!dateString) return '-';
    try {
        return new Date(dateString).toLocaleString('tr-TR', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateString;
    }
}

export function switchAdminTab(tabName) {
    activeAdminTab = tabName || 'analytics';
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-admin-tab') === activeAdminTab);
    });
    document.querySelectorAll('.admin-tab-panel').forEach(panel => {
        panel.classList.toggle('hidden', panel.id !== `admin-panel-${activeAdminTab}`);
    });
    if (activeAdminTab === 'news') {
        const previewBox = document.getElementById('admin-news-live-preview');
        if (previewBox && !previewBox.dataset.loaded) {
            previewBox.dataset.loaded = '1';
            previewBox.innerHTML = `<p class="text-xs text-muted">Canlı haber akışı yükleniyor...</p>`;
            fetchAutomaticTravelNews(false).then(items => renderAdminNewsPreview(items)).catch(() => {});
        }
    }
    if (window.lucide) window.lucide.createIcons();
}

export function initAdminEvents() {
    if (adminEventsInitialized) return;
    adminEventsInitialized = true;

    // Tab buttons
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchAdminTab(btn.getAttribute('data-admin-tab'));
        });
    });

    // Analytics refresh & filter
    const refreshAnalyticsBtn = document.getElementById('btn-admin-refresh-analytics');
    if (refreshAnalyticsBtn) {
        refreshAnalyticsBtn.addEventListener('click', () => loadAdminAnalytics());
    }

    document.querySelectorAll('[data-visitor-filter]').forEach(btn => {
        btn.addEventListener('click', () => {
            visitorFilter = btn.getAttribute('data-visitor-filter') || 'all';
            document.querySelectorAll('[data-visitor-filter]').forEach(b => b.classList.toggle('active', b === btn));
            renderAdminAnalytics();
        });
    });

    // Blog CMS Form wiring
    const titleInput = document.getElementById('blog-form-title');
    const slugInput = document.getElementById('blog-form-slug');
    const contentInput = document.getElementById('blog-form-content');
    const readTimeInput = document.getElementById('blog-form-read-time');
    const coverFileInput = document.getElementById('blog-form-cover-file');
    const coverUrlInput = document.getElementById('blog-form-cover-url');
    const clearCoverBtn = document.getElementById('btn-blog-clear-cover');
    const resetBlogBtn = document.getElementById('btn-blog-form-reset');
    const previewToggleBtn = document.getElementById('btn-blog-toggle-preview');
    const blogForm = document.getElementById('admin-blog-form');

    if (titleInput && slugInput) {
        titleInput.addEventListener('input', () => {
            if (!slugInput.dataset.manual) {
                slugInput.value = slugifyTR(titleInput.value);
            }
        });
        slugInput.addEventListener('input', () => {
            slugInput.dataset.manual = slugInput.value.trim() ? '1' : '';
        });
    }

    if (contentInput && readTimeInput) {
        contentInput.addEventListener('input', () => {
            readTimeInput.value = estimateReadMinutes(contentInput.value);
        });
    }

    const updateCoverPreview = (src) => {
        const previewWrap = document.getElementById('blog-cover-preview-wrap');
        const previewImg = document.getElementById('blog-cover-preview-img');
        if (!previewWrap || !previewImg) return;
        if (src) {
            previewImg.src = src;
            previewWrap.classList.remove('hidden');
        } else {
            previewImg.src = '';
            previewWrap.classList.add('hidden');
        }
    };

    if (coverFileInput) {
        coverFileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
                selectedBlogCoverFile = await compressImage(file, 1400, 0.82);
                const objectUrl = URL.createObjectURL(selectedBlogCoverFile);
                updateCoverPreview(objectUrl);
            } catch {
                selectedBlogCoverFile = file;
            }
        });
    }

    if (coverUrlInput) {
        coverUrlInput.addEventListener('input', () => {
            if (!selectedBlogCoverFile) {
                updateCoverPreview(coverUrlInput.value.trim());
            }
        });
    }

    if (clearCoverBtn) {
        clearCoverBtn.addEventListener('click', () => {
            selectedBlogCoverFile = null;
            if (coverFileInput) coverFileInput.value = '';
            if (coverUrlInput) coverUrlInput.value = '';
            updateCoverPreview('');
        });
    }

    // Inline image insertion inside blog body
    const inlineImgBtn = document.getElementById('btn-blog-insert-image');
    const inlineImgInput = document.getElementById('blog-inline-image-file');
    if (inlineImgBtn && inlineImgInput && contentInput) {
        inlineImgBtn.addEventListener('click', () => inlineImgInput.click());
        inlineImgInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const prevHtml = inlineImgBtn.innerHTML;
            inlineImgBtn.disabled = true;
            inlineImgBtn.textContent = 'Fotoğraf yükleniyor...';
            try {
                const compressed = await compressImage(file, 1400, 0.82);
                const publicUrl = await db.uploadPublicContentImage(compressed);
                if (!publicUrl) throw new Error('Görsel adresi alınamadı.');
                const caption = (file.name || 'Fotoğraf').replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
                const snippet = `\n\n![${caption}](${publicUrl})\n\n`;
                const start = contentInput.selectionStart ?? contentInput.value.length;
                const end = contentInput.selectionEnd ?? start;
                contentInput.value = contentInput.value.slice(0, start) + snippet + contentInput.value.slice(end);
                contentInput.focus();
                showToast('Fotoğraf yazının içine eklendi!', 'success');
                const previewBox = document.getElementById('blog-markdown-preview');
                if (previewBox && !previewBox.classList.contains('hidden')) {
                    previewBox.innerHTML = renderMarkdownContent(contentInput.value);
                }
            } catch (err) {
                showToast('Fotoğraf yüklenemedi: ' + (err.message || err), 'danger');
            } finally {
                inlineImgInput.value = '';
                inlineImgBtn.disabled = false;
                inlineImgBtn.innerHTML = prevHtml;
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    if (previewToggleBtn) {
        previewToggleBtn.addEventListener('click', () => {
            const previewBox = document.getElementById('blog-markdown-preview');
            if (!previewBox || !contentInput) return;
            const willShow = previewBox.classList.contains('hidden');
            previewBox.classList.toggle('hidden', !willShow);
            if (willShow) {
                previewBox.innerHTML = renderMarkdownContent(contentInput.value) || '<p class="text-muted">Önizlenecek içerik yok.</p>';
                previewToggleBtn.textContent = 'Önizlemeyi Gizle';
            } else {
                previewToggleBtn.textContent = 'İçeriği Önizle';
            }
        });
    }

    if (resetBlogBtn) {
        resetBlogBtn.addEventListener('click', () => resetBlogForm());
    }

    if (blogForm) {
        blogForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('btn-blog-form-submit');
            const editId = document.getElementById('blog-form-id')?.value || '';
            const title = titleInput?.value.trim() || '';
            let slug = slugifyTR(slugInput?.value.trim() || title);
            const summary = document.getElementById('blog-form-summary')?.value.trim() || '';
            const content = contentInput?.value.trim() || '';
            const category = document.getElementById('blog-form-category')?.value || 'Şehir Rehberi';
            const tagsRaw = document.getElementById('blog-form-tags')?.value || '';
            const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
            const authorName = document.getElementById('blog-form-author')?.value.trim() || 'TravellerMobi Editör';
            const status = document.getElementById('blog-form-status')?.value || 'published';
            const isFeatured = !!document.getElementById('blog-form-featured')?.checked;
            const readTime = Number(readTimeInput?.value) || estimateReadMinutes(content);
            const coverUrl = coverUrlInput?.value.trim() || '';

            if (!title || !content) {
                showToast('Başlık ve içerik alanları zorunludur.', 'warning');
                return;
            }
            if (!slug) slug = `yazi-${Date.now()}`;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = selectedBlogCoverFile ? 'Görsel yükleniyor & kaydediliyor...' : 'Kaydediliyor...';
            }

            try {
                const payload = {
                    title,
                    slug,
                    summary,
                    content,
                    category,
                    tags,
                    author_name: authorName,
                    status,
                    is_featured: isFeatured,
                    read_time_minutes: readTime,
                    cover_image_url: coverUrl
                };

                if (editId) {
                    await db.updateBlogPost(editId, payload, selectedBlogCoverFile);
                    showToast('Blog yazısı güncellendi!', 'success');
                } else {
                    await db.createBlogPost(payload, selectedBlogCoverFile);
                    showToast('Yeni blog yazısı kaydedildi!', 'success');
                }

                resetBlogForm();
                await loadAdminBlogPosts();
            } catch (err) {
                showToast('Kaydedilemedi: ' + (err.message || err), 'danger');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = editId ? 'Yazıyı Güncelle' : 'Yazıyı Kaydet';
                }
            }
        });
    }

    // News Sources Form
    const newsSourceForm = document.getElementById('admin-news-source-form');
    if (newsSourceForm) {
        newsSourceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameEl = document.getElementById('news-source-name');
            const urlEl = document.getElementById('news-source-url');
            const catEl = document.getElementById('news-source-category');
            const name = nameEl?.value.trim() || '';
            const rss_url = urlEl?.value.trim() || '';
            const category = catEl?.value || 'Turizm';

            if (!name || !rss_url.startsWith('https://')) {
                showToast('Geçerli bir kaynak adı ve https:// RSS adresi girin.', 'warning');
                return;
            }

            try {
                await db.createNewsSource({ name, rss_url, category, is_enabled: true });
                newsSourceForm.reset();
                showToast('RSS haber kaynağı eklendi!', 'success');
                await loadAdminNewsSources();
            } catch (err) {
                showToast('Kaynak eklenemedi: ' + err.message, 'danger');
            }
        });
    }

    const blockSourceForm = document.getElementById('admin-block-source-form');
    if (blockSourceForm) {
        blockSourceForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const inputEl = document.getElementById('block-source-name');
            const name = (inputEl?.value || '').trim();
            if (name.length < 2) {
                showToast('En az 2 karakterlik bir kaynak adı girin.', 'warning');
                return;
            }
            try {
                await db.createNewsSource({
                    name,
                    rss_url: `block://${name.toLowerCase()}`,
                    category: '__block__',
                    is_enabled: true
                });
                blockSourceForm.reset();
                showToast(`"${name}" engellenen kaynaklara eklendi!`, 'success');
                await loadAdminNewsSources();
                const items = await fetchAutomaticTravelNews(true);
                renderAdminNewsPreview(items);
            } catch (err) {
                showToast('Engellenemedi: ' + err.message, 'danger');
            }
        });
    }

    const testNewsBtn = document.getElementById('btn-admin-test-news-feed');
    if (testNewsBtn) {
        testNewsBtn.addEventListener('click', async () => {
            testNewsBtn.disabled = true;
            const items = await fetchAutomaticTravelNews(true);
            testNewsBtn.disabled = false;
            renderAdminNewsPreview(items);
            showToast(`${items.length} güncel seyahat haberi çekildi.`, items.length > 0 ? 'success' : 'warning');
        });
    }

    // Visitor Journey Timeline Modal close wiring
    const timelineModal = document.getElementById('modal-visitor-timeline');
    const closeTimelineBtn = document.getElementById('btn-close-visitor-timeline');
    if (closeTimelineBtn && timelineModal) {
        closeTimelineBtn.addEventListener('click', () => timelineModal.classList.add('hidden'));
        timelineModal.addEventListener('click', (e) => {
            if (e.target === timelineModal) timelineModal.classList.add('hidden');
        });
    }
}

export function clearAdminViewState() {
    adminBlogPosts = [];
    adminNewsSources = [];
    adminAnalytics = { visitors: [], events: [] };
    const idsToEmpty = [
        'admin-users-list',
        'admin-blog-list',
        'admin-news-sources-list',
        'admin-visitors-table-body',
        'analytics-devices-list',
        'analytics-locations-list',
        'analytics-sources-list',
        'analytics-top-posts-list',
        'analytics-reading-quality-list',
        'analytics-search-terms-list',
        'admin-analytics-funnel',
        'visitor-timeline-list'
    ];
    for (const id of idsToEmpty) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    }
    const timelineModal = document.getElementById('modal-visitor-timeline');
    if (timelineModal) timelineModal.classList.add('hidden');
}

function resetBlogForm() {
    const form = document.getElementById('admin-blog-form');
    if (form) form.reset();
    const idEl = document.getElementById('blog-form-id');
    if (idEl) idEl.value = '';
    const slugInput = document.getElementById('blog-form-slug');
    if (slugInput) slugInput.dataset.manual = '';
    const submitBtn = document.getElementById('btn-blog-form-submit');
    if (submitBtn) submitBtn.textContent = 'Yazıyı Kaydet';
    const heading = document.getElementById('blog-form-heading');
    if (heading) heading.textContent = 'Yeni Blog Yazısı Oluştur';
    const previewBox = document.getElementById('blog-markdown-preview');
    if (previewBox) previewBox.classList.add('hidden');
    const previewWrap = document.getElementById('blog-cover-preview-wrap');
    if (previewWrap) previewWrap.classList.add('hidden');
    selectedBlogCoverFile = null;
}

function populateBlogFormForEdit(post) {
    document.getElementById('blog-form-id').value = post.id;
    document.getElementById('blog-form-title').value = post.title || '';
    const slugInput = document.getElementById('blog-form-slug');
    slugInput.value = post.slug || '';
    slugInput.dataset.manual = '1';
    document.getElementById('blog-form-category').value = post.category || 'Şehir Rehberi';
    document.getElementById('blog-form-author').value = post.author_name || 'TravellerMobi Editör';
    document.getElementById('blog-form-read-time').value = post.read_time_minutes || 3;
    document.getElementById('blog-form-tags').value = Array.isArray(post.tags) ? post.tags.join(', ') : '';
    document.getElementById('blog-form-cover-url').value = post.cover_image_url || '';
    document.getElementById('blog-form-summary').value = post.summary || '';
    document.getElementById('blog-form-content').value = post.content || '';
    document.getElementById('blog-form-status').value = post.status || 'published';
    document.getElementById('blog-form-featured').checked = !!post.is_featured;

    selectedBlogCoverFile = null;
    const previewWrap = document.getElementById('blog-cover-preview-wrap');
    const previewImg = document.getElementById('blog-cover-preview-img');
    if (previewWrap && previewImg) {
        if (post.cover_image_url) {
            previewImg.src = post.cover_image_url;
            previewWrap.classList.remove('hidden');
        } else {
            previewWrap.classList.add('hidden');
        }
    }

    const submitBtn = document.getElementById('btn-blog-form-submit');
    if (submitBtn) submitBtn.textContent = 'Yazıyı Güncelle';
    const heading = document.getElementById('blog-form-heading');
    if (heading) heading.textContent = `Yazıyı Düzenle: ${post.title}`;

    document.getElementById('admin-blog-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export async function loadAdminData() {
    if (!state.isAdmin || !state.activeUser || state.userProfile?.status !== 'approved') {
        clearAdminViewState();
        window.location.hash = state.activeUser ? '#dashboard' : '#explore';
        return;
    }

    initAdminEvents();
    switchAdminTab(activeAdminTab);

    await Promise.allSettled([
        loadAdminUsers(),
        loadAdminBlogPosts(),
        loadAdminNewsSources(),
        loadAdminAnalytics()
    ]);
}

async function loadAdminUsers() {
    try {
        const profiles = await db.getAllProfiles();
        renderAdminUsers(profiles);
    } catch (err) {
        showToast('Üye listesi yüklenemedi: ' + err.message, 'danger');
    }
}

async function loadAdminBlogPosts() {
    const listEl = document.getElementById('admin-blog-list');
    try {
        adminBlogPosts = await db.getAllBlogPostsAdmin();
        renderAdminBlogPosts();
        updateAnalyticsBlogCount();
    } catch (err) {
        if (listEl) {
            listEl.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Blog tablosu bulunamadı. Lütfen Ayarlar → SQL Şeması kodunu Supabase'de çalıştırın. (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderAdminBlogPosts() {
    const listEl = document.getElementById('admin-blog-list');
    if (!listEl) return;

    if (adminBlogPosts.length === 0) {
        listEl.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Henüz blog yazısı eklenmemiş. Yukarıdaki formdan ilk yazınızı oluşturabilirsiniz.</td></tr>`;
        return;
    }

    listEl.innerHTML = adminBlogPosts.map(post => {
        const statusBadge = post.status === 'published'
            ? '<span class="badge badge-activity">Yayında</span>'
            : '<span class="badge" style="background:rgba(245,158,11,0.15);color:#f59e0b;">Taslak</span>';

        const thumb = post.cover_image_url
            ? `<img src="${escapeHtml(post.cover_image_url)}" alt="" class="admin-blog-thumb">`
            : `<span class="admin-blog-thumb-empty"><i data-lucide="image"></i></span>`;

        return `
            <tr>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        ${thumb}
                        <div>
                            <strong>${escapeHtml(post.title)}</strong>
                            ${post.is_featured ? '<span class="badge badge-lodge" style="font-size:9px; padding:2px 5px; margin-left:4px;">Öne Çıkan</span>' : ''}
                            <div class="text-xs text-muted">${escapeHtml(post.category || 'Rehber')} • /${escapeHtml(post.slug)}</div>
                        </div>
                    </div>
                </td>
                <td>${statusBadge}</td>
                <td>${post.view_count || 0}</td>
                <td>${formatDate(post.published_at || post.created_at)}</td>
                <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <a href="#post?slug=${encodeURIComponent(post.slug)}" class="btn btn-secondary btn-sm" title="Görüntüle">Aç</a>
                        <button type="button" class="btn btn-primary btn-sm btn-edit-blog" data-id="${post.id}">Düzenle</button>
                        <button type="button" class="btn btn-secondary btn-sm btn-toggle-blog-status" data-id="${post.id}">
                            ${post.status === 'published' ? 'Taslağa Al' : 'Yayınla'}
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm btn-delete-blog" data-id="${post.id}" style="color:var(--color-danger);">Sil</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    listEl.querySelectorAll('.btn-edit-blog').forEach(btn => {
        btn.addEventListener('click', () => {
            const post = adminBlogPosts.find(p => p.id === btn.getAttribute('data-id'));
            if (post) populateBlogFormForEdit(post);
        });
    });

    listEl.querySelectorAll('.btn-toggle-blog-status').forEach(btn => {
        btn.addEventListener('click', async () => {
            const post = adminBlogPosts.find(p => p.id === btn.getAttribute('data-id'));
            if (!post) return;
            const nextStatus = post.status === 'published' ? 'draft' : 'published';
            try {
                await db.updateBlogPost(post.id, { ...post, status: nextStatus });
                showToast(nextStatus === 'published' ? 'Yazı yayına alındı!' : 'Yazı taslağa çekildi.', 'success');
                await loadAdminBlogPosts();
            } catch (err) {
                showToast('Durum güncellenemedi: ' + err.message, 'danger');
            }
        });
    });

    listEl.querySelectorAll('.btn-delete-blog').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (!confirm('Bu blog yazısını kalıcı olarak silmek istediğinize emin misiniz?')) return;
            try {
                await db.deleteBlogPost(id);
                showToast('Blog yazısı silindi.', 'info');
                await loadAdminBlogPosts();
            } catch (err) {
                showToast('Silinemedi: ' + err.message, 'danger');
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

async function loadAdminNewsSources() {
    const listEl = document.getElementById('admin-news-sources-list');
    try {
        adminNewsSources = await db.getNewsSources(false);
        renderAdminNewsSources();
    } catch (err) {
        if (listEl) {
            listEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Özel kaynak tablosu henüz oluşturulmamış (varsayılan otomatik haber kaynakları aktif).</td></tr>`;
        }
    }
}

function renderAdminNewsSources() {
    const listEl = document.getElementById('admin-news-sources-list');
    const blockedWrap = document.getElementById('admin-blocked-sources-list');

    const rssOnly = adminNewsSources.filter(s => s.category !== '__block__');
    const blockedOnly = adminNewsSources.filter(s => s.category === '__block__');

    if (blockedWrap) {
        if (blockedOnly.length === 0) {
            blockedWrap.innerHTML = `<span class="text-xs text-muted">Ekstra engellenen kaynak yok (Rudaw, Sputnik vb. sistem tarafından otomatik engellenir).</span>`;
        } else {
            blockedWrap.innerHTML = blockedOnly.map(b => `
                <span class="filter-pill" style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px;">
                    <span>${escapeHtml(b.name)}</span>
                    <button type="button" class="btn-remove-blocked-src" data-id="${b.id}" style="background:none; border:none; color:var(--color-danger); cursor:pointer; font-weight:700; padding:0 2px;" title="Engeli Kaldır">&times;</button>
                </span>
            `).join('');
            blockedWrap.querySelectorAll('.btn-remove-blocked-src').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await db.deleteNewsSource(btn.getAttribute('data-id'));
                        await loadAdminNewsSources();
                        showToast('Kaynak engeli kaldırıldı.', 'info');
                    } catch (err) {
                        showToast('Hata: ' + err.message, 'danger');
                    }
                });
            });
        }
    }

    if (!listEl) return;

    if (rssOnly.length === 0) {
        listEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Ek özel RSS kaynağı yok. Güvenilir varsayılan seyahat kaynakları otomatik çalışır.</td></tr>`;
        return;
    }

    listEl.innerHTML = rssOnly.map(src => `
        <tr>
            <td><strong>${escapeHtml(src.name)}</strong><div class="text-xs text-muted" style="word-break:break-all;">${escapeHtml(src.rss_url)}</div></td>
            <td><span class="badge-pill">${escapeHtml(src.category || 'Seyahat')}</span></td>
            <td>${src.is_enabled ? '<span class="badge badge-activity">Aktif</span>' : '<span class="badge">Pasif</span>'}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn btn-secondary btn-sm btn-toggle-news-src" data-id="${src.id}">${src.is_enabled ? 'Durdur' : 'Aktifleştir'}</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-delete-news-src" data-id="${src.id}" style="color:var(--color-danger);">Sil</button>
                </div>
            </td>
        </tr>
    `).join('');

    listEl.querySelectorAll('.btn-toggle-news-src').forEach(btn => {
        btn.addEventListener('click', async () => {
            const src = rssOnly.find(s => s.id === btn.getAttribute('data-id'));
            if (!src) return;
            try {
                await db.updateNewsSource(src.id, { is_enabled: !src.is_enabled });
                await loadAdminNewsSources();
                showToast('Kaynak durumu güncellendi.', 'success');
            } catch (err) {
                showToast('Hata: ' + err.message, 'danger');
            }
        });
    });

    listEl.querySelectorAll('.btn-delete-news-src').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (!confirm('Bu RSS kaynağını silmek istiyor musunuz?')) return;
            try {
                await db.deleteNewsSource(id);
                await loadAdminNewsSources();
                showToast('RSS kaynağı silindi.', 'info');
            } catch (err) {
                showToast('Hata: ' + err.message, 'danger');
            }
        });
    });
}

function mapNewsCategoryToBlog(newsCat) {
    if (newsCat === 'Vize & Pasaport' || newsCat === 'Havacılık') return 'Vize & Ulaşım';
    if (newsCat === 'Destinasyon') return 'Şehir Rehberi';
    return 'Seyahat Gündemi';
}

function transferNewsToBlogDraft(newsItem) {
    if (!newsItem) return;
    resetBlogForm();

    const titleEl = document.getElementById('blog-form-title');
    const slugEl = document.getElementById('blog-form-slug');
    const catEl = document.getElementById('blog-form-category');
    const summaryEl = document.getElementById('blog-form-summary');
    const contentEl = document.getElementById('blog-form-content');
    const tagsEl = document.getElementById('blog-form-tags');
    const coverUrlEl = document.getElementById('blog-form-cover-url');
    const statusEl = document.getElementById('blog-form-status');
    const readTimeEl = document.getElementById('blog-form-read-time');
    const headingEl = document.getElementById('blog-form-heading');

    const safeTitle = newsItem.title || '';
    const safeSource = newsItem.source || 'Haber Kaynağı';
    const safeSummary = (newsItem.summary || '').trim();
    const starterContent = [
        safeSummary || `${safeTitle} konusundaki güncel gelişmelerin gezginler açısından özeti:`,
        '',
        '## Gezginler İçin Ne Anlama Geliyor?',
        '',
        'Buraya kendi notlarınızı, pratik tavsiyelerinizi ve dikkat edilmesi gereken noktaları ekleyebilirsiniz.',
        '',
        `> Kaynak: [${safeSource}](${newsItem.link})`
    ].join('\n');

    if (titleEl) titleEl.value = safeTitle;
    if (slugEl) {
        slugEl.value = slugifyTR(safeTitle);
        slugEl.dataset.manual = '';
    }
    if (catEl) catEl.value = mapNewsCategoryToBlog(newsItem.category);
    if (summaryEl) summaryEl.value = safeSummary || `${safeSource} kaynaklı güncel seyahat gelişmesi ve değerlendirmesi.`;
    if (contentEl) contentEl.value = starterContent;
    if (tagsEl) {
        const baseTag = slugifyTR(newsItem.category || 'seyahat').replace(/-/g, ' ');
        tagsEl.value = [baseTag, 'seyahat-gundemi', 'haber'].filter(Boolean).join(', ');
    }
    if (coverUrlEl && newsItem.image_url) {
        coverUrlEl.value = newsItem.image_url;
        const previewWrap = document.getElementById('blog-cover-preview-wrap');
        const previewImg = document.getElementById('blog-cover-preview-img');
        if (previewWrap && previewImg) {
            previewImg.src = newsItem.image_url;
            previewWrap.classList.remove('hidden');
        }
    }
    if (statusEl) statusEl.value = 'draft';
    if (readTimeEl) readTimeEl.value = estimateReadMinutes(starterContent);
    if (headingEl) headingEl.textContent = 'Haberden Oluşturulan Blog Taslağı';

    switchAdminTab('blog');
    document.getElementById('admin-blog-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Haber blog taslağına aktarıldı! Notlarınızı ekleyip kaydedebilirsiniz.', 'success');
}

function renderAdminNewsPreview(items) {
    const box = document.getElementById('admin-news-live-preview');
    if (!box) return;
    if (!items || items.length === 0) {
        box.innerHTML = `<p class="text-sm text-muted">Canlı haber çekilemedi (yerel sunucuda /api/travel-news çalışmaz; Vercel üzerinde otomatik çalışır).</p>`;
        return;
    }
    const visible = items.slice(0, 14);
    box.innerHTML = visible.map((n, idx) => `
        <div class="admin-news-preview-row" style="justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; flex:1;">
                <span class="editorial-kicker">${escapeHtml(n.category)}</span>
                <a href="${escapeHtml(n.link)}" target="_blank" rel="noopener noreferrer" style="color:var(--text-primary); font-weight:500;">${escapeHtml(n.title)}</a>
                <span class="text-xs text-muted">(${escapeHtml(n.source)})</span>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                <button type="button" class="btn btn-primary btn-sm btn-news-to-blog" data-news-idx="${idx}" style="padding:4px 9px; font-size:11px;">
                    Blog Taslağına Aktar
                </button>
                <button type="button" class="btn btn-secondary btn-sm btn-quick-block-src" data-source="${escapeHtml(n.source)}" style="color:var(--color-danger); padding:4px 8px; font-size:11px;">
                    Kaynağı Engelle
                </button>
            </div>
        </div>
    `).join('');

    box.querySelectorAll('.btn-news-to-blog').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-news-idx'));
            const item = visible[idx];
            if (item) transferNewsToBlogDraft(item);
        });
    });

    box.querySelectorAll('.btn-quick-block-src').forEach(btn => {
        btn.addEventListener('click', async () => {
            const srcName = btn.getAttribute('data-source') || '';
            if (!srcName) return;
            try {
                await db.createNewsSource({
                    name: srcName,
                    rss_url: `block://${srcName.toLowerCase()}`,
                    category: '__block__',
                    is_enabled: true
                });
                showToast(`"${srcName}" engellendi ve akış yenileniyor.`, 'success');
                await loadAdminNewsSources();
                const refreshed = await fetchAutomaticTravelNews(true);
                renderAdminNewsPreview(refreshed);
            } catch (err) {
                showToast('Engellenemedi: ' + err.message, 'danger');
            }
        });
    });
}

async function loadAdminAnalytics() {
    const noticeEl = document.getElementById('admin-analytics-sql-notice');
    try {
        adminAnalytics = await db.getAnalyticsOverview(150, 400);
        if (noticeEl) noticeEl.classList.add('hidden');
        renderAdminAnalytics();
    } catch (err) {
        if (noticeEl) {
            noticeEl.classList.remove('hidden');
            noticeEl.textContent = `Ziyaretçi analitiği tabloları (site_visitors / site_events) henüz Supabase'de kurulmamış. Ayarlar → SQL Şeması kodunu çalıştırın. (${err.message})`;
        }
    }
}

function updateAnalyticsBlogCount() {
    const el = document.getElementById('stat-admin-published-blogs');
    if (el) {
        el.textContent = String(adminBlogPosts.filter(p => p.status === 'published').length);
    }
}

function renderBreakdownBars(containerId, countsMap, emptyText = 'Veri yok') {
    const el = document.getElementById(containerId);
    if (!el) return;
    const entries = Object.entries(countsMap)
        .filter(([k, v]) => k && v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    if (entries.length === 0) {
        el.innerHTML = `<p class="text-xs text-muted">${emptyText}</p>`;
        return;
    }
    const maxVal = entries[0][1] || 1;
    el.innerHTML = entries.map(([label, count]) => {
        const pct = Math.max(8, Math.round((count / maxVal) * 100));
        return `
            <div class="analytics-bar-row">
                <div class="analytics-bar-head">
                    <span>${escapeHtml(label)}</span>
                    <strong>${count}</strong>
                </div>
                <div class="analytics-bar-track">
                    <div class="analytics-bar-fill" style="width:${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('');
}

function formatDurationTR(seconds) {
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    if (sec < 60) return `${sec} sn`;
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return rem > 0 ? `${mins} dk ${rem} sn` : `${mins} dk`;
}

function classifyVisitorSegment(v, visitorEventsMap) {
    if (v.user_id || v.user_email) {
        return { key: 'identified', label: 'Aktif Üye', cssClass: 'seg-member' };
    }
    const vEvents = visitorEventsMap.get(v.visitor_id) || [];
    const clickedAuth = !!(v.clicked_auth || vEvents.some(e => e.event_type === 'auth_cta_click' || (e.page_path || '').startsWith('#auth')));
    const deepRead = (Number(v.max_scroll_depth) || 0) >= 50 || vEvents.some(e => (Number(e.scroll_depth) || 0) >= 50);

    if (clickedAuth || deepRead) {
        return { key: 'warm', label: 'Sıcak Aday', cssClass: 'seg-warm' };
    }
    if ((Number(v.visit_count) || 1) >= 3) {
        return { key: 'returning', label: 'Geri Dönen Okuyucu', cssClass: 'seg-returning' };
    }
    return { key: 'new', label: 'Yeni Ziyaretçi', cssClass: 'seg-new' };
}

function describeTimelineEvent(ev) {
    const type = ev.event_type || 'page_view';
    if (type === 'post_view') {
        return { icon: 'book-open', title: `Blog yazısı açtı: "${ev.post_title || ev.post_slug || ''}"`, meta: ev.page_path || '' };
    }
    if (type === 'post_engagement') {
        const depth = typeof ev.scroll_depth === 'number' ? `%${ev.scroll_depth} okuma` : '';
        const dur = typeof ev.duration_seconds === 'number' ? formatDurationTR(ev.duration_seconds) : '';
        const detail = [depth, dur].filter(Boolean).join(' • ');
        const bounce = (Number(ev.duration_seconds) || 0) < 10 && (Number(ev.scroll_depth) || 0) < 25 ? ' (Hızlı Çıkış)' : '';
        return { icon: 'clock', title: `Okuma derinliği: "${ev.post_title || ev.post_slug || ''}"`, meta: `${detail}${bounce}` };
    }
    if (type === 'search') {
        const zeroBadge = Number(ev.search_results_count) === 0 ? ' • ⚠️ 0 Sonuç (İçerik Fırsatı)' : ` • ${ev.search_results_count} sonuç`;
        return { icon: 'search', title: `Arama yaptı: "${ev.search_query || ''}"`, meta: zeroBadge.replace(/^ • /, '') };
    }
    if (type === 'news_click') {
        return { icon: 'radio', title: `Seyahat haberine tıkladı: "${ev.post_title || ''}"`, meta: 'Dış haber kaynağı' };
    }
    if (type === 'auth_cta_click') {
        return { icon: 'log-in', title: `"Giriş Yap" butonuna tıkladı`, meta: `Kaynak: ${ev.page_path || '#explore'}` };
    }
    if (type === 'auth_signup') {
        return { icon: 'user-plus', title: 'Yeni üye kaydı oluşturdu', meta: 'Dönüşüm tamamlandı' };
    }
    if (type === 'auth_login') {
        return { icon: 'check-circle', title: 'Hesabına giriş yaptı', meta: 'Kimlik eşleştirildi' };
    }
    return {
        icon: 'eye',
        title: `Sayfa ziyaret etti: ${ev.page_path || '#explore'}`,
        meta: ev.referrer_domain && ev.referrer_domain !== 'Site İçi' ? `Kaynak: ${ev.referrer_domain}` : ''
    };
}

async function openVisitorTimelineModal(visitor) {
    if (!state.isAdmin || !visitor) return;
    const modal = document.getElementById('modal-visitor-timeline');
    const titleEl = document.getElementById('visitor-timeline-title');
    const metaEl = document.getElementById('visitor-timeline-meta');
    const listEl = document.getElementById('visitor-timeline-list');
    if (!modal || !listEl) return;

    const isMatched = !!(visitor.user_id || visitor.user_email);
    if (titleEl) {
        titleEl.textContent = isMatched
            ? `Üye Yolculuğu: ${visitor.user_email || visitor.user_id}`
            : `Ziyaretçi Yolculuğu #${String(visitor.visitor_id || '').slice(0, 8)}`;
    }
    if (metaEl) {
        const loc = visitor.city && visitor.country ? `${visitor.city}, ${visitor.country}` : (visitor.country || visitor.timezone || 'Bilinmiyor');
        const src = visitor.first_utm_source ? `UTM: ${visitor.first_utm_source}` : (visitor.first_referrer_domain || 'Doğrudan');
        metaEl.textContent = `${visitor.device_type === 'mobile' ? 'Mobil' : visitor.device_type === 'tablet' ? 'Tablet' : 'Masaüstü'} (${visitor.os || '-'} / ${visitor.browser || '-'}) • ${loc} • İlk kaynak: ${src} • ${visitor.visit_count || 1} ziyaret`;
    }

    listEl.innerHTML = `<div class="text-center text-muted" style="padding:20px;">Ziyaretçi geçmişi yükleniyor...</div>`;
    modal.classList.remove('hidden');

    try {
        const timeline = await db.getVisitorTimelineAdmin(visitor.visitor_id, 80);
        if (timeline.length === 0) {
            listEl.innerHTML = `<div class="text-center text-muted" style="padding:20px;">Bu ziyaretçi için henüz adım kaydı bulunmuyor.</div>`;
            return;
        }

        listEl.innerHTML = timeline.map(ev => {
            const info = describeTimelineEvent(ev);
            return `
                <div class="timeline-step">
                    <div class="timeline-step-dot"><i data-lucide="${info.icon}"></i></div>
                    <div class="timeline-step-body">
                        <div class="timeline-step-head">
                            <strong>${escapeHtml(info.title)}</strong>
                            <span class="text-xs text-muted">${formatDateTime(ev.created_at)}</span>
                        </div>
                        ${info.meta ? `<div class="text-xs text-muted" style="margin-top:2px;">${escapeHtml(info.meta)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        listEl.innerHTML = `<div class="text-center text-muted" style="padding:20px;">Geçmiş yüklenemedi: ${escapeHtml(err.message)}</div>`;
    }
}

function isBotOrLocalVisitorRecord(v) {
    if (!v) return false;
    const osStr = String(v.os || '');
    const resStr = String(v.screen_resolution || '');
    // Filter out historical headless preview crawlers (Linux + 800x600)
    if (/^Linux/i.test(osStr) && resStr.startsWith('800x600') && !v.user_id) return true;
    // Filter out historical localhost dev rows that had no geo country/city
    if (!v.country && !v.city && !v.user_id && String(v.timezone || '') === 'Europe/Istanbul' && /^Windows/i.test(osStr)) {
        return true;
    }
    return false;
}

function inferDeviceDisplay(v) {
    const typeLabel = v.device_type === 'mobile' ? 'Mobil' : v.device_type === 'tablet' ? 'Tablet' : 'Masaüstü';
    const rawOs = String(v.os || '-');
    const rawRes = String(v.screen_resolution || '');

    // If new tracker already attached model via "OS · Model", split cleanly
    if (rawOs.includes(' · ')) {
        const [osPart, modelPart] = rawOs.split(' · ');
        return { primary: modelPart || typeLabel, secondary: `${osPart} • ${v.browser || '-'}` };
    }

    // Infer Apple model family for existing iOS records from logical viewport resolution
    if (/^iOS/i.test(rawOs)) {
        const baseRes = rawRes.split(' ')[0];
        const iosResMap = {
            '440x956': 'iPhone 16 Pro Max',
            '402x874': 'iPhone 16 Pro',
            '430x932': 'iPhone 14/15/16 Plus·Max',
            '393x852': 'iPhone 14 Pro / 15 / 16',
            '428x926': 'iPhone 12/13/14 Pro Max',
            '390x844': 'iPhone 12 / 13 / 14',
            '375x812': 'iPhone X/XS/11 Pro/mini',
            '414x896': 'iPhone 11 / XR / XS Max',
            '375x667': 'iPhone SE / 8'
        };
        if (iosResMap[baseRes]) {
            return { primary: iosResMap[baseRes], secondary: `${rawOs} • ${v.browser || '-'}` };
        }
    }

    return { primary: typeLabel, secondary: `${rawOs} • ${v.browser || '-'}` };
}

function renderAdminAnalytics() {
    const rawVisitors = adminAnalytics.visitors || [];
    const visitors = rawVisitors.filter(v => !isBotOrLocalVisitorRecord(v));
    const allowedVisitorIds = new Set(visitors.map(v => v.visitor_id));
    const events = (adminAnalytics.events || []).filter(ev => allowedVisitorIds.has(ev.visitor_id));

    // Group events by visitor_id for segmentation & funnel
    const visitorEventsMap = new Map();
    for (const ev of events) {
        if (!ev.visitor_id) continue;
        if (!visitorEventsMap.has(ev.visitor_id)) visitorEventsMap.set(ev.visitor_id, []);
        visitorEventsMap.get(ev.visitor_id).push(ev);
    }

    const totalViews = visitors.reduce((acc, v) => acc + (Number(v.visit_count) || 1), 0);
    const uniqueVisitors = visitors.length;
    const identifiedVisitors = visitors.filter(v => v.user_id || v.user_email).length;

    const elViews = document.getElementById('stat-admin-total-views');
    const elUnique = document.getElementById('stat-admin-unique-visitors');
    const elMatched = document.getElementById('stat-admin-identified-visitors');
    if (elViews) elViews.textContent = String(totalViews);
    if (elUnique) elUnique.textContent = String(uniqueVisitors);
    if (elMatched) elMatched.textContent = String(identifiedVisitors);
    updateAnalyticsBlogCount();

    // 1. Conversion Funnel
    const funnelEl = document.getElementById('admin-analytics-funnel');
    if (funnelEl) {
        const contentReadersSet = new Set();
        const authIntentSet = new Set();
        for (const ev of events) {
            if (ev.event_type === 'post_view' || ev.event_type === 'post_engagement' || ev.event_type === 'news_click') {
                contentReadersSet.add(ev.visitor_id);
            }
            if (ev.event_type === 'auth_cta_click' || ev.event_type === 'auth_signup' || ev.event_type === 'auth_login' || (ev.page_path || '').startsWith('#auth')) {
                authIntentSet.add(ev.visitor_id);
            }
        }
        for (const v of visitors) {
            if (v.clicked_auth || v.user_id || v.user_email) authIntentSet.add(v.visitor_id);
            if ((Number(v.max_scroll_depth) || 0) > 0) contentReadersSet.add(v.visitor_id);
        }

        const base = Math.max(uniqueVisitors, 1);
        const steps = [
            { label: 'Tekil Ziyaretçi', count: uniqueVisitors, pct: 100 },
            { label: 'Blog / Haber Etkileşimi', count: contentReadersSet.size, pct: Math.round((contentReadersSet.size / base) * 100) },
            { label: 'Giriş Ekranına Geçen', count: authIntentSet.size, pct: Math.round((authIntentSet.size / base) * 100) },
            { label: 'Üyeye Dönüşen', count: identifiedVisitors, pct: Math.round((identifiedVisitors / base) * 100) }
        ];

        funnelEl.innerHTML = steps.map((s, idx) => `
            <div class="funnel-step-card">
                <span class="funnel-step-num">${idx + 1}</span>
                <div class="funnel-step-label">${s.label}</div>
                <div class="funnel-step-val">${s.count} <span class="funnel-step-pct">%${s.pct}</span></div>
            </div>
        `).join('');
    }

    // 2. Breakdowns + Reading Quality + Search Terms
    const deviceCounts = {};
    const locationCounts = {};
    const sourceCounts = {};
    const postCounts = {};
    const postEngagementMap = {};
    const searchStatsMap = {};

    for (const v of visitors) {
        const devLabel = `${v.device_type === 'mobile' ? 'Mobil' : v.device_type === 'tablet' ? 'Tablet' : 'Masaüstü'} (${v.os || 'Diğer'})`;
        deviceCounts[devLabel] = (deviceCounts[devLabel] || 0) + 1;

        const locLabel = v.city && v.country
            ? `${v.city}, ${v.country}`
            : (v.country || v.timezone || 'Bilinmiyor');
        locationCounts[locLabel] = (locationCounts[locLabel] || 0) + 1;

        const srcLabel = v.first_utm_source
            ? `UTM: ${v.first_utm_source}`
            : (v.first_referrer_domain || 'Doğrudan');
        sourceCounts[srcLabel] = (sourceCounts[srcLabel] || 0) + 1;
    }

    for (const ev of events) {
        if (ev.event_type === 'post_view' && ev.post_title) {
            postCounts[ev.post_title] = (postCounts[ev.post_title] || 0) + 1;
        }
        if (ev.event_type === 'post_engagement' && (ev.post_title || ev.post_slug)) {
            const key = ev.post_title || ev.post_slug;
            if (!postEngagementMap[key]) {
                postEngagementMap[key] = { sessions: 0, totalScroll: 0, totalSeconds: 0, bounces: 0 };
            }
            const item = postEngagementMap[key];
            item.sessions += 1;
            const sc = Number(ev.scroll_depth) || 0;
            const sec = Number(ev.duration_seconds) || 0;
            item.totalScroll += sc;
            item.totalSeconds += sec;
            if (sec < 10 && sc < 25) item.bounces += 1;
        }
        if (ev.event_type === 'search' && ev.search_query) {
            const q = String(ev.search_query).trim().toLowerCase();
            if (!searchStatsMap[q]) {
                searchStatsMap[q] = { count: 0, zeroCount: 0, lastResults: Number(ev.search_results_count) || 0 };
            }
            searchStatsMap[q].count += 1;
            if (Number(ev.search_results_count) === 0) searchStatsMap[q].zeroCount += 1;
            searchStatsMap[q].lastResults = Number(ev.search_results_count) || 0;
        }
    }

    renderBreakdownBars('analytics-devices-list', deviceCounts, 'Cihaz verisi henüz oluşmadı');
    renderBreakdownBars('analytics-locations-list', locationCounts, 'Konum verisi henüz oluşmadı');
    renderBreakdownBars('analytics-sources-list', sourceCounts, 'Kaynak verisi henüz oluşmadı');
    renderBreakdownBars('analytics-top-posts-list', postCounts, 'Henüz okunan blog yazısı yok');

    // Render Blog Reading Quality (Scroll Depth & Time)
    const qualityEl = document.getElementById('analytics-reading-quality-list');
    if (qualityEl) {
        const qEntries = Object.entries(postEngagementMap).sort((a, b) => b[1].sessions - a[1].sessions).slice(0, 6);
        if (qEntries.length === 0) {
            qualityEl.innerHTML = `<p class="text-xs text-muted">Henüz okuma derinliği verisi oluşmadı. Ziyaretçiler blog okudukça burada görünür.</p>`;
        } else {
            qualityEl.innerHTML = qEntries.map(([title, stat]) => {
                const avgScroll = Math.round(stat.totalScroll / stat.sessions);
                const avgSec = Math.round(stat.totalSeconds / stat.sessions);
                const bouncePct = Math.round((stat.bounces / stat.sessions) * 100);
                return `
                    <div class="reading-quality-row">
                        <div class="reading-quality-title">${escapeHtml(title)}</div>
                        <div class="reading-quality-metrics">
                            <span class="rq-pill"><strong>%${avgScroll}</strong> ort. kaydırma</span>
                            <span class="rq-pill"><strong>${formatDurationTR(avgSec)}</strong> ort. süre</span>
                            <span class="rq-pill ${bouncePct >= 50 ? 'rq-warn' : ''}"><strong>%${bouncePct}</strong> hızlı çıkış</span>
                        </div>
                        <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.max(6, avgScroll)}%;"></div></div>
                    </div>
                `;
            }).join('');
        }
    }

    // Render Site Search Terms & Content Opportunities
    const searchEl = document.getElementById('analytics-search-terms-list');
    if (searchEl) {
        const sEntries = Object.entries(searchStatsMap).sort((a, b) => b[1].count - a[1].count).slice(0, 8);
        if (sEntries.length === 0) {
            searchEl.innerHTML = `<p class="text-xs text-muted">Henüz site içi arama kaydı yok. Misafirler Keşfet arama kutusunu kullandıkça burada toplanır.</p>`;
        } else {
            searchEl.innerHTML = sEntries.map(([term, stat]) => {
                const isOpportunity = stat.lastResults === 0 || stat.zeroCount > 0;
                return `
                    <div class="search-term-row">
                        <div>
                            <strong>"${escapeHtml(term)}"</strong>
                            <span class="text-xs text-muted"> • ${stat.count} arama</span>
                        </div>
                        ${isOpportunity
                            ? `<span class="badge-opportunity">0 Sonuç • İçerik Fırsatı!</span>`
                            : `<span class="text-xs text-muted">${stat.lastResults} eşleşme</span>`}
                    </div>
                `;
            }).join('');
        }
    }

    // 3. Visitor + Identity Stitching + Behavioral Segment Table (Clickable rows!)
    const tbody = document.getElementById('admin-visitors-table-body');
    if (!tbody) return;

    const enrichedVisitors = visitors.map(v => ({
        v,
        segment: classifyVisitorSegment(v, visitorEventsMap)
    }));

    const filteredVisitors = enrichedVisitors.filter(({ v, segment }) => {
        if (visitorFilter === 'identified') return segment.key === 'identified';
        if (visitorFilter === 'warm') return segment.key === 'warm';
        if (visitorFilter === 'returning') return segment.key === 'returning';
        if (visitorFilter === 'anonymous') return !(v.user_id || v.user_email);
        return true;
    });

    if (filteredVisitors.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Bu filtrede ziyaretçi kaydı yok.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredVisitors.slice(0, 60).map(({ v, segment }) => {
        const isMatched = !!(v.user_id || v.user_email);
        const identityHtml = `
            <span class="segment-pill ${segment.cssClass}">${segment.label}</span><br>
            ${isMatched
                ? `<strong>${escapeHtml(v.user_email || v.user_id)}</strong>`
                : `<span class="text-xs text-muted">Anonim #${escapeHtml(String(v.visitor_id || '').slice(0, 8))}</span>`}
        `;

        const locationStr = v.city && v.country
            ? `${v.city}, ${v.country}`
            : (v.country || v.timezone || 'Bilinmiyor');

        const sourceStr = v.first_utm_source
            ? `UTM: ${v.first_utm_source}${v.first_utm_campaign ? ' / ' + v.first_utm_campaign : ''}`
            : (v.first_referrer_domain || 'Doğrudan');

        const readMeta = (Number(v.max_scroll_depth) || 0) > 0
            ? `<div class="text-xs text-muted">Maks okuma: %${v.max_scroll_depth}</div>`
            : '';

        const deviceDisp = inferDeviceDisplay(v);
        const regionHtml = v.region
            ? `<div class="text-xs text-muted">${escapeHtml(v.region)}</div>`
            : '';

        return `
            <tr class="visitor-clickable-row" data-visitor-id="${escapeHtml(v.visitor_id)}" title="Ziyaretçi yolculuğunu incelemek için tıklayın">
                <td>${identityHtml}</td>
                <td>
                    <strong>${escapeHtml(deviceDisp.primary)}</strong>
                    <div class="text-xs text-muted">${escapeHtml(deviceDisp.secondary)}</div>
                    <div class="text-xs text-muted">${escapeHtml(v.screen_resolution || '')} ${v.is_pwa ? '• PWA' : ''}</div>
                </td>
                <td>
                    <strong>${escapeHtml(locationStr)}</strong>
                    ${regionHtml}
                    <div class="text-xs text-muted">${escapeHtml(v.language || '')}</div>
                </td>
                <td>
                    <strong>${escapeHtml(sourceStr)}</strong>
                    <div class="text-xs text-muted">İlk: ${escapeHtml(v.first_landing_page || '#explore')}</div>
                    ${v.last_page ? `<div class="text-xs text-muted">Son: ${escapeHtml(v.last_page)}</div>` : ''}
                    ${readMeta}
                </td>
                <td><strong>${v.visit_count || 1}</strong></td>
                <td>
                    <div>${formatDateTime(v.last_seen_at)}</div>
                    <div class="text-xs" style="color:var(--color-primary); font-weight:600; margin-top:2px;">Yolculuğu Gör →</div>
                </td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('.visitor-clickable-row').forEach(row => {
        row.addEventListener('click', () => {
            const vid = row.getAttribute('data-visitor-id');
            const visitor = visitors.find(x => x.visitor_id === vid);
            if (visitor) openVisitorTimelineModal(visitor);
        });
    });
}

export function renderAdminUsers(profiles) {
    const listEl = document.getElementById('admin-users-list');
    if (!listEl) return;

    if (profiles.length === 0) {
        listEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Kayıtlı üye bulunmamaktadır.</td></tr>`;
        return;
    }

    listEl.innerHTML = profiles.map(profile => {
        let statusBadge = '';
        if (profile.status === 'approved') {
            statusBadge = '<span class="badge badge-activity">Onaylı</span>';
        } else if (profile.status === 'rejected') {
            statusBadge = '<span class="badge badge-food">Reddedildi</span>';
        } else {
            statusBadge = '<span class="badge" style="background-color: rgba(245, 158, 11, 0.15); color: #f59e0b;">Bekliyor</span>';
        }

        const isSelf = profile.id === state.activeUser?.id;
        const isAdminProfile = profile.role?.name === 'admin';

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(profile.email)}</strong>
                    ${isAdminProfile ? ' <span class="badge badge-lodge" style="font-size:8px; padding:2px 4px;">Yönetici</span>' : ''}
                </td>
                <td>${formatDate(profile.created_at)}</td>
                <td>${statusBadge}</td>
                <td>
                    ${isSelf ? '<span class="text-muted">Aktif Oturum</span>' : `
                        <div style="display:flex; gap:8px;">
                            ${profile.status !== 'approved' ? `
                                <button class="btn btn-secondary btn-sm btn-approve-user" data-id="${profile.id}" style="background-color: var(--color-success-light); color: var(--color-success); padding: 6px 12px;">
                                    Onayla
                                </button>
                            ` : ''}
                            ${profile.status !== 'rejected' ? `
                                <button class="btn btn-secondary btn-sm btn-reject-user" data-id="${profile.id}" style="background-color: var(--color-danger-light); color: var(--color-danger); padding: 6px 12px;">
                                    Reddet
                                </button>
                            ` : ''}
                        </div>
                    `}
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.btn-approve-user').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            try {
                await db.updateProfileStatus(id, 'approved');
                showToast('Kullanıcı onaylandı', 'success');
                await loadAdminUsers();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    });

    document.querySelectorAll('.btn-reject-user').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            try {
                await db.updateProfileStatus(id, 'rejected');
                showToast('Kullanıcı reddedildi', 'warning');
                await loadAdminUsers();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}
