// js/app.js - Main Application Orchestrator and SPA UI Controller

import { isConfigured, config, savePreferences } from '../config.js';
import * as db from '../db.js';
import { state } from './state.js';
import { showToast } from './utils.js';

// Import View Modules
import { initAuthEvents, renderApprovalPending, checkResetPasswordMode, syncAuthNetworkUI, syncAuthTabFromHash } from './modules/auth.js';
import { initSettingsEvents, loadSettingsForm } from './modules/settings.js';
import { initTripsEvents, loadTripsData, renderParticipantTags } from './modules/trips.js';
import { initReservationEvents } from './modules/reservations.js';
import { initExpensesEvents, loadExpensesData, updateExpenseFormParticipants } from './modules/expenses.js';
import { initJournalEvents, loadJournalData } from './modules/journal.js';
import { initDashboardEvents, loadDashboardData, renderDashboard } from './modules/dashboard.js';
import { loadAdminData, initAdminEvents, clearAdminViewState } from './modules/admin.js';
import { initPlacesEvents, loadPlacesData, handleIncomingPlaceIntent } from './modules/places.js';
import { initShareEvents, loadShareView } from './modules/share.js';
import { initAiAssistant, setAiLauncherVisible } from './modules/ai_assistant.js';
import { initExploreEvents, loadExploreView, loadBlogPostDetailView } from './modules/explore.js';
import { trackPageView, identifyVisitor, initPrivacyNotice, flushReadingSession } from './modules/analytics.js';

let lastIdentifiedUserId = null;

function syncGlobalOfflineBanner() {
    const banner = document.getElementById('global-offline-banner');
    if (!banner) return;
    const online = db.hasInternet();
    banner.classList.toggle('hidden', online);
    if (window.lucide) window.lucide.createIcons();
}

// Theme UI Synchronizer
function syncThemeUI(theme) {
    const isLight = theme === 'light';
    document.body.className = isLight ? 'light-theme' : 'dark-theme';

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
        metaTheme.setAttribute('content', isLight ? '#ffffff' : '#121212');
    }

    const mobileBtn = document.getElementById('btn-mobile-theme-toggle');
    if (mobileBtn) {
        mobileBtn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}"></i>`;
        mobileBtn.title = isLight ? 'Koyu Temaya Geç' : 'Açık Temaya Geç';
    }

    const desktopBtn = document.getElementById('btn-desktop-theme-toggle');
    if (desktopBtn) {
        desktopBtn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}"></i><span>${isLight ? 'Koyu Tema' : 'Açık Tema'}</span>`;
        desktopBtn.title = isLight ? 'Koyu Temaya Geç' : 'Açık Temaya Geç';
    }

    const exploreThemeBtn = document.getElementById('btn-explore-theme-toggle');
    if (exploreThemeBtn) {
        exploreThemeBtn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}"></i>`;
        exploreThemeBtn.title = isLight ? 'Koyu Temaya Geç' : 'Açık Temaya Geç';
    }

    const postThemeBtn = document.getElementById('btn-post-theme-toggle');
    if (postThemeBtn) {
        postThemeBtn.innerHTML = `<i data-lucide="${isLight ? 'moon' : 'sun'}"></i>`;
        postThemeBtn.title = isLight ? 'Koyu Temaya Geç' : 'Açık Temaya Geç';
    }

    if (window.lucide) window.lucide.createIcons();
}

function setDesktopThemeToggleVisible(visible) {
    const desktopBtn = document.getElementById('btn-desktop-theme-toggle');
    if (desktopBtn) desktopBtn.classList.toggle('hidden', !visible);
}

// Global error logging for diagnostics
let globalErrors = [];
window.onerror = function(message, source, lineno, colno, error) {
    const errorStr = `Error: ${message} at ${source}:${lineno}:${colno}`;
    console.error(errorStr);
    globalErrors.push(errorStr);
    updateDiagnosticsUI();
    return false;
};
window.onunhandledrejection = function(event) {
    const errorStr = `Unhandled Promise Rejection: ${event.reason}`;
    console.error(errorStr);
    globalErrors.push(errorStr);
    updateDiagnosticsUI();
};

