// app.js - Main Application Orchestrator and SPA UI Controller

import { isConfigured, config, saveConfig, savePreferences } from './config.js';
import * as db from './db.js';

// Application State
let activeUser = null;
let userProfile = null;
let isAdmin = false;
let tripsList = [];
let expensesList = [];
let memoriesList = [];
let activeTripId = null;
let currentGalleryTab = 'all'; // 'all' or 'photos'
let exchangeRates = {};
let selectedPhotoFile = null;

// Fallback rates if exchange rate API fails or offline
const fallbackRates = {
    TRY: 32.50,
    EUR: 0.92,
    USD: 1.00,
    GBP: 0.79,
    JPY: 157.00
};

// Toast Alert notification helper
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Choose icon based on type
    let icon = 'info';
    if (type === 'success') icon = 'check-circle';
    if (type === 'warning') icon = 'alert-triangle';
    if (type === 'danger') icon = 'x-circle';

    toast.innerHTML = `<i data-lucide="${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    
    // Trigger Lucide icon parsing for this new toast
    if (window.lucide) window.lucide.createIcons();
    
    // Force reflow and animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Fade out and remove after 4 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Convert currencies dynamically using API rates
function convertCurrency(amount, from, to) {
    const rates = Object.keys(exchangeRates).length > 0 ? exchangeRates : fallbackRates;
    if (!rates[from] || !rates[to]) return amount;
    
    // Convert source to USD base, then USD to target currency
    const amountInUSD = amount / rates[from];
    return amountInUSD * rates[to];
}

// Fetch live currency rates from exchange rate API
async function fetchExchangeRates() {
    try {
        const response = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await response.json();
        if (data && data.rates) {
            exchangeRates = data.rates;
            console.log("Latest exchange rates loaded:", exchangeRates);
            // Update converter widget result instantly
            updateConverterResult();
            // Re-render dashboard totals using new rates
            renderDashboard();
        }
    } catch (error) {
        console.warn("Could not fetch live exchange rates, using offline defaults:", error);
    }
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
    // Hash change event router
    window.addEventListener('hashchange', handleRouting);
    // Initial routing call
    handleRouting();

    // Bind sidebar and mobile bar nav highlight active item
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash || '#dashboard';
        
        // Remove active from all nav items
        document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
            el.classList.remove('active');
        });

        // Add active to selected route items
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
    
    // 1. Route Guard - Check config first
    if (!isConfigured()) {
        showView('setup');
        return;
    }

    // Initialize Supabase instance once configured
    db.initSupabase();

    // 2. Route Guard - Check user session
    activeUser = await db.getCurrentUser();
    
    // If not authenticated, force Auth page (unless setup view is active)
    if (!activeUser && hash !== '#auth') {
        window.location.hash = '#auth';
        return;
    }

    userProfile = null;
    isAdmin = false;
    if (activeUser) {
        userProfile = await db.getUserProfile(activeUser.id);
        if (!userProfile) {
            userProfile = await db.createUserProfile(activeUser.id, activeUser.email);
        }
        isAdmin = !!(userProfile && userProfile.is_admin);
    }

    // Toggle Admin Panel card visibility in Settings
    const adminCard = document.getElementById('settings-admin-card');
    if (adminCard) {
        if (isAdmin) adminCard.classList.remove('hidden');
        else adminCard.classList.add('hidden');
    }

    // Route Guard - Check user approval status
    if (activeUser && userProfile && userProfile.status !== 'approved') {
        showView('approval-pending');
        
        document.getElementById('pending-email').textContent = activeUser.email;
        const pendingMsgEl = document.getElementById('pending-message');
        const pendingIconEl = document.getElementById('pending-status-icon');
        
        if (userProfile.status === 'rejected') {
            if (pendingMsgEl) pendingMsgEl.textContent = 'Üyelik talebiniz yönetici tarafından reddedildi.';
            if (pendingIconEl) pendingIconEl.innerHTML = '<i data-lucide="x-circle" style="color:var(--color-danger); width:64px; height:64px;"></i>';
        } else {
            if (pendingMsgEl) pendingMsgEl.textContent = 'Üyeliğiniz onay sürecindedir. Yönetici onay verdiğinde uygulamaya erişebileceksiniz.';
            if (pendingIconEl) pendingIconEl.innerHTML = '<i data-lucide="clock" style="color:var(--color-warning); width:64px; height:64px;"></i>';
        }
        
        if (window.lucide) window.lucide.createIcons();

        const layout = document.getElementById('layout-container');
        const mobileNav = document.querySelector('.mobile-nav');
        if (layout) layout.classList.add('no-sidebar');
        if (mobileNav) mobileNav.classList.add('hidden');
        return;
    }

    // Hide layouts elements if on Auth or Setup screen
    const layout = document.getElementById('layout-container');
    const mobileNav = document.querySelector('.mobile-nav');
    
    if (hash === '#auth' || hash === '#setup') {
        layout.classList.add('no-sidebar');
        if (mobileNav) mobileNav.classList.add('hidden');
    } else {
        layout.classList.remove('no-sidebar');
        if (mobileNav) mobileNav.classList.remove('hidden');
    }

    // View specific page loaded triggers
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
            if (isAdmin) {
                showView('admin');
                await loadAdminData();
            } else {
                window.location.hash = '#dashboard';
            }
            break;
        case '#auth':
            if (activeUser) {
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
    // Hide all views
    for (const key in views) {
        if (views[key]) {
            views[key].classList.add('hidden');
            views[key].classList.remove('visible');
        }
    }
    // Show target view
    if (views[viewName]) {
        views[viewName].classList.remove('hidden');
        views[viewName].classList.add('visible');
    }
    
    // Render Icons
    if (window.lucide) window.lucide.createIcons();
}

/* ==========================================================================
   DATA LOADER MODULES
   ========================================================================== */

async function loadDashboardData() {
    tripsList = await db.getTrips();
    expensesList = await db.getExpenses();
    memoriesList = await db.getMemories();

    // Populate trip selector dropdowns in dashboard
    const selector = document.getElementById('dash-trip-selector');
    if (selector) {
        selector.innerHTML = '<option value="">Seyahat Seçin...</option>' + 
            tripsList.map(t => `<option value="${t.id}" ${t.id === activeTripId ? 'selected' : ''}>${t.name}</option>`).join('');
    }

    renderDashboard();
}

async function loadTripsData() {
    tripsList = await db.getTrips();
    renderTrips();
}

async function loadExpensesData() {
    tripsList = await db.getTrips();
    
    // Fill Trip filter selects
    const filterSelect = document.getElementById('expense-trip-filter');
    const modalSelect = document.getElementById('expense-trip-id');
    
    const tripOptions = tripsList.map(t => `<option value="${t.id}" ${t.id === activeTripId ? 'selected' : ''}>${t.name}</option>`).join('');
    
    if (filterSelect) filterSelect.innerHTML = '<option value="">Seyahat Seçin...</option>' + tripOptions;
    if (modalSelect) modalSelect.innerHTML = tripOptions;

    // Fetch expenses for filtered trip
    if (activeTripId) {
        expensesList = await db.getExpenses(activeTripId);
    } else {
        expensesList = [];
    }
    
    renderExpenses();
}

async function loadJournalData() {
    tripsList = await db.getTrips();
    
    const filterSelect = document.getElementById('journal-trip-filter');
    const modalSelect = document.getElementById('memory-trip-id');
    
    const tripOptions = tripsList.map(t => `<option value="${t.id}" ${t.id === activeTripId ? 'selected' : ''}>${t.name}</option>`).join('');
    
    if (filterSelect) filterSelect.innerHTML = '<option value="">Seyahat Seçin...</option>' + tripOptions;
    if (modalSelect) modalSelect.innerHTML = tripOptions;

    if (activeTripId) {
        memoriesList = await db.getMemories(activeTripId);
    } else {
        memoriesList = [];
    }

    renderJournal();
}

/* ==========================================================================
   DOM RENDERER MODULES
   ========================================================================== */

function renderDashboard() {
    const userEmailEl = document.getElementById('user-email');
    if (userEmailEl && activeUser) {
        userEmailEl.textContent = activeUser.email;
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl) avatarEl.textContent = activeUser.email[0].toUpperCase();
    }

    // Connection indicator
    const syncBadge = document.getElementById('dash-sync-badge');
    const mobileIndicator = document.getElementById('mobile-sync-indicator');
    const onlineStatus = db.isOnline();

    if (syncBadge) {
        syncBadge.innerHTML = onlineStatus ? 
            '<span class="pulse-indicator online"></span> Buluta Bağlı' : 
            '<span class="pulse-indicator offline"></span> Çevrimdışı Mod';
    }
    if (mobileIndicator) {
        const icon = mobileIndicator.querySelector('.sync-icon');
        if (icon) {
            icon.className = `sync-icon ${onlineStatus ? 'online' : 'offline'}`;
            icon.setAttribute('data-lucide', onlineStatus ? 'cloud' : 'cloud-lightning');
        }
    }

    // Pending queues counter
    const queueCard = document.getElementById('offline-queue-card');
    const queueText = document.getElementById('queue-status-text');
    const syncBtn = document.getElementById('btn-sync-now');
    const pendingCount = db.getPendingQueueCount();

    if (queueCard && queueText && syncBtn) {
        if (pendingCount > 0) {
            queueText.innerHTML = `Eşitlenmeyi bekleyen <strong>${pendingCount}</strong> değişiklik var.`;
            syncBtn.classList.remove('hidden');
            if (onlineStatus) {
                // Glow alert sync pending
                queueText.style.color = 'var(--color-warning)';
            }
        } else {
            queueText.textContent = "Verileriniz güncel ve bulutla eşitlenmiş.";
            syncBtn.classList.add('hidden');
            queueText.style.color = '';
        }
    }

    // Calculate active trip metrics
    const baseCur = config.defaultCurrency;
    let totalExpenseInBase = 0;
    let activeTrip = null;

    if (activeTripId) {
        activeTrip = tripsList.find(t => t.id === activeTripId);
    } else if (tripsList.length > 0) {
        // Default to first trip
        activeTrip = tripsList[0];
        activeTripId = activeTrip.id;
        
        // Sync selects
        const selector = document.getElementById('dash-trip-selector');
        if (selector) selector.value = activeTripId;
    }

    if (activeTrip) {
        const tripExpenses = expensesList.filter(e => e.trip_id === activeTrip.id);
        
        tripExpenses.forEach(e => {
            totalExpenseInBase += convertCurrency(e.amount, e.currency, baseCur);
        });

        document.getElementById('dash-active-trip').textContent = activeTrip.name;
        document.getElementById('dash-trip-dates').textContent = `${formatDate(activeTrip.start_date)} - ${formatDate(activeTrip.end_date)}`;
        
        // Progress bar for budget
        const budgetLimit = activeTrip.budget;
        const limitInBase = convertCurrency(budgetLimit, activeTrip.currency, baseCur);
        const percent = limitInBase > 0 ? Math.min((totalExpenseInBase / limitInBase) * 100, 100) : 0;
        
        const textProgress = document.getElementById('dash-budget-progress-text');
        const barProgress = document.getElementById('dash-budget-progress-bar');
        
        if (textProgress && barProgress) {
            textProgress.textContent = `${totalExpenseInBase.toFixed(2)} / ${limitInBase.toFixed(2)} ${baseCur}`;
            barProgress.style.width = `${percent}%`;
            
            // Color thresholds
            barProgress.className = 'progress-bar';
            if (percent > 90) barProgress.classList.add('danger');
            else if (percent > 75) barProgress.classList.add('warning');
        }
    } else {
        document.getElementById('dash-active-trip').textContent = "Seyahat Yok";
        document.getElementById('dash-trip-dates').textContent = "Yeni bir seyahat ekleyip başlayın";
        document.getElementById('dash-budget-progress-text').textContent = "0.00 / 0.00 TRY";
        document.getElementById('dash-budget-progress-bar').style.width = '0%';
    }

    // Global Metrics counters
    document.getElementById('dash-total-expense').textContent = `${totalExpenseInBase.toFixed(2)} ${baseCur}`;
    document.getElementById('dash-memories-count').textContent = `${memoriesList.filter(m => !activeTripId || m.trip_id === activeTripId).length} Anı`;
    
    const photosCount = memoriesList
        .filter(m => !activeTripId || m.trip_id === activeTripId)
        .filter(m => m.photo_url).length;
    document.getElementById('dash-photos-count').textContent = `${photosCount} Fotoğraf yüklendi`;

    if (window.lucide) window.lucide.createIcons();
}

function renderTrips() {
    const listEl = document.getElementById('trips-list');
    if (!listEl) return;

    if (tripsList.length === 0) {
        listEl.innerHTML = `
            <div class="card glass text-center" style="grid-column: 1/-1; padding: 50px;">
                <i data-lucide="compass" style="width: 48px; height: 48px; margin-bottom: 16px; color: var(--text-muted);"></i>
                <h3>Henüz Kayıtlı Seyahat Yok</h3>
                <p class="text-muted" style="margin-top: 8px;">İlk rotanızı oluşturarak seyahat planlamanıza ve masraf takibinize başlayın!</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    listEl.innerHTML = tripsList.map(trip => {
        return `
            <div class="trip-card">
                <div class="trip-card-glow"></div>
                <div>
                    <div class="trip-card-header">
                        <span class="trip-title">${escapeHTML(trip.name)}</span>
                        <div class="trip-actions">
                            <button class="btn-icon-only btn-edit-trip" data-id="${trip.id}" title="Seyahati Düzenle">
                                <i data-lucide="edit-3" style="width: 16px; height: 16px; color: var(--color-primary);"></i>
                            </button>
                            <button class="btn-icon-only btn-delete-trip" data-id="${trip.id}" title="Seyahati Sil">
                                <i data-lucide="trash-2" style="width: 16px; height: 16px; color: var(--color-danger);"></i>
                            </button>
                        </div>
                    </div>
                    <div class="trip-dates">
                        <i data-lucide="calendar" style="width: 12px; height: 12px; display:inline; margin-right:4px;"></i>
                        ${formatDate(trip.start_date)} - ${formatDate(trip.end_date)}
                    </div>
                </div>
                <div class="trip-budget-summary">
                    <div class="trip-budget-row">
                        <span>Planlanan Bütçe:</span>
                        <span>${trip.budget.toFixed(2)} ${trip.currency}</span>
                    </div>
                </div>
                <button class="btn btn-secondary btn-sm btn-select-trip" data-id="${trip.id}">
                    <i data-lucide="check"></i> Aktif Rota Yap
                </button>
            </div>
        `;
    }).join('');

    // Bind event handlers
    document.querySelectorAll('.btn-edit-trip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const trip = tripsList.find(t => t.id === id);
            if (trip) {
                document.getElementById('trip-id').value = trip.id;
                document.getElementById('trip-name').value = trip.name;
                document.getElementById('trip-start').value = trip.start_date;
                document.getElementById('trip-end').value = trip.end_date;
                document.getElementById('trip-budget').value = trip.budget;
                document.getElementById('trip-currency').value = trip.currency;
                
                document.getElementById('trip-modal-title').textContent = 'Seyahati Düzenle';
                document.getElementById('trip-modal').classList.remove('hidden');
            }
        });
    });

    document.querySelectorAll('.btn-delete-trip').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            if (confirm('Bu seyahati sildiğinizde, bu seyahate ait tüm harcamalar ve anılar da silinecektir. Emin misiniz?')) {
                await db.deleteTrip(id);
                showToast('Seyahat silindi', 'success');
                if (activeTripId === id) activeTripId = null;
                await loadTripsData();
            }
        });
    });

    document.querySelectorAll('.btn-select-trip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = btn.getAttribute('data-id');
            activeTripId = id;
            showToast('Aktif seyahat güncellendi', 'success');
            window.location.hash = '#dashboard';
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

function renderExpenses() {
    const listEl = document.getElementById('expenses-list');
    if (!listEl) return;

    if (!activeTripId) {
        listEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Lütfen listelemek için üst kısımdan bir seyahat seçin.</td></tr>`;
        return;
    }

    const categoryFilter = document.getElementById('expense-category-filter').value;
    let filtered = expensesList;

    if (categoryFilter) {
        filtered = expensesList.filter(e => e.category === categoryFilter);
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Kayıtlı harcama bulunamadı.</td></tr>`;
        renderExpenseChart([]);
        return;
    }

    const baseCur = config.defaultCurrency;

    listEl.innerHTML = filtered.map(exp => {
        const amtInBase = convertCurrency(exp.amount, exp.currency, baseCur);
        const catBadgeClass = getCategoryBadgeClass(exp.category);
        
        return `
            <tr>
                <td>${formatDate(exp.date)}</td>
                <td><strong>${escapeHTML(exp.title)}</strong></td>
                <td><span class="badge ${catBadgeClass}">${exp.category}</span></td>
                <td>${exp.amount.toFixed(2)} ${exp.currency}</td>
                <td>${amtInBase.toFixed(2)} ${baseCur}</td>
                <td>
                    <div class="table-actions" style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm btn-edit-expense" data-id="${exp.id}" title="Düzenle">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px; color: var(--color-primary);"></i>
                        </button>
                        <button class="btn btn-secondary btn-sm btn-delete-expense" data-id="${exp.id}" title="Sil">
                            <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--color-danger);"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Attach listeners
    document.querySelectorAll('.btn-edit-expense').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const exp = expensesList.find(x => x.id === id);
            if (exp) {
                document.getElementById('expense-id').value = exp.id;
                document.getElementById('expense-trip-id').value = exp.trip_id;
                document.getElementById('expense-title').value = exp.title;
                document.getElementById('expense-amount').value = exp.amount;
                document.getElementById('expense-currency').value = exp.currency;
                document.getElementById('expense-category').value = exp.category;
                document.getElementById('expense-date').value = exp.date;
                
                document.getElementById('expense-modal-title').textContent = 'Masrafı Düzenle';
                document.getElementById('expense-modal').classList.remove('hidden');
            }
        });
    });

    document.querySelectorAll('.btn-delete-expense').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (confirm('Bu harcamayı silmek istediğinize emin misiniz?')) {
                await db.deleteExpense(id);
                showToast('Harcama silindi', 'success');
                await loadExpensesData();
            }
        });
    });

    renderExpenseChart(expensesList);

    if (window.lucide) window.lucide.createIcons();
}

function renderExpenseChart(expenses) {
    const chartEl = document.getElementById('category-chart');
    if (!chartEl) return;

    if (expenses.length === 0) {
        chartEl.innerHTML = `<p class="text-center text-muted pad-50">Grafik için harcama verisi yok.</p>`;
        return;
    }

    const baseCur = config.defaultCurrency;
    
    // Aggregation
    const totals = {};
    let grandTotal = 0;

    expenses.forEach(e => {
        const amountInBase = convertCurrency(e.amount, e.currency, baseCur);
        totals[e.category] = (totals[e.category] || 0) + amountInBase;
        grandTotal += amountInBase;
    });

    const categoryIcons = {
        Yemek: '🍔 Yemek',
        Konaklama: '🏨 Konaklama',
        Ulaşım: '✈️ Ulaşım',
        Aktivite: '🎟️ Aktivite',
        Alışveriş: '🛍️ Alışveriş',
        Diğer: '📦 Diğer'
    };

    chartEl.innerHTML = Object.keys(totals).map(cat => {
        const catVal = totals[cat];
        const percent = grandTotal > 0 ? (catVal / grandTotal) * 100 : 0;
        
        return `
            <div class="chart-bar-row">
                <div class="chart-bar-label">
                    <span>${categoryIcons[cat] || cat}</span>
                    <span>${catVal.toFixed(2)} ${baseCur} (${percent.toFixed(0)}%)</span>
                </div>
                <div class="chart-bar-bg">
                    <div class="chart-bar-fill ${cat}" style="width: ${percent}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderJournal() {
    const container = document.getElementById('journal-container');
    if (!container) return;

    if (!activeTripId) {
        container.innerHTML = `<div class="text-center text-muted pad-50">Lütfen listelemek için seyahat seçin.</div>`;
        return;
    }

    if (memoriesList.length === 0) {
        container.innerHTML = `
            <div class="card glass text-center" style="padding: 50px;">
                <i data-lucide="camera" style="width: 48px; height: 48px; margin-bottom: 16px; color: var(--text-muted);"></i>
                <h3>Seyahat Anısı Bulunmuyor</h3>
                <p class="text-muted" style="margin-top: 8px;">Uçak biletlerinizi, çektiğiniz fotoğrafları ve o güne dair küçük notlarınızı ekleyin!</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    if (currentGalleryTab === 'photos') {
        // Photos only gallery view
        const photosOnly = memoriesList.filter(m => m.photo_url);
        if (photosOnly.length === 0) {
            container.innerHTML = `<div class="text-center text-muted pad-50">Seyahate kayıtlı fotoğraf bulunmuyor.</div>`;
            return;
        }

        container.className = "journal-container photos-grid";
        container.innerHTML = photosOnly.map(mem => {
            return `
                <div class="photo-grid-item" data-id="${mem.id}">
                    <img src="${mem.photo_url}" alt="${escapeHTML(mem.title)}">
                    <div class="photo-caption-overlay">
                        <strong>${escapeHTML(mem.title)}</strong><br>
                        ${formatDate(mem.date)} - ${escapeHTML(mem.location || '')}
                    </div>
                </div>
            `;
        }).join('');

        // Bind image zoom action if needed (click to view memory detail)
        document.querySelectorAll('.photo-grid-item').forEach(item => {
            item.addEventListener('click', () => {
                const memId = item.getAttribute('data-id');
                const mem = memoriesList.find(m => m.id === memId);
                if (mem) alert(`[${mem.title}] - ${mem.location}\n\n${mem.description}`);
            });
        });

    } else {
        // Journal view (with timeline cards)
        container.className = "journal-container";
        container.innerHTML = memoriesList.map(mem => {
            const hasImage = !!mem.photo_url;
            return `
                <div class="journal-card ${hasImage ? '' : 'no-image'}">
                    <div class="journal-info-col">
                        <div class="journal-meta">
                            <span><i data-lucide="calendar"></i> ${formatDate(mem.date)}</span>
                            ${mem.location ? `<span><i data-lucide="map-pin"></i> ${escapeHTML(mem.location)}</span>` : ''}
                        </div>
                        <h2 class="journal-title">${escapeHTML(mem.title)}</h2>
                        <div class="journal-body">
                            <p>${escapeHTML(mem.description || '').replace(/\n/g, '<br>')}</p>
                        </div>
                        <div class="journal-actions" style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary btn-sm btn-edit-memory" data-id="${mem.id}">
                                <i data-lucide="edit-3" style="width: 14px; height: 14px; color: var(--color-primary);"></i> Düzenle
                            </button>
                            <button class="btn btn-secondary btn-sm btn-delete-memory" data-id="${mem.id}">
                                <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--color-danger);"></i> Sil
                            </button>
                        </div>
                    </div>
                    ${hasImage ? `
                        <div class="journal-image-col">
                            <img src="${mem.photo_url}" class="journal-img" alt="${escapeHTML(mem.title)}" onclick="window.open('${mem.photo_url}', '_blank')">
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        // Bind actions
        document.querySelectorAll('.btn-edit-memory').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const mem = memoriesList.find(m => m.id === id);
                if (mem) {
                    document.getElementById('memory-id').value = mem.id;
                    document.getElementById('memory-trip-id').value = mem.trip_id;
                    document.getElementById('memory-title').value = mem.title;
                    document.getElementById('memory-desc').value = mem.description || '';
                    document.getElementById('memory-location').value = mem.location || '';
                    document.getElementById('memory-date').value = mem.date;
                    
                    const previewImg = document.getElementById('photo-preview');
                    const previewContainer = document.getElementById('photo-preview-container');
                    const photoPlaceholder = document.getElementById('photo-upload-placeholder');
                    
                    if (mem.photo_url) {
                        previewImg.src = mem.photo_url;
                        previewContainer.classList.remove('hidden');
                        photoPlaceholder.classList.add('hidden');
                    } else {
                        previewImg.src = '';
                        previewContainer.classList.add('hidden');
                        photoPlaceholder.classList.remove('hidden');
                    }
                    
                    document.getElementById('memory-modal-title').textContent = 'Anıyı Düzenle';
                    document.getElementById('memory-modal').classList.remove('hidden');
                    
                    // Reset chosen file upload
                    selectedPhotoFile = null;
                    document.getElementById('memory-photo').value = '';
                }
            });
        });

        document.querySelectorAll('.btn-delete-memory').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-id');
                if (confirm('Bu anıyı silmek istediğinizden emin misiniz?')) {
                    await db.deleteMemory(id);
                    showToast('Anı silindi', 'success');
                    await loadJournalData();
                }
            });
        });
    }

    if (window.lucide) window.lucide.createIcons();
}

function loadSettingsForm() {
    const urlInput = document.getElementById('settings-supabase-url');
    const keyInput = document.getElementById('settings-supabase-key');
    const currencySelect = document.getElementById('settings-base-currency');

    if (urlInput) urlInput.value = config.supabaseUrl;
    if (keyInput) keyInput.value = config.supabaseKey;
    if (currencySelect) currencySelect.value = config.defaultCurrency;

    // Highlights active theme button style
    const isDark = config.theme === 'dark';
    document.getElementById('btn-theme-dark').className = isDark ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('btn-theme-light').className = !isDark ? 'btn btn-primary' : 'btn btn-secondary';
}

async function loadAdminData() {
    try {
        const profiles = await db.getAllProfiles();
        renderAdminUsers(profiles);
    } catch (err) {
        showToast('Üye listesi yüklenemedi: ' + err.message, 'danger');
    }
}

function renderAdminUsers(profiles) {
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

        const isSelf = profile.id === activeUser.id;

        return `
            <tr>
                <td>
                    <strong>${escapeHTML(profile.email)}</strong>
                    ${profile.is_admin ? ' <span class="badge badge-lodge" style="font-size:8px; padding:2px 4px;">Yönetici</span>' : ''}
                </td>
                <td>${formatDate(profile.created_at)}</td>
                <td>${statusBadge}</td>
                <td>
                    ${isSelf ? '<span class="text-muted">Aktif Oturum</span>' : `
                        <div style="display:flex; gap:8px;">
                            ${profile.status !== 'approved' ? `
                                <button class="btn btn-secondary btn-sm btn-approve-user" data-id="${profile.id}" style="background-color: var(--color-success-light); color: var(--color-success); padding: 6px 12px;">
                                    <i data-lucide="check" style="width:12px; height:12px; display:inline-block; vertical-align:middle;"></i> Onayla
                                </button>
                            ` : ''}
                            ${profile.status !== 'rejected' ? `
                                <button class="btn btn-secondary btn-sm btn-reject-user" data-id="${profile.id}" style="background-color: var(--color-danger-light); color: var(--color-danger); padding: 6px 12px;">
                                    <i data-lucide="x" style="width:12px; height:12px; display:inline-block; vertical-align:middle;"></i> Reddet
                                </button>
                            ` : ''}
                        </div>
                    `}
                </td>
            </tr>
        `;
    }).join('');

    // Bind click handlers
    document.querySelectorAll('.btn-approve-user').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            try {
                await db.updateProfileStatus(id, 'approved');
                showToast('Kullanıcı onaylandı', 'success');
                await loadAdminData();
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
                await loadAdminData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

/* ==========================================================================
   EVENT LISTENERS AND FORMS HANDLERS
   ========================================================================== */

function initEventHandlers() {
    // 1. Database Credentials Settings Setup
    const setupForm = document.getElementById('setup-form');
    if (setupForm) {
        setupForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const url = document.getElementById('setup-url').value;
            const key = document.getElementById('setup-key').value;
            
            saveConfig(url, key);
            db.initSupabase();

            showToast('Bağlantı ayarları kaydedildi', 'success');
            window.location.hash = '#auth';
        });
    }

    // Settings config update
    const settingsApiForm = document.getElementById('settings-api-form');
    if (settingsApiForm) {
        settingsApiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const url = document.getElementById('settings-supabase-url').value;
            const key = document.getElementById('settings-supabase-key').value;
            saveConfig(url, key);
            db.initSupabase();
            showToast('Bağlantı ayarları güncellendi', 'success');
            window.location.hash = '#dashboard';
        });
    }

    // Settings user preferences save
    const settingsPrefForm = document.getElementById('settings-preferences-form');
    if (settingsPrefForm) {
        settingsPrefForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const currency = document.getElementById('settings-base-currency').value;
            savePreferences(currency, config.theme);
            showToast('Tercihleriniz kaydedildi', 'success');
            renderDashboard();
        });
    }

    // Theme switches
    const themeDark = document.getElementById('btn-theme-dark');
    const themeLight = document.getElementById('btn-theme-light');
    if (themeDark && themeLight) {
        themeDark.addEventListener('click', () => {
            document.body.className = 'dark-theme';
            savePreferences(config.defaultCurrency, 'dark');
            loadSettingsForm();
        });
        themeLight.addEventListener('click', () => {
            document.body.className = 'light-theme';
            savePreferences(config.defaultCurrency, 'light');
            loadSettingsForm();
        });
    }

    // 2. Auth view switching and login handling
    let authMode = 'login'; // 'login' or 'register'
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authForm = document.getElementById('auth-form');
    const submitBtn = document.getElementById('btn-auth-submit');

    if (tabLogin && tabRegister && submitBtn) {
        tabLogin.addEventListener('click', () => {
            authMode = 'login';
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            submitBtn.textContent = 'Giriş Yap';
        });
        tabRegister.addEventListener('click', () => {
            authMode = 'register';
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            submitBtn.textContent = 'Kayıt Ol';
        });
    }

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'İşleniyor...';

            try {
                if (authMode === 'login') {
                    await db.signIn(email, password);
                    showToast('Giriş başarılı!', 'success');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Giriş Yap';
                    window.location.hash = '#dashboard';
                } else {
                    await db.signUp(email, password);
                    
                    // Check if they got automatically logged in (depends on Supabase email confirmation settings)
                    const user = await db.getCurrentUser();
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Giriş Yap'; // Reset button

                    if (user) {
                        showToast('Kayıt ve giriş başarılı!', 'success');
                        window.location.hash = '#dashboard';
                    } else {
                        showToast('Kayıt başarılı! Lütfen giriş yapabilmek için e-postanıza gönderilen onay linkine tıklayın.', 'warning');
                        // Reset form, switch to login tab
                        if (tabLogin) tabLogin.click();
                        authForm.reset();
                    }
                }
            } catch (error) {
                showToast(error.message || 'Yetkilendirme hatası', 'danger');
                submitBtn.disabled = false;
                submitBtn.textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';
            }
        });
    }


    // Logout button click
    const logoutBtn = document.getElementById('btn-logout');
    const pendingLogoutBtn = document.getElementById('btn-pending-logout');
    
    const handleLogout = async () => {
        await db.signOut();
        showToast('Çıkış yapıldı', 'info');
        window.location.hash = '#auth';
    };

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (pendingLogoutBtn) pendingLogoutBtn.addEventListener('click', handleLogout);

    // 3. Trip Selectors filter listeners
    const dashTripSelector = document.getElementById('dash-trip-selector');
    if (dashTripSelector) {
        dashTripSelector.addEventListener('change', async (e) => {
            activeTripId = e.target.value;
            await loadDashboardData();
        });
    }

    const expenseTripFilter = document.getElementById('expense-trip-filter');
    if (expenseTripFilter) {
        expenseTripFilter.addEventListener('change', async (e) => {
            activeTripId = e.target.value;
            await loadExpensesData();
        });
    }

    const journalTripFilter = document.getElementById('journal-trip-filter');
    if (journalTripFilter) {
        journalTripFilter.addEventListener('change', async (e) => {
            activeTripId = e.target.value;
            await loadJournalData();
        });
    }

    // 4. Modal Triggers
    setupModal('btn-add-trip', 'trip-modal', 'btn-close-trip-modal');
    setupModal('btn-add-expense', 'expense-modal', 'btn-close-expense-modal');
    setupModal('btn-add-memory', 'memory-modal', 'btn-close-memory-modal');

    // 5. Trip Form Submission
    const tripForm = document.getElementById('trip-form');
    if (tripForm) {
        tripForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tripId = document.getElementById('trip-id').value;
            const name = document.getElementById('trip-name').value;
            const start = document.getElementById('trip-start').value;
            const end = document.getElementById('trip-end').value;
            const budget = document.getElementById('trip-budget').value;
            const currency = document.getElementById('trip-currency').value;

            try {
                if (tripId) {
                    await db.updateTrip(tripId, { name, start_date: start, end_date: end, budget, currency });
                    showToast(`Seyahat güncellendi: ${name}`, 'success');
                } else {
                    const newTrip = await db.createTrip({ name, start_date: start, end_date: end, budget, currency });
                    showToast(`Seyahat oluşturuldu: ${newTrip.name}`, 'success');
                    activeTripId = newTrip.id;
                }
                
                // Hide modal and reset
                document.getElementById('trip-modal').classList.add('hidden');
                tripForm.reset();
                document.getElementById('trip-id').value = '';
                
                await loadTripsData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    }

    // 6. Expense Form Submission
    const expenseForm = document.getElementById('expense-form');
    if (expenseForm) {
        expenseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const expenseId = document.getElementById('expense-id').value;
            const tripId = document.getElementById('expense-trip-id').value;
            const title = document.getElementById('expense-title').value;
            const amount = document.getElementById('expense-amount').value;
            const currency = document.getElementById('expense-currency').value;
            const category = document.getElementById('expense-category').value;
            const date = document.getElementById('expense-date').value;

            try {
                if (expenseId) {
                    await db.updateExpense(expenseId, { trip_id: tripId, title, amount, currency, category, date });
                    showToast('Harcama güncellendi', 'success');
                } else {
                    await db.createExpense({ trip_id: tripId, title, amount, currency, category, date });
                    showToast('Harcama kaydedildi', 'success');
                }
                
                document.getElementById('expense-modal').classList.add('hidden');
                expenseForm.reset();
                document.getElementById('expense-id').value = '';
                
                activeTripId = tripId;
                await loadExpensesData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    }

    // 7. Memory Form Submission (with file upload previews)
    const memoryForm = document.getElementById('memory-form');
    const fileInput = document.getElementById('memory-photo');
    const photoPlaceholder = document.getElementById('photo-upload-placeholder');
    const previewContainer = document.getElementById('photo-preview-container');
    const previewImg = document.getElementById('photo-preview');
    const removePhotoBtn = document.getElementById('btn-remove-photo');

    if (fileInput && photoPlaceholder && previewContainer && previewImg) {
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                selectedPhotoFile = file;
                const reader = new FileReader();
                reader.onload = (event) => {
                    previewImg.src = event.target.result;
                    previewContainer.classList.remove('hidden');
                    photoPlaceholder.classList.add('hidden');
                    
                    // Programmatically scroll the modal content and wrapper to bottom so the save button is visible
                    setTimeout(() => {
                        const modalContent = document.querySelector('#memory-modal .modal-content');
                        if (modalContent) {
                            modalContent.scrollTop = modalContent.scrollHeight;
                        }
                        const modalContainer = document.getElementById('memory-modal');
                        if (modalContainer) {
                            modalContainer.scrollTop = modalContainer.scrollHeight;
                        }
                    }, 100);
                };
                reader.readAsDataURL(file);
            }
        });

        removePhotoBtn.addEventListener('click', () => {
            selectedPhotoFile = null;
            fileInput.value = '';
            previewImg.src = '';
            previewContainer.classList.add('hidden');
            photoPlaceholder.classList.remove('hidden');
        });
    }

    if (memoryForm) {
        memoryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const memoryId = document.getElementById('memory-id').value;
            const tripId = document.getElementById('memory-trip-id').value;
            const title = document.getElementById('memory-title').value;
            const description = document.getElementById('memory-desc').value;
            const location = document.getElementById('memory-location').value;
            const date = document.getElementById('memory-date').value;

            const submitBtn = memoryForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Kaydediliyor...';

            const progressBarContainer = document.getElementById('upload-progress-container');
            const progressBar = document.getElementById('upload-progress-bar');
            const progressText = document.getElementById('upload-progress-text');

            const hasExistingPhoto = !previewContainer.classList.contains('hidden') && previewImg.src.startsWith('http');
            const existingPhotoUrl = hasExistingPhoto ? previewImg.src : null;

            if (selectedPhotoFile && progressBarContainer && progressBar && progressText) {
                progressBarContainer.classList.remove('hidden');
                
                // Mock custom upload progression rate visually
                let progress = 0;
                const progressInterval = setInterval(() => {
                    if (progress < 90) {
                        progress += 10;
                        progressBar.style.width = `${progress}%`;
                        progressText.textContent = `Fotoğraf yükleniyor... %${progress}`;
                    }
                }, 100);

                try {
                    if (memoryId) {
                        await db.updateMemory(memoryId, { trip_id: tripId, title, description, location, date, photo_url: null }, selectedPhotoFile);
                    } else {
                        await db.createMemory({ trip_id: tripId, title, description, location, date }, selectedPhotoFile);
                    }
                    clearInterval(progressInterval);
                    
                    progressBar.style.width = '100%';
                    progressText.textContent = 'Fotoğraf başarıyla yüklendi! %100';
                    
                    setTimeout(() => {
                        showToast(memoryId ? 'Seyahat anısı güncellendi!' : 'Seyahat anısı ve fotoğraf başarıyla kaydedildi!', 'success');
                        closeModal();
                    }, 500);

                } catch (err) {
                    clearInterval(progressInterval);
                    showToast('Yükleme hatası: ' + err.message, 'danger');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Kaydet';
                }
            } else {
                // Text only or keeping existing photo memory saving
                try {
                    if (memoryId) {
                        await db.updateMemory(memoryId, { trip_id: tripId, title, description, location, date, photo_url: existingPhotoUrl }, null);
                        showToast('Seyahat anısı güncellendi!', 'success');
                    } else {
                        await db.createMemory({ trip_id: tripId, title, description, location, date }, null);
                        showToast('Seyahat anısı başarıyla kaydedildi!', 'success');
                    }
                    closeModal();
                } catch (err) {
                    showToast('Hata oluştu: ' + err.message, 'danger');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Kaydet';
                }
            }

            async function closeModal() {
                if (progressBarContainer) {
                    progressBarContainer.classList.add('hidden');
                    progressBar.style.width = '0%';
                }
                
                document.getElementById('memory-modal').classList.add('hidden');
                memoryForm.reset();
                document.getElementById('memory-id').value = '';
                
                selectedPhotoFile = null;
                previewContainer.classList.add('hidden');
                photoPlaceholder.classList.remove('hidden');
                
                submitBtn.disabled = false;
                submitBtn.textContent = 'Kaydet';
                
                activeTripId = tripId;
                await loadJournalData();
            }
        });
    }

    // Category filter in expenses list table
    const categoryFilter = document.getElementById('expense-category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => {
            renderExpenses();
        });
    }

    // Gallery tab filters toggles
    const tabAll = document.getElementById('tab-all-memories');
    const tabPhotos = document.getElementById('tab-only-photos');
    if (tabAll && tabPhotos) {
        tabAll.addEventListener('click', () => {
            currentGalleryTab = 'all';
            tabAll.classList.add('active');
            tabPhotos.classList.remove('active');
            renderJournal();
        });
        tabPhotos.addEventListener('click', () => {
            currentGalleryTab = 'photos';
            tabPhotos.classList.add('active');
            tabAll.classList.remove('active');
            renderJournal();
        });
    }

    // 8. Exchange rates live converter calculator interactions
    const convAmountInput = document.getElementById('conv-amount');
    const convFromSelect = document.getElementById('conv-from');
    const convToSelect = document.getElementById('conv-to');
    const convSwapBtn = document.getElementById('btn-conv-swap');

    if (convAmountInput && convFromSelect && convToSelect && convSwapBtn) {
        convAmountInput.addEventListener('input', updateConverterResult);
        convFromSelect.addEventListener('change', updateConverterResult);
        convToSelect.addEventListener('change', updateConverterResult);
        
        convSwapBtn.addEventListener('click', () => {
            const temp = convFromSelect.value;
            convFromSelect.value = convToSelect.value;
            convToSelect.value = temp;
            updateConverterResult();
        });
    }

    // 9. Manual queue sync trigger button click
    const syncBtn = document.getElementById('btn-sync-now');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            syncBtn.textContent = 'Eşitleniyor...';
            
            const result = await db.syncOfflineQueue((msg) => {
                showToast(msg, 'info');
            });

            if (result.success) {
                showToast(`Eşitleme başarılı! ${result.count} değişiklik yüklendi.`, 'success');
            } else {
                if (result.reason === 'offline') {
                    showToast('Eşitleme başarısız: Cihaz çevrimdışı.', 'warning');
                } else if (result.reason === 'unauthorized') {
                    showToast('Eşitleme başarısız: Giriş yapmadınız veya oturumunuz süresi dolmuş. Lütfen önce giriş yapın.', 'warning');
                } else {
                    const errMsg = result.error && result.error.message ? `: ${result.error.message}` : '';
                    showToast(`Eşitleme sırasında hata oluştu${errMsg}`, 'danger');
                }
            }
            
            syncBtn.disabled = false;
            syncBtn.textContent = 'Şimdi Eşitle';
            await loadDashboardData();
        });
    }

    // 10. Copy SQL Schema code button helper
    const copySqlBtn = document.getElementById('btn-copy-sql');
    if (copySqlBtn) {
        copySqlBtn.addEventListener('click', () => {
            const codeBlock = document.getElementById('sql-code-block');
            if (codeBlock) {
                navigator.clipboard.writeText(codeBlock.textContent.trim());
                showToast('SQL şeması panoya kopyalandı', 'success');
            }
        });
    }

    // Bind custom sync success reloader event
    window.addEventListener('sync-completed', async () => {
        showToast('Bulut verileri otomatik olarak güncellendi.', 'success');
        // Reload all data arrays locally to update views
        const currentHash = window.location.hash;
        if (currentHash === '#dashboard') await loadDashboardData();
        else if (currentHash === '#trips') await loadTripsData();
        else if (currentHash === '#expenses') await loadExpensesData();
        else if (currentHash === '#journal') await loadJournalData();
    });

    // Update queue notifications count badge
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
}

// Helper method to setup show/hide handlers on custom modals
function setupModal(triggerId, modalId, closeId) {
    const trigger = document.getElementById(triggerId);
    const modal = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeId);

    if (trigger && modal && closeBtn) {
        trigger.addEventListener('click', () => {
            modal.classList.remove('hidden');
            
            // Reset form on addition trigger
            const form = modal.querySelector('form');
            if (form) {
                form.reset();
                const idInput = form.querySelector('input[type="hidden"]');
                if (idInput) idInput.value = '';
            }

            // Reset modal title
            const titleEl = modal.querySelector('h2');
            if (titleEl) {
                if (modalId === 'trip-modal') titleEl.textContent = 'Yeni Seyahat Ekle';
                else if (modalId === 'expense-modal') titleEl.textContent = 'Yeni Masraf Ekle';
                else if (modalId === 'memory-modal') titleEl.textContent = 'Yeni Anı Kaydet';
            }

            // Memory specific reset
            if (modalId === 'memory-modal') {
                const previewImg = document.getElementById('photo-preview');
                const previewContainer = document.getElementById('photo-preview-container');
                const photoPlaceholder = document.getElementById('photo-upload-placeholder');
                if (previewImg && previewContainer && photoPlaceholder) {
                    previewImg.src = '';
                    previewContainer.classList.add('hidden');
                    photoPlaceholder.classList.remove('hidden');
                }
                selectedPhotoFile = null;
            }

            // Auto prefill current date for forms
            const dateInput = modal.querySelector('input[type="date"]');
            if (dateInput) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }

            // Pre-select active trip if available
            if (modalId === 'expense-modal' && activeTripId) {
                const select = document.getElementById('expense-trip-id');
                if (select) select.value = activeTripId;
            }
            if (modalId === 'memory-modal' && activeTripId) {
                const select = document.getElementById('memory-trip-id');
                if (select) select.value = activeTripId;
            }
        });

        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        // Close on backing shadow click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    }
}

function updateConverterResult() {
    const amountInput = document.getElementById('conv-amount');
    const resultDiv = document.getElementById('exchange-result');
    const fromSelect = document.getElementById('conv-from');
    const toSelect = document.getElementById('conv-to');

    if (!amountInput || !resultDiv || !fromSelect || !toSelect) return;

    const amount = parseFloat(amountInput.value) || 0;
    const from = fromSelect.value;
    const to = toSelect.value;

    const converted = convertCurrency(amount, from, to);
    resultDiv.textContent = `${amount.toFixed(2)} ${from} = ${converted.toFixed(2)} ${to}`;
}

/* ==========================================================================
   STRING HELPERS AND DATE UTILITIES
   ========================================================================== */

function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('tr-TR', options);
    } catch {
        return dateString;
    }
}

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function getCategoryBadgeClass(category) {
    switch (category) {
        case 'Yemek': return 'badge-food';
        case 'Konaklama': return 'badge-lodge';
        case 'Ulaşım': return 'badge-transport';
        case 'Aktivite': return 'badge-activity';
        case 'Alışveriş': return 'badge-shopping';
        default: return 'badge-other';
    }
}

/* ==========================================================================
   INITIALIZATION TRIGGER
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
    // Set active theme class on load
    document.body.className = config.theme === 'light' ? 'light-theme' : 'dark-theme';

    initNavigation();
    initEventHandlers();
    
    // Initial fetches
    fetchExchangeRates();
});
