// js/app.js - Main Application Orchestrator and SPA UI Controller

import { isConfigured, config, savePreferences } from '../config.js';
import * as db from '../db.js';
import { state } from './state.js';
import { showToast } from './utils.js';

// Import View Modules
import { initAuthEvents, renderApprovalPending } from './modules/auth.js';
import { initSettingsEvents, loadSettingsForm } from './modules/settings.js';
import { initTripsEvents, loadTripsData, renderParticipantTags } from './modules/trips.js';
import { initExpensesEvents, loadExpensesData, updateExpenseFormParticipants } from './modules/expenses.js';
import { initJournalEvents, loadJournalData } from './modules/journal.js';
import { initDashboardEvents, loadDashboardData, renderDashboard } from './modules/dashboard.js';
import { loadAdminData } from './modules/admin.js';

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
    logs.push(`- Çevrimiçi mi? (isOnline): ${db.isOnline()}`);
    logs.push(`- Giriş Yapan Kullanıcı: ${state.activeUser ? state.activeUser.email : 'Giriş yapılmamış'}`);
    logs.push(`- Kullanıcı ID: ${state.activeUser ? state.activeUser.id : 'null'}`);
    logs.push(`- Yönetici mi? (isAdmin): ${state.isAdmin}`);
    logs.push(`- Profil Verisi (userProfile): ${JSON.stringify(state.userProfile)}`);
    logs.push(`- Aktif Seyahat ID: ${state.activeTripId}`);
    logs.push(`- Seyahat Sayısı: ${state.tripsList.length}`);
    logs.push(`- Toplam Harcama Sayısı: ${state.expensesList.length}`);
    logs.push(`- Toplam Anı Sayısı: ${state.memoriesList.length}`);
    
    if (state.tripsList.length > 0) {
        logs.push(`- Seyahatler: ${state.tripsList.map(t => `${t.name} (ID: ${t.id.substring(0,6)}...)`).join(', ')}`);
    }
    
    if (state.expensesList.length > 0) {
        logs.push(`- Son 3 Harcama: ${state.expensesList.slice(0, 3).map(e => `${e.title} (${e.amount} ${e.currency}, Seyahat ID: ${e.trip_id.substring(0,6)}...)`).join(', ')}`);
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
    dashboard: document.getElementById('view-dashboard'),
    trips: document.getElementById('view-trips'),
    expenses: document.getElementById('view-expenses'),
    journal: document.getElementById('view-journal'),
    settings: document.getElementById('view-settings'),
    admin: document.getElementById('view-admin'),
    'approval-pending': document.getElementById('view-approval-pending')
};

function initNavigation() {
    window.addEventListener('hashchange', handleRouting);
    handleRouting();

    window.addEventListener('hashchange', () => {
        const hash = window.location.hash || '#dashboard';
        
        document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
            el.classList.remove('active');
        });

        const mapping = {
            '#dashboard': ['nav-dash', 'm-nav-dash'],
            '#trips': ['nav-trips', 'm-nav-trips'],
            '#expenses': ['nav-expenses', 'm-nav-expenses'],
            '#journal': ['nav-journal', 'm-nav-journal'],
            '#settings': ['nav-settings', 'm-nav-settings']
        };

        const ids = mapping[hash];
        if (ids) {
            ids.forEach(id => {
                const navEl = document.getElementById(id);
                if (navEl) navEl.classList.add('active');
            });
        }
    });
}

