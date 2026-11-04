// js/modules/share.js - Read-Only Share System with 4-Digit PIN Security, Cloud Short-Links & Infographic Layout

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast, escapeHtml } from '../utils.js';
import { PLACE_CATEGORIES } from './places.js';
import { openStoryModal } from './story_export.js';

let shareMapInstance = null;
let shareMarkersLayer = null;
let sharePolylineLayer = null;
let currentDecodedShareData = null;
let currentShareSlug = null;

// Guest view pending state
let pendingShareData = null;
let pendingSharePayload = null;
let pendingSharePinHash = null;
let pendingShareTripName = null;
let activeModalSlug = null;
let currentModalPin = null;
let isOpeningShareModal = false;
let sharePreviewSeq = 0;
let pinInputDebounceTimer = null;

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
                const pinBadgeEl = document.getElementById('share-pin-display-badge');
                if (pinBadgeEl) pinBadgeEl.style.display = 'none';
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

    // PIN input change with debounce
    const pinInput = document.getElementById('share-pin-code');
    if (pinInput) {
        pinInput.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '').slice(0, 4);
            e.target.value = val;
            const pinBadgeEl = document.getElementById('share-pin-display-badge');
            if (pinBadgeEl) {
                if (val.length === 4) {
                    pinBadgeEl.textContent = `PIN: ${val}`;
                    pinBadgeEl.style.display = 'inline-block';
                } else {
                    pinBadgeEl.style.display = 'none';
                }
            }
            clearTimeout(pinInputDebounceTimer);
            if (val.length === 4) {
                pinInputDebounceTimer = setTimeout(async () => {
                    currentModalPin = val;
                    if (state.activeTripId && activeModalSlug) {
                        try {
                            localStorage.setItem(`trip_share_${state.activeTripId}`, JSON.stringify({
                                slug: activeModalSlug,
                                pin: currentModalPin
                            }));
                        } catch (err) {}
                    }
                    await updateShareLinkPreview();
                }, 250);
            }
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
            if (url && !url.includes("hazırlanıyor") && !url.includes("oluşturuluyor")) {
                closeShareModal();
                window.location.href = url;
            }
        });
    }

    // Guest Place Suggestion Handlers
    const btnGuestSuggest = document.getElementById('btn-guest-suggest-place');
    const modalGuestSuggest = document.getElementById('modal-guest-suggest-place');
    const btnCloseGuestSuggest = document.getElementById('btn-close-guest-suggest');
    const btnCancelGuestSuggest = document.getElementById('btn-cancel-guest-suggest');
    const guestSuggestForm = document.getElementById('guest-suggest-form');

    if (btnGuestSuggest && modalGuestSuggest) {
        btnGuestSuggest.addEventListener('click', () => {
            if (guestSuggestForm) guestSuggestForm.reset();
            modalGuestSuggest.classList.remove('hidden');
            const nameInp = document.getElementById('guest-suggest-name');
            if (nameInp) nameInp.focus();
        });
    }

    const closeGuestSuggestModal = () => {
        if (modalGuestSuggest) modalGuestSuggest.classList.add('hidden');
    };

    if (btnCloseGuestSuggest) btnCloseGuestSuggest.addEventListener('click', closeGuestSuggestModal);
    if (btnCancelGuestSuggest) btnCancelGuestSuggest.addEventListener('click', closeGuestSuggestModal);

    if (guestSuggestForm) {
        guestSuggestForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await handleGuestSuggestSubmit();
        });
    }

    // Guest Open Story Export
    const btnGuestStory = document.getElementById('btn-guest-open-story-export');
    if (btnGuestStory) {
        btnGuestStory.addEventListener('click', () => {
            if (!currentDecodedShareData) {
                showToast("Görüntülenecek rota verisi bulunamadı.", "warning");
                return;
            }
            const rawPlaces = currentDecodedShareData.places || [];
            const valid = rawPlaces.filter(p => p.latitude && p.longitude);
            let totalDist = 0;
            for (let i = 0; i < valid.length - 1; i++) {
                totalDist += calculateDistance(valid[i].latitude, valid[i].longitude, valid[i+1].latitude, valid[i+1].longitude);
            }
            openStoryModal({
                title: currentDecodedShareData.tripName || 'Seyahat Rotası',
                subtitle: currentDecodedShareData.startDate ? `${currentDecodedShareData.startDate} — ${currentDecodedShareData.endDate || ''}` : '',
                places: valid,
                totalDistMeters: totalDist
            });
        });
    }

    // Setup 4-digit PIN Gate inputs
    setupPinGateInputs();
}