function updateDiagnosticsUI() {
    const diagLog = document.getElementById('diagnostics-log');
    if (!diagLog) return;

    let logs = [];
    logs.push(`Uygulama Durumu (App State):`);
    logs.push(`- İnternet Erişimi (hasInternet): ${db.hasInternet()}`);
    logs.push(`- Bulut Bağlantısı (isOnline): ${db.isOnline()}`);
    logs.push(`- Giriş Yapan Kullanıcı: ${state.activeUser ? state.activeUser.email : 'Giriş yapılmamış'}`);
    logs.push(`- Kullanıcı ID: ${state.activeUser ? state.activeUser.id : 'null'}`);
    logs.push(`- Yönetici mi? (isAdmin): ${state.isAdmin}`);
    logs.push(`- Profil Verisi (userProfile): ${JSON.stringify(state.userProfile)}`);
    logs.push(`- Aktif Seyahat ID: ${state.activeTripId || 'Genel'}`);
    logs.push(`- Seyahat Sayısı: ${state.tripsList.length}`);
    logs.push(`- Toplam Harcama Sayısı: ${state.expensesList.length}`);
    logs.push(`- Toplam Anı Sayısı: ${state.memoriesList.length}`);

    if (state.tripsList.length > 0) {
        logs.push(`- Seyahatler: ${state.tripsList.map(t => `${t.name} (ID: ${t.id ? t.id.substring(0, 6) : 'null'}...)`).join(', ')}`);
    }

    if (state.expensesList.length > 0) {
        logs.push(`- Son 3 Harcama: ${state.expensesList.slice(0, 3).map(e => `${e.title} (${e.amount} ${e.currency}, Seyahat ID: ${e.trip_id ? e.trip_id.substring(0, 6) : 'Genel'}...)`).join(', ')}`);
    }

    if (globalErrors.length > 0) {
        logs.push(`\nYakalanan Hatalar (Errors Caught):`);
        globalErrors.forEach(err => logs.push(`⚠️ ${err}`));
    } else {
        logs.push(`\nYakalanan Hata Yok.`);
    }

    diagLog.textContent = logs.join('\n');
}

/* ==========================================================================
   ROUTING ENGINE
   ========================================================================== */

const views = {
    auth: document.getElementById('view-auth'),
    setup: document.getElementById('view-setup'),
    explore: document.getElementById('view-explore'),
    post: document.getElementById('view-post'),
    dashboard: document.getElementById('view-dashboard'),
    trips: document.getElementById('view-trips'),
    expenses: document.getElementById('view-expenses'),
    places: document.getElementById('view-places'),
    journal: document.getElementById('view-journal'),
    settings: document.getElementById('view-settings'),
    admin: document.getElementById('view-admin'),
    share: document.getElementById('view-share'),
    'approval-pending': document.getElementById('view-approval-pending')
};

function updateActiveNav(hash) {
    const cleanHash = (hash || '#dashboard').split('?')[0];
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
        el.classList.remove('active');
    });

    const mapping = {
        '#explore': ['nav-explore', 'm-nav-explore'],
        '#blog': ['nav-explore', 'm-nav-explore'],
        '#news': ['nav-explore', 'm-nav-explore'],
        '#post': ['nav-explore', 'm-nav-explore'],
        '#dashboard': ['nav-dash', 'm-nav-dash'],
        '#trips': ['nav-trips', 'm-nav-trips'],
        '#places': ['nav-places', 'm-nav-places'],
        '#expenses': ['nav-expenses', 'm-nav-expenses'],
        '#journal': ['nav-journal', 'm-nav-journal'],
        '#settings': ['nav-settings', 'm-nav-settings']
    };

    const ids = mapping[cleanHash];
    if (ids) {
        ids.forEach(id => {
            const navEl = document.getElementById(id);
            if (navEl) navEl.classList.add('active');
        });
    }
}

function extractMobilePlaceIntent() {
    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return null;
    const isCheckin = params.get('checkin') === '1';
    const sharedParts = [params.get('share_url'), params.get('share_text'), params.get('share_title')]
        .map(v => (v || '').trim())
        .filter(Boolean);
    if (!isCheckin && sharedParts.length === 0) return null;
    return { mode: isCheckin ? 'checkin' : 'share', text: sharedParts.join(' ') };
}

async function processPendingMobileIntent() {
    const intent = extractMobilePlaceIntent();
    if (!intent) return;
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    await handleIncomingPlaceIntent(intent);
}

