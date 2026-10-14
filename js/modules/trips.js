// js/modules/trips.js

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast } from '../utils.js';

export async function loadTripsData() {
    state.tripsList = await db.getTrips();
    renderTrips();
}

export function renderTrips() {
    const listEl = document.getElementById('trips-list');
    if (!listEl) return;

    if (state.tripsList.length === 0) {
        listEl.innerHTML = `
            <div class="card glass text-center" style="grid-column: 1/-1; padding: 40px 16px;">
                <i data-lucide="compass" style="width: 48px; height: 48px; margin-bottom: 16px; color: var(--text-muted);"></i>
                <h3>Henüz Kayıtlı Seyahat Yok</h3>
                <p class="text-muted" style="margin-top: 8px;">İlk rotanızı oluşturarak seyahat planlamanıza ve masraf takibinize başlayın!</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    listEl.innerHTML = state.tripsList.map(trip => {
        const isActive = state.activeTripId === trip.id;
        const coverImg = getTripCoverImage(trip.name);
        
        // Calculate spent amount for this trip
        const tripExpenses = (state.expensesList || []).filter(e => e.trip_id === trip.id);
        let totalSpent = 0;
        tripExpenses.forEach(e => {
            totalSpent += Number(e.amount) || 0;
        });
        const percent = trip.budget > 0 ? Math.min((totalSpent / trip.budget) * 100, 100) : 0;
        const isOverBudget = trip.budget > 0 && totalSpent > trip.budget;
        const progressColor = isOverBudget ? 'var(--color-danger)' : (percent > 80 ? 'var(--color-warning)' : 'var(--color-success)');

        return `
            <div class="trip-card ${isActive ? 'active-trip-card' : ''}">
                <div class="trip-card-glow"></div>
                <div class="trip-cover-banner" style="background-image: url('${coverImg}');">
                    <div class="trip-cover-overlay"></div>
                    <div class="trip-cover-header">
                        ${isActive ? '<span class="trip-badge-active"><span class="pulse-indicator online"></span> Aktif Rota</span>' : '<span></span>'}
                        <div class="trip-actions" style="position:relative; z-index:2;">
                            <button class="btn-icon-sm btn-edit-trip" data-id="${trip.id}" title="Seyahati Düzenle" style="background:rgba(0,0,0,0.5); border-color:rgba(255,255,255,0.2);">
                                <i data-lucide="edit-3" style="width: 14px; height: 14px; color: #fff;"></i>
                            </button>
                            <button class="btn-icon-sm btn-delete-trip" data-id="${trip.id}" title="Seyahati Sil" style="background:rgba(0,0,0,0.5); border-color:rgba(255,255,255,0.2);">
                                <i data-lucide="trash-2" style="width: 14px; height: 14px; color: var(--color-danger);"></i>
                            </button>
                        </div>
                    </div>
                    <div class="trip-cover-title-row">
                        <span class="trip-title">${escapeHTML(trip.name)}</span>
                        <div class="trip-dates text-xs" style="color:rgba(255,255,255,0.85);">
                            <i data-lucide="calendar" style="width: 12px; height: 12px; display:inline; margin-right:4px;"></i>
                            ${formatDate(trip.start_date)} - ${formatDate(trip.end_date)}
                        </div>
                    </div>
                </div>

                <div class="trip-card-content" style="padding: 16px;">
                    <!-- Budget Progress Bar -->
                    <div class="trip-progress-container" style="margin-bottom: 14px;">
                        <div class="trip-progress-labels" style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
                            <span>Harcanan: <strong>${totalSpent.toFixed(2)} ${trip.currency}</strong></span>
                            <span>Bütçe: <strong>${trip.budget.toFixed(2)} ${trip.currency}</strong></span>
                        </div>
                        <div class="progress-bar-bg" style="height: 6px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden;">
                            <div class="progress-bar-fill" style="width: ${percent}%; height:100%; background: ${progressColor}; border-radius: 4px; transition: width 0.3s ease;"></div>
                        </div>
                        <div style="text-align:right; font-size:11px; margin-top:4px; color:var(--text-muted);">
                            %${percent.toFixed(0)} kullanıldı ${isOverBudget ? '⚠️ (Bütçe Aşıldı)' : ''}
                        </div>
                    </div>

                    ${isActive ? `
                        <div class="trip-active-status-bar" style="display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.25); border-radius:8px; font-size:12px; color:var(--color-success);">
                            <span>🟢 Bu rota şu anda aktif</span>
                            <a href="#places" style="color:var(--color-success); font-weight:600; text-decoration:none;">Haritaya Git ➔</a>
                        </div>
                    ` : `
                        <button class="btn btn-secondary btn-sm btn-block btn-select-trip" data-id="${trip.id}">
                            Bu Rotayı Aktif Yap
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');

    // Bind event handlers
    document.querySelectorAll('.btn-edit-trip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const trip = state.tripsList.find(t => t.id === id);
            if (trip) {
                document.getElementById('trip-id').value = trip.id;
                document.getElementById('trip-name').value = trip.name;
                document.getElementById('trip-start').value = trip.start_date;
                document.getElementById('trip-end').value = trip.end_date;
                document.getElementById('trip-budget').value = trip.budget;
                document.getElementById('trip-currency').value = trip.currency;
                state.tempTripParticipants = (trip.participants && Array.isArray(trip.participants)) ? [...trip.participants] : [];
                renderParticipantTags();
                
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
                try {
                    await db.deleteTrip(id);
                    showToast('Seyahat silindi', 'success');
                    if (state.activeTripId === id) state.activeTripId = null;
                    await loadTripsData();
                } catch (err) {
                    showToast('Silme hatası: ' + err.message, 'danger');
                }
            }
        });
    });

    document.querySelectorAll('.btn-select-trip').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = btn.getAttribute('data-id');
            state.activeTripId = id;
            showToast('Aktif seyahat güncellendi', 'success');
            window.location.hash = '#dashboard';
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

export function renderParticipantTags() {
    const container = document.getElementById('trip-participants-tags');
    if (!container) return;
    
    if (state.tempTripParticipants.length === 0) {
        container.innerHTML = '<span class="text-sm text-muted">Henüz katılımcı eklenmedi.</span>';
        return;
    }
    
    container.innerHTML = state.tempTripParticipants.map((p, index) => `
        <span class="badge" style="display:inline-flex; align-items:center; gap:8px; padding:6px 12px; font-size:13px; font-weight:600; border-radius:20px; background-color: var(--color-primary-light); color: var(--color-primary); border: 1px solid rgba(99, 102, 241, 0.25);">
            ${escapeHTML(p)}
            <button type="button" class="btn-remove-tag" data-index="${index}" style="background:none; border:none; color:var(--color-danger); font-size:16px; font-weight:bold; cursor:pointer; padding:0; line-height:1; vertical-align:middle;">&times;</button>
        </span>
    `).join('');
    
    // Bind remove button events
    container.querySelectorAll('.btn-remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const idx = parseInt(btn.getAttribute('data-index'));
            state.tempTripParticipants.splice(idx, 1);
            renderParticipantTags();
        });
    });
}

export function initTripsEvents() {
    const addParticipantBtn = document.getElementById('btn-add-participant');
    const participantInput = document.getElementById('trip-participant-input');
    
    const addParticipantToList = () => {
        if (!participantInput) return;
        const name = participantInput.value.trim();
        if (name && !state.tempTripParticipants.includes(name)) {
            state.tempTripParticipants.push(name);
            participantInput.value = '';
            renderParticipantTags();
        }
    };

    if (addParticipantBtn) {
        addParticipantBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addParticipantToList();
        });
    }

    if (participantInput) {
        participantInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addParticipantToList();
            }
        });
    }

    const tripForm = document.getElementById('trip-form');
    if (tripForm) {
        tripForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tripId = document.getElementById('trip-id').value;
            const name = document.getElementById('trip-name').value;
            const start = document.getElementById('trip-start').value;
            const end = document.getElementById('trip-end').value;
            const budget = parseFloat(document.getElementById('trip-budget').value) || 0;
            const currency = document.getElementById('trip-currency').value;
            const participants = [...state.tempTripParticipants];

            try {
                if (tripId) {
                    await db.updateTrip(tripId, { name, start_date: start, end_date: end, budget, currency, participants });
                    showToast(`Seyahat güncellendi: ${name}`, 'success');
                } else {
                    const newTrip = await db.createTrip({ name, start_date: start, end_date: end, budget, currency, participants });
                    showToast(`Seyahat oluşturuldu: ${newTrip.name}`, 'success');
                    state.activeTripId = newTrip.id;
                }
                
                document.getElementById('trip-modal').classList.add('hidden');
                tripForm.reset();
                document.getElementById('trip-id').value = '';
                
                await loadTripsData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    }
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

function getTripCoverImage(tripName) {
    const lower = (tripName || '').toLowerCase();
    if (lower.includes('atina') || lower.includes('athens') || lower.includes('yunan')) {
        return 'https://images.unsplash.com/photo-1548013146-72479768bada?auto=format&fit=crop&w=600&q=80';
    } else if (lower.includes('prag') || lower.includes('prague')) {
        return 'https://images.unsplash.com/photo-1541849546-216549ae216d?auto=format&fit=crop&w=600&q=80';
    } else if (lower.includes('roma') || lower.includes('rome') || lower.includes('italy')) {
        return 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?auto=format&fit=crop&w=600&q=80';
    } else if (lower.includes('paris') || lower.includes('fransa')) {
        return 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=600&q=80';
    } else if (lower.includes('tokyo') || lower.includes('japon')) {
        return 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=600&q=80';
    } else if (lower.includes('london') || lower.includes('londra')) {
        return 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=600&q=80';
    } else if (lower.includes('istanbul')) {
        return 'https://images.unsplash.com/photo-1527838832700-5059252407fa?auto=format&fit=crop&w=600&q=80';
    } else {
        return 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=600&q=80';
    }
}
