// js/modules/places.js - Interactive Map & Places Management Module for TravellerMobi

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast, escapeHtml } from '../utils.js';

let mapInstance = null;
let markersLayer = null;
let tempDraftMarker = null;
let routePolylineLayer = null;
let showRouteLine = true;
let userLocationMarker = null;
let userLocationCircle = null;
let currentUserCoords = null; // { lat, lng }
let isFullscreenMap = false;

// Expanded Category icons and colors (Google Maps / Mapstr / Wanderlog inspired)
export const PLACE_CATEGORIES = {
    cafe: { name: 'Kafe & Kahve', icon: 'coffee', emoji: '☕', color: '#ec4899', bg: 'rgba(236, 72, 153, 0.2)' },
    food: { name: 'Restoran & Yemek', icon: 'utensils', emoji: '🍽️', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)' },
    bar: { name: 'Bar & Gece Hayatı', icon: 'glass-water', emoji: '🍸', color: '#a855f7', bg: 'rgba(168, 85, 247, 0.2)' },
    bakery: { name: 'Fırın & Tatlı', icon: 'croissant', emoji: '🥐', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)' },
    viewpoint: { name: 'Park & Manzara', icon: 'trees', emoji: '🌳', color: '#10b981', bg: 'rgba(16, 185, 129, 0.2)' },
    museum: { name: 'Müze & Sanat', icon: 'landmark', emoji: '🏛️', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.2)' },
    historical: { name: 'Tarihi Alan & Anıt', icon: 'monument', emoji: '🗿', color: '#d97706', bg: 'rgba(217, 119, 6, 0.2)' },
    shopping: { name: 'Alışveriş & Butik', icon: 'shopping-bag', emoji: '🛍️', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
    hotel: { name: 'Otel & Konaklama', icon: 'home', emoji: '🏨', color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.2)' },
    other: { name: 'Favori Nokta / Diğer', icon: 'map-pin', emoji: '📍', color: '#64748b', bg: 'rgba(100, 116, 139, 0.2)' }
};

/**
 * Initialize event listeners for Places & Map module
 */
export function initPlacesEvents() {
    // Add Place Button
    const btnAdd = document.getElementById('btn-add-place');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => openPlaceModal());
    }

    // Modal Close and Cancel
    const btnClose = document.getElementById('btn-close-place-modal');
    const btnCancel = document.getElementById('btn-cancel-place-modal');
    if (btnClose) btnClose.addEventListener('click', closePlaceModal);
    if (btnCancel) btnCancel.addEventListener('click', closePlaceModal);

    // Trip Selector Change
    const tripSelector = document.getElementById('places-trip-selector');
    if (tripSelector) {
        tripSelector.addEventListener('change', async (e) => {
            state.activeTripId = e.target.value;
            await loadPlacesData();
        });
    }

    // Search Input Real-Time Filter
    const searchInput = document.getElementById('places-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            renderPlacesList();
            renderMapMarkers();
        });
    }

    // Category & Status Filter Buttons
    const filterContainer = document.getElementById('places-filter-bar');
    if (filterContainer) {
        filterContainer.addEventListener('click', (e) => {
            const pill = e.target.closest('.filter-pill');
            if (!pill) return;
            filterContainer.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.activePlaceFilter = pill.dataset.filter || 'all';
            renderPlacesList();
            renderMapMarkers();
        });
    }

    // Fullscreen Map Toggle Button
    const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen-map');
    const mapCardContainer = document.querySelector('.map-card-container');
    const fullscreenMapText = document.getElementById('fullscreen-map-text');
    if (btnToggleFullscreen && mapCardContainer) {
        btnToggleFullscreen.addEventListener('click', () => {
            isFullscreenMap = !isFullscreenMap;
            if (isFullscreenMap) {
                mapCardContainer.classList.add('map-fullscreen');
                if (fullscreenMapText) fullscreenMapText.textContent = 'Küçült';
            } else {
                mapCardContainer.classList.remove('map-fullscreen');
                if (fullscreenMapText) fullscreenMapText.textContent = 'Tam Ekran';
            }
            setTimeout(() => {
                if (mapInstance) mapInstance.invalidateSize();
            }, 250);
        });
    }

    // Route Polyline Toggle Button
    const btnToggleRoute = document.getElementById('btn-toggle-route-line');
    const routeStatusText = document.getElementById('route-line-status-text');
    if (btnToggleRoute) {
        btnToggleRoute.addEventListener('click', () => {
            showRouteLine = !showRouteLine;
            if (routeStatusText) {
                routeStatusText.textContent = showRouteLine ? 'Rota: Açık' : 'Rota: Kapalı';
            }
            if (showRouteLine) {
                btnToggleRoute.classList.remove('btn-secondary');
                btnToggleRoute.classList.add('btn-primary');
            } else {
                btnToggleRoute.classList.remove('btn-primary');
                btnToggleRoute.classList.add('btn-secondary');
            }
            renderRoutePolyline();
        });
    }

    // Bottom Sheet Close Button & Backdrop
    const btnCloseSheet = document.getElementById('btn-close-bottom-sheet');
    const sheetBackdrop = document.getElementById('bottom-sheet-backdrop');
    if (btnCloseSheet) btnCloseSheet.addEventListener('click', closePlaceBottomSheet);
    if (sheetBackdrop) sheetBackdrop.addEventListener('click', closePlaceBottomSheet);

    // Modal Delete Place Button
    const btnDeleteModal = document.getElementById('btn-delete-place-modal');
    if (btnDeleteModal) {
        btnDeleteModal.addEventListener('click', async () => {
            const placeId = document.getElementById('place-id').value;
            if (placeId) {
                closePlaceModal();
                await window.deletePlaceAction(placeId);
            }
        });
    }

    // Geocoding Search inside Modal
    const btnSearch = document.getElementById('btn-search-place-location');
    const inputSearch = document.getElementById('place-search-query');
    if (btnSearch && inputSearch) {
        btnSearch.addEventListener('click', () => handleLocationSearch());
        inputSearch.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleLocationSearch();
            }
        });
    }

    // Place Form Submit
    const placeForm = document.getElementById('place-form');
    if (placeForm) {
        placeForm.addEventListener('submit', handlePlaceFormSubmit);
    }

    // Location Permission Modal Controls
    const locModal = document.getElementById('modal-location-permission');
    const btnCloseLocModal = document.getElementById('btn-close-location-modal');
    const btnDismissLocModal = document.getElementById('btn-dismiss-location-modal');
    const btnRetryLocation = document.getElementById('btn-retry-location-permission');
    if (locModal) {
        locModal.addEventListener('click', (e) => {
            if (e.target === locModal) closeLocationPermissionModal();
        });
    }
    if (btnCloseLocModal) btnCloseLocModal.addEventListener('click', closeLocationPermissionModal);
    if (btnDismissLocModal) btnDismissLocModal.addEventListener('click', closeLocationPermissionModal);

    const tabBtnIos = document.getElementById('tab-btn-ios');
    const tabBtnAndroid = document.getElementById('tab-btn-android');
    const tabBtnPc = document.getElementById('tab-btn-pc');

    if (tabBtnIos) tabBtnIos.addEventListener('click', () => switchLocationTab('ios'));
    if (tabBtnAndroid) tabBtnAndroid.addEventListener('click', () => switchLocationTab('android'));
    if (tabBtnPc) tabBtnPc.addEventListener('click', () => switchLocationTab('pc'));

    if (btnRetryLocation) {
        btnRetryLocation.addEventListener('click', () => requestLocationFromPermissionModal());
    }
}