function initNavigation() {
    window.addEventListener('hashchange', handleRouting);
    handleRouting();
}

async function handleRouting() {
    flushReadingSession();
    const rawHash = window.location.hash || '';
    syncGlobalOfflineBanner();

    // Handle Read-Only Guest Share View (#share?id=... or #s=...)
    if (rawHash.startsWith('#share') || rawHash.startsWith('#s=') || rawHash.startsWith('#s?')) {
        const layout = document.getElementById('layout-container');
        const mobileNav = document.querySelector('.mobile-nav');
        if (layout) layout.classList.add('no-sidebar');
        if (mobileNav) mobileNav.classList.add('hidden');
        showView('share');
        setAiLauncherVisible(false);
        setDesktopThemeToggleVisible(false);
        db.initSupabase();
        await loadShareView(rawHash);
        trackPageView(rawHash);
        return;
    }

    if (!isConfigured()) {
        showView('setup');
        setAiLauncherVisible(false);
        setDesktopThemeToggleVisible(false);
        return;
    }

    db.initSupabase();
    checkResetPasswordMode();

    state.activeUser = await db.getCurrentUser();

    // Guests land on #explore (Blog & Travel News); signed-in users land on #dashboard
    const hash = rawHash || (state.activeUser ? '#dashboard' : '#explore');
    const cleanHash = hash.split('?')[0];
    const isPublicExploreRoute = cleanHash === '#explore' || cleanHash === '#blog' || cleanHash === '#news' || cleanHash === '#post';

    updateActiveNav(hash);

    state.userProfile = null;
    state.isAdmin = false;
    if (state.activeUser) {
        if (lastIdentifiedUserId !== state.activeUser.id) {
            lastIdentifiedUserId = state.activeUser.id;
            identifyVisitor(state.activeUser.id, state.activeUser.email);
        }

        state.isAdmin = state.activeUser.email === 'bllacrr@gmail.com';

        try {
            state.userProfile = await db.getUserProfile(state.activeUser.id);
            if (!state.userProfile && db.hasInternet()) {
                state.userProfile = await db.createUserProfile(state.activeUser.id, state.activeUser.email);
            }
            if (!state.userProfile && !db.hasInternet()) {
                state.userProfile = {
                    id: state.activeUser.id,
                    email: state.activeUser.email,
                    status: 'approved',
                    role: { name: state.isAdmin ? 'admin' : 'member' }
                };
            }
            state.isAdmin = !!(
                (state.userProfile && state.userProfile.role && state.userProfile.role.name === 'admin') ||
                (state.activeUser && state.activeUser.email === 'bllacrr@gmail.com')
            );
        } catch (profileErr) {
            console.error("Profile resolution failed:", profileErr);
            if (db.hasInternet()) {
                showToast("Profil doğrulanamadı. SQL şemasını çalıştırdığınızdan emin olun.", "danger");
            }
        }
    }

    const adminLink = document.getElementById('nav-admin');
    if (adminLink) {
        if (state.isAdmin) adminLink.classList.remove('hidden');
        else adminLink.classList.add('hidden');
    }

    const isApprovedLoggedIn = !!(state.activeUser && state.userProfile && state.userProfile.status === 'approved');
    if (!isApprovedLoggedIn || !state.isAdmin) {
        clearAdminViewState();
    }
    const layout = document.getElementById('layout-container');
    const mobileNav = document.querySelector('.mobile-nav');

    // Public Explore & Blog Detail Views (Accessible WITH or WITHOUT login)
    if (isPublicExploreRoute) {
        if (isApprovedLoggedIn) {
            layout.classList.remove('no-sidebar');
            setAiLauncherVisible(true);
            setDesktopThemeToggleVisible(true);
            if (mobileNav) mobileNav.classList.remove('hidden');
        } else {
            layout.classList.add('no-sidebar');
            setAiLauncherVisible(false);
            setDesktopThemeToggleVisible(false);
            if (mobileNav) mobileNav.classList.add('hidden');
        }

        if (cleanHash === '#post') {
            showView('post');
            await loadBlogPostDetailView(hash);
        } else {
            showView('explore');
            const initialTab = cleanHash === '#blog' ? 'blog' : cleanHash === '#news' ? 'news' : 'all';
            await loadExploreView(initialTab);
            trackPageView(hash);
        }
        return;
    }

    if (!state.activeUser && cleanHash !== '#auth' && !hash.startsWith('#reset-password') && !hash.includes('type=recovery')) {
        window.location.hash = '#explore';
        return;
    }

    if (state.activeUser && !isApprovedLoggedIn) {
        showView('approval-pending');
        renderApprovalPending();
        setAiLauncherVisible(false);
        setDesktopThemeToggleVisible(false);

        if (layout) layout.classList.add('no-sidebar');
        if (mobileNav) mobileNav.classList.add('hidden');
        return;
    }

    if (!isApprovedLoggedIn || cleanHash === '#auth' || cleanHash === '#setup' || cleanHash === '#reset-password' || hash.includes('type=recovery')) {
        setAiLauncherVisible(false);
        setDesktopThemeToggleVisible(false);
        layout.classList.add('no-sidebar');
        if (mobileNav) mobileNav.classList.add('hidden');
    } else {
        layout.classList.remove('no-sidebar');
        setAiLauncherVisible(cleanHash !== '#admin');
        setDesktopThemeToggleVisible(true);
        if (mobileNav) mobileNav.classList.remove('hidden');

        if (extractMobilePlaceIntent() && cleanHash !== '#places') {
            window.location.hash = '#places';
            return;
        }
    }

    switch (cleanHash) {
        case '#dashboard':
            showView('dashboard');
            await loadDashboardData();
            break;
        case '#trips':
            showView('trips');
            await loadTripsData();
            break;
        case '#places':
            showView('places');
            await loadPlacesData();
            await processPendingMobileIntent();
            break;
        case '#expenses':
            showView('expenses');
            await loadExpensesData();
            break;
        case '#journal':
            showView('journal');
            await loadJournalData();
            break;
        case '#settings':
            showView('settings');
            loadSettingsForm();
            break;
        case '#admin':
            if (isApprovedLoggedIn && state.isAdmin) {
                showView('admin');
                await loadAdminData();
            } else {
                clearAdminViewState();
                showToast('Bu alana yalnızca yetkili yönetici erişebilir.', 'danger');
                window.location.hash = isApprovedLoggedIn ? '#dashboard' : '#explore';
            }
            break;
        case '#auth':
            if (state.activeUser) {
                window.location.hash = '#dashboard';
            } else {
                syncAuthTabFromHash(hash);
                showView('auth');
                syncAuthNetworkUI();
            }
            break;
        default:
            if (isApprovedLoggedIn) {
                showView('dashboard');
                await loadDashboardData();
            } else {
                showView('explore');
                await loadExploreView('all');
            }
    }

    trackPageView(hash);
}

