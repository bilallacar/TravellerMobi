// js/modules/share.js - Read-Only Share System with 4-Digit PIN Security, Cloud Short-Links & Infographic Layout

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast, escapeHtml } from '../utils.js';
import { PLACE_CATEGORIES } from './places.js';

let shareMapInstance = null;
let shareMarkersLayer = null;
let sharePolylineLayer = null;
let currentDecodedShareData = null;

// Guest view pending state
let pendingShareData = null;
let pendingSharePayload = null;
let pendingSharePinHash = null;
let pendingShareTripName = null;
let activeModalSlug = null;

/**
 * Initialize event listeners for share system
 */
export function initShareEvents() {
    // Open Share Modal Button on Places Page
    const btnSharePlaces = document.getElementById('btn-share-places-route');
    if (btnSharePlaces) {
        btnSharePlaces.addEventListener('click', openShareModal);
    }

    // Modal Close
    const btnCloseModal = document.getElementById('btn-close-share-modal');
    const btnCancelModal = document.getElementById('btn-cancel-share-modal');
    if (btnCloseModal) btnCloseModal.addEventListener('click', closeShareModal);
    if (btnCancelModal) btnCancelModal.addEventListener('click', closeShareModal);

    // PIN Toggle
    const pinCheckbox = document.getElementById('share-pin-enable');
    const pinContainer = document.getElementById('share-pin-input-container');
    if (pinCheckbox && pinContainer) {
        pinCheckbox.addEventListener('change', async (e) => {
            if (e.target.checked) {
                pinContainer.classList.remove('hidden');
                generateNewPin();
            } else {
                pinContainer.classList.add('hidden');
            }
            await updateShareLinkPreview();
        });
    }

    // Regenerate PIN button
    const btnRegenPin = document.getElementById('btn-regenerate-pin');
    if (btnRegenPin) {
        btnRegenPin.addEventListener('click', async () => {
            generateNewPin();
            await updateShareLinkPreview();
        });
    }

    // PIN input change
    const pinInput = document.getElementById('share-pin-code');
    if (pinInput) {
        pinInput.addEventListener('input', async (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
            await updateShareLinkPreview();
        });
    }

    // Copy Link Button
    const btnCopyLink = document.getElementById('btn-copy-share-link');
    if (btnCopyLink) {
        btnCopyLink.addEventListener('click', () => copyShareLink());
    }

    // Copy PIN Button
    const btnCopyPin = document.getElementById('btn-copy-share-pin');
    if (btnCopyPin) {
        btnCopyPin.addEventListener('click', () => copySharePin());
    }

    // WhatsApp Share Button
    const btnWhatsapp = document.getElementById('btn-whatsapp-share');
    if (btnWhatsapp) {
        btnWhatsapp.addEventListener('click', () => shareViaWhatsApp());
    }

    // Preview as Guest Button
    const btnPreviewGuest = document.getElementById('btn-preview-share-guest');
    if (btnPreviewGuest) {
        btnPreviewGuest.addEventListener('click', () => {
            const url = document.getElementById('share-link-result').value;
            if (url && !url.includes("hazırlanıyor")) {
                closeShareModal();
                window.location.href = url;
            }
        });
    }

    // Setup 4-digit PIN Gate inputs
    setupPinGateInputs();
}

/**
 * Open Share Modal for the active trip
 */
export async function openShareModal() {
    const modal = document.getElementById('modal-share-route');
    if (!modal) return;

    if (!state.activeTripId || !state.placesList || state.placesList.length === 0) {
        showToast("Paylaşmak için seyahatinizde en az 1 gezi noktası bulunmalıdır.", "warning");
        return;
    }

    const currentTrip = state.tripsList.find(t => t.id === state.activeTripId) || { name: 'Seyahat Rotası' };

    // Fresh unique slug for this share session: e.g. atina-4821
    const slugBase = slugify(currentTrip.name).split('-')[0] || 'rota';
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    activeModalSlug = `${slugBase}-${randomSuffix}`;

    // Set trip title & count
    const tripNameEl = document.getElementById('share-modal-trip-name');
    if (tripNameEl) tripNameEl.textContent = currentTrip.name;

    const countEl = document.getElementById('share-modal-place-count');
    if (countEl) countEl.textContent = `${state.placesList.length} Gezi Noktası`;

    // Reset PIN options (Default: 4-digit PIN ON)
    const pinCheckbox = document.getElementById('share-pin-enable');
    const pinContainer = document.getElementById('share-pin-input-container');
    if (pinCheckbox) pinCheckbox.checked = true;
    if (pinContainer) pinContainer.classList.remove('hidden');
    generateNewPin();

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();

    await updateShareLinkPreview();
}

