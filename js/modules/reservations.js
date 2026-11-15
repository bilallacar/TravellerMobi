// js/modules/reservations.js - Trip Flights, Hotels, Tickets & Offline PNR Cards

import { state } from '../state.js';
import { config } from '../../config.js';
import * as db from '../../db.js';
import { escapeHtml, showToast } from '../utils.js';

export const RESERVATION_TYPES = {
    flight: { name: 'Uçuş', icon: 'plane', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.14)' },
    hotel: { name: 'Konaklama', icon: 'bed-double', color: '#818cf8', bg: 'rgba(129, 140, 248, 0.14)' },
    ticket: { name: 'Bilet & Müze', icon: 'ticket', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)' },
    transport: { name: 'Transfer & Tren', icon: 'train-front', color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)' },
    other: { name: 'Diğer', icon: 'bookmark', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.14)' }
};

const MONTH_MAP = {
    oca: '01', ocak: '01', jan: '01', january: '01',
    sub: '02', 'şub': '02', subat: '02', 'şubat': '02', feb: '02', february: '02',
    mar: '03', mart: '03', march: '03',
    nis: '04', nisan: '04', apr: '04', april: '04',
    may: '05', mayis: '05', 'mayıs': '05',
    haz: '06', haziran: '06', jun: '06', june: '06',
    tem: '07', temmuz: '07', jul: '07', july: '07',
    agu: '08', 'ağu': '08', agustos: '08', 'ağustos': '08', aug: '08', august: '08',
    eyl: '09', eylul: '09', 'eylül': '09', sep: '09', september: '09',
    eki: '10', ekim: '10', oct: '10', october: '10',
    kas: '11', kasim: '11', 'kasım': '11', nov: '11', november: '11',
    ara: '12', aralik: '12', 'aralık': '12', dec: '12', december: '12'
};

function formatDateTimeShort(isoOrLocal) {
    if (!isoOrLocal) return '';
    const str = String(isoOrLocal).trim();
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}))?/);
    if (!match) return str;
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const mName = months[parseInt(match[2], 10) - 1] || match[2];
    const dayNum = parseInt(match[3], 10);
    return match[4] ? `${dayNum} ${mName} · ${match[4]}` : `${dayNum} ${mName}`;
}

function toDatetimeLocalValue(val) {
    if (!val) return '';
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return str;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return `${str}T09:00`;
    const match = str.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return match ? `${match[1]}T${match[2]}` : '';
}

function copyTextWithToast(text, label = 'Kod') {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast(`${label} kopyalandı: ${text}`, 'success');
        }).catch(() => {
            showToast(`${label}: ${text}`, 'info');
        });
    } else {
        showToast(`${label}: ${text}`, 'info');
    }
}

/**
 * Offline regex parser for Pegasus / THY / Booking / Museum confirmation emails & SMS.
 */