function showView(viewName) {
    for (const key in views) {
        if (views[key]) {
            views[key].classList.add('hidden');
            views[key].classList.remove('visible');
        }
    }
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
        views[viewName].classList.add('visible');
    }
    if (window.lucide) window.lucide.createIcons();
}

// Modal helper
function setupModal(triggerId, modalId, closeId) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeId);

    if (trigger && modal && closeBtn) {
        trigger.addEventListener('click', () => {
            modal.classList.remove('hidden');
            const form = modal.querySelector('form');
            if (form) {
                form.reset();
                const idInput = form.querySelector('input[type="hidden"]');
                if (idInput) idInput.value = '';
            }
            if (modalId === 'trip-modal') {
                state.tempTripParticipants = [];
                renderParticipantTags();
            }

            const titleEl = modal.querySelector('h2');
            if (titleEl) {
                if (modalId === 'trip-modal') titleEl.textContent = 'Yeni Seyahat Ekle';
                else if (modalId === 'expense-modal') titleEl.textContent = 'Yeni Masraf Ekle';
                else if (modalId === 'memory-modal') titleEl.textContent = 'Yeni Anı Kaydet';
            }

            if (modalId === 'memory-modal') {
                const previewImg = document.getElementById('photo-preview');
                const previewContainer = document.getElementById('photo-preview-container');
                const photoPlaceholder = document.getElementById('photo-upload-placeholder');
                if (previewImg && previewContainer && photoPlaceholder) {
                    previewImg.src = '';
                    previewContainer.classList.add('hidden');
                    photoPlaceholder.classList.remove('hidden');
                }
                state.selectedPhotoFile = null;
            }

            const dateInput = modal.querySelector('input[type="date"]');
            if (dateInput) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }

            if (modalId === 'expense-modal') {
                const select = document.getElementById('expense-trip-id');
                if (select && state.activeTripId) {
                    select.value = state.activeTripId;
                }
                updateExpenseFormParticipants(state.activeTripId || (select ? select.value : null));
            }
            if (modalId === 'memory-modal' && state.activeTripId) {
                const select = document.getElementById('memory-trip-id');
                if (select) select.value = state.activeTripId;
            }
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }
}