/**
 * Helper to determine mobile viewport
 */
function isMobileScreen() {
    return window.innerWidth <= 768;
}

/**
 * Load Places Data for currently selected trip or City Guide
 */
export async function loadPlacesData() {
    const tripSelector = document.getElementById('places-trip-selector');
    
    // Ensure trips and everyday city guide options are available in dropdown
    if (tripSelector) {
        tripSelector.innerHTML = '';

        // Everyday Saved Places (City Guide) Option
        const optCityGuide = document.createElement('option');
        optCityGuide.value = 'city-guide';
        optCityGuide.textContent = '🌟 Şehir Rehberim & Günlük Kayıtlar';
        tripSelector.appendChild(optCityGuide);

        // All Places Global Map Option
        const optAllPlaces = document.createElement('option');
        optAllPlaces.value = 'all-places';
        optAllPlaces.textContent = '🌐 Tüm Kayıtlı Mekanlarım (Genel Harita)';
        tripSelector.appendChild(optAllPlaces);

        // Add Active Trips
        state.tripsList.forEach(trip => {
            const opt = document.createElement('option');
            opt.value = trip.id;
            opt.textContent = `✈️ ${trip.name} (${trip.currency || 'TRY'})`;
            tripSelector.appendChild(opt);
        });

        // Set active selection
        if (!state.activeTripId) {
            state.activeTripId = state.tripsList.length > 0 ? state.tripsList[0].id : 'city-guide';
        }
        tripSelector.value = state.activeTripId;
    }

    try {
        const places = await db.getPlaces(state.activeTripId);
        state.placesList = (places || []).filter(p => p && typeof p === 'object' && p.id);
        
        try {
            renderPlacesList();
        } catch (listErr) {
            console.error("Failed to render places list:", listErr);
        }

        try {
            initOrUpdateMap();
        } catch (mapErr) {
            console.error("Failed to initialize or update map:", mapErr);
        }
    } catch (err) {
        console.error("Failed to load places:", err);
        const errMsg = err?.message || err?.error || (typeof err === 'string' ? err : 'Veriler alınırken bağlantı hatası oluştu');
        showToast("Mekanlar yüklenirken hata oluştu: " + errMsg, "danger");
    }
}

/**
 * Initialize Leaflet Map or update existing map instance
 */
function initOrUpdateMap() {
    const mapEl = document.getElementById('places-map');
    if (!mapEl || typeof L === 'undefined') return;

    if (!mapInstance) {
        // Create Leaflet instance
        // Default center: Istanbul / Athens corridor [41.0082, 28.9784]
        mapInstance = L.map('places-map', {
            zoomControl: true,
            scrollWheelZoom: true,
            tap: false // Disables 300ms mobile touch delay
        }).setView([41.0082, 28.9784], 13);

        // Minimalist Esri Canvas Tile Layer (Distraction-free, fast, no watermark)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
        }).addTo(mapInstance);

        // Reference Labels overlay
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        }).addTo(mapInstance);

        // Zoom-level visibility listener for marker labels (zoom >= 14)
        mapInstance.on('zoomend', updatePlacesMapZoomClass);

        routePolylineLayer = L.layerGroup().addTo(mapInstance);

        // MarkerCluster Layer
        if (typeof L.markerClusterGroup !== 'undefined') {
            try {
                markersLayer = L.markerClusterGroup({
                    maxClusterRadius: isMobileScreen() ? 30 : 40,
                    spiderfyOnMaxZoom: !isMobileScreen(), // Disable spiderfy jumping on mobile
                    showCoverageOnHover: false,
                    zoomToBoundsOnClick: true
                }).addTo(mapInstance);
            } catch (clusterErr) {
                console.warn("MarkerCluster init fallback to layerGroup:", clusterErr);
                markersLayer = L.layerGroup().addTo(mapInstance);
            }
        } else {
            markersLayer = L.layerGroup().addTo(mapInstance);
        }

        // GPS "Konumumu Bul" Leaflet Control under zoom buttons
        try {
            const LocateControl = L.Control.extend({
                options: { position: 'topleft' },
                onAdd: function() {
                    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
                    const button = L.DomUtil.create('a', 'leaflet-control-locate', container);
                    button.innerHTML = '🎯';
                    button.href = '#';
                    button.title = 'Konumumu Bul (GPS)';
                    button.setAttribute('role', 'button');
                    button.setAttribute('aria-label', 'Konumumu Bul');

                    L.DomEvent.disableClickPropagation(container);
                    L.DomEvent.on(button, 'click', function(e) {
                        L.DomEvent.stop(e);
                        handleUserLocationRequest();
                    });

                    return container;
                }
            });
            mapInstance.addControl(new LocateControl());

            mapInstance.on('locationfound', onLocationFound);
            mapInstance.on('locationerror', onLocationError);
        } catch (ctrlErr) {
            console.warn("LocateControl init error:", ctrlErr);
        }

        // Click on map listener:
        // On mobile: closes the bottom sheet without accidentally opening the add modal.
        // On desktop: allows clicking to drop a pin.
        mapInstance.on('click', (e) => {
            closePlaceBottomSheet();
            if (!isMobileScreen()) {
                const { lat, lng } = e.latlng;
                openPlaceModalWithCoords(lat, lng);
            }
        });

        // Trigger map resize fix after layout rendering
        setTimeout(() => {
            if (mapInstance) mapInstance.invalidateSize();
        }, 300);
    } else {
        setTimeout(() => {
            if (mapInstance) mapInstance.invalidateSize();
        }, 100);
    }

    renderMapMarkers();
    renderRoutePolyline();
}