async function handleRouting() {
    const hash = window.location.hash || '#dashboard';
    
    if (!isConfigured()) {
        showView('setup');
        return;
    }

    db.initSupabase();

    state.activeUser = await db.getCurrentUser();
    
    if (!state.activeUser && hash !== '#auth') {
        window.location.hash = '#auth';
        return;
    }

    state.userProfile = null;
    state.isAdmin = false;
    if (state.activeUser) {
        // Apply email fallback immediately in case DB queries fail/throw
        state.isAdmin = state.activeUser.email === 'bllacrr@gmail.com';
        
        try {
            state.userProfile = await db.getUserProfile(state.activeUser.id);
            if (!state.userProfile) {
                state.userProfile = await db.createUserProfile(state.activeUser.id, state.activeUser.email);
            }
            // Resolve isAdmin role based on dynamic roles join output with independent email fallback
            state.isAdmin = !!(
                (state.userProfile && state.userProfile.role && state.userProfile.role.name === 'admin') ||
                (state.activeUser && state.activeUser.email === 'bllacrr@gmail.com')
            );
        } catch (profileErr) {
            console.error("Profile resolution failed:", profileErr);
            showToast("Profil doğrulanamadı. SQL şemasını çalıştırdığınızdan emin olun.", "danger");
        }
    }

    // Toggle admin layouts elements dynamically
    const adminLink = document.getElementById('nav-admin');
    if (adminLink) {
        if (state.isAdmin) adminLink.classList.remove('hidden');
        else adminLink.classList.add('hidden');
    }

    if (state.activeUser) {
        if (!state.userProfile || state.userProfile.status !== 'approved') {
            showView('approval-pending');
            renderApprovalPending();

            const layout = document.getElementById('layout-container');
            const mobileNav = document.querySelector('.mobile-nav');
            if (layout) layout.classList.add('no-sidebar');
            if (mobileNav) mobileNav.classList.add('hidden');
            return;
        }
    }

    const layout = document.getElementById('layout-container');
    const mobileNav = document.querySelector('.mobile-nav');
    
    if (hash === '#auth' || hash === '#setup') {
        layout.classList.add('no-sidebar');
        if (mobileNav) mobileNav.classList.add('hidden');
    } else {
        layout.classList.remove('no-sidebar');
        if (mobileNav) mobileNav.classList.remove('hidden');
    }

    switch(hash) {
        case '#dashboard':
            showView('dashboard');
            await loadDashboardData();
            break;
        case '#trips':
            showView('trips');
            await loadTripsData();
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
            if (state.isAdmin) {
                showView('admin');
                await loadAdminData();
            } else {
                window.location.hash = '#dashboard';
            }
            break;
        case '#auth':
            if (state.activeUser) {
                window.location.hash = '#dashboard';
            } else {
                showView('auth');
            }
            break;
        default:
            showView('dashboard');
    }
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

// Fetch exchange rates from exchange rate API on load
async function fetchExchangeRates() {
    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();
        if (data && data.rates) {
            state.exchangeRates = data.rates;
            renderDashboard();
        }
    } catch (error) {
        console.warn("Could not fetch live exchange rates, using offline defaults:", error);
    }
}

// Global Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.body.className = config.theme === 'light' ? 'light-theme' : 'dark-theme';

    initNavigation();
    
    // Init Modules Event Handlers
    initAuthEvents();
    initSettingsEvents();
    initTripsEvents();
    initExpensesEvents();
    initJournalEvents();
    initDashboardEvents();

    setupModal('btn-add-trip', 'trip-modal', 'btn-close-trip-modal');
    setupModal('btn-add-expense', 'expense-modal', 'btn-close-expense-modal');
    setupModal('btn-add-memory', 'memory-modal', 'btn-close-memory-modal');

    // Live Sync Listeners
    window.addEventListener('sync-completed', async () => {
        showToast('Bulut verileri otomatik olarak güncellendi.', 'success');
        const currentHash = window.location.hash;
        if (currentHash === '#dashboard') await loadDashboardData();
        else if (currentHash === '#trips') await loadTripsData();
        else if (currentHash === '#expenses') await loadExpensesData();
        else if (currentHash === '#journal') await loadJournalData();
    });

    window.addEventListener('offline-queue-changed', () => {
        const pendingCount = db.getPendingQueueCount();
        const queueText = document.getElementById('queue-status-text');
        const syncBtn = document.getElementById('btn-sync-now');

        if (queueText && syncBtn) {
            if (pendingCount > 0) {
                queueText.innerHTML = `Eşitlenmeyi bekleyen <strong>${pendingCount}</strong> değişiklik var.`;
                syncBtn.classList.remove('hidden');
            } else {
                queueText.textContent = "Verileriniz güncel ve bulutla eşitlenmiş.";
                syncBtn.classList.add('hidden');
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
});