// Fetch exchange rates from exchange rate API on load (with localStorage cache & fallback provider)
const RATES_CACHE_KEY = 'travellermobi_rates_cache_v1';

function loadCachedExchangeRates() {
    try {
        const raw = localStorage.getItem(RATES_CACHE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.rates && parsed.rates.TRY && parsed.rates.EUR) {
            state.exchangeRates = parsed.rates;
            state.exchangeRatesMeta = {
                source: 'cache',
                updatedAt: parsed.updatedAt || null
            };
            return true;
        }
    } catch (_) {}
    return false;
}

async function fetchExchangeRates() {
    loadCachedExchangeRates();
    if (!db.hasInternet()) return;

    const applyLiveRates = (rates, updatedAt = new Date().toISOString()) => {
        state.exchangeRates = { USD: 1, ...rates };
        state.exchangeRatesMeta = { source: 'live', updatedAt };
        try {
            localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({
                rates: state.exchangeRates,
                updatedAt
            }));
        } catch (_) {}
        renderDashboard();
    };

    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' });
        const data = await response.json();
        if (data && data.result === 'success' && data.rates) {
            applyLiveRates(data.rates, data.time_last_update_utc || new Date().toISOString());
            return;
        }
    } catch (error) {
        console.warn("Primary exchange rate API failed, trying fallback:", error);
    }

    try {
        const res2 = await fetch('https://api.frankfurter.app/latest?from=USD', { cache: 'no-store' });
        const data2 = await res2.json();
        if (data2 && data2.rates) {
            applyLiveRates(data2.rates, data2.date || new Date().toISOString());
            return;
        }
    } catch (err2) {
        console.warn("Could not fetch live exchange rates, using cached/offline defaults:", err2);
    }
}