/**
 * Close Share Modal
 */
export function closeShareModal() {
    const modal = document.getElementById('modal-share-route');
    if (modal) modal.classList.add('hidden');
}

/**
 * Generate a random 4-digit numeric PIN
 */
function generateNewPin() {
    const randomPin = Math.floor(1000 + Math.random() * 9000).toString();
    const pinInput = document.getElementById('share-pin-code');
    if (pinInput) pinInput.value = randomPin;
}

/**
 * Generate share URL:
 * 1. Checks Supabase shared_routes table -> Generates ultra-short URL (e.g. #share?id=atina-4821)
 * 2. If table not yet created -> Uses compact URL-safe Base64URL fallback
 */
async function updateShareLinkPreview() {
    const currentTrip = state.tripsList.find(t => t.id === state.activeTripId) || { name: 'Seyahat Rotası' };
    const pinCheckbox = document.getElementById('share-pin-enable');
    const pinInput = document.getElementById('share-pin-code');
    const linkResultInput = document.getElementById('share-link-result');
    const pinBadgeEl = document.getElementById('share-pin-display-badge');

    if (!activeModalSlug) {
        const slugBase = slugify(currentTrip.name).split('-')[0] || 'rota';
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        activeModalSlug = `${slugBase}-${randomSuffix}`;
    }
    const slug = activeModalSlug;

    const isPinEnabled = pinCheckbox && pinCheckbox.checked;
    const pin = (isPinEnabled && pinInput) ? pinInput.value.trim() : '';
    const pinHash = (isPinEnabled && pin.length === 4) ? hashPin(pin) : '';

    if (linkResultInput) linkResultInput.value = "Kısa link oluşturuluyor...";

    // 1. Prepare clean places payload
    const compactPlaces = state.placesList.map((p, idx) => ({
        id: p.id || `p_${idx}`,
        name: p.name || '',
        category: p.category || 'other',
        status: p.status || 'planned',
        latitude: p.latitude,
        longitude: p.longitude,
        address: p.address || '',
        notes: p.notes || '',
        estimated_cost: p.estimated_cost || 0,
        currency: p.currency || 'EUR',
        visit_order: p.visit_order !== undefined ? p.visit_order : idx
    }));

    // 2. Cache locally as instant backup
    try {
        localStorage.setItem(`shared_route_${slug}`, JSON.stringify({
            tripName: currentTrip.name,
            pinHash: pinHash,
            places: compactPlaces,
            sharedAt: new Date().toISOString()
        }));
    } catch (e) {}

    // 3. Try to save to Supabase Cloud Table
    let savedToCloud = false;
    try {
        const cloudRecord = await db.saveSharedRoute(slug, currentTrip.name, compactPlaces, pinHash);
        if (cloudRecord && cloudRecord.id) {
            savedToCloud = true;
        }
    } catch (e) {
        console.warn("Cloud save skipped:", e);
    }

    // 4. Form final URL:
    // If cloud saved: ULTRA-SHORT link (e.g. https://.../#share?id=atina-4821)
    // If not: Compact URL-safe Base64URL fallback
    const baseUrl = window.location.origin + window.location.pathname;
    let fullUrl = '';

    if (savedToCloud) {
        fullUrl = `${baseUrl}#s=${slug}`;
    } else {
        const { payload } = encodeRoutePayload(currentTrip.name, compactPlaces, isPinEnabled ? pin : '');
        let hash = `#share?id=${slug}&d=${payload}`;
        if (isPinEnabled && pinHash) {
            hash += `&h=${pinHash}`;
        }
        fullUrl = `${baseUrl}${hash}`;
    }

    if (linkResultInput) linkResultInput.value = fullUrl;

    if (pinBadgeEl) {
        if (isPinEnabled && pin.length === 4) {
            pinBadgeEl.textContent = `PIN: ${pin}`;
            pinBadgeEl.style.display = 'inline-block';
        } else {
            pinBadgeEl.style.display = 'none';
        }
    }
}