/**
 * Handle GPS location request via browser Geolocation API
 */
async function handleUserLocationRequest() {
    if (!mapInstance) return;

    // If we already have user coordinates, pan smoothly immediately
    if (currentUserCoords) {
        mapInstance.setView([currentUserCoords.lat, currentUserCoords.lng], 16);
        showToast("Mevcut konumunuza odaklanıldı", "info");
    }

    // Check modern navigator.permissions if available
    if (navigator.permissions && navigator.permissions.query) {
        try {
            const status = await navigator.permissions.query({ name: 'geolocation' });
            if (status.state === 'denied') {
                openLocationPermissionModal({ code: 1 });
                return;
            }
        } catch (_) {
            // permissions.query may fail in some WebViews/browsers, proceed to locate
        }
    }

    showToast("GPS konumu tespit ediliyor...", "info");
    mapInstance.locate({
        setView: true,
        maxZoom: 16,
        enableHighAccuracy: true
    });
}

function onLocationFound(e) {
    const radius = Math.round(e.accuracy);
    currentUserCoords = { lat: e.latlng.lat, lng: e.latlng.lng };

    if (userLocationMarker && mapInstance) mapInstance.removeLayer(userLocationMarker);
    if (userLocationCircle && mapInstance) mapInstance.removeLayer(userLocationCircle);

    const userIcon = L.divIcon({
        className: 'user-gps-marker',
        html: `
            <div class="user-gps-pulse-outer">
                <div class="user-gps-dot"></div>
            </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
    });

    userLocationMarker = L.marker(e.latlng, { icon: userIcon })
        .addTo(mapInstance)
        .bindPopup(`<b>📍 Şu an buradasınız!</b><br><small>Hassasiyet: ~${radius} metre</small>`);

    userLocationCircle = L.circle(e.latlng, {
        radius: radius,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 1.5
    }).addTo(mapInstance);

    showToast(`Konumunuz bulundu (Hassasiyet: ~${radius}m)`, "success");
    // Re-render list & markers to reflect real-time user distances
    renderPlacesList();
}

function onLocationError(e) {
    console.warn("Location error:", e.message);
    openLocationPermissionModal(e);
}

/**
 * Switch active OS guide tab in the location permission modal
 */
export function switchLocationTab(tab) {
    const tabs = ['ios', 'android', 'pc'];
    tabs.forEach(t => {
        const btn = document.getElementById(`tab-btn-${t}`);
        const guide = document.getElementById(`loc-guide-${t}`);
        if (btn) {
            if (t === tab) btn.classList.add('active-loc-tab');
            else btn.classList.remove('active-loc-tab');
        }
        if (guide) {
            if (t === tab) guide.classList.remove('hidden');
            else guide.classList.add('hidden');
        }
    });
}
window.switchLocationTab = switchLocationTab;

/**
 * Open Location Permission Guidance Modal
 */
export function openLocationPermissionModal(err = null) {
    const modal = document.getElementById('modal-location-permission');
    if (!modal) return;

    // Detect device OS to auto-select relevant tab
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    if (isIOS) switchLocationTab('ios');
    else if (isAndroid) switchLocationTab('android');
    else switchLocationTab('pc');

    // Display error context if provided
    const alertBox = document.getElementById('location-modal-alert');
    if (alertBox) {
        if (err) {
            let message = "⚠️ Tarayıcı konum erişimini kısıtladı veya izin verilmedi.";
            if (err.code === 1 || err.PERMISSION_DENIED) {
                message = "🚫 <strong>Konum İzni Reddedildi:</strong> Tarayıcınızda veya cihazınızda bu site için konum erişimi engellenmiş görünüyor. Lütfen aşağıdaki 2 adımlık rehberi uygulayın.";
            } else if (err.code === 2) {
                message = "📡 <strong>GPS Sinyali Alınamadı:</strong> Cihazınızın Konum / GPS servisinin açık olduğundan emin olun.";
            } else if (err.code === 3) {
                message = "⏳ <strong>Zaman Aşımı:</strong> Konum tespiti çok uzun sürdü. Lütfen tekrar deneyin.";
            } else if (err.message) {
                message = `⚠️ ${err.message}`;
            }
            alertBox.innerHTML = message;
            alertBox.classList.remove('hidden');
        } else {
            alertBox.classList.add('hidden');
        }
    }

    modal.classList.remove('hidden');
}
window.openLocationPermissionModal = openLocationPermissionModal;

/**
 * Close Location Permission Guidance Modal
 */
export function closeLocationPermissionModal() {
    const modal = document.getElementById('modal-location-permission');
    if (modal) modal.classList.add('hidden');
}
window.closeLocationPermissionModal = closeLocationPermissionModal;

/**
 * Single-tap retry button inside modal: Triggers browser geolocation request immediately
 */
export async function requestLocationFromPermissionModal() {
    const btn = document.getElementById('btn-retry-location-permission');
    const alertBox = document.getElementById('location-modal-alert');
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;">⏳ Konum Alınıyor...</span>`;
    }

    if (!navigator.geolocation) {
        if (alertBox) {
            alertBox.innerHTML = "❌ Tarayıcınız konum servisini desteklemiyor.";
            alertBox.classList.remove('hidden');
        }
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = "📍 Konumu Şimdi Al (Tek Tıkla)";
        }
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = "📍 Konumu Şimdi Al (Tek Tıkla)";
            }
            closeLocationPermissionModal();

            const latlng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            if (mapInstance) {
                mapInstance.setView([latlng.lat, latlng.lng], 16);
            }
            onLocationFound({
                latlng: latlng,
                accuracy: pos.coords.accuracy || 15
            });
            showToast("Harika! Konumunuz başarıyla alındı.", "success");
        },
        (err) => {
            console.warn("Permission modal retry failed:", err);
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = "🔄 Tekrar Dene";
            }
            if (alertBox) {
                alertBox.innerHTML = "❌ <strong>İzin Hâlâ Kapalı:</strong> Lütfen yukarıdaki adımları tarayıcının adres çubuğundan tamamlayıp tekrar 'Tekrar Dene' butonuna dokunun.";
                alertBox.classList.remove('hidden');
            }
            showToast("Konum izni henüz verilmedi.", "warning");
        },
        {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        }
    );
}
window.requestLocationFromPermissionModal = requestLocationFromPermissionModal;