/**
 * Handle Guest Suggestion Submission (allows friends to recommend places with 1-click)
 */
async function handleGuestSuggestSubmit() {
    const modalGuestSuggest = document.getElementById('modal-guest-suggest-place');
    const nameInput = document.getElementById('guest-suggest-name');
    const catInput = document.getElementById('guest-suggest-category');
    const authorInput = document.getElementById('guest-suggest-author');
    const notesInput = document.getElementById('guest-suggest-notes');
    const submitBtn = document.getElementById('btn-save-guest-suggest');

    const name = nameInput ? nameInput.value.trim() : '';
    const category = catInput ? catInput.value : 'cafe';
    const author = authorInput ? authorInput.value.trim() : '';
    const notes = notesInput ? notesInput.value.trim() : '';

    if (!name) {
        showToast("Lütfen bir mekan veya konum adı girin.", "warning");
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Ekleniyor...';
    }

    try {
        let lat = null;
        let lng = null;

        // Try geocoding place name with OpenStreetMap Nominatim
        try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(name)}&limit=1`, {
                headers: { 'Accept-Language': 'tr' }
            });
            if (geoRes.ok) {
                const results = await geoRes.json();
                if (results && results.length > 0) {
                    lat = parseFloat(results[0].lat);
                    lng = parseFloat(results[0].lon);
                }
            }
        } catch (e) {
            console.warn("Geocoding failed for guest suggest:", e);
        }

        // Fallback: If not found, use center of existing places or default
        if (!lat || !lng) {
            if (currentDecodedShareData && currentDecodedShareData.places && currentDecodedShareData.places.length > 0) {
                const firstWithCoords = currentDecodedShareData.places.find(p => p.latitude && p.longitude);
                if (firstWithCoords) {
                    lat = firstWithCoords.latitude + (Math.random() - 0.5) * 0.008;
                    lng = firstWithCoords.longitude + (Math.random() - 0.5) * 0.008;
                }
            }
            if (!lat || !lng) {
                lat = 41.0082;
                lng = 28.9784;
            }
        }

        const noteHeader = author ? `[Öneren: ${author}]` : '[Grup Önerisi]';
        const finalNotes = notes ? `${noteHeader} ${notes}` : noteHeader;

        const newPlace = {
            id: 'guest_' + Date.now(),
            name: name,
            category: category,
            status: 'planned',
            latitude: lat,
            longitude: lng,
            notes: finalNotes,
            is_suggested: true,
            estimated_cost: 0,
            currency: 'TRY',
            visit_order: (currentDecodedShareData?.places?.length || 0) + 1
        };

        if (!currentDecodedShareData) {
            currentDecodedShareData = { tripName: 'Grup Rotası', places: [] };
        }
        currentDecodedShareData.places.push(newPlace);

        // Save back to cloud table if this is a cloud route slug
        if (currentShareSlug) {
            try {
                await db.saveSharedRoute(currentShareSlug, currentDecodedShareData.tripName, currentDecodedShareData.places, pendingSharePinHash || null);
                localStorage.setItem(`shared_route_${currentShareSlug}`, JSON.stringify({
                    tripName: currentDecodedShareData.tripName,
                    places: currentDecodedShareData.places,
                    pinHash: pendingSharePinHash
                }));
            } catch (err) {
                console.warn("Failed to persist guest suggestion to DB:", err);
            }
        }

        // Re-render map and places list
        renderShareMap(currentDecodedShareData.places);
        renderSharePlacesList(currentDecodedShareData.places);

        const countEl = document.getElementById('share-trip-place-count');
        if (countEl) countEl.textContent = `${currentDecodedShareData.places.length} Gezi Noktası`;

        if (modalGuestSuggest) modalGuestSuggest.classList.add('hidden');
        showToast("Mekan öneriniz rotaya başarıyla eklendi!", "success");
    } catch (err) {
        console.error("Guest suggest error:", err);
        showToast("Öneri eklenirken hata: " + err.message, "danger");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Öneriyi Ekle';
        }
    }
}

/**
 * Open Share Modal for the active trip
 */
export async function openShareModal() {
    if (isOpeningShareModal) return;
    isOpeningShareModal = true;

    try {
        const modal = document.getElementById('modal-share-route');
        if (!modal) return;

        if (!state.activeTripId || !state.placesList || state.placesList.length === 0) {
            showToast("Paylaşmak için seyahatinizde en az 1 gezi noktası bulunmalıdır.", "warning");
            return;
        }

        const currentTrip = state.tripsList.find(t => t.id === state.activeTripId) || { name: 'Seyahat Rotası' };

        // Check if there is an existing cached share session for this trip
        let savedShare = null;
        try {
            const raw = localStorage.getItem(`trip_share_${state.activeTripId}`);
            if (raw) savedShare = JSON.parse(raw);
        } catch (e) {}

        if (savedShare && savedShare.slug && savedShare.pin) {
            activeModalSlug = savedShare.slug;
            currentModalPin = savedShare.pin;
        } else {
            const slugBase = slugify(currentTrip.name).split('-')[0] || 'rota';
            const randomSuffix = Math.floor(1000 + Math.random() * 9000);
            activeModalSlug = `${slugBase}-${randomSuffix}`;
            currentModalPin = Math.floor(1000 + Math.random() * 9000).toString();
            try {
                localStorage.setItem(`trip_share_${state.activeTripId}`, JSON.stringify({
                    slug: activeModalSlug,
                    pin: currentModalPin
                }));
            } catch (e) {}
        }

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

        // Sync PIN value to input & display badge
        const pinInput = document.getElementById('share-pin-code');
        if (pinInput) pinInput.value = currentModalPin;

        const pinBadgeEl = document.getElementById('share-pin-display-badge');
        if (pinBadgeEl) {
            pinBadgeEl.textContent = `PIN: ${currentModalPin}`;
            pinBadgeEl.style.display = 'inline-block';
        }

        const linkResultInput = document.getElementById('share-link-result');
        if (linkResultInput) linkResultInput.value = "Kısa link ve PIN hazırlanıyor...";

        modal.classList.remove('hidden');
        if (window.lucide) window.lucide.createIcons();

        await updateShareLinkPreview();
    } finally {
        isOpeningShareModal = false;
    }
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
    currentModalPin = randomPin;
    const pinInput = document.getElementById('share-pin-code');
    if (pinInput) pinInput.value = randomPin;

    const pinBadgeEl = document.getElementById('share-pin-display-badge');
    if (pinBadgeEl) {
        pinBadgeEl.textContent = `PIN: ${randomPin}`;
        pinBadgeEl.style.display = 'inline-block';
    }

    if (state.activeTripId && activeModalSlug) {
        try {
            localStorage.setItem(`trip_share_${state.activeTripId}`, JSON.stringify({
                slug: activeModalSlug,
                pin: randomPin
            }));
        } catch (e) {}
    }
}

/**
 * Generate share URL:
 * 1. Checks Supabase shared_routes table -> Generates ultra-short URL (e.g. #s=atina-4821&h=1a4e1b)
 * 2. If table not yet created -> Uses compact URL-safe Base64URL fallback
 */
async function updateShareLinkPreview() {
    const currentSeq = ++sharePreviewSeq;
    const currentTrip = state.tripsList.find(t => t.id === state.activeTripId) || { name: 'Seyahat Rotası' };
    const pinCheckbox = document.getElementById('share-pin-enable');
    const pinInput = document.getElementById('share-pin-code');
    const linkResultInput = document.getElementById('share-link-result');
    const pinBadgeEl = document.getElementById('share-pin-display-badge');
    const btnWhatsapp = document.getElementById('btn-whatsapp-share');
    const btnCopyLink = document.getElementById('btn-copy-share-link');

    if (!activeModalSlug) {
        const slugBase = slugify(currentTrip.name).split('-')[0] || 'rota';
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        activeModalSlug = `${slugBase}-${randomSuffix}`;
    }
    const slug = activeModalSlug;

    const isPinEnabled = pinCheckbox && pinCheckbox.checked;
    const rawPin = pinInput ? pinInput.value.replace(/\D/g, '').trim() : '';
    const pin = (isPinEnabled && rawPin.length === 4) ? rawPin : '';
    const pinHash = (isPinEnabled && pin.length === 4) ? hashPin(pin) : '';

    if (linkResultInput) linkResultInput.value = "Kısa link oluşturuluyor...";
    if (btnWhatsapp) btnWhatsapp.disabled = true;
    if (btnCopyLink) btnCopyLink.disabled = true;

    // 1. Prepare clean places payload
    const compactPlaces = (state.placesList || []).map((p, idx) => ({
        id: p.id || `p_${idx}`,
        name: p.name || '',
        category: p.category || 'other',
        status: p.status || 'planned',
        latitude: p.latitude !== undefined ? Number(p.latitude) : 0,
        longitude: p.longitude !== undefined ? Number(p.longitude) : 0,
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

    // Ignore stale request if a newer update started in the meantime
    if (currentSeq !== sharePreviewSeq) return;

    // 4. Form final URL:
    // If cloud saved: ULTRA-SHORT link with fail-safe PIN hash (e.g. https://.../#s=atina-4821&h=1a4e1b)
    // If not: Compact URL-safe Base64URL fallback
    const baseUrl = window.location.origin + window.location.pathname;
    let fullUrl = '';

    if (savedToCloud) {
        fullUrl = `${baseUrl}#s=${slug}`;
        if (isPinEnabled && pinHash) {
            fullUrl += `&h=${pinHash}`;
        }
    } else {
        const { payload } = encodeRoutePayload(currentTrip.name, compactPlaces, isPinEnabled ? pin : '');
        let hash = `#share?id=${slug}&d=${payload}`;
        if (isPinEnabled && pinHash) {
            hash += `&h=${pinHash}`;
        }
        fullUrl = `${baseUrl}${hash}`;
    }

    if (linkResultInput) linkResultInput.value = fullUrl;
    if (btnWhatsapp) btnWhatsapp.disabled = false;
    if (btnCopyLink) btnCopyLink.disabled = false;

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
    if (!linkInput || !linkInput.value || linkInput.value.includes("oluşturuluyor") || linkInput.value.includes("hazırlanıyor")) {
        showToast("Link hazırlanıyor, lütfen 1 saniye bekleyin...", "warning");
        return;
    }

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
        await navigator.clipboard.writeText(pinInput.value.trim());
        showToast(`🔑 PIN kodu (${pinInput.value.trim()}) panoya kopyalandı!`, "success");
    } catch (e) {
        showToast(`PIN: ${pinInput.value.trim()}`, "info");
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

    if (!linkInput || !linkInput.value || linkInput.value.includes("oluşturuluyor") || linkInput.value.includes("hazırlanıyor")) {
        showToast("Link hazırlanıyor, lütfen 1 saniye bekleyin...", "warning");
        return;
    }

    const tripName = tripNameEl ? tripNameEl.textContent : 'Seyahat';
    const link = linkInput.value;
    const isPin = pinCheckbox && pinCheckbox.checked && pinInput && pinInput.value.trim().length === 4;
    const pin = isPin ? pinInput.value.trim() : '';

    let text = `*${tripName}*\nTravellerMobi ortak seyahat rotamız hazırlandı:\n\n${link}\n`;
    if (isPin) {
        text += `\n*Giriş PIN Kodu:* *${pin}*\n`;
    }
    text += `\nHesap oluşturmadan tek tıkla rotayı inceleyebilir ve "+ Mekan Öner" butonuyla yeni yerler ekleyebilirsin!`;

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

    if (hash.startsWith('#s=') || hash.startsWith('#s?')) {
        const afterPrefix = hash.replace(/^#s[=?]/, '');
        // Extract slug and any query parameters (like &h=... or ?h=...)
        const [cleanSlug, queryPart] = afterPrefix.split(/[?&](.+)/);
        slug = cleanSlug ? cleanSlug.replace(/\/+$/, '').trim() : null;
        if (queryPart) {
            const params = new URLSearchParams(queryPart);
            payload = params.get('d');
            pinHashFromUrl = params.get('h');
        } else if (cleanSlug && cleanSlug.includes('&h=')) {
            const parts = cleanSlug.split('&h=');
            slug = parts[0];
            pinHashFromUrl = parts[1];
        }
    } else {
        const queryString = hash.includes('?') ? hash.substring(hash.indexOf('?') + 1) : '';
        const params = new URLSearchParams(queryString);
        slug = (params.get('id') || params.get('s') || '').replace(/\/+$/, '').trim() || null;
        payload = params.get('d');
        pinHashFromUrl = params.get('h');
    }

    currentShareSlug = slug;

    // 1. Try to fetch from Supabase Cloud Table
    if (slug) {
        try {
            const cloudRoute = await db.getSharedRoute(slug);
            if (cloudRoute && cloudRoute.places) {
                let placesData = cloudRoute.places;
                if (typeof placesData === 'string') {
                    try { placesData = JSON.parse(placesData); } catch (e) {}
                }
                pendingShareData = placesData;
                pendingShareTripName = cloudRoute.trip_name || 'Seyahat Rotası';
                // Priority: Pin hash from URL parameter, fallback to database record's pin_hash
                pendingSharePinHash = pinHashFromUrl || (cloudRoute.pin_hash ? String(cloudRoute.pin_hash).trim() : null);
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
                let placesData = parsed.places;
                if (typeof placesData === 'string') {
                    try { placesData = JSON.parse(placesData); } catch (e) {}
                }
                pendingShareData = placesData;
                pendingShareTripName = parsed.tripName;
                pendingSharePinHash = pinHashFromUrl || (parsed.pinHash ? String(parsed.pinHash).trim() : null);
            }
        } catch (e) {}
    }

    // 3. Fallback to URL Payload (&d=...)
    if (!pendingShareData && payload) {
        pendingSharePayload = payload;
        pendingSharePinHash = pinHashFromUrl ? String(pinHashFromUrl).trim() : null;
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

        setTimeout(() => {
            if (shareMapInstance) shareMapInstance.invalidateSize();
        }, 200);
    } catch (err) {
        console.error("Failed to decode share data:", err);
        showToast("Rota yüklenemedi: " + err.message, "danger");
    }
}

/**
 * Setup 4-digit PIN Gate inputs (Unified input + reactive visual digit boxes)
 */
function setupPinGateInputs() {
    const unifiedInput = document.getElementById('pin-unified-input');
    const digitBoxes = document.querySelectorAll('.pin-digit-box');
    const submitBtn = document.getElementById('btn-submit-share-pin');
    const container = document.getElementById('pin-boxes-container');

    if (container && unifiedInput) {
        container.addEventListener('click', () => {
            unifiedInput.focus();
        });
    }

    if (unifiedInput) {
        unifiedInput.addEventListener('input', (e) => {
            const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
            e.target.value = raw;
            updateVisualDigitBoxes(raw);
            if (raw.length === 4) {
                handlePinGateSubmit();
            }
        });

        unifiedInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handlePinGateSubmit();
            }
        });

        unifiedInput.addEventListener('focus', () => {
            updateVisualDigitBoxes(unifiedInput.value);
        });

        unifiedInput.addEventListener('blur', () => {
            digitBoxes.forEach(b => b.classList.remove('active'));
        });
    }

    // Fallback if legacy separate inputs are present in DOM
    digitBoxes.forEach((box, index) => {
        if (box.tagName === 'INPUT') {
            box.addEventListener('input', (e) => {
                const val = e.target.value.replace(/\D/g, '');
                e.target.value = val ? val[0] : '';
                if (val && index < digitBoxes.length - 1) {
                    digitBoxes[index + 1].focus();
                }
                checkAutoSubmitPin();
            });

            box.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !e.target.value && index > 0) {
                    digitBoxes[index - 1].focus();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    handlePinGateSubmit();
                }
            });
        }
    });

    if (submitBtn) {
        submitBtn.addEventListener('click', handlePinGateSubmit);
    }
}