/**
 * Copy share link to clipboard
 */
async function copyShareLink() {
    const linkInput = document.getElementById('share-link-result');
    if (!linkInput || !linkInput.value || linkInput.value.includes("oluşturuluyor")) return;

    try {
        await navigator.clipboard.writeText(linkInput.value);
        showToast("📋 Paylaşım linki panoya kopyalandı!", "success");
    } catch (e) {
        linkInput.select();
        document.execCommand('copy');
        showToast("📋 Link kopyalandı!", "success");
    }
}

/**
 * Copy PIN to clipboard
 */
async function copySharePin() {
    const pinInput = document.getElementById('share-pin-code');
    if (!pinInput || !pinInput.value) return;

    try {
        await navigator.clipboard.writeText(pinInput.value);
        showToast(`🔑 PIN kodu (${pinInput.value}) panoya kopyalandı!`, "success");
    } catch (e) {
        showToast(`PIN: ${pinInput.value}`, "info");
    }
}

/**
 * Share via WhatsApp
 */
function shareViaWhatsApp() {
    const linkInput = document.getElementById('share-link-result');
    const pinCheckbox = document.getElementById('share-pin-enable');
    const pinInput = document.getElementById('share-pin-code');
    const tripNameEl = document.getElementById('share-modal-trip-name');

    const tripName = tripNameEl ? tripNameEl.textContent : 'Seyahat';
    const link = linkInput ? linkInput.value : '';
    const isPin = pinCheckbox && pinCheckbox.checked && pinInput && pinInput.value.length === 4;
    const pin = isPin ? pinInput.value : '';

    let text = `🗺️ *${tripName} Gezi Rotası*\n\n🔗 ${link}\n`;
    if (isPin) {
        text += `\n🔑 *Giriş PIN Kodu:* *${pin}*\n`;
    }
    text += `\nÜye olmadan tek tıkla rotayı ve haritayı inceleyebilirsin! ✨`;

    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(waUrl, '_blank');
}

/* ==========================================================================
   READ-ONLY GUEST VIEW LOADING & RENDERING (#share or #s=)
   ========================================================================== */

/**
 * Load and render the Read-Only Share View
 */