export function parseReservationTextHeuristic(rawText) {
    const text = (rawText || '').trim();
    if (!text) return {};
    const lower = text.toLowerCase();

    // Detect type
    let type = 'other';
    if (/(pegasus|thy|turkish airlines|uçuş|ucus|flight|pnr|boarding|\bpc\s?\d{3,4}\b|\btk\s?\d{3,4}\b|\b[A-Z]{3}\s*(?:->|→|-)\s*[A-Z]{3}\b)/i.test(text)) {
        type = 'flight';
    } else if (/(booking\.com|airbnb|hotel|otel|check-?in|konaklama|oda|nights?)/i.test(lower)) {
        type = 'hotel';
    } else if (/(müze|museum|ticket|bilet|kolezyum|colosseum|vatikan|vatican|giriş|entry)/i.test(lower)) {
        type = 'ticket';
    } else if (/(tren|train|trenitalia|italo|otobüs|bus|transfer|ferry|feribot)/i.test(lower)) {
        type = 'transport';
    }

    // Extract PNR / confirmation code
    let pnr = '';
    const pnrLabelMatch = text.match(/(?:PNR(?:\s*Kodu|\s*No)?|Rezervasyon\s*(?:Kodu|No|Numaras[ıi])|Booking\s*(?:Ref(?:erence)?|Code|ID)|Confirmation(?:\s*(?:Code|No|Number))?|Referans)\s*[:#\-]?\s*([A-Z0-9]{5,12})/i);
    if (pnrLabelMatch) {
        pnr = pnrLabelMatch[1].toUpperCase();
    }

    // Extract flight code & airline/provider
    const flightCodeMatch = text.match(/\b(PC|TK|AJ|VF|XQ|FR|AZ|W6|LH|BA|AF|KL)\s?(\d{3,4})\b/i);
    const flightCode = flightCodeMatch ? `${flightCodeMatch[1].toUpperCase()} ${flightCodeMatch[2]}` : '';
    let provider = '';
    if (lower.includes('pegasus') || flightCode.startsWith('PC')) provider = flightCode ? `Pegasus · ${flightCode}` : 'Pegasus';
    else if (lower.includes('turkish') || lower.includes('thy') || flightCode.startsWith('TK')) provider = flightCode ? `THY · ${flightCode}` : 'Türk Hava Yolları';
    else if (lower.includes('booking.com')) provider = 'Booking.com';
    else if (lower.includes('airbnb')) provider = 'Airbnb';
    else if (flightCode) provider = flightCode;

    // Extract airport route e.g. SAW -> FCO
    const routeMatch = text.match(/\b([A-Z]{3})\s*(?:->|→|[-–—]|to)\s*([A-Z]{3})\b/);
    let location = '';
    let title = '';
    if (routeMatch) {
        location = `${routeMatch[1]} → ${routeMatch[2]}`;
        title = type === 'flight'
            ? `${provider ? provider.split(' · ')[0] + ' ' : ''}${routeMatch[1]} → ${routeMatch[2]}`.trim()
            : location;
    }

    // Extract date (ISO, DD.MM.YYYY, or "27 Kasım 2026")
    let dateStr = '';
    const isoDateMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    const trDateMatch = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
    const wordDateMatch = text.match(/\b(\d{1,2})\s+([a-zçğıöşü]+)(?:\s+(20\d{2}))?/i);

    if (isoDateMatch) {
        dateStr = `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
    } else if (trDateMatch) {
        dateStr = `${trDateMatch[3]}-${trDateMatch[2].padStart(2, '0')}-${trDateMatch[1].padStart(2, '0')}`;
    } else if (wordDateMatch && MONTH_MAP[wordDateMatch[2].toLowerCase()]) {
        const year = wordDateMatch[3] || String(new Date().getFullYear());
        dateStr = `${year}-${MONTH_MAP[wordDateMatch[2].toLowerCase()]}-${wordDateMatch[1].padStart(2, '0')}`;
    }

    const times = [...text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)].map(m => `${m[1].padStart(2, '0')}:${m[2]}`);
    const startDatetime = dateStr ? `${dateStr}T${times[0] || '09:00'}` : '';
    const endDatetime = (dateStr && times.length > 1) ? `${dateStr}T${times[1]}` : '';

    if (!title) {
        const firstLine = text.split(/\r?\n/).map(l => l.trim()).find(Boolean) || '';
        title = firstLine.slice(0, 60);
    }

    return {
        type,
        title,
        provider,
        pnr,
        start_datetime: startDatetime,
        end_datetime: endDatetime,
        location,
        notes: text.length > 220 ? `${text.slice(0, 220)}...` : text
    };
}

/**
 * Parses messy email/SMS text using Gemini when online & configured,
 * falling back cleanly to the offline regex parser otherwise.
 */
async function parseReservationSmart(rawText) {
    const fallback = parseReservationTextHeuristic(rawText);
    const apiKey = (config.geminiApiKey || '').trim();
    if (!apiKey || !db.isOnline()) {
        return fallback;
    }

    try {
        const model = (config.geminiModel || 'gemini-2.5-flash').trim();
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const prompt = `Aşağıdaki bilet, uçuş, otel veya etkinlik onay metninden yapılandırılmış bilgi çıkar ve SADECE geçerli bir JSON nesnesi döndür.
Alanlar:
- "type": "flight" | "hotel" | "ticket" | "transport" | "other"
- "title": kısa net başlık (örn: "Pegasus SAW → FCO" veya "Kolezyum Giriş Bileti")
- "provider": firma ve kod (örn: "Pegasus · PC 1217", "Booking.com")
- "pnr": PNR / rezervasyon / referans kodu (büyük harf)
- "start_datetime": "YYYY-MM-DDTHH:mm" formatında başlangıç (yıl belirsizse 2026)
- "end_datetime": varsa "YYYY-MM-DDTHH:mm" formatında bitiş, yoksa ""
- "location": havalimanı/terminal/adres (örn: "SAW Terminal → FCO T3")
- "notes": koltuk, bagaj, giriş kapısı vb. kısa özet

METİN:
${rawText}`;

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: 'application/json' }
            })
        });
        if (!res.ok) return fallback;
        const json = await res.json();
        const rawOut = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = JSON.parse(rawOut);
        return {
            type: RESERVATION_TYPES[parsed.type] ? parsed.type : (fallback.type || 'other'),
            title: parsed.title || fallback.title || '',
            provider: parsed.provider || fallback.provider || '',
            pnr: (parsed.pnr || fallback.pnr || '').toUpperCase(),
            start_datetime: toDatetimeLocalValue(parsed.start_datetime) || fallback.start_datetime || '',
            end_datetime: toDatetimeLocalValue(parsed.end_datetime) || fallback.end_datetime || '',
            location: parsed.location || fallback.location || '',
            notes: parsed.notes || ''
        };
    } catch (err) {
        console.warn('Gemini reservation parse fallback:', err);
        return fallback;
    }
}

export async function loadReservationsData() {
    const filterEl = document.getElementById('res-trip-filter');
    if (filterEl) {
        const previousVal = filterEl.value;
        filterEl.innerHTML = '<option value="">Tüm Seyahatler</option>' +
            (state.tripsList || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');

        if (previousVal && (state.tripsList || []).some(t => String(t.id) === String(previousVal))) {
            filterEl.value = previousVal;
        } else if (state.activeTripId && (state.tripsList || []).some(t => String(t.id) === String(state.activeTripId))) {
            filterEl.value = state.activeTripId;
        }
    }

    const selectedTripId = filterEl?.value || null;
    state.reservationsList = await db.getReservations(selectedTripId || null);
    renderReservations();
}

export function renderReservations() {
    const container = document.getElementById('reservations-list');
    if (!container) return;

    const list = state.reservationsList || [];
    if (list.length === 0) {
        container.innerHTML = `
            <div class="card glass text-center res-empty-card" style="grid-column: 1 / -1;">
                <i data-lucide="ticket" style="width:32px; height:32px; color:var(--text-muted); margin-bottom:8px;"></i>
                <p style="margin:0; font-weight:600;">Henüz kayıtlı bilet veya rezervasyon yok</p>
                <span class="text-xs text-muted">Pegasus onay mailini, otel bilgisini veya bilet ekran görüntüsünü ekleyerek çevrimdışıyken bile tek tıkla erişebilirsiniz.</span>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    container.innerHTML = list.map(res => {
        const meta = RESERVATION_TYPES[res.type] || RESERVATION_TYPES.other;
        const trip = (state.tripsList || []).find(t => String(t.id) === String(res.trip_id));
        const startText = formatDateTimeShort(res.start_datetime);
        const endText = formatDateTimeShort(res.end_datetime);
        const timeRange = startText && endText ? `${startText} → ${endText}` : (startText || endText);

        return `
            <div class="card glass reservation-card" data-id="${escapeHtml(String(res.id))}">
                <div class="res-card-top">
                    <span class="res-type-badge" style="color:${meta.color}; background:${meta.bg}; border-color:${meta.color}40;">
                        <i data-lucide="${meta.icon}"></i> ${escapeHtml(meta.name)}
                    </span>
                    <div class="res-card-actions">
                        <button type="button" class="btn-compact-icon btn-edit-res" data-id="${escapeHtml(String(res.id))}" title="Düzenle">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button type="button" class="btn-compact-icon btn-delete-res" data-id="${escapeHtml(String(res.id))}" title="Sil">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>

                <h3 class="res-card-title">${escapeHtml(res.title || meta.name)}</h3>
                ${res.provider ? `<div class="res-card-provider">${escapeHtml(res.provider)}</div>` : ''}

                <div class="res-meta-rows">
                    ${timeRange ? `<div class="res-meta-line"><i data-lucide="clock"></i> <span>${escapeHtml(timeRange)}</span></div>` : ''}
                    ${res.location ? `<div class="res-meta-line"><i data-lucide="map-pin"></i> <span>${escapeHtml(res.location)}</span></div>` : ''}
                    ${trip ? `<div class="res-meta-line"><i data-lucide="compass"></i> <span>${escapeHtml(trip.name)}</span></div>` : ''}
                </div>

                ${res.pnr ? `
                    <button type="button" class="res-pnr-pill btn-copy-pnr" data-pnr="${escapeHtml(res.pnr)}" title="PNR / Referans kodunu kopyala">
                        <span>PNR / Ref: <strong>${escapeHtml(res.pnr)}</strong></span>
                        <i data-lucide="copy"></i>
                    </button>
                ` : ''}

                ${res.notes ? `<p class="res-card-notes">${escapeHtml(res.notes)}</p>` : ''}
            </div>
        `;
    }).join('');

    container.querySelectorAll('.btn-copy-pnr').forEach(btn => {
        btn.addEventListener('click', () => copyTextWithToast(btn.dataset.pnr, 'PNR / Ref'));
    });

    container.querySelectorAll('.btn-edit-res').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = list.find(r => String(r.id) === String(btn.dataset.id));
            if (item) openReservationModal(item);
        });
    });

    container.querySelectorAll('.btn-delete-res').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Bu rezervasyonu silmek istediğinize emin misiniz?')) return;
            await db.deleteReservation(btn.dataset.id);
            showToast('Rezervasyon silindi.', 'success');
            await loadReservationsData();
            window.dispatchEvent(new CustomEvent('dashboard-reload-needed'));
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