/**
 * Toggle map container class when zoom >= 14 to show place name labels under pins
 */
function updatePlacesMapZoomClass() {
    if (!mapInstance) return;
    const zoom = mapInstance.getZoom();
    const mapEl = document.getElementById('places-map');
    if (mapEl) {
        if (zoom >= 14) mapEl.classList.add('map-detailed-zoom');
        else mapEl.classList.remove('map-detailed-zoom');
    }
}

/**
 * Sort places: Hotel first (base), then by visit_order or creation
 */
export function getSortedPlaces(places) {
    return [...places].sort((a, b) => {
        if (a.category === 'hotel') return -1;
        if (b.category === 'hotel') return 1;
        return (a.visit_order || 0) - (b.visit_order || 0);
    });
}

/**
 * Filter helper supporting categories, status, and instant text search
 */
function getFilteredPlaces() {
    let filtered = [...state.placesList];

    // Category / Status Filter
    const filter = state.activePlaceFilter || 'all';
    if (filter === 'planned') filtered = filtered.filter(p => p.status === 'planned');
    else if (filter === 'visited') filtered = filtered.filter(p => p.status === 'visited');
    else if (filter !== 'all') filtered = filtered.filter(p => p.category === filter);

    // Instant Text Search
    const searchInput = document.getElementById('places-search-input');
    const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (query) {
        filtered = filtered.filter(p => {
            const name = (p.name || '').toLowerCase();
            const address = (p.address || '').toLowerCase();
            const notes = (p.notes || '').toLowerCase();
            const catName = (PLACE_CATEGORIES[p.category]?.name || '').toLowerCase();
            return name.includes(query) || address.includes(query) || notes.includes(query) || catName.includes(query);
        });
    }

    return filtered;
}

/**
 * Render Numbered Markers on the map with Mobile Bottom Sheet Integration
 */
function renderMapMarkers() {
    if (!mapInstance || !markersLayer) return;

    markersLayer.clearLayers();
    if (tempDraftMarker) {
        mapInstance.removeLayer(tempDraftMarker);
        tempDraftMarker = null;
    }

    const filtered = getFilteredPlaces();
    if (filtered.length === 0) {
        renderRoutePolyline();
        return;
    }

    const sorted = getSortedPlaces(filtered);
    const hotel = state.placesList.find(p => p.category === 'hotel');
    const latLngBounds = [];

    sorted.forEach((place, index) => {
        if (!place.latitude || !place.longitude) return;

        const placeNumber = index + 1;
        const isVisited = place.status === 'visited';
        const catInfo = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.other;
        
        // Custom Numbered HTML Marker Icon with Zoom-Sensitive Label
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

        const marker = L.marker([place.latitude, place.longitude], { icon });

        // Tapping/Clicking a marker:
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);

            if (isMobileScreen()) {
                // On mobile: smoothly center map with offset and open Bottom Sheet!
                mapInstance.setView([place.latitude, place.longitude], Math.max(mapInstance.getZoom(), 15), {
                    animate: true
                });
                // Slight upward pan so pin is clearly visible above drawer
                setTimeout(() => {
                    mapInstance.panBy([0, -100], { animate: true });
                }, 150);

                openPlaceBottomSheet(place, placeNumber);
            } else {
                // On desktop: open standard popup
                openDesktopPopup(marker, place, placeNumber, hotel, catInfo);
            }
        });

        markersLayer.addLayer(marker);
        latLngBounds.push([place.latitude, place.longitude]);
    });

    // Auto-fit bounds if markers exist
    if (latLngBounds.length > 0) {
        mapInstance.fitBounds(latLngBounds, { padding: [40, 40], maxZoom: 16 });
    }

    updatePlacesMapZoomClass();
    renderRoutePolyline();
}

/**
 * Desktop Popup Card Renderer
 */