export async function loadShareView(hash) {
    const viewShare = document.getElementById('view-share');
    const pinGate = document.getElementById('share-pin-gate');
    const shareContent = document.getElementById('share-content-container');
    if (!viewShare) return;

    // Reset state
    pendingShareData = null;
    pendingSharePayload = null;
    pendingSharePinHash = null;
    pendingShareTripName = null;
    currentDecodedShareData = null;

    // Parse URL params from hash (e.g. #s=atina-9511 or #share?id=...)
    let slug = null;
    let payload = null;
    let pinHashFromUrl = null;

    if (hash.startsWith('#s=')) {
        const afterPrefix = hash.substring(3);
        const [cleanSlug, queryPart] = afterPrefix.split('?');
        slug = cleanSlug;
        if (queryPart) {
            const params = new URLSearchParams(queryPart);
            payload = params.get('d');
            pinHashFromUrl = params.get('h');
        }
    } else {
        const queryString = hash.includes('?') ? hash.substring(hash.indexOf('?') + 1) : '';
        const params = new URLSearchParams(queryString);
        slug = params.get('id') || params.get('s');
        payload = params.get('d');
        pinHashFromUrl = params.get('h');
    }

    // 1. Try to fetch from Supabase Cloud Table
    if (slug) {
        try {
            const cloudRoute = await db.getSharedRoute(slug);
            if (cloudRoute && cloudRoute.places) {
                pendingShareData = cloudRoute.places;
                pendingShareTripName = cloudRoute.trip_name || 'Seyahat Rotası';
                pendingSharePinHash = cloudRoute.pin_hash || null;
            }
        } catch (e) {
            console.warn("Could not load from cloud table:", e);
        }
    }

    // 2. Fallback to localStorage (creator's device or offline preview)
    if (!pendingShareData && slug) {
        try {
            const cached = localStorage.getItem(`shared_route_${slug}`);
            if (cached) {
                const parsed = JSON.parse(cached);
                pendingShareData = parsed.places;
                pendingShareTripName = parsed.tripName;
                pendingSharePinHash = parsed.pinHash || null;
            }
        } catch (e) {}
    }

    // 3. Fallback to URL Payload (&d=...)
    if (!pendingShareData && payload) {
        pendingSharePayload = payload;
        pendingSharePinHash = pinHashFromUrl || null;
    }

    // Check if we found any data source
    if (!pendingShareData && !pendingSharePayload) {
        showToast("Paylaşılan rota verisi bulunamadı veya link geçersiz.", "danger");
        if (pinGate) pinGate.classList.add('hidden');
        if (shareContent) shareContent.classList.remove('hidden');
        renderInfographicShareContent({ tripName: 'Rota Bulunamadı', places: [] });
        return;
    }

    // 4. Check if PIN protection is active
    if (pendingSharePinHash) {
        if (pinGate) pinGate.classList.remove('hidden');
        if (shareContent) shareContent.classList.add('hidden');
        clearPinGateInputs();
        focusFirstPinInput();
        return;
    }

    // 5. No PIN required -> Unlock immediately
    try {
        let routeData = null;
        if (pendingShareData) {
            routeData = { tripName: pendingShareTripName, places: pendingShareData };
        } else if (pendingSharePayload) {
            routeData = decodeRoutePayload(pendingSharePayload, '', '');
        }

        currentDecodedShareData = routeData;
        if (pinGate) pinGate.classList.add('hidden');
        if (shareContent) shareContent.classList.remove('hidden');
        renderInfographicShareContent(routeData);
    } catch (err) {
        console.error("Failed to decode share data:", err);
        showToast("Rota yüklenemedi: " + err.message, "danger");
    }
}

/**
 * Setup 4-digit PIN Gate inputs with auto-advance and backspace
 */
function setupPinGateInputs() {
    const inputs = document.querySelectorAll('.pin-digit-box');
    const submitBtn = document.getElementById('btn-submit-share-pin');

    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val ? val[0] : '';
            if (val && index < inputs.length - 1) {
                inputs[index + 1].focus();
            }
            checkAutoSubmitPin();
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
            }
        });

        // Paste full PIN handling
        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/\D/g, '');
            if (pasteData.length >= 4) {
                for (let i = 0; i < 4; i++) {
                    if (inputs[i]) inputs[i].value = pasteData[i];
                }
                inputs[3].focus();
                checkAutoSubmitPin();
            }
        });
    });

    if (submitBtn) {
        submitBtn.addEventListener('click', handlePinGateSubmit);
    }
}

function clearPinGateInputs() {
    const inputs = document.querySelectorAll('.pin-digit-box');
    inputs.forEach(input => input.value = '');
}

function focusFirstPinInput() {
    setTimeout(() => {
        const first = document.querySelector('.pin-digit-box');
        if (first) first.focus();
    }, 200);
}

function checkAutoSubmitPin() {
    const inputs = document.querySelectorAll('.pin-digit-box');
    let pin = '';
    inputs.forEach(input => pin += input.value.trim());
    if (pin.length === 4) {
        handlePinGateSubmit();
    }
}