export async function renderDashboardReservationsStrip(tripId) {
    const stripEl = document.getElementById('dash-reservations-strip');
    if (!stripEl) return;

    if (!tripId) {
        stripEl.classList.add('hidden');
        stripEl.innerHTML = '';
        return;
    }

    const list = await db.getReservations(tripId);
    if (!list || list.length === 0) {
        stripEl.classList.add('hidden');
        stripEl.innerHTML = '';
        return;
    }

    const preview = list.slice(0, 3);
    stripEl.innerHTML = `
        <div class="dash-res-header">
            <span><i data-lucide="ticket" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px;"></i> Bilet & Rezervasyonlar</span>
            <a href="#trips" class="text-xs" style="color:var(--color-primary); text-decoration:none; font-weight:600;">Tümünü Gör (${list.length})</a>
        </div>
        <div class="dash-res-chips">
            ${preview.map(res => {
                const meta = RESERVATION_TYPES[res.type] || RESERVATION_TYPES.other;
                const timeTxt = formatDateTimeShort(res.start_datetime);
                return `
                    <button type="button" class="dash-res-chip" data-pnr="${escapeHtml(res.pnr || '')}" title="${res.pnr ? 'PNR kopyalamak için dokunun' : escapeHtml(res.title)}">
                        <i data-lucide="${meta.icon}" style="color:${meta.color};"></i>
                        <span class="dash-res-chip-title">${escapeHtml(res.title || meta.name)}</span>
                        ${timeTxt ? `<span class="dash-res-chip-time">${escapeHtml(timeTxt)}</span>` : ''}
                        ${res.pnr ? `<span class="dash-res-chip-pnr">${escapeHtml(res.pnr)}</span>` : ''}
                    </button>
                `;
            }).join('')}
        </div>
    `;
    stripEl.classList.remove('hidden');

    stripEl.querySelectorAll('.dash-res-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.pnr) {
                copyTextWithToast(btn.dataset.pnr, 'PNR / Ref');
            } else {
                window.location.hash = '#trips';
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

function applyParsedFieldsToModal(parsed) {
    if (!parsed) return;
    if (parsed.type) document.getElementById('res-type').value = parsed.type;
    if (parsed.title) document.getElementById('res-title').value = parsed.title;
    if (parsed.provider) document.getElementById('res-provider').value = parsed.provider;
    if (parsed.pnr) document.getElementById('res-pnr').value = parsed.pnr;
    if (parsed.start_datetime) document.getElementById('res-start').value = toDatetimeLocalValue(parsed.start_datetime);
    if (parsed.end_datetime) document.getElementById('res-end').value = toDatetimeLocalValue(parsed.end_datetime);
    if (parsed.location) document.getElementById('res-location').value = parsed.location;
    if (parsed.notes) document.getElementById('res-notes').value = parsed.notes;
}

export function openReservationModal(existing = null) {
    const modal = document.getElementById('reservation-modal');
    const form = document.getElementById('reservation-form');
    if (!modal || !form) return;

    form.reset();

    const tripSelect = document.getElementById('res-trip-id');
    if (tripSelect) {
        tripSelect.innerHTML = '<option value="">Genel (Seyahate Bağsız)</option>' +
            (state.tripsList || []).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
        const defaultTripId = existing?.trip_id || document.getElementById('res-trip-filter')?.value || state.activeTripId || '';
        if (defaultTripId && (state.tripsList || []).some(t => String(t.id) === String(defaultTripId))) {
            tripSelect.value = defaultTripId;
        }
    }

    const titleEl = document.getElementById('reservation-modal-title');
    if (existing) {
        if (titleEl) titleEl.textContent = 'Rezervasyonu Düzenle';
        document.getElementById('res-id').value = existing.id;
        document.getElementById('res-type').value = existing.type || 'other';
        document.getElementById('res-title').value = existing.title || '';
        document.getElementById('res-provider').value = existing.provider || '';
        document.getElementById('res-pnr').value = existing.pnr || '';
        document.getElementById('res-start').value = toDatetimeLocalValue(existing.start_datetime);
        document.getElementById('res-end').value = toDatetimeLocalValue(existing.end_datetime);
        document.getElementById('res-location').value = existing.location || '';
        document.getElementById('res-notes').value = existing.notes || '';
    } else {
        if (titleEl) titleEl.textContent = 'Yeni Bilet / Rezervasyon';
        document.getElementById('res-id').value = '';
    }

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

export function initReservationEvents() {
    const btnAdd = document.getElementById('btn-add-reservation');
    const modal = document.getElementById('reservation-modal');
    const btnClose = document.getElementById('btn-close-reservation-modal');
    const form = document.getElementById('reservation-form');
    const filterEl = document.getElementById('res-trip-filter');
    const parseBtn = document.getElementById('btn-parse-reservation-text');
    const smartPasteInput = document.getElementById('res-smart-paste');

    if (btnAdd) btnAdd.addEventListener('click', () => openReservationModal());
    if (btnClose && modal) btnClose.addEventListener('click', () => modal.classList.add('hidden'));
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }

    if (filterEl) {
        filterEl.addEventListener('change', () => loadReservationsData());
    }

    if (parseBtn && smartPasteInput) {
        parseBtn.addEventListener('click', async () => {
            const raw = smartPasteInput.value.trim();
            if (!raw) {
                showToast('Önce Pegasus/otel onay maili veya SMS metnini yapıştırın.', 'warning');
                return;
            }
            const origText = parseBtn.innerHTML;
            parseBtn.disabled = true;
            parseBtn.textContent = 'Ayıklanıyor...';
            try {
                const parsed = await parseReservationSmart(raw);
                applyParsedFieldsToModal(parsed);
                showToast('Bilgiler form alanlarına aktarıldı! Kontrol edip Kaydet\'e basın.', 'success');
            } finally {
                parseBtn.disabled = false;
                parseBtn.innerHTML = origText;
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const resId = document.getElementById('res-id').value;
                const payload = {
                    trip_id: document.getElementById('res-trip-id').value || null,
                    type: document.getElementById('res-type').value || 'other',
                    title: document.getElementById('res-title').value.trim(),
                    provider: document.getElementById('res-provider').value.trim(),
                    pnr: document.getElementById('res-pnr').value.trim().toUpperCase(),
                    start_datetime: document.getElementById('res-start').value || '',
                    end_datetime: document.getElementById('res-end').value || '',
                    location: document.getElementById('res-location').value.trim(),
                    notes: document.getElementById('res-notes').value.trim()
                };

                if (resId) {
                    await db.updateReservation(resId, payload);
                    showToast('Rezervasyon güncellendi.', 'success');
                } else {
                    await db.createReservation(payload);
                    showToast('Rezervasyon kaydedildi!', 'success');
                }

                if (modal) modal.classList.add('hidden');
                await loadReservationsData();
                window.dispatchEvent(new CustomEvent('dashboard-reload-needed'));
            } catch (err) {
                showToast('Kaydetme hatası: ' + err.message, 'danger');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
}
