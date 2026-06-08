// js/modules/dashboard.js

import { state } from '../state.js';
import { config } from '../../config.js';
import * as db from '../../db.js';
import { convertCurrency } from '../utils.js';

export async function loadDashboardData() {
    state.tripsList = await db.getTrips();
    state.expensesList = await db.getExpenses();
    state.memoriesList = await db.getMemories();

    if (!state.activeTripId && state.tripsList.length > 0) {
        state.activeTripId = state.tripsList[0].id;
    }

    const selector = document.getElementById('dash-trip-selector');
    if (selector) {
        selector.innerHTML = '<option value="">Seyahat Seçin...</option>' + 
            state.tripsList.map(t => `<option value="${t.id}" ${t.id === state.activeTripId ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('');
    }

    renderDashboard();
}

export function renderDashboard() {
    const userEmailEl = document.getElementById('user-email');
    if (userEmailEl && state.activeUser) {
        userEmailEl.textContent = state.activeUser.email;
        const avatarEl = document.getElementById('user-avatar');
        if (avatarEl) avatarEl.textContent = state.activeUser.email[0].toUpperCase();
    }

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
            icon.setAttribute('class', `sync-icon ${onlineStatus ? 'online' : 'offline'}`);
            icon.setAttribute('data-lucide', onlineStatus ? 'cloud' : 'cloud-lightning');
        }
    }

    const queueCard = document.getElementById('offline-queue-card');
    const queueText = document.getElementById('queue-status-text');
    const syncBtn = document.getElementById('btn-sync-now');
    const pendingCount = db.getPendingQueueCount();

    if (queueCard && queueText && syncBtn) {
        if (pendingCount > 0) {
            queueText.innerHTML = `Eşitlenmeyi bekleyen <strong>${pendingCount}</strong> değişiklik var.`;
            syncBtn.classList.remove('hidden');
            if (onlineStatus) {
                queueText.style.color = 'var(--color-warning)';
            }
        } else {
            queueText.textContent = "Verileriniz güncel ve bulutla eşitlenmiş.";
            syncBtn.classList.add('hidden');
            queueText.style.color = '';
        }
    }

    const baseCur = config.defaultCurrency;
    let globalTotalExpense = 0;
    state.expensesList.forEach(e => {
        globalTotalExpense += convertCurrency(e.amount, e.currency, baseCur);
    });

    const globalMemoriesCount = state.memoriesList.length;
    const globalPhotosCount = state.memoriesList.filter(m => m.photo_url).length;

    let activeTripExpenseInBase = 0;
    let activeTrip = null;

    if (state.activeTripId) {
        activeTrip = state.tripsList.find(t => t.id === state.activeTripId);
    }
    
    if (!activeTrip && state.tripsList.length > 0) {
        activeTrip = state.tripsList[0];
        state.activeTripId = activeTrip.id;
        const selector = document.getElementById('dash-trip-selector');
        if (selector) selector.value = state.activeTripId;
    }

    if (activeTrip) {
        const tripExpenses = state.expensesList.filter(e => e.trip_id === activeTrip.id);
        
        tripExpenses.forEach(e => {
            activeTripExpenseInBase += convertCurrency(e.amount, e.currency, baseCur);
        });

        document.getElementById('dash-active-trip').textContent = activeTrip.name;
        document.getElementById('dash-trip-dates').textContent = `${formatDate(activeTrip.start_date)} - ${formatDate(activeTrip.end_date)}`;
        
        const budgetLimit = activeTrip.budget;
        const limitInBase = convertCurrency(budgetLimit, activeTrip.currency, baseCur);
        const percent = limitInBase > 0 ? Math.min((activeTripExpenseInBase / limitInBase) * 100, 100) : 0;
        
        const textProgress = document.getElementById('dash-budget-progress-text');
        const barProgress = document.getElementById('dash-budget-progress-bar');
        
        if (textProgress && barProgress) {
            textProgress.textContent = `${activeTripExpenseInBase.toFixed(2)} / ${limitInBase.toFixed(2)} ${baseCur}`;
            barProgress.style.width = `${percent}%`;
            
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

    document.getElementById('dash-total-expense').textContent = `${globalTotalExpense.toFixed(2)} ${baseCur}`;
    
    const expenseSubEl = document.getElementById('dash-expense-converted');
    if (expenseSubEl) {
        expenseSubEl.textContent = "Tüm rotaların genel toplamı";
    }

    document.getElementById('dash-memories-count').textContent = `${globalMemoriesCount} Anı`;
    document.getElementById('dash-photos-count').textContent = `${globalPhotosCount} Fotoğraf yüklendi`;

    if (window.lucide) window.lucide.createIcons();
    
    // Dispatch event to app.js for updates
    window.dispatchEvent(new CustomEvent('diagnostics-update-needed'));
}

export function initDashboardEvents() {
    const dashTripSelector = document.getElementById('dash-trip-selector');
    if (dashTripSelector) {
        dashTripSelector.addEventListener('change', async (e) => {
            state.activeTripId = e.target.value;
            await loadDashboardData();
        });
    }

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

    const syncBtn = document.getElementById('btn-sync-now');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            syncBtn.textContent = 'Eşitleniyor...';
            
            const result = await db.syncOfflineQueue((msg) => {
                // Call global listener or toast
                window.dispatchEvent(new CustomEvent('show-toast-needed', { detail: { message: msg, type: 'info' } }));
            });

            if (result.success) {
                window.dispatchEvent(new CustomEvent('show-toast-needed', { detail: { message: `Eşitleme başarılı! ${result.count} değişiklik yüklendi.`, type: 'success' } }));
            } else {
                if (result.reason === 'offline') {
                    window.dispatchEvent(new CustomEvent('show-toast-needed', { detail: { message: 'Eşitleme başarısız: Cihaz çevrimdışı.', type: 'warning' } }));
                } else if (result.reason === 'unauthorized') {
                    window.dispatchEvent(new CustomEvent('show-toast-needed', { detail: { message: 'Eşitleme başarısız: Giriş yapmadınız veya oturumunuz süresi dolmuş. Lütfen önce giriş yapın.', type: 'warning' } }));
                } else {
                    const errMsg = result.error && result.error.message ? `: ${result.error.message}` : '';
                    window.dispatchEvent(new CustomEvent('show-toast-needed', { detail: { message: `Eşitleme sırasında hata oluştu${errMsg}`, type: 'danger' } }));
                }
            }
            
            syncBtn.disabled = false;
            syncBtn.textContent = 'Şimdi Eşitle';
            await loadDashboardData();
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

// Helpers
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