function handlePinGateSubmit() {
    const inputs = document.querySelectorAll('.pin-digit-box');
    let pin = '';
    inputs.forEach(input => pin += input.value.trim());

    if (pin.length !== 4) {
        showToast("Lütfen 4 haneli PIN kodunu eksiksiz girin", "warning");
        return;
    }

    // Verify PIN Hash
    const enteredHash = hashPin(pin);
    if (pendingSharePinHash && enteredHash !== pendingSharePinHash) {
        showToast("Hatalı PIN kodu! Lütfen tekrar deneyiniz.", "danger");
        const box = document.getElementById('pin-boxes-container');
        if (box) {
            box.classList.add('shake-error');
            setTimeout(() => box.classList.remove('shake-error'), 600);
        }
        clearPinGateInputs();
        focusFirstPinInput();
        return;
    }

    try {
        let routeData = null;
        if (pendingShareData) {
            routeData = { tripName: pendingShareTripName, places: pendingShareData };
        } else if (pendingSharePayload) {
            routeData = decodeRoutePayload(pendingSharePayload, pin, pendingSharePinHash);
        }

        if (!routeData) {
            throw new Error("Rota verisi çözülemedi.");
        }

        currentDecodedShareData = routeData;
        const pinGate = document.getElementById('share-pin-gate');
        const shareContent = document.getElementById('share-content-container');

        showToast("🔓 PIN kodu doğrulandı! Rota açılıyor...", "success");
        if (pinGate) pinGate.classList.add('hidden');
        if (shareContent) shareContent.classList.remove('hidden');

        renderInfographicShareContent(routeData);
    } catch (err) {
        console.error("PIN check failed:", err);
        showToast("Hatalı PIN kodu veya bozuk veri: " + err.message, "danger");
        clearPinGateInputs();
        focusFirstPinInput();
    }
}

/**
 * Render the full Infographic Read-Only Content:
 * - Trip Header Info & Stats
 * - Interactive Leaflet Map with minimalist Esri Light Gray Canvas, numbered pins, polylines, and zoom-sensitive labels
 * - Infographic Places List matching the numbers 1, 2, 3...
 */
function renderInfographicShareContent(data) {
    // 1. Header Information
    const titleEl = document.getElementById('share-trip-title');
    const datesEl = document.getElementById('share-trip-dates');
    const countEl = document.getElementById('share-trip-place-count');
    const distEl = document.getElementById('share-trip-total-distance');

    if (titleEl) titleEl.textContent = `🏛️ ${data.tripName || 'Seyahat Rotası'}`;
    
    if (datesEl) {
        if (data.startDate && data.endDate) {
            datesEl.textContent = `📅 ${data.startDate} — ${data.endDate}`;
        } else if (data.startDate) {
            datesEl.textContent = `📅 ${data.startDate}`;
        } else {
            datesEl.textContent = `📅 Güncel Seyahat Güzergahı`;
        }
    }

    const places = (data.places || []).map((p, idx) => ({
        id: p.id || `p_${idx}`,
        name: p.name || p.n || '',
        category: p.category || p.c || 'other',
        status: p.status || p.s || 'planned',
        latitude: p.latitude !== undefined ? p.latitude : p.lt,
        longitude: p.longitude !== undefined ? p.longitude : p.ln,
        address: p.address || p.a || '',
        notes: p.notes || p.nt || '',
        estimated_cost: p.estimated_cost !== undefined ? p.estimated_cost : (p.ec || 0),
        currency: p.currency || p.cr || data.currency || 'EUR',
        visit_order: p.visit_order !== undefined ? p.visit_order : (p.vo !== undefined ? p.vo : idx)
    }));

    // Sort: Hotel first, then visit_order
    places.sort((a, b) => {
        if (a.category === 'hotel') return -1;
        if (b.category === 'hotel') return 1;
        return (a.visit_order || 0) - (b.visit_order || 0);
    });

    if (countEl) countEl.textContent = `📍 ${places.length} Gezi Noktası`;

    // 2. Render Interactive Map
    renderShareMap(places);

    // 3. Render Infographic Places List (Read-Only)
    renderSharePlacesList(places);

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Initialize / Render the Share Leaflet Map
 */
function renderShareMap(places) {
    const mapEl = document.getElementById('share-map');
    if (!mapEl || typeof L === 'undefined') return;

    if (!shareMapInstance) {
        shareMapInstance = L.map('share-map', {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([37.9838, 23.7275], 13);

        // Esri World Light Gray Canvas (Minimalist, pale, distraction-free with English/Latin labels, NO API KEY, NO WATERMARK)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
        }).addTo(shareMapInstance);

        // Subtle English reference labels overlay
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        }).addTo(shareMapInstance);

        sharePolylineLayer = L.layerGroup().addTo(shareMapInstance);
        shareMarkersLayer = L.layerGroup().addTo(shareMapInstance);

        // Listen for zoom to toggle labels
        shareMapInstance.on('zoomend', () => updateShareMapZoomClass());
    }

    setTimeout(() => {
        if (shareMapInstance) shareMapInstance.invalidateSize();
    }, 200);

    updateShareMapZoomClass();
    renderShareMarkersAndRoute(places);
}

