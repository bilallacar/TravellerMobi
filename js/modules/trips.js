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
                     Aktif Rota Yap
                </button>
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