function openDesktopPopup(marker, place, placeNumber, hotel, catInfo) {
    const isVisited = place.status === 'visited';
    let distanceHtml = '';
    if (hotel && hotel.id !== place.id) {
        const distMeters = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
        const distText = distMeters >= 1000 ? `${(distMeters / 1000).toFixed(1)} km` : `${Math.round(distMeters)} m`;
        const walkMin = Math.round(distMeters / 80);
        distanceHtml = `<div class="popup-distance">🏨 Otele <strong>${distText}</strong> (~${walkMin} dk yürüme)</div>`;
    }

    const ratingStars = place.rating > 0 ? `<div class="rating-stars margin-bottom-6">${'⭐'.repeat(place.rating)}</div>` : '';
    const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

    const popupContent = `
        <div class="place-popup-card">
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
            ${ratingStars}
            ${place.address ? `<p class="popup-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
            ${distanceHtml}
            ${place.notes ? `<p class="popup-notes">${escapeHtml(place.notes)}</p>` : ''}
            ${place.estimated_cost > 0 ? `<div class="popup-cost">Tahmini Masraf: <strong>${place.estimated_cost} ${place.currency || 'EUR'}</strong></div>` : ''}
            
            <div class="popup-actions">
                <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn btn-primary btn-sm btn-block">
                    🗺️ Google Haritalar'da Yol Tarifi
                </a>
                <button type="button" class="btn btn-secondary btn-sm btn-block btn-toggle-status" data-id="${place.id}">
                    ${isVisited ? 'Gidilecek Olarak İşaretle' : '✓ Gidildi Olarak İşaretle'}
                </button>
                <div style="display: flex; gap: 8px; margin-top: 8px;">
                    <button type="button" class="btn btn-secondary btn-sm btn-edit-place" data-id="${place.id}" style="flex: 1;">
                        ✏️ Düzenle
                    </button>
                    <button type="button" class="btn btn-sm btn-delete-popup" data-id="${place.id}" style="flex: 1;">
                        🗑️ Sil
                    </button>
                </div>
            </div>
        </div>
    `;

    marker.bindPopup(popupContent, { maxWidth: 320, className: 'glass-popup' }).openPopup();

    setTimeout(() => {
        if (window.lucide) window.lucide.createIcons();
        const popupEl = marker.getPopup()?.getElement();
        if (popupEl) {
            const btnToggle = popupEl.querySelector('.btn-toggle-status');
            if (btnToggle) btnToggle.onclick = () => togglePlaceStatus(place.id);
            const btnEdit = popupEl.querySelector('.btn-edit-place');
            if (btnEdit) btnEdit.onclick = () => {
                mapInstance.closePopup();
                openPlaceModal(place);
            };
            const btnDelete = popupEl.querySelector('.btn-delete-popup');
            if (btnDelete) btnDelete.onclick = () => {
                mapInstance.closePopup();
                window.deletePlaceAction(place.id);
            };
        }
    }, 50);
}

/**
 * Open Mobile Bottom Sheet (Native Map Drawer)
 */
export function openPlaceBottomSheet(place, placeNumber) {
    const sheet = document.getElementById('place-bottom-sheet');
    const sheetBody = document.getElementById('bottom-sheet-body');
    if (!sheet || !sheetBody) return;

    const catInfo = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.other;
    const isVisited = place.status === 'visited';
    const hotel = state.placesList.find(p => p.category === 'hotel');

    // Calculate real-time distances
    let userDistText = '';
    if (currentUserCoords) {
        const distUser = calculateDistance(currentUserCoords.lat, currentUserCoords.lng, place.latitude, place.longitude);
        const distStr = distUser >= 1000 ? `${(distUser / 1000).toFixed(1)} km` : `${Math.round(distUser)} m`;
        userDistText = `<span class="distance-pill">📍 Sizden ${distStr}</span>`;
    }

    let hotelDistText = '';
    if (hotel && hotel.id !== place.id) {
        const distHotel = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
        const distStr = distHotel >= 1000 ? `${(distHotel / 1000).toFixed(1)} km` : `${Math.round(distHotel)} m`;
        hotelDistText = `<span class="distance-pill hotel-dist">🏨 Otele ${distStr}</span>`;
    }

    const ratingStars = place.rating > 0 ? `<div class="rating-stars">${'⭐'.repeat(place.rating)}</div>` : '';
    const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

    sheetBody.innerHTML = `
        <div class="bottom-sheet-header-badges">
            <span class="popup-number-badge">#${placeNumber}</span>
            <span class="popup-category-badge" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                ${catInfo.emoji} ${catInfo.name}
            </span>
            <span class="popup-status-badge ${isVisited ? 'status-visited' : 'status-planned'}">
                ${isVisited ? '✓ Gezildi' : '🟢 Gitmek İstiyorum'}
            </span>
            ${ratingStars}
        </div>

        <h3 class="bottom-sheet-title">${escapeHtml(place.name)}</h3>
        ${place.address ? `<div class="bottom-sheet-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</div>` : ''}

        ${(userDistText || hotelDistText) ? `<div class="bottom-sheet-distances">${userDistText}${hotelDistText}</div>` : ''}

        ${place.notes ? `<div class="bottom-sheet-notes">${escapeHtml(place.notes)}</div>` : ''}
        ${place.estimated_cost > 0 ? `<div class="text-sm margin-bottom-8">💰 Tahmini Masraf: <strong>${place.estimated_cost} ${place.currency || 'EUR'}</strong></div>` : ''}

        <div class="bottom-sheet-actions">
            <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn-directions-primary">
                <i data-lucide="navigation"></i> Google Haritalar'da Yol Tarifi
            </a>

            <div class="bottom-sheet-sub-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-sheet-toggle-status" style="flex: 2;">
                    ${isVisited ? 'Gidilecek Olarak İşaretle' : '✓ Gidildi Olarak İşaretle'}
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-sheet-edit" style="flex: 1;">
                    ✏️ Düzenle
                </button>
                <button type="button" class="btn btn-secondary btn-sm btn-delete-popup" id="btn-sheet-delete" style="flex: 1;">
                    🗑️ Sil
                </button>
            </div>
        </div>
    `;

    // Wire up buttons inside bottom sheet
    const btnToggle = sheetBody.querySelector('#btn-sheet-toggle-status');
    if (btnToggle) {
        btnToggle.onclick = async () => {
            await togglePlaceStatus(place.id);
            closePlaceBottomSheet();
        };
    }
    const btnEdit = sheetBody.querySelector('#btn-sheet-edit');
    if (btnEdit) {
        btnEdit.onclick = () => {
            closePlaceBottomSheet();
            openPlaceModal(place);
        };
    }
    const btnDelete = sheetBody.querySelector('#btn-sheet-delete');
    if (btnDelete) {
        btnDelete.onclick = async () => {
            closePlaceBottomSheet();
            await window.deletePlaceAction(place.id);
        };
    }

    sheet.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

/**
 * Close Mobile Bottom Sheet
 */
export function closePlaceBottomSheet() {
    const sheet = document.getElementById('place-bottom-sheet');
    if (sheet) sheet.classList.add('hidden');
}

/**
 * Render Polyline connecting Numbered Points (1 -> 2 -> 3...) with Segment Distance Badges
 */
function renderRoutePolyline() {
    if (!mapInstance || !routePolylineLayer) return;
    routePolylineLayer.clearLayers();
    if (!showRouteLine) return;

    // Only draw route line if inside a trip (not general city guide with scattered places across towns)
    if (state.activeTripId === 'all-places') return;

    const sorted = getSortedPlaces(getFilteredPlaces().filter(p => p.latitude && p.longitude));
    if (sorted.length < 2) return;

    let totalMeters = 0;
    const polyCoords = [];

    for (let i = 0; i < sorted.length; i++) {
        polyCoords.push([sorted[i].latitude, sorted[i].longitude]);

        // Draw distance badge on segment between i and i+1
        if (i < sorted.length - 1) {
            const p1 = sorted[i];
            const p2 = sorted[i + 1];
            const segDist = calculateDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
            totalMeters += segDist;

            const midLat = (p1.latitude + p2.latitude) / 2;
            const midLng = (p1.longitude + p2.longitude) / 2;
            const segText = segDist >= 1000 ? `${(segDist / 1000).toFixed(1)} km` : `${Math.round(segDist)} m`;

            const distIcon = L.divIcon({
                className: 'route-dist-label-container',
                html: `<div class="route-dist-pill">➔ ${segText}</div>`,
                iconSize: [64, 22],
                iconAnchor: [32, 11]
            });

            L.marker([midLat, midLng], { icon: distIcon, interactive: false }).addTo(routePolylineLayer);
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

    const totalText = totalMeters >= 1000 ? `${(totalMeters / 1000).toFixed(1)} km` : `${Math.round(totalMeters)} m`;
    const walkMin = Math.round(totalMeters / 80);
    polyline.bindTooltip(`🗺️ Toplam Güzergah: ${totalText} (~${walkMin} dk yürüme)`, { sticky: true });
    routePolylineLayer.addLayer(polyline);

    // Update total route summary pill in header if element exists
    const summaryEl = document.getElementById('places-route-total-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `🚶 Rota: <strong>${totalText}</strong> (~${walkMin} dk yürüme)`;
        summaryEl.classList.remove('hidden');
    }
}

/**
 * Render places list / cards below the map with matching Number Badges (#1, #2, #3...)
 */
function renderPlacesList() {
    const listContainer = document.getElementById('places-cards-container');
    const statsEl = document.getElementById('places-summary-stats');
    if (!listContainer) return;

    const total = state.placesList.length;
    const visitedCount = state.placesList.filter(p => p.status === 'visited').length;
    const plannedCount = total - visitedCount;
    const hotel = state.placesList.find(p => p.category === 'hotel');

    if (statsEl) {
        statsEl.innerHTML = `
            <div class="stat-pill"><strong>${total}</strong> Toplam Mekan</div>
            <div class="stat-pill pill-planned">🟢 <strong>${plannedCount}</strong> Gitmek İstediğim</div>
            <div class="stat-pill pill-visited">⚪ <strong>${visitedCount}</strong> Ziyaret Edilen</div>
            ${hotel ? `<div class="stat-pill pill-hotel">🏨 Otel: <strong>${escapeHtml(hotel.name)}</strong></div>` : ''}
        `;
    }

    const filtered = getFilteredPlaces();

    if (filtered.length === 0) {
        const isCityGuide = state.activeTripId === 'city-guide';
        listContainer.innerHTML = `
            <div class="empty-places-card card glass">
                <i data-lucide="map-pin-off" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
                <h3>${isCityGuide ? 'Şehir Rehberinizde Mekan Yok' : 'Henüz Mekan Eklenmemiş'}</h3>
                <p class="text-muted">
                    ${isCityGuide 
                        ? 'Günlük hayatınızda gitmek istediğiniz 3. dalga kahvecileri, restoranları ve keyifli parkları haritanıza kaydedin!' 
                        : 'Bu rota için gezilecek yerleri, otelinizi ve mekanları haritaya ekleyin.'}
                </p>
                <button type="button" class="btn btn-primary margin-top-12" id="btn-empty-add-place">
                    + İlk Mekanı Ekle
                </button>
            </div>
        `;
        const emptyBtn = document.getElementById('btn-empty-add-place');
        if (emptyBtn) emptyBtn.addEventListener('click', () => openPlaceModal());
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    const sorted = getSortedPlaces(filtered);

    listContainer.innerHTML = sorted.map((place, index) => {
        const placeNumber = index + 1;
        const catInfo = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.other;
        const isVisited = place.status === 'visited';

        // Distance from hotel or from user GPS
        let distanceBadge = '';
        if (currentUserCoords) {
            const distUser = calculateDistance(currentUserCoords.lat, currentUserCoords.lng, place.latitude, place.longitude);
            const distStr = distUser >= 1000 ? `${(distUser / 1000).toFixed(1)} km` : `${Math.round(distUser)} m`;
            distanceBadge = `<span class="place-distance-tag" title="Anlık Konumunuza Uzaklık">📍 Sizden ${distStr}</span>`;
        } else if (hotel && hotel.id !== place.id) {
            const distM = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
            const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
            const walkMin = Math.round(distM / 80);
            distanceBadge = `<span class="place-distance-tag" title="Otele Uzaklık">🏨 ${distStr} (~${walkMin} dk)</span>`;
        } else if (place.category === 'hotel') {
            distanceBadge = `<span class="place-distance-tag hotel-tag">📍 Ana Konaklama Üssü</span>`;
        }

        const ratingStars = place.rating > 0 ? `<span class="pill-rating">${'⭐'.repeat(place.rating)}</span>` : '';
        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

        return `
            <div class="place-card card glass ${isVisited ? 'place-visited' : 'place-planned'}" data-id="${place.id}">
                <div class="place-card-left-number">
                    <span class="card-number-badge">#${placeNumber}</span>
                </div>

                <div class="place-card-content-area">
                    <div class="place-card-header">
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                            <div class="place-category-pill" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                                ${catInfo.emoji} ${catInfo.name}
                            </div>
                            ${ratingStars}
                        </div>
                        <div class="place-status-wrapper">
                            <button type="button" class="btn-toggle-badge ${isVisited ? 'badge-visited' : 'badge-planned'}" onclick="window.togglePlaceStatusAction('${place.id}')">
                                ${isVisited ? '✓ Gezildi' : '🟢 Gitmek İstiyorum'}
                            </button>
                        </div>
                    </div>

                    <div class="place-card-body">
                        <h3 class="place-name ${isVisited ? 'text-strikethrough' : ''}">${escapeHtml(place.name)}</h3>
                        ${place.address ? `<p class="place-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
                        ${distanceBadge ? `<div class="margin-bottom-8">${distanceBadge}</div>` : ''}
                        ${place.notes ? `<p class="place-notes">${escapeHtml(place.notes)}</p>` : ''}
                        ${place.estimated_cost > 0 ? `<div class="place-cost-tag">Tahmini Masraf: <strong>${place.estimated_cost} ${place.currency || 'EUR'}</strong></div>` : ''}
                    </div>

                    <div class="place-card-actions">
                        <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" title="Google Haritalar'da Aç">
                            <i data-lucide="navigation"></i> Yol Tarifi
                        </a>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.focusPlaceOnMapAction(${place.latitude}, ${place.longitude}, '${place.id}', ${placeNumber})" title="Haritada Odaklan">
                            <i data-lucide="crosshair"></i> Haritada Gör
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.editPlaceAction('${place.id}')" title="Düzenle">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm btn-delete-place" onclick="window.deletePlaceAction('${place.id}')" title="Sil">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Focus map on specific latitude & longitude
 */
window.focusPlaceOnMapAction = function(lat, lng, placeId = null, placeNumber = 1) {
    if (!mapInstance) return;
    mapInstance.setView([lat, lng], 16, { animate: true });
    
    if (isMobileScreen() && placeId) {
        const place = state.placesList.find(p => p.id === placeId);
        if (place) openPlaceBottomSheet(place, placeNumber);
    }

    const mapCard = document.querySelector('.map-card-container');
    if (mapCard) {
        mapCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
};

/**
 * Toggle place status between 'planned' and 'visited'
 */
window.togglePlaceStatusAction = async function(placeId) {
    await togglePlaceStatus(placeId);
};

export async function togglePlaceStatus(placeId) {
    const place = state.placesList.find(p => p.id === placeId);
    if (!place) return;

    const newStatus = place.status === 'visited' ? 'planned' : 'visited';
    try {
        await db.updatePlaceStatus(placeId, newStatus);
        place.status = newStatus;
        showToast(newStatus === 'visited' ? 'Tebrikler! Mekan gezildi / ziyaret edildi olarak işaretlendi.' : 'Mekan gitmek istediklerim listesine alındı.', 'success');
        renderPlacesList();
        renderMapMarkers();
    } catch (err) {
        showToast("Durum güncellenirken hata: " + err.message, "danger");
    }
}

/**
 * Open Place Modal
 */
export function openPlaceModal(place = null) {
    const modal = document.getElementById('modal-place');
    const form = document.getElementById('place-form');
    const titleEl = document.getElementById('place-modal-title');
    const btnDeleteModal = document.getElementById('btn-delete-place-modal');
    if (!modal || !form) return;

    form.reset();

    // Populate trips select in modal (Includes City Guide option)
    const tripSelect = document.getElementById('place-modal-trip-select');
    if (tripSelect) {
        tripSelect.innerHTML = '';

        const optCity = document.createElement('option');
        optCity.value = 'city-guide';
        optCity.textContent = '🌟 Şehir Rehberim (Seyahatsiz / Günlük Mekan)';
        tripSelect.appendChild(optCity);

        state.tripsList.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = `✈️ ${t.name} (${t.currency || 'TRY'})`;
            if (t.id === state.activeTripId) opt.selected = true;
            tripSelect.appendChild(opt);
        });

        if (state.activeTripId === 'city-guide' || state.activeTripId === 'all-places' || !state.activeTripId) {
            optCity.selected = true;
        }
    }

    if (place) {
        state.selectedPlaceForEdit = place;
        if (titleEl) titleEl.textContent = 'Mekanı Düzenle';
        if (btnDeleteModal) {
            btnDeleteModal.classList.remove('hidden');
            btnDeleteModal.style.display = 'inline-flex';
        }
        document.getElementById('place-id').value = place.id;
        document.getElementById('place-name').value = place.name;
        document.getElementById('place-category').value = place.category || 'cafe';
        document.getElementById('place-status').value = place.status || 'planned';
        document.getElementById('place-rating').value = place.rating || 0;
        document.getElementById('place-lat').value = place.latitude;
        document.getElementById('place-lng').value = place.longitude;
        document.getElementById('place-address').value = place.address || '';
        document.getElementById('place-notes').value = place.notes || '';
        document.getElementById('place-cost').value = place.estimated_cost || 0;
        document.getElementById('place-currency').value = place.currency || 'TRY';

        if (tripSelect) {
            tripSelect.value = place.trip_id ? place.trip_id : 'city-guide';
        }
    } else {
        state.selectedPlaceForEdit = null;
        if (titleEl) titleEl.textContent = 'Yeni Mekan / Gezi Noktası Ekle';
        if (btnDeleteModal) {
            btnDeleteModal.classList.add('hidden');
            btnDeleteModal.style.display = 'none';
        }
        document.getElementById('place-id').value = '';
        document.getElementById('place-rating').value = '0';
        document.getElementById('place-category').value = 'cafe';

        // Pre-fill coordinates with map center or user GPS
        if (currentUserCoords) {
            document.getElementById('place-lat').value = currentUserCoords.lat.toFixed(6);
            document.getElementById('place-lng').value = currentUserCoords.lng.toFixed(6);
        } else if (mapInstance) {
            const center = mapInstance.getCenter();
            document.getElementById('place-lat').value = center.lat.toFixed(6);
            document.getElementById('place-lng').value = center.lng.toFixed(6);
        }
    }

    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

/**
 * Open Modal when clicking on map
 */
function openPlaceModalWithCoords(lat, lng) {
    openPlaceModal();
    document.getElementById('place-lat').value = lat.toFixed(6);
    document.getElementById('place-lng').value = lng.toFixed(6);
    showToast(`Seçilen koordinat: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'info');
}

