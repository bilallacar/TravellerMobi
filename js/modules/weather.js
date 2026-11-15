// js/modules/weather.js - Live Trip Weather Forecast via Open-Meteo (No API Key Required)

import { escapeHtml, isValidCoord, showToast } from '../utils.js';

const WEATHER_CACHE_KEY = 'weather_cache_v1';
const GEOCODE_CACHE_KEY = 'weather_geocode_cache_v1';
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DAY_NAMES_TR = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/**
 * Maps Open-Meteo WMO weather codes to an emoji and concise Turkish description.
 */
export function describeWeatherCode(code) {
    const c = Number(code);
    if (c === 0) return { emoji: '☀️', label: 'Açık' };
    if (c === 1 || c === 2) return { emoji: '⛅', label: 'Parçalı Bulutlu' };
    if (c === 3) return { emoji: '☁️', label: 'Bulutlu' };
    if (c === 45 || c === 48) return { emoji: '🌫️', label: 'Sisli' };
    if ((c >= 51 && c <= 57) || c === 80) return { emoji: '🌦️', label: 'Çiseleme' };
    if ((c >= 61 && c <= 67) || c === 81 || c === 82) return { emoji: '🌧️', label: 'Yağmurlu' };
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { emoji: '❄️', label: 'Karlı' };
    if (c >= 95) return { emoji: '⛈️', label: 'Fırtına' };
    return { emoji: '🌤️', label: 'Değişken' };
}

function readJsonStorage(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
        return {};
    }
}

function writeJsonStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Ignore quota errors on private/full storage
    }
}

function formatDayLabel(isoDate, index) {
    if (index === 0) return 'Bugün';
    if (index === 1) return 'Yarın';
    const d = new Date(`${isoDate}T12:00:00`);
    if (Number.isNaN(d.getTime())) return isoDate;
    return DAY_NAMES_TR[d.getDay()] || isoDate.slice(5);
}

async function resolveTripCoords({ places = [], trip = null } = {}) {
    const validPlace = (places || []).find(p => p && isValidCoord(p.latitude, p.longitude));
    if (validPlace) {
        const label = trip?.destination || trip?.name || validPlace.address || validPlace.name || 'Konum';
        return {
            lat: parseFloat(validPlace.latitude),
            lng: parseFloat(validPlace.longitude),
            label
        };
    }

    const queryName = (trip?.destination || trip?.name || '').trim();
    if (!queryName) return null;

    const geoCache = readJsonStorage(GEOCODE_CACHE_KEY);
    const cacheKey = queryName.toLowerCase();
    if (geoCache[cacheKey]) {
        return geoCache[cacheKey];
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return null;
    }

    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(queryName)}&count=1&language=tr&format=json`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const json = await res.json();
        const match = json?.results?.[0];
        if (!match) return null;

        const resolved = {
            lat: match.latitude,
            lng: match.longitude,
            label: match.name || queryName
        };
        geoCache[cacheKey] = resolved;
        writeJsonStorage(GEOCODE_CACHE_KEY, geoCache);
        return resolved;
    } catch {
        return null;
    }
}

/**
 * Fetches current weather and 4-day forecast for a trip or list of places,
 * caching responses in localStorage for 30 minutes and falling back to stale cache offline.
 */
export async function fetchTripWeather({ places = [], trip = null } = {}) {
    const target = await resolveTripCoords({ places, trip });
    if (!target) return null;

    const coordKey = `${target.lat.toFixed(2)},${target.lng.toFixed(2)}`;
    const allCache = readJsonStorage(WEATHER_CACHE_KEY);
    const cached = allCache[coordKey];
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        return { ...cached.data, label: target.label };
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return cached ? { ...cached.data, label: target.label, isStale: true } : null;
    }

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${target.lat}&longitude=${target.lng}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=4`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const currentCode = json?.current?.weather_code ?? json?.daily?.weather_code?.[0] ?? 0;
        const currentMeta = describeWeatherCode(currentCode);
        const dailyTimes = json?.daily?.time || [];

        const days = dailyTimes.map((dateStr, idx) => {
            const meta = describeWeatherCode(json.daily.weather_code?.[idx]);
            return {
                dateStr,
                dayLabel: formatDayLabel(dateStr, idx),
                emoji: meta.emoji,
                label: meta.label,
                tempMax: Math.round(json.daily.temperature_2m_max?.[idx] ?? 0),
                tempMin: Math.round(json.daily.temperature_2m_min?.[idx] ?? 0),
                rainProb: Math.round(json.daily.precipitation_probability_max?.[idx] ?? 0)
            };
        });

        const parsed = {
            currentTemp: Math.round(json?.current?.temperature_2m ?? days[0]?.tempMax ?? 0),
            emoji: currentMeta.emoji,
            description: currentMeta.label,
            days
        };

        allCache[coordKey] = { timestamp: now, data: parsed };
        writeJsonStorage(WEATHER_CACHE_KEY, allCache);
        return { ...parsed, label: target.label };
    } catch (err) {
        console.warn('Weather fetch failed, using fallback if cached:', err);
        return cached ? { ...cached.data, label: target.label, isStale: true } : null;
    }
}

/**
 * Renders the 4-day weather strip inside the Dashboard Aktif Seyahat card.
 */
export function renderDashboardWeather(containerEl, weather) {
    if (!containerEl) return;
    if (!weather || !weather.days || weather.days.length === 0) {
        containerEl.classList.add('hidden');
        containerEl.innerHTML = '';
        return;
    }

    const daysHtml = weather.days.map(day => `
        <div class="weather-day-chip" title="${escapeHtml(day.label)} • Yağış ihtimali: %${day.rainProb}">
            <span class="weather-chip-day">${escapeHtml(day.dayLabel)}</span>
            <span class="weather-chip-icon">${day.emoji}</span>
            <span class="weather-chip-temp">${day.tempMax}°<small>/${day.tempMin}°</small></span>
            ${day.rainProb >= 20 ? `<span class="weather-chip-rain">💧%${day.rainProb}</span>` : ''}
        </div>
    `).join('');

    containerEl.innerHTML = `
        <div class="weather-current-col">
            <span class="weather-current-emoji">${weather.emoji}</span>
            <div>
                <div class="weather-current-temp">${weather.currentTemp}°C · ${escapeHtml(weather.description)}</div>
                <div class="weather-current-loc">${escapeHtml(weather.label || '')}</div>
            </div>
        </div>
        <div class="weather-days-row">${daysHtml}</div>
    `;
    containerEl.classList.remove('hidden');
}

/**
 * Renders a compact clickable weather pill inside the Map card header.
 */
export function renderPlacesWeatherPill(pillEl, weather) {
    if (!pillEl) return;
    if (!weather || !weather.days || weather.days.length === 0) {
        pillEl.classList.add('hidden');
        pillEl.innerHTML = '';
        pillEl.onclick = null;
        return;
    }

    const today = weather.days[0];
    const rainText = today?.rainProb >= 15 ? ` · 💧%${today.rainProb}` : '';
    pillEl.innerHTML = `<span>${weather.emoji}</span> <strong>${weather.currentTemp}°C</strong> <span class="weather-pill-meta">${escapeHtml(weather.description)}${rainText}</span>`;
    pillEl.classList.remove('hidden');

    pillEl.onclick = () => {
        const summary = weather.days
            .map(d => `${d.dayLabel}: ${d.emoji} ${d.tempMax}°/${d.tempMin}° (%${d.rainProb} yağış)`)
            .join(' | ');
        showToast(`${weather.label}: ${summary}`, 'info');
    };
}