function updateShareMapZoomClass() {
    if (!shareMapInstance) return;
    const zoom = shareMapInstance.getZoom();
    const mapEl = document.getElementById('share-map');
    if (mapEl) {
        if (zoom >= 14) mapEl.classList.add('map-detailed-zoom');
        else mapEl.classList.remove('map-detailed-zoom');
    }
}

/**
 * Render Numbered Markers (1, 2, 3...) and Route with Segment Distances
 */
function renderShareMarkersAndRoute(places) {
    if (!shareMapInstance || !shareMarkersLayer || !sharePolylineLayer) return;

    shareMarkersLayer.clearLayers();
    sharePolylineLayer.clearLayers();

    const validPlaces = places.filter(p => p.latitude && p.longitude);
    if (validPlaces.length === 0) return;

    const latLngBounds = [];
    const routePoints = [];

    // Hotel for distance calculation
    const hotel = validPlaces.find(p => p.category === 'hotel');

    validPlaces.forEach((place, index) => {
        const placeNumber = index + 1;
        const isVisited = place.status === 'visited';
        const catInfo = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.other;

        // Custom Numbered Pin HTML
        const markerHtml = `
            <div class="custom-marker-wrapper ${isVisited ? 'marker-visited' : 'marker-planned'} category-${place.category}">
                <div class="marker-bubble">
                    <span class="marker-number">${placeNumber}</span>
                    ${isVisited ? '<span class="marker-check-badge">✓</span>' : ''}
                </div>
                <div class="marker-pin-tip"></div>
                <div class="marker-label">${escapeHtml(place.name)}</div>
            </div>
        `;

        const icon = L.divIcon({
            className: 'custom-leaflet-icon',
            html: markerHtml,
            iconSize: [38, 46],
            iconAnchor: [19, 44],
            popupAnchor: [0, -40]
        });

        // Distance from hotel in popup
        let distanceHtml = '';
        if (hotel && hotel.id !== place.id) {
            const distM = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
            const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
            const walkMin = Math.round(distM / 80);
            distanceHtml = `<div class="popup-distance">🏨 Otele: <strong>${distStr}</strong> (~${walkMin} dk yürüme)</div>`;
        }

        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

        const popupContent = `
            <div class="place-popup-card read-only-popup">
                <div class="popup-header">
                    <span class="popup-number-badge">#${placeNumber}</span>
                    <span class="popup-category-badge" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                        ${catInfo.emoji} ${catInfo.name}
                    </span>
                    <span class="popup-status-badge ${isVisited ? 'status-visited' : 'status-planned'}">
                        ${isVisited ? '✓ Gezildi' : '🟢 Gidilecek'}
                    </span>
                </div>
                <h4 class="popup-title">${escapeHtml(place.name)}</h4>
                ${place.address ? `<p class="popup-address">📍 ${escapeHtml(place.address)}</p>` : ''}
                ${distanceHtml}
                ${place.notes ? `<p class="popup-notes">📝 ${escapeHtml(place.notes)}</p>` : ''}
                ${place.estimated_cost > 0 ? `<div class="popup-cost">Tahmini Giriş/Masraf: <strong>${place.estimated_cost} ${place.currency}</strong></div>` : ''}
                <div class="popup-actions" style="margin-top: 12px;">
                    <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm btn-block">
                        🗺️ Google Haritalar'da Yol Tarifi Al
                    </a>
                </div>
            </div>
        `;

        const marker = L.marker([place.latitude, place.longitude], { icon })
            .bindPopup(popupContent, { maxWidth: 300, className: 'glass-popup' });

        shareMarkersLayer.addLayer(marker);
        latLngBounds.push([place.latitude, place.longitude]);
        routePoints.push(place);
    });

    // Draw Polyline & Segment Distance Pills
    let totalRouteMeters = 0;
    if (routePoints.length >= 2) {
        const polyCoords = [];

        for (let i = 0; i < routePoints.length; i++) {
            polyCoords.push([routePoints[i].latitude, routePoints[i].longitude]);

            // Distance pill between i and i + 1
            if (i < routePoints.length - 1) {
                const p1 = routePoints[i];
                const p2 = routePoints[i + 1];
                const segmentMeters = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
                totalRouteMeters += segmentMeters;

                const midLat = (p1.latitude + p2.latitude) / 2;
                const midLng = (p1.longitude + p2.longitude) / 2;
                const segText = segmentMeters >= 1000 ? `${(segmentMeters / 1000).toFixed(1)} km` : `${Math.round(segmentMeters)} m`;

                const distIcon = L.divIcon({
                    className: 'route-dist-label-container',
                    html: `<div class="route-dist-pill">➔ ${segText}</div>`,
                    iconSize: [64, 22],
                    iconAnchor: [32, 11]
                });

                L.marker([midLat, midLng], { icon: distIcon, interactive: false }).addTo(sharePolylineLayer);
            }
        }

        const polyline = L.polyline(polyCoords, {
            color: '#6366f1',
            weight: 4,
            opacity: 0.85,
            dashArray: '8, 8',
            className: 'route-polyline',
            lineJoin: 'round'
        });

        polyline.bindTooltip(`🗺️ Toplam Rota: ${totalRouteMeters >= 1000 ? (totalRouteMeters / 1000).toFixed(1) + ' km' : Math.round(totalRouteMeters) + ' m'}`, { sticky: true });
        sharePolylineLayer.addLayer(polyline);
    }

    // Update total distance metric on header
    const distEl = document.getElementById('share-trip-total-distance');
    if (distEl) {
        if (totalRouteMeters > 0) {
            const km = (totalRouteMeters / 1000).toFixed(1);
            const walkMin = Math.round(totalRouteMeters / 80);
            distEl.textContent = `🚶 Toplam Güzergah: ${km} km (~${walkMin} dk yürüme)`;
        } else {
            distEl.textContent = `🚶 Gezi Rotası`;
        }
    }

    if (latLngBounds.length > 0) {
        shareMapInstance.fitBounds(latLngBounds, { padding: [50, 50], maxZoom: 16 });
    }
}