/**
 * Close Place Modal
 */
export function closePlaceModal() {
    const modal = document.getElementById('modal-place');
    if (modal) modal.classList.add('hidden');
    const btnDeleteModal = document.getElementById('btn-delete-place-modal');
    if (btnDeleteModal) {
        btnDeleteModal.classList.add('hidden');
        btnDeleteModal.style.display = 'none';
    }
    state.selectedPlaceForEdit = null;
}

/**
 * Smart Multilingual Location Search using OpenStreetMap Nominatim + Wikipedia
 */
async function handleLocationSearch() {
    const queryInput = document.getElementById('place-search-query');
    const query = queryInput ? queryInput.value.trim() : '';
    if (!query) {
        showToast("Lütfen aranacak yeri veya semti yazın (örn: Kadıköy Moda, Petra Gayrettepe veya Akropolis)", "warning");
        return;
    }

    const btnSearch = document.getElementById('btn-search-place-location');
    if (btnSearch) {
        btnSearch.disabled = true;
        btnSearch.textContent = 'Aranıyor...';
    }

    try {
        let found = false;

        // Step 1: OpenStreetMap Nominatim API
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
            const res = await fetch(url, {
                headers: { 'Accept-Language': 'tr,en' }
            });
            const data = await res.json();

            if (data && data.length > 0) {
                const result = data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                document.getElementById('place-lat').value = lat.toFixed(6);
                document.getElementById('place-lng').value = lon.toFixed(6);
                document.getElementById('place-address').value = result.display_name.split(',').slice(0, 3).join(', ');

                const nameInput = document.getElementById('place-name');
                if (!nameInput.value.trim()) {
                    nameInput.value = query;
                }

                showToast(`"${query}" başarıyla bulundu!`, "success");
                if (mapInstance) mapInstance.setView([lat, lon], 16);
                found = true;
                return;
            }
        } catch (nomErr) {
            console.warn("Nominatim search failed, trying fallback:", nomErr);
        }

        // Step 2: Wikipedia / Wikidata Multilingual Geosearch Fallback
        if (!found) {
            try {
                const wikiUrl = `https://tr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
                const wikiRes = await fetch(wikiUrl);
                const wikiData = await wikiRes.json();
                const searchList = wikiData?.query?.search || [];

                if (searchList.length > 0) {
                    const topTitle = searchList[0].title;
                    const coordUrl = `https://tr.wikipedia.org/w/api.php?action=query&prop=coordinates|langlinks&titles=${encodeURIComponent(topTitle)}&format=json&lllang=en&origin=*`;
                    const coordRes = await fetch(coordUrl);
                    const coordData = await coordRes.json();
                    const pages = coordData?.query?.pages || {};

                    for (const pid of Object.keys(pages)) {
                        const page = pages[pid];
                        const coords = page.coordinates;
                        if (coords && coords.length > 0) {
                            const lat = coords[0].lat;
                            const lon = coords[0].lon;
                            const enName = page.langlinks?.[0]?.['*'] || '';
                            const cleanName = topTitle.replace(/\s*\([^)]*\)/g, '').trim();

                            document.getElementById('place-lat').value = lat.toFixed(6);
                            document.getElementById('place-lng').value = lon.toFixed(6);
                            document.getElementById('place-name').value = cleanName;
                            document.getElementById('place-address').value = enName ? `${cleanName} (${enName})` : cleanName;

                            showToast(`"${cleanName}" başarıyla bulundu!`, "success");
                            if (mapInstance) mapInstance.setView([lat, lon], 16);
                            found = true;
                            return;
                        }
                    }
                }
            } catch (wikiErr) {
                console.warn("Wikipedia fallback search error:", wikiErr);
            }
        }

        if (!found) {
            showToast("Konum bulunamadı. Lütfen şehir veya semt adını ekleyin (örn: Petra Kafe Gayrettepe).", "warning");
        }
    } catch (err) {
        console.error("Geocoding failed:", err);
        showToast("Arama servisine ulaşılamadı: " + err.message, "danger");
    } finally {
        if (btnSearch) {
            btnSearch.disabled = false;
            btnSearch.textContent = 'Konumu Bul';
        }
    }
}

