// js/modules/places.js - Interactive Map & Places Management Module for TravellerMobi

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast } from '../utils.js';
import { openShareModal } from './share.js';

let mapInstance = null;
let markersLayer = null;
let tempDraftMarker = null;
let routePolylineLayer = null;
let showRouteLine = true;
let userLocationMarker = null;
let userLocationCircle = null;

// Category icons and colors
export const PLACE_CATEGORIES = {
    hotel: { name: 'Otel / Konaklama', icon: 'home', emoji: '🏨', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.2)' },
    museum: { name: 'Müze / Sergi', icon: 'landmark', emoji: '🏛️', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.2)' },
    historical: { name: 'Tarihi / Antik Alan', icon: 'monument', emoji: '🗿', color: '#d97706', bg: 'rgba(217, 119, 6, 0.2)' },
    food: { name: 'Restoran / Kafe', icon: 'utensils', emoji: '🍽️', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)' },
    viewpoint: { name: 'Manzara / Park', icon: 'compass', emoji: '🌳', color: '#10b981', bg: 'rgba(16, 185, 129, 0.2)' },
    shopping: { name: 'Alışveriş / Çarşı', icon: 'shopping-bag', emoji: '🛍️', color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.2)' },
    other: { name: 'Diğer Nokta', icon: 'map-pin', emoji: '📍', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.2)' }
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

    // Share Route Button
    const btnShareRoute = document.getElementById('btn-share-places-route');
    if (btnShareRoute) {
        btnShareRoute.addEventListener('click', () => openShareModal());
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

    // Filter Buttons
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

    // Route Polyline Toggle Button
    const btnToggleRoute = document.getElementById('btn-toggle-route-line');
    const routeStatusText = document.getElementById('route-line-status-text');
    if (btnToggleRoute) {
        btnToggleRoute.addEventListener('click', () => {
            showRouteLine = !showRouteLine;
            if (routeStatusText) {
                routeStatusText.textContent = showRouteLine ? 'Rota Çizgisi: Açık' : 'Rota Çizgisi: Kapalı';
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
}

/**
 * Load Places Data for currently selected trip
 */
export async function loadPlacesData() {
    const tripSelector = document.getElementById('places-trip-selector');
    
    // Ensure trips are available in dropdown
    if (tripSelector) {
        tripSelector.innerHTML = '';
        if (state.tripsList.length === 0) {
            tripSelector.innerHTML = '<option value="">(Önce bir seyahat oluşturmalısınız)</option>';
            state.placesList = [];
            renderEmptyState();
            return;
        }

        state.tripsList.forEach(trip => {
            const opt = document.createElement('option');
            opt.value = trip.id;
            opt.textContent = `${trip.name} (${trip.currency || 'TRY'})`;
            if (state.activeTripId === trip.id) opt.selected = true;
            tripSelector.appendChild(opt);
        });

        if (!state.activeTripId && state.tripsList.length > 0) {
            state.activeTripId = state.tripsList[0].id;
            tripSelector.value = state.activeTripId;
        }
    }

    if (!state.activeTripId) return;

    try {
        const places = await db.getPlaces(state.activeTripId);
        // Sanitize places data to avoid any null/undefined element crashes
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
        // Default center: Athens, Greece [37.9838, 23.7275]
        mapInstance = L.map('places-map', {
            zoomControl: true,
            scrollWheelZoom: true
        }).setView([37.9838, 23.7275], 13);

        // Esri World Light Gray Canvas (Minimalist, pale, distraction-free with English/Latin labels, NO API KEY, NO WATERMARK)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
        }).addTo(mapInstance);

        // English Reference Labels overlay
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        }).addTo(mapInstance);

        // Zoom-level visibility listener for marker labels (zoom >= 14)
        mapInstance.on('zoomend', updatePlacesMapZoomClass);

        routePolylineLayer = L.layerGroup().addTo(mapInstance);

        // MarkerCluster Layer (Clusters close pins and avoids overlap)
        if (typeof L.markerClusterGroup !== 'undefined') {
            try {
                markersLayer = L.markerClusterGroup({
                    maxClusterRadius: 40,
                    spiderfyOnMaxZoom: true,
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

            // Listen for GPS location events
            mapInstance.on('locationfound', onLocationFound);
            mapInstance.on('locationerror', onLocationError);
        } catch (ctrlErr) {
            console.warn("LocateControl init error:", ctrlErr);
        }

        // Click on map to add draft pin and trigger modal
        mapInstance.on('click', (e) => {
            const { lat, lng } = e.latlng;
            openPlaceModalWithCoords(lat, lng);
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
function handleUserLocationRequest() {
    if (!mapInstance) return;
    showToast("GPS konumu tespit ediliyor...", "info");
    mapInstance.locate({
        setView: true,
        maxZoom: 16,
        enableHighAccuracy: true
    });
}

function onLocationFound(e) {
    const radius = Math.round(e.accuracy);
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
        .bindPopup(`<b>📍 Şu an buradasınız!</b><br><small>Hassasiyet: ~${radius} metre</small>`)
        .openPopup();

    userLocationCircle = L.circle(e.latlng, {
        radius: radius,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.12,
        weight: 1.5
    }).addTo(mapInstance);

    showToast(`Konumunuz bulundu (Hassasiyet: ~${radius}m)`, "success");
}

function onLocationError(e) {
    console.warn("Location error:", e.message);
    showToast("Konumunuz alınamadı. Lütfen tarayıcı konum izinlerini ve cihaz GPS'ini kontrol edin.", "warning");
}

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
 * Render Numbered Markers on the map (1, 2, 3...) with Zoom-Level Visibility Labels
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

    // Find active hotel for distance reference
    const hotel = state.placesList.find(p => p.category === 'hotel');
    const latLngBounds = [];

    sorted.forEach((place, index) => {
        if (!place.latitude || !place.longitude) return;

        const placeNumber = index + 1;
        const isVisited = place.status === 'visited';
        const catInfo = PLACE_CATEGORIES[place.category] || PLACE_CATEGORIES.other;
        
        // Distance from hotel
        let distanceHtml = '';
        if (hotel && hotel.id !== place.id) {
            const distMeters = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
            const distText = distMeters >= 1000 ? `${(distMeters / 1000).toFixed(1)} km` : `${Math.round(distMeters)} m`;
            const walkMin = Math.round(distMeters / 80); // ~80m per min
            distanceHtml = `<div class="popup-distance">🏨 Otele <strong>${distText}</strong> (~${walkMin} dk yürüme)</div>`;
        }

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
                ${place.address ? `<p class="popup-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
                ${distanceHtml}
                ${place.notes ? `<p class="popup-notes">${escapeHtml(place.notes)}</p>` : ''}
                ${place.estimated_cost > 0 ? `<div class="popup-cost">Tahmini Giriş/Masraf: <strong>${place.estimated_cost} ${place.currency || 'EUR'}</strong></div>` : ''}
                
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

        const marker = L.marker([place.latitude, place.longitude], { icon })
            .bindPopup(popupContent, { maxWidth: 320, className: 'glass-popup' });

        marker.on('popupopen', () => {
            if (window.lucide) window.lucide.createIcons();
            const popupEl = marker.getPopup().getElement();
            if (popupEl) {
                const btnToggle = popupEl.querySelector('.btn-toggle-status');
                if (btnToggle) {
                    btnToggle.onclick = () => togglePlaceStatus(place.id);
                }
                const btnEdit = popupEl.querySelector('.btn-edit-place');
                if (btnEdit) {
                    btnEdit.onclick = () => {
                        mapInstance.closePopup();
                        openPlaceModal(place);
                    };
                }
                const btnDelete = popupEl.querySelector('.btn-delete-popup');
                if (btnDelete) {
                    btnDelete.onclick = () => {
                        mapInstance.closePopup();
                        window.deletePlaceAction(place.id);
                    };
                }
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
 * Render Polyline connecting Numbered Points (1 -> 2 -> 3...) with Segment Distance Badges
 */
function renderRoutePolyline() {
    if (!mapInstance || !routePolylineLayer) return;
    routePolylineLayer.clearLayers();
    if (!showRouteLine) return;

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
 * Filter helper
 */
function getFilteredPlaces() {
    const filter = state.activePlaceFilter || 'all';
    if (filter === 'all') return state.placesList;
    if (filter === 'planned') return state.placesList.filter(p => p.status === 'planned');
    if (filter === 'visited') return state.placesList.filter(p => p.status === 'visited');
    if (filter === 'hotel') return state.placesList.filter(p => p.category === 'hotel');
    return state.placesList.filter(p => p.category === filter);
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
            <div class="stat-pill pill-planned">🟢 <strong>${plannedCount}</strong> Gidilecek</div>
            <div class="stat-pill pill-visited">⚪ <strong>${visitedCount}</strong> Gezildi</div>
            ${hotel ? `<div class="stat-pill pill-hotel">🏨 Otel: <strong>${escapeHtml(hotel.name)}</strong></div>` : ''}
        `;
    }

    const filtered = getFilteredPlaces();

    if (filtered.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-places-card card glass">
                <i data-lucide="map-pin-off" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
                <h3>Henüz Mekan Eklenmemiş</h3>
                <p class="text-muted">Bu seyahat için gezilecek yerler, müzeler ve otelinizi haritaya ekleyin.</p>
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

        // Distance from hotel
        let distanceBadge = '';
        if (hotel && hotel.id !== place.id) {
            const distM = calculateDistance(hotel.latitude, hotel.longitude, place.latitude, place.longitude);
            const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(1)} km` : `${Math.round(distM)} m`;
            const walkMin = Math.round(distM / 80);
            distanceBadge = `<span class="place-distance-tag" title="Otele Uzaklık">🏨 ${distStr} (~${walkMin} dk)</span>`;
        } else if (place.category === 'hotel') {
            distanceBadge = `<span class="place-distance-tag hotel-tag">📍 Ana Konaklama Üssü</span>`;
        }

        const googleMapsDirUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;

        return `
            <div class="place-card card glass ${isVisited ? 'place-visited' : 'place-planned'}" data-id="${place.id}">
                <div class="place-card-left-number">
                    <span class="card-number-badge">#${placeNumber}</span>
                </div>

                <div class="place-card-content-area">
                    <div class="place-card-header">
                        <div class="place-category-pill" style="background: ${catInfo.bg}; color: ${catInfo.color};">
                            ${catInfo.emoji} ${catInfo.name}
                        </div>
                        <div class="place-status-wrapper">
                            <button type="button" class="btn-toggle-badge ${isVisited ? 'badge-visited' : 'badge-planned'}" onclick="window.togglePlaceStatusAction('${place.id}')">
                                ${isVisited ? '✓ Gezildi' : '🟢 Gidilecek'}
                            </button>
                        </div>
                    </div>

                    <div class="place-card-body">
                        <h3 class="place-name ${isVisited ? 'text-strikethrough' : ''}">${escapeHtml(place.name)}</h3>
                        ${place.address ? `<p class="place-address"><i data-lucide="map-pin"></i> ${escapeHtml(place.address)}</p>` : ''}
                        ${distanceBadge ? `<div class="margin-bottom-8">${distanceBadge}</div>` : ''}
                        ${place.notes ? `<p class="place-notes">${escapeHtml(place.notes)}</p>` : ''}
                        ${place.estimated_cost > 0 ? `<div class="place-cost-tag">Giriş: <strong>${place.estimated_cost} ${place.currency || 'EUR'}</strong></div>` : ''}
                    </div>

                    <div class="place-card-actions">
                        <a href="${googleMapsDirUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm" title="Google Maps Navigasyonu">
                            <i data-lucide="navigation"></i> Yol Tarifi
                        </a>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.focusPlaceOnMapAction(${place.latitude}, ${place.longitude})" title="Haritada Odaklan">
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
window.focusPlaceOnMapAction = function(lat, lng) {
    if (!mapInstance) return;
    mapInstance.setView([lat, lng], 16, { animate: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        showToast(newStatus === 'visited' ? 'Tebrikler! Mekan gezildi olarak işaretlendi.' : 'Mekan gidilecekler listesine alındı.', 'success');
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

    // Populate trips select in modal
    const tripSelect = document.getElementById('place-modal-trip-select');
    if (tripSelect) {
        tripSelect.innerHTML = '';
        state.tripsList.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.name;
            if (t.id === state.activeTripId) opt.selected = true;
            tripSelect.appendChild(opt);
        });
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
        document.getElementById('place-category').value = place.category;
        document.getElementById('place-status').value = place.status;
        document.getElementById('place-lat').value = place.latitude;
        document.getElementById('place-lng').value = place.longitude;
        document.getElementById('place-address').value = place.address || '';
        document.getElementById('place-notes').value = place.notes || '';
        document.getElementById('place-cost').value = place.estimated_cost || 0;
        document.getElementById('place-currency').value = place.currency || 'EUR';
        if (tripSelect && place.trip_id) tripSelect.value = place.trip_id;
    } else {
        state.selectedPlaceForEdit = null;
        if (titleEl) titleEl.textContent = 'Yeni Gezi Noktası / Otel Ekle';
        if (btnDeleteModal) {
            btnDeleteModal.classList.add('hidden');
            btnDeleteModal.style.display = 'none';
        }
        document.getElementById('place-id').value = '';
        // If map has a center, pre-fill
        if (mapInstance) {
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
 * Smart Multilingual Location Search
 * Combines OpenStreetMap Nominatim with Turkish Wikipedia/Wikidata Geosearch
 * so users can search in Turkish (e.g. 'Ulusal Arkeoloji Müzesi atina', 'Sintagma', 'Akropolis')
 */
async function handleLocationSearch() {
    const queryInput = document.getElementById('place-search-query');
    const query = queryInput ? queryInput.value.trim() : '';
    if (!query) {
        showToast("Lütfen aranacak yeri yazın (örn: Ulusal Arkeoloji Müzesi veya Acropolis)", "warning");
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
            console.warn("Nominatim search failed, trying multilingual wiki fallback:", nomErr);
        }

        // Step 2: Wikipedia / Wikidata Multilingual Geosearch Fallback (Perfect for Turkish names)
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
            showToast("Konum bulunamadı. Lütfen şehir adını ekleyin (örn: Ulusal Arkeoloji Müzesi Atina) veya haritaya tıklayarak pini yerleştirin.", "warning");
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
    const tripId = document.getElementById('place-modal-trip-select').value;
    const name = document.getElementById('place-name').value.trim();
    const category = document.getElementById('place-category').value;
    const status = document.getElementById('place-status').value;
    const lat = parseFloat(document.getElementById('place-lat').value);
    const lng = parseFloat(document.getElementById('place-lng').value);
    const address = document.getElementById('place-address').value.trim();
    const notes = document.getElementById('place-notes').value.trim();
    const cost = parseFloat(document.getElementById('place-cost').value) || 0;
    const currency = document.getElementById('place-currency').value;

    if (!tripId) {
        showToast("Lütfen bir seyahat seçin", "danger");
        return;
    }
    if (!name) {
        showToast("Mekan adı zorunludur", "danger");
        return;
    }
    if (isNaN(lat) || isNaN(lng)) {
        showToast("Lütfen geçerli enlem ve boylam koordinatı girin veya haritadan arayın", "danger");
        return;
    }

    const payload = {
        trip_id: tripId,
        name,
        category,
        status,
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
            showToast("Yeni mekan haritaya eklendi!", "success");
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

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderEmptyState() {
    const list = document.getElementById('places-cards-container');
    if (list) {
        list.innerHTML = `
            <div class="empty-places-card card glass">
                <i data-lucide="compass" style="width: 48px; height: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
                <h3>Seyahat Bulunamadı</h3>
                <p class="text-muted">Haritayı kullanmak için önce "Seyahatlerim" sayfasından en az bir rota (örneğin Atina) oluşturmalısınız.</p>
                <a href="#trips" class="btn btn-primary margin-top-12">Rotalara Git</a>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
    }
}
