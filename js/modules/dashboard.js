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

    if (state.activeTripId) {
        state.placesList = await db.getPlaces(state.activeTripId);
    } else {
        state.placesList = [];
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

    // Render Places / Route Preview on Dashboard
    const placesSummaryEl = document.getElementById('dash-places-summary');
    if (placesSummaryEl) {
        if (!activeTrip || state.placesList.length === 0) {
            placesSummaryEl.innerHTML = `
                <div class="dash-empty-places" style="padding:20px; text-align:center; background:rgba(255,255,255,0.02); border-radius:10px; border:1px dashed var(--border-color);">
                    <p class="text-muted" style="margin:0 0 10px 0; font-size:13px;">Bu seyahat için henüz gezilecek yer veya otel eklenmedi.</p>
                    <a href="#places" class="btn btn-secondary btn-sm">+ Haritaya Yer Ekle</a>
                </div>
            `;
        } else {
            const hotel = state.placesList.find(p => p.category === 'hotel');
            const plannedPlaces = state.placesList.filter(p => p.status === 'planned');
            const visitedCount = state.placesList.filter(p => p.status === 'visited').length;

            const placesToShow = plannedPlaces.slice(0, 3);
            
            let html = '';
            if (hotel) {
                html += `
                    <div class="dash-place-mini-item hotel-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.3); border-radius:10px; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:10px;">
                            <span style="font-size:18px;">🏨</span>
                            <div>
                                <strong style="font-size:14px; color:var(--text-primary);">${escapeHTML(hotel.name)}</strong>
                                <span class="text-xs text-muted" style="display:block;">${escapeHTML(hotel.address || 'Ana Konaklama')}</span>
                            </div>
                        </div>
                        <a href="https://www.google.com/maps/dir/?api=1&destination=${hotel.latitude},${hotel.longitude}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="padding:6px 10px; font-size:11px;">
                            🗺️ Yol Tarifi
                        </a>
                    </div>
                `;
            }

            if (placesToShow.length === 0 && hotel) {
                html += `<p class="text-sm text-muted" style="margin-top:6px;">Tüm gezi noktaları ziyaret edilmiş! (${visitedCount} yer gezildi)</p>`;
            } else if (placesToShow.length === 0) {
                html += `<p class="text-sm text-muted" style="margin-top:6px;">Tüm yerler tamamlandı! (${visitedCount} yer gezildi)</p>`;
            } else {
                placesToShow.forEach(p => {
                    const dirUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`;
                    html += `
                        <div class="dash-place-mini-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:10px; margin-bottom:8px;">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="font-size:16px;">🟢</span>
                                <div>
                                    <strong style="font-size:13px; color:var(--text-primary);">${escapeHTML(p.name)}</strong>
                                    <span class="text-xs text-muted" style="display:block;">${escapeHTML(p.address || p.category)}</span>
                                </div>
                            </div>
                            <div style="display:flex; gap:6px;">
                                <a href="${dirUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:11px;" title="Google Maps">
                                    <i data-lucide="navigation"></i>
                                </a>
                                <button type="button" class="btn btn-secondary btn-sm btn-dash-toggle-place" data-id="${p.id}" style="padding:4px 8px; font-size:11px;" title="Gezildi Yap">
                                    ✓
                                </button>
                            </div>
                        </div>
                    `;
                });
            }

            placesSummaryEl.innerHTML = html;

            placesSummaryEl.querySelectorAll('.btn-dash-toggle-place').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pid = btn.dataset.id;
                    await db.updatePlaceStatus(pid, 'visited');
                    await loadDashboardData();
                });
            });
        }
    }

    // Render Recent Expenses Preview
    const recentExpEl = document.getElementById('dash-recent-expenses');
    if (recentExpEl) {
        const tripExpenses = activeTrip ? state.expensesList.filter(e => e.trip_id === activeTrip.id) : state.expensesList;
        const recent3 = tripExpenses.slice(0, 3);
        if (recent3.length === 0) {
            recentExpEl.innerHTML = `<p class="text-muted text-sm" style="padding:10px 0;">Henüz masraf kaydı bulunmuyor.</p>`;
        } else {
            recentExpEl.innerHTML = recent3.map(exp => {
                const cat = state.categoriesList.find(c => c.id === exp.category_id);
                const catName = cat ? cat.name : (exp.category || 'Diğer');
                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                        <div>
                            <strong style="font-size:13px; color:var(--text-primary);">${escapeHTML(exp.title)}</strong>
                            <span class="text-xs text-muted" style="display:block;">${formatDate(exp.date)} • ${escapeHTML(catName)}</span>
                        </div>
                        <span style="font-size:14px; font-weight:700; color:var(--text-primary);">
                            ${exp.amount.toFixed(2)} ${exp.currency}
                        </span>
                    </div>
                `;
            }).join('');
        }
    }

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