/**
 * Handle form submission for Place
 */
async function handlePlaceFormSubmit(e) {
    e.preventDefault();
    const placeId = document.getElementById('place-id').value;
    const tripSelectVal = document.getElementById('place-modal-trip-select').value;
    const name = document.getElementById('place-name').value.trim();
    const category = document.getElementById('place-category').value;
    const status = document.getElementById('place-status').value;
    const rating = parseInt(document.getElementById('place-rating').value) || 0;
    const lat = parseFloat(document.getElementById('place-lat').value);
    const lng = parseFloat(document.getElementById('place-lng').value);
    const address = document.getElementById('place-address').value.trim();
    const notes = document.getElementById('place-notes').value.trim();
    const cost = parseFloat(document.getElementById('place-cost').value) || 0;
    const currency = document.getElementById('place-currency').value;

    if (!name) {
        showToast("Mekan adı zorunludur", "danger");
        return;
    }
    if (isNaN(lat) || isNaN(lng)) {
        showToast("Lütfen geçerli bir konum arayın veya haritadan koordinat seçin", "danger");
        return;
    }

    const payload = {
        trip_id: (tripSelectVal && tripSelectVal !== 'city-guide') ? tripSelectVal : null,
        name,
        category,
        status,
        rating,
        latitude: lat,
        longitude: lng,
        address,
        notes,
        estimated_cost: cost,
        currency
    };

    const submitBtn = document.getElementById('btn-save-place');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Kaydediliyor...';
    }

    try {
        if (placeId) {
            await db.updatePlace(placeId, payload);
            showToast("Mekan başarıyla güncellendi!", "success");
        } else {
            await db.createPlace(payload);
            showToast("Yeni mekan başarıyla kaydedildi!", "success");
        }

        closePlaceModal();
        await loadPlacesData();
    } catch (err) {
        console.error("Save place failed:", err);
        showToast("Kaydedilirken hata oluştu: " + err.message, "danger");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Kaydet';
        }
    }
}