/**
 * Render Infographic Places List matching the numbered pins (Read-Only)
 */
function renderSharePlacesList(places) {
    const listEl = document.getElementById('share-places-list');
    if (!listEl) return;

    if (places.length === 0) {
        listEl.innerHTML = `
            <div class="empty-places-card card glass text-center pad-40">
                <p class="text-muted">Bu rotada kayıtlı gezi noktası bulunmuyor.</p>
            </div>
        `;
        return;
    }

    const hotel = places.find(p => p.category === 'hotel');

    listEl.innerHTML = places.map((place, index) => {
        const placeNumber = index + 1;
        const isVisited = place.status === 'visited';
        const catInfo = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.other;

        // Distance from hotel
        let distBadge = '';
        if (hotel && hotel.id !== place.id) {
            const distM = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
            const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
            const walkMin = Math.round(distM / 80);
            distBadge = `<span class="place-distance-tag" title="Otele Uzaklık">🏨 Otele ${distStr} (~${walkMin} dk)</span>`;
        } else if (place.category === 'hotel') {
            distBadge = `<span class="place-distance-tag hotel-tag">📍 Ana Konaklama Üssü</span>`;
        }

        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

        return `
            <div class="place-card card glass share-place-card ${isVisited ? 'place-visited' : 'place-planned'}">
                <div class="share-card-left-badge">
                    <span class="share-place-number">${placeNumber}</span>
                </div>

                <div class="share-card-content">
                    <div class="place-card-header">
                        <div class="place-category-pill" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                            ${catInfo.emoji} ${catInfo.name}
                        </div>
                        <div class="place-status-wrapper">
                            <span class="badge-read-only ${isVisited ? 'badge-visited' : 'badge-planned'}">
                                ${isVisited ? '✓ Gezildi' : '🟢 Gidilecek'}
                            </span>
                        </div>
                    </div>

                    <div class="place-card-body">
                        <h3 class="place-name ${isVisited ? 'text-strikethrough' : ''}">${escapeHtml(place.name)}</h3>
                        ${place.address ? `<p class="place-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
                        ${distBadge ? `<div class="margin-bottom-8">${distBadge}</div>` : ''}
                        ${place.notes ? `<p class="place-notes">📝 ${escapeHtml(place.notes)}</p>` : ''}
                        ${place.estimated_cost > 0 ? `<div class="place-cost-tag">Giriş/Masraf: <strong>${place.estimated_cost} ${place.currency}</strong></div>` : ''}
                    </div>

                    <div class="share-card-actions">
                        <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">
                            <i data-lucide="navigation"></i> Google Haritalar'da Yol Tarifi
                        </a>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.focusShareMapAction(${place.latitude}, ${place.longitude})">
                            <i data-lucide="crosshair"></i> Haritada Göster
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Focus Share Map on selected coordinate
 */
window.focusShareMapAction = function(lat, lng) {
    if (!shareMapInstance) return;
    shareMapInstance.setView([lat, lng], 16, { animate: true });
    const mapEl = document.getElementById('share-map');
    if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

/* ==========================================================================
   CODEC & SECURITY HELPER FUNCTIONS (Base64URL, Symmetrical XOR, Hash)
   ========================================================================== */

export function hashPin(pin) {
    let hash = 0;
    const str = String(pin || '');
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16);
}

function toBase64Url(binStr) {
    const b64 = btoa(binStr);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64Url) {
    let b64 = (b64Url || '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) {
        b64 += '=';
    }
    return atob(b64);
}

function utf8ToBinaryString(str) {
    return encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => {
        return String.fromCharCode(parseInt(p1, 16));
    });
}

function binaryStringToUtf8(binStr) {
    return decodeURIComponent(Array.prototype.map.call(binStr, (c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
}

function xorCipher(binStr, pin) {
    if (!pin) return binStr;
    const key = String(pin);
    let out = '';
    for (let i = 0; i < binStr.length; i++) {
        out += String.fromCharCode(binStr.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
}

export function encodeRoutePayload(tripName, places, pin = '') {
    const compact = {
        t: tripName || 'Seyahat Rotası',
        p: (places || []).map((p, idx) => [
            p.name || '',
            typeof p.latitude === 'number' ? Math.round(p.latitude * 100000) / 100000 : 0,
            typeof p.longitude === 'number' ? Math.round(p.longitude * 100000) / 100000 : 0,
            p.category || 'other',
            p.status === 'visited' ? 1 : 0,
            p.address || '',
            p.notes || '',
            p.estimated_cost || 0
        ])
    };

    const jsonStr = JSON.stringify(compact);
    const binStr = utf8ToBinaryString(jsonStr);

    let pinHash = '';
    let payload = '';

    if (pin && pin.trim().length === 4) {
        const cleanPin = pin.trim();
        pinHash = hashPin(cleanPin);
        const cipherBin = xorCipher(binStr, cleanPin);
        payload = toBase64Url(cipherBin);
    } else {
        payload = toBase64Url(binStr);
    }

    return { payload, pinHash };
}

export function decodeRoutePayload(payload, pin = '', expectedPinHash = '') {
    if (expectedPinHash) {
        if (!pin || hashPin(pin) !== expectedPinHash) {
            throw new Error("Geçersiz veya hatalı PIN kodu!");
        }
    }

    const cipherBin = fromBase64Url(payload);
    const binStr = (expectedPinHash && pin) ? xorCipher(cipherBin, pin) : cipherBin;
    const jsonStr = binaryStringToUtf8(binStr);
    const compact = JSON.parse(jsonStr);

    return {
        tripName: compact.t || 'Seyahat Rotası',
        places: (compact.p || []).map((p, idx) => ({
            id: `shared_${idx}`,
            name: p[0] || '',
            latitude: p[1] || 0,
            longitude: p[2] || 0,
            category: p[3] || 'other',
            status: p[4] === 1 ? 'visited' : 'planned',
            address: p[5] || '',
            notes: p[6] || '',
            estimated_cost: p[7] || 0,
            visit_order: idx
        }))
    };
}

function slugify(text) {
    return (text || 'rota')
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .substring(0, 20);
}

/**
 * Haversine distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}