function updateVisualDigitBoxes(val) {
    const digitBoxes = document.querySelectorAll('.pin-digit-box');
    const clean = String(val || '').replace(/\D/g, '').slice(0, 4);
    digitBoxes.forEach((box, i) => {
        const char = clean[i] || '';
        box.textContent = char;
        if (char) {
            box.classList.add('filled');
        } else {
            box.classList.remove('filled');
        }
        if (i === Math.min(clean.length, 3)) {
            box.classList.add('active');
        } else {
            box.classList.remove('active');
        }
    });
}

function clearPinGateInputs() {
    const unifiedInput = document.getElementById('pin-unified-input');
    if (unifiedInput) {
        unifiedInput.value = '';
    }
    const digitBoxes = document.querySelectorAll('.pin-digit-box');
    digitBoxes.forEach(box => {
        if (box.tagName === 'INPUT') box.value = '';
        else box.textContent = '';
        box.classList.remove('filled');
        box.classList.remove('active');
    });
    if (digitBoxes[0]) digitBoxes[0].classList.add('active');
}

function focusFirstPinInput() {
    setTimeout(() => {
        const unified = document.getElementById('pin-unified-input');
        if (unified) {
            unified.focus();
            updateVisualDigitBoxes(unified.value);
            return;
        }
        const first = document.querySelector('.pin-digit-box');
        if (first && first.focus) first.focus();
    }, 150);
}