/**
 * Edit place action
 */
window.editPlaceAction = function(placeId) {
    const place = state.placesList.find(p => p.id === placeId);
    if (place) openPlaceModal(place);
};

/**
 * Delete place action (with instant optimistic update)
 */
window.deletePlaceAction = async function(placeId) {
    const place = state.placesList.find(p => p.id === placeId);
    const placeName = place ? `"${place.name}"` : "Bu mekanı";
    if (!confirm(`${placeName} haritadan ve gezi listesinden silinsin mi?`)) return;

    try {
        if (mapInstance) mapInstance.closePopup();
        closePlaceBottomSheet();

        // Optimistic UI update
        state.placesList = state.placesList.filter(p => p.id !== placeId);
        renderPlacesList();
        renderMapMarkers();
        renderRoutePolyline();

        await db.deletePlace(placeId);
        showToast("Mekan başarıyla silindi", "info");
        await loadPlacesData();
    } catch (err) {
        console.error("Delete place failed:", err);
        showToast("Silinemedi: " + err.message, "danger");
        await loadPlacesData();
    }
};

/**
 * Haversine formula to calculate distance in meters between two lat/lng points
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

function renderEmptyState() {
    const list = document.getElementById('places-cards-container');
    if (list) {
        list.innerHTML = `
            <div class="empty-places-card card glass">
                <i data-lucide="compass" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
                <h3>Şehir Rehberinize Hoş Geldiniz!</h3>
                <p class="text-muted">Günlük hayatınızda veya seyahatlerinizde sevdiğiniz mekanları haritaya kaydedin.</p>
                <button type="button" class="btn btn-primary margin-top-12" onclick="openPlaceModal()">+ İlk Mekanı Ekle</button>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
    }
}