// Global Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    syncThemeUI(config.theme);

    const handleQuickThemeToggle = () => {
        const nextTheme = config.theme === 'light' ? 'dark' : 'light';
        savePreferences(config.defaultCurrency, nextTheme);
        syncThemeUI(nextTheme);
        if (window.location.hash === '#settings') {
            loadSettingsForm();
        }
        showToast(nextTheme === 'light' ? 'Açık tema aktif edildi' : 'Koyu tema aktif edildi', 'info');
    };

    const mobileThemeBtn = document.getElementById('btn-mobile-theme-toggle');
    const desktopThemeBtn = document.getElementById('btn-desktop-theme-toggle');
    if (mobileThemeBtn) mobileThemeBtn.addEventListener('click', handleQuickThemeToggle);
    if (desktopThemeBtn) desktopThemeBtn.addEventListener('click', handleQuickThemeToggle);

    window.addEventListener('theme-changed', (e) => {
        syncThemeUI(e.detail?.theme || config.theme);
    });

    initNavigation();

    // Init Modules Event Handlers
    initAuthEvents();
    initSettingsEvents();
    initTripsEvents();
    initReservationEvents();
    initExpensesEvents();
    initPlacesEvents();
    initShareEvents();
    initJournalEvents();
    initDashboardEvents();
    initAiAssistant();
    initExploreEvents();
    initAdminEvents();
    initPrivacyNotice();

    // Global network status listeners
    syncGlobalOfflineBanner();
    window.addEventListener('network-status-changed', (e) => {
        const online = !!e.detail?.online;
        syncGlobalOfflineBanner();
        if (online) {
            showToast('İnternet bağlantısı yeniden kuruldu!', 'success');
            fetchExchangeRates();
        } else {
            showToast('İnternet bağlantısı kesildi — Çevrimdışı mod aktif.', 'warning');
        }
    });

    const retryGlobalNetBtn = document.getElementById('btn-global-retry-network');
    if (retryGlobalNetBtn) {
        retryGlobalNetBtn.addEventListener('click', async () => {
            syncGlobalOfflineBanner();
            if (db.hasInternet()) {
                await db.initSupabase();
                await db.syncOfflineQueue();
                showToast('Bağlantı aktif ve bulutla eşitleniyor.', 'success');
                handleRouting();
            } else {
                showToast('İnternet bağlantısı hâlâ algılanamadı.', 'warning');
            }
        });
    }

    window.addEventListener('ai-data-mutated', async () => {
        const currentHash = (window.location.hash || '#dashboard').split('?')[0];
        if (currentHash === '#dashboard') await loadDashboardData();
        else if (currentHash === '#trips') await loadTripsData();
        else if (currentHash === '#places') await loadPlacesData();
        else if (currentHash === '#expenses') await loadExpensesData();
        else if (currentHash === '#journal') await loadJournalData();
    });

    setupModal('btn-add-trip', 'trip-modal', 'btn-close-trip-modal');
    setupModal('btn-add-expense', 'expense-modal', 'btn-close-expense-modal');
    setupModal('btn-add-memory', 'memory-modal', 'btn-close-memory-modal');

    // Live Sync Listeners
    window.addEventListener('sync-completed', async () => {
        showToast('Bulut verileri otomatik olarak güncellendi.', 'success');
        const currentHash = (window.location.hash || '#dashboard').split('?')[0];
        if (currentHash === '#dashboard') await loadDashboardData();
        else if (currentHash === '#trips') await loadTripsData();
        else if (currentHash === '#places') await loadPlacesData();
        else if (currentHash === '#expenses') await loadExpensesData();
        else if (currentHash === '#journal') await loadJournalData();
    });

    window.addEventListener('offline-queue-changed', () => {
        const pendingCount = db.getPendingQueueCount();
        const queueText = document.getElementById('queue-status-text');
        const syncBtn = document.getElementById('btn-sync-now');

        if (syncBtn) {
            syncBtn.classList.toggle('hidden', pendingCount === 0);
        }

        if (queueText) {
            if (pendingCount > 0) {
                queueText.innerHTML = `Eşitlenmeyi bekleyen <strong>${pendingCount}</strong> değişiklik var.`;
            } else {
                queueText.textContent = "Verileriniz güncel ve bulutla eşitlenmiş.";
                queueText.style.color = '';
            }
        }
    });

    window.addEventListener('diagnostics-update-needed', () => {
        updateDiagnosticsUI();
    });

    window.addEventListener('dashboard-reload-needed', () => {
        renderDashboard();
    });

    window.addEventListener('show-toast-needed', (e) => {
        showToast(e.detail.message, e.detail.type);
    });

    fetchExchangeRates();

    // PWA Install Prompt & Service Worker Registration
    let deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const banner = document.getElementById('pwa-install-banner');
        if (banner) banner.classList.remove('hidden');
    });

    const btnPwaInstall = document.getElementById('btn-pwa-install');
    const btnPwaDismiss = document.getElementById('btn-pwa-dismiss');
    if (btnPwaInstall) {
        btnPwaInstall.addEventListener('click', async () => {
            const banner = document.getElementById('pwa-install-banner');
            if (deferredInstallPrompt) {
                deferredInstallPrompt.prompt();
                const { outcome } = await deferredInstallPrompt.userChoice;
                if (outcome === 'accepted') {
                    showToast('TravellerMobi ana ekranınıza ekleniyor!', 'success');
                }
                deferredInstallPrompt = null;
            } else {
                showToast('Tarayıcınızın Paylaş/Menü kısmından "Ana Ekrana Ekle"ye dokunarak uygulamayı yükleyebilirsiniz.', 'info');
            }
            if (banner) banner.classList.add('hidden');
        });
    }
    if (btnPwaDismiss) {
        btnPwaDismiss.addEventListener('click', () => {
            const banner = document.getElementById('pwa-install-banner');
            if (banner) banner.classList.add('hidden');
        });
    }

    // Floating Back-to-Top button on long scrollable views
    const scrollTopBtn = document.getElementById('btn-scroll-top');
    if (scrollTopBtn) {
        const syncScrollTopVisibility = () => {
            scrollTopBtn.classList.toggle('hidden', window.scrollY < 340);
        };
        window.addEventListener('scroll', syncScrollTopVisibility, { passive: true });
        syncScrollTopVisibility();
        scrollTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
        }).catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
        });
    }
});