function checkAutoSubmitPin() {
    const unifiedInput = document.getElementById('pin-unified-input');
    let pin = '';
    if (unifiedInput) {
        pin = unifiedInput.value.replace(/\D/g, '').trim();
    } else {
        const inputs = document.querySelectorAll('.pin-digit-box');
        inputs.forEach(input => pin += (input.value || input.textContent || '').trim());
        pin = pin.replace(/\D/g, '').trim();
    }
    if (pin.length === 4) {
        handlePinGateSubmit();
    }
}

let isSubmittingPin = false;

function handlePinGateSubmit() {
    if (isSubmittingPin) return;

    const unifiedInput = document.getElementById('pin-unified-input');
    let pin = '';
    if (unifiedInput) {
        pin = unifiedInput.value.replace(/\D/g, '').trim();
    } else {
        const inputs = document.querySelectorAll('.pin-digit-box');
        inputs.forEach(input => pin += (input.value || input.textContent || '').trim());
        pin = pin.replace(/\D/g, '').trim();
    }

    if (pin.length !== 4) {
        showToast("Lütfen 4 haneli PIN kodunu eksiksiz girin", "warning");
        return;
    }

    // Verify PIN Hash (case-insensitive & trimmed)
    const enteredHash = hashPin(pin).toLowerCase();
    const expectedHash = String(pendingSharePinHash || '').trim().toLowerCase();

    console.log("Verifying PIN Gate:", { pin, enteredHash, expectedHash });

    if (expectedHash && enteredHash !== expectedHash) {
        showToast("Hatalı PIN kodu! Lütfen size iletilen 4 haneli PIN kodunu kontrol ediniz.", "danger");
        const box = document.getElementById('pin-boxes-container');
        if (box) {
            box.classList.add('shake-error');
            setTimeout(() => box.classList.remove('shake-error'), 600);
        }
        clearPinGateInputs();
        focusFirstPinInput();
        return;
    }

    isSubmittingPin = true;
    try {
        let routeData = null;
        if (pendingShareData) {
            routeData = { tripName: pendingShareTripName, places: pendingShareData };
        } else if (pendingSharePayload) {
            routeData = decodeRoutePayload(pendingSharePayload, pin, pendingSharePinHash);
        }

        if (!routeData) {
            throw new Error("Rota verisi çözülemedi veya rota boş.");
        }

        currentDecodedShareData = routeData;
        const pinGate = document.getElementById('share-pin-gate');
        const shareContent = document.getElementById('share-content-container');

        showToast("🔓 PIN kodu doğrulandı! Rota açılıyor...", "success");
        if (pinGate) pinGate.classList.add('hidden');
        if (shareContent) shareContent.classList.remove('hidden');

        try {
            renderInfographicShareContent(routeData);
        } catch (renderErr) {
            console.error("Error rendering infographic content:", renderErr);
            showToast("Rota içeriği gösterilirken bir hata oluştu: " + renderErr.message, "warning");
        }

        // Force Leaflet map resize after container becomes visible
        setTimeout(() => {
            if (shareMapInstance) {
                shareMapInstance.invalidateSize();
            }
        }, 150);
        setTimeout(() => {
            if (shareMapInstance) {
                shareMapInstance.invalidateSize();
            }
        }, 500);
    } catch (err) {
        console.error("PIN check failed:", err);
        showToast("Rota açılamadı: " + err.message, "danger");
        clearPinGateInputs();
        focusFirstPinInput();
    } finally {
        isSubmittingPin = false;
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

    if (titleEl) titleEl.textContent = data.tripName || 'Seyahat Rotası';
    
    if (datesEl) {
        if (data.startDate && data.endDate) {
            datesEl.textContent = `${data.startDate} — ${data.endDate}`;
        } else if (data.startDate) {
            datesEl.textContent = data.startDate;
        } else {
            datesEl.textContent = 'Ortak Seyahat Güzergahı';
        }
    }

    let rawPlaces = data.places || [];
    if (typeof rawPlaces === 'string') {
        try { rawPlaces = JSON.parse(rawPlaces); } catch (e) { rawPlaces = []; }
    }
    const places = (Array.isArray(rawPlaces) ? rawPlaces : []).map((p, idx) => ({
        id: p.id || `p_${idx}`,
        name: p.name || p.n || '',
        category: p.category || p.c || 'other',
        status: p.status || p.s || 'planned',
        latitude: p.latitude !== undefined ? Number(p.latitude) : (p.lt !== undefined ? Number(p.lt) : 0),
        longitude: p.longitude !== undefined ? Number(p.longitude) : (p.ln !== undefined ? Number(p.ln) : 0),
        address: p.address || p.a || '',
        notes: p.notes || p.nt || '',
        is_suggested: !!p.is_suggested,
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

    if (countEl) countEl.textContent = `${places.length} Gezi Noktası`;

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
            distanceHtml = `<div class="popup-distance"><i data-lucide="hotel" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;"></i> Otele: <strong>${distStr}</strong> (~${walkMin} dk yürüme)</div>`;
        }

        const isGroupSuggested = place.is_suggested || (place.notes && (place.notes.includes('[Öneren:') || place.notes.includes('[Grup Önerisi]')));
        const suggestedBadge = isGroupSuggested ? `<span class="badge-group-suggested" style="margin-left: 6px;"><i data-lucide="users" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px;"></i> Grup Önerisi</span>` : '';

        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

        const popupContent = `
            <div class="place-popup-card read-only-popup">
                <div class="popup-header">
                    <span class="popup-number-badge">#${placeNumber}</span>
                    <span class="popup-category-badge" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                        <i data-lucide="${catInfo.icon || 'map-pin'}" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px;"></i>${catInfo.name}
                    </span>
                    <span class="popup-status-badge ${isVisited ? 'status-visited' : 'status-planned'}">
                        ${isVisited ? 'Ziyaret Edildi' : 'Gidilecek'}
                    </span>
                    ${suggestedBadge}
                </div>
                <h4 class="popup-title">${escapeHtml(place.name)}</h4>
                ${place.address ? `<p class="popup-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
                ${distanceHtml}
                ${place.notes ? `<p class="popup-notes">${escapeHtml(place.notes)}</p>` : ''}
                ${place.estimated_cost > 0 ? `<div class="popup-cost">Tahmini Masraf: <strong>${place.estimated_cost} ${place.currency || 'TRY'}</strong></div>` : ''}
                <div class="popup-actions" style="margin-top: 12px;">
                    <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm btn-block">
                        <i data-lucide="navigation"></i> Google Haritalar'da Yol Tarifi
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

        polyline.bindTooltip(`Toplam Rota: ${totalRouteMeters >= 1000 ? (totalRouteMeters / 1000).toFixed(1) + ' km' : Math.round(totalRouteMeters) + ' m'}`, { sticky: true });
        sharePolylineLayer.addLayer(polyline);
    }

    // Update total distance metric on header
    const distEl = document.getElementById('share-trip-total-distance');
    if (distEl) {
        if (totalRouteMeters > 0) {
            const km = (totalRouteMeters / 1000).toFixed(1);
            const walkMin = Math.round(totalRouteMeters / 80);
            distEl.innerHTML = `<i data-lucide="route" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;"></i> Toplam Güzergah: ${km} km (~${walkMin} dk)`;
        } else {
            distEl.innerHTML = `<i data-lucide="route" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;"></i> Gezi Rotası`;
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
            distBadge = `<span class="place-distance-tag" title="Otele Uzaklık"><i data-lucide="hotel" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px;"></i> Otele ${distStr} (~${walkMin} dk)</span>`;
        } else if (place.category === 'hotel') {
            distBadge = `<span class="place-distance-tag hotel-tag">Konaklama Noktası</span>`;
        }

        const isGroupSuggested = place.is_suggested || (place.notes && (place.notes.includes('[Öneren:') || place.notes.includes('[Grup Önerisi]')));
        const suggestedBadge = isGroupSuggested ? `<span class="badge-group-suggested"><i data-lucide="users" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px;"></i> Grup Önerisi</span>` : '';

        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

        return `
            <div class="place-card card glass share-place-card ${isVisited ? 'place-visited' : 'place-planned'}">
                <div class="share-card-left-badge">
                    <span class="share-place-number">${placeNumber}</span>
                </div>

                <div class="share-card-content">
                    <div class="place-card-header">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <div class="place-category-pill" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                                <i data-lucide="${catInfo.icon || 'map-pin'}" style="width:11px;height:11px;vertical-align:-1px;margin-right:3px;"></i>${catInfo.name}
                            </div>
                            ${suggestedBadge}
                        </div>
                        <div class="place-status-wrapper">
                            <span class="badge-read-only ${isVisited ? 'badge-visited' : 'badge-planned'}">
                                ${isVisited ? 'Ziyaret Edildi' : 'Gidilecek'}
                            </span>
                        </div>
                    </div>

                    <div class="place-card-body">
                        <h3 class="place-name ${isVisited ? 'text-strikethrough' : ''}">${escapeHtml(place.name)}</h3>
                        ${place.address ? `<p class="place-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
                        ${distBadge ? `<div class="margin-bottom-8">${distBadge}</div>` : ''}
                        ${place.notes ? `<p class="place-notes">${escapeHtml(place.notes)}</p>` : ''}
                        ${place.estimated_cost > 0 ? `<div class="place-cost-tag">Giriş/Masraf: <strong>${place.estimated_cost} ${place.currency || 'TRY'}</strong></div>` : ''}
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
    const str = String(pin || '').replace(/\D/g, '').trim();
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
    const key = String(pin).replace(/\D/g, '').trim();
    if (!key) return binStr;
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

    const cleanPin = String(pin || '').replace(/\D/g, '').trim();
    if (cleanPin.length === 4) {
        pinHash = hashPin(cleanPin);
        const cipherBin = xorCipher(binStr, cleanPin);
        payload = toBase64Url(cipherBin);
    } else {
        payload = toBase64Url(binStr);
    }

    return { payload, pinHash };
}

export function decodeRoutePayload(payload, pin = '', expectedPinHash = '') {
    const cleanPin = String(pin || '').replace(/\D/g, '').trim();
    if (expectedPinHash) {
        if (!cleanPin || hashPin(cleanPin) !== String(expectedPinHash).trim().toLowerCase()) {
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
