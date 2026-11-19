// js/modules/analytics.js - Privacy-friendly Visitor Traffic Tracker, Bot/Localhost Filter & Detailed Device Detection

import * as db from '../../db.js';
import { state } from '../state.js';

const VISITOR_ID_KEY = 'travellermobi_visitor_id_v1';
const SESSION_ID_KEY = 'travellermobi_session_id_v1';
const GEO_CACHE_KEY = 'travellermobi_geo_cache_v2';
const PRIVACY_ACK_KEY = 'travellermobi_privacy_ack_v1';

let lastTrackedKey = '';
let lastTrackedAt = 0;
let geoPromise = null;
let cachedDeviceInfoPromise = null;

// Reading engagement tracker (scroll depth + active reading seconds)
let activeReading = null;
let readingListenersBound = false;
let lastLoggedSearch = '';

function isLocalDevHost() {
    const host = (window.location.hostname || '').toLowerCase();
    return (
        !host ||
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.endsWith('.local')
    );
}

function isLikelyBot() {
    const ua = navigator.userAgent || '';
    if (!ua) return true;
    if (navigator.webdriver === true) return true;
    if (/bot|crawler|spider|slurp|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|pinterest|bingpreview|applebot|yandex|baiduspider|duckduckbot|semrush|ahrefs|mj12bot|curl|wget|python-requests|go-http-client/i.test(ua)) {
        return true;
    }
    // Typical headless Linux link-preview crawler signature (e.g. San Jose 800x600)
    if (/Linux/i.test(ua) && !/Android/i.test(ua) && screen.width === 800 && screen.height === 600) {
        return true;
    }
    return false;
}

function shouldSkipTracking() {
    return !db.hasInternet() || isLocalDevHost() || isLikelyBot();
}

function createUid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getVisitorId() {
    try {
        let id = localStorage.getItem(VISITOR_ID_KEY);
        if (!id) {
            id = createUid();
            localStorage.setItem(VISITOR_ID_KEY, id);
        }
        return id;
    } catch {
        return createUid();
    }
}

export function getSessionId() {
    try {
        let id = sessionStorage.getItem(SESSION_ID_KEY);
        if (!id) {
            id = createUid();
            sessionStorage.setItem(SESSION_ID_KEY, id);
        }
        return id;
    } catch {
        return createUid();
    }
}

function detectAppleDeviceModel(ua) {
    const w = Math.min(screen.width || 0, screen.height || 0);
    const h = Math.max(screen.width || 0, screen.height || 0);
    const dpr = Math.round(window.devicePixelRatio || 1);

    if (/iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
        if (w === 1024 && h === 1366) return 'iPad Pro 12.9"/13"';
        if (w === 834 && h === 1194) return 'iPad Pro 11"';
        if (w === 820 && h === 1180) return 'iPad Air / 10. Nesil';
        if (w === 744 && h === 1133) return 'iPad mini';
        return 'iPad';
    }

    if (!/iPhone/i.test(ua)) return '';

    const key = `${w}x${h}@${dpr}`;
    const map = {
        '440x956@3': 'iPhone 16 Pro Max',
        '402x874@3': 'iPhone 16 Pro',
        '430x932@3': 'iPhone 14/15/16 Plus·Max',
        '393x852@3': 'iPhone 14 Pro / 15 / 16',
        '428x926@3': 'iPhone 12/13/14 Pro Max',
        '390x844@3': 'iPhone 12 / 13 / 14',
        '375x812@3': 'iPhone X/XS/11 Pro/mini',
        '414x896@3': 'iPhone XS Max / 11 Pro Max',
        '414x896@2': 'iPhone XR / 11',
        '414x736@3': 'iPhone 6/7/8 Plus',
        '375x667@2': 'iPhone SE / 8'
    };
    return map[key] || 'iPhone';
}

function prettifyAndroidModel(rawModel) {
    const m = String(rawModel || '').trim();
    if (!m || m.toUpperCase() === 'K') return '';

    const prefixes = [
        [/^SM-S928/i, 'Galaxy S24 Ultra'],
        [/^SM-S926/i, 'Galaxy S24+'],
        [/^SM-S921/i, 'Galaxy S24'],
        [/^SM-S938/i, 'Galaxy S25 Ultra'],
        [/^SM-S936/i, 'Galaxy S25+'],
        [/^SM-S931/i, 'Galaxy S25'],
        [/^SM-S918/i, 'Galaxy S23 Ultra'],
        [/^SM-S916/i, 'Galaxy S23+'],
        [/^SM-S911/i, 'Galaxy S23'],
        [/^SM-S908/i, 'Galaxy S22 Ultra'],
        [/^SM-A55/i, 'Galaxy A55'],
        [/^SM-A54/i, 'Galaxy A54'],
        [/^SM-A53/i, 'Galaxy A53'],
        [/^SM-A35/i, 'Galaxy A35'],
        [/^SM-A34/i, 'Galaxy A34'],
        [/^SM-F9/i, 'Galaxy Z Fold'],
        [/^SM-F7/i, 'Galaxy Z Flip'],
        [/^SM-/i, `Samsung ${m}`]
    ];
    for (const [rx, label] of prefixes) {
        if (rx.test(m)) return label;
    }
    return m.slice(0, 32);
}

async function detectDeviceInfoAsync() {
    if (cachedDeviceInfoPromise) return cachedDeviceInfoPromise;

    cachedDeviceInfoPromise = (async () => {
        const ua = navigator.userAgent || '';
        const width = window.innerWidth || screen.width || 0;
        const isIPadDesktopUA = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

        let device_type = 'desktop';
        if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || isIPadDesktopUA || (width >= 640 && width <= 1024 && 'ontouchstart' in window)) {
            device_type = 'tablet';
        } else if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || width < 640) {
            device_type = 'mobile';
        }

        let osBase = 'Diğer';
        let modelLabel = '';

        if (/iPhone|iPad|iPod/i.test(ua) || isIPadDesktopUA) {
            const iosVer = ua.match(/OS\s(\d+)[._](\d+)/i);
            osBase = iosVer ? `iOS ${iosVer[1]}.${iosVer[2]}` : 'iOS';
            modelLabel = detectAppleDeviceModel(ua);
        } else if (/Android/i.test(ua)) {
            const andVer = ua.match(/Android\s([\d.]+)/i);
            osBase = andVer ? `Android ${andVer[1].split('.')[0]}` : 'Android';

            // Try Chromium High-Entropy Client Hints for exact hardware model
            if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
                try {
                    const hints = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
                    if (hints?.model) {
                        modelLabel = prettifyAndroidModel(hints.model);
                    }
                    if (hints?.platformVersion && !andVer) {
                        const major = String(hints.platformVersion).split('.')[0];
                        if (major && major !== '0') osBase = `Android ${major}`;
                    }
                } catch (_) {}
            }
            if (!modelLabel) {
                const uaModelMatch = ua.match(/Android\s[\d.]+;\s*([^;)]+?)(?:\s+Build\/|[;)])/i);
                if (uaModelMatch && uaModelMatch[1]) {
                    modelLabel = prettifyAndroidModel(uaModelMatch[1]);
                }
            }
        } else if (/Windows NT/i.test(ua)) {
            osBase = 'Windows';
            if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === 'function') {
                try {
                    const hints = await navigator.userAgentData.getHighEntropyValues(['platformVersion']);
                    const major = parseInt(String(hints?.platformVersion || '').split('.')[0], 10);
                    if (major >= 13) osBase = 'Windows 11';
                    else if (major > 0) osBase = 'Windows 10';
                } catch (_) {}
            }
        } else if (/Mac OS X/i.test(ua)) {
            osBase = 'macOS';
        } else if (/Linux/i.test(ua)) {
            osBase = 'Linux';
        }

        const os = modelLabel ? `${osBase} · ${modelLabel}` : osBase;

        let browser = 'Diğer';
        if (/Edg\//i.test(ua)) browser = 'Edge';
        else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
        else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung';
        else if (/CriOS/i.test(ua)) browser = 'Chrome iOS';
        else if (/FxiOS/i.test(ua)) browser = 'Firefox iOS';
        else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
        else if (/Firefox\//i.test(ua)) browser = 'Firefox';
        else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';

        let timezone = '';
        try {
            timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch (_) {}

        const is_pwa = !!(
            window.matchMedia?.('(display-mode: standalone)').matches ||
            window.navigator.standalone === true
        );

        const dpr = window.devicePixelRatio ? `@${Math.round(window.devicePixelRatio)}x` : '';
        return {
            device_type,
            os: os.slice(0, 80),
            browser,
            language: (navigator.language || 'tr').slice(0, 16),
            screen_resolution: `${screen.width || 0}x${screen.height || 0}${dpr ? ' ' + dpr : ''}`,
            timezone: timezone.slice(0, 64),
            is_pwa
        };
    })();

    return cachedDeviceInfoPromise;
}

function extractTrafficSource() {
    const params = new URLSearchParams(window.location.search);
    const referrer = document.referrer || '';
    let referrer_domain = 'Doğrudan';

    if (referrer) {
        try {
            const refUrl = new URL(referrer);
            if (refUrl.hostname === window.location.hostname) {
                referrer_domain = 'Site İçi';
            } else {
                referrer_domain = refUrl.hostname.replace(/^www\./, '');
            }
        } catch {
            referrer_domain = 'Diğer';
        }
    }

    return {
        referrer: referrer.slice(0, 300) || null,
        referrer_domain,
        utm_source: (params.get('utm_source') || '').slice(0, 60) || null,
        utm_medium: (params.get('utm_medium') || '').slice(0, 60) || null,
        utm_campaign: (params.get('utm_campaign') || '').slice(0, 80) || null
    };
}

async function resolveGeoInfo() {
    try {
        const cached = sessionStorage.getItem(GEO_CACHE_KEY);
        if (cached) return JSON.parse(cached);
    } catch (_) {}

    if (geoPromise) return geoPromise;

    geoPromise = (async () => {
        const fallback = { country: null, city: null, region: null };
        if (shouldSkipTracking()) return fallback;
        try {
            const res = await fetch('/api/geo', { cache: 'no-store' });
            if (!res.ok) return fallback;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return fallback;
            const data = await res.json();
            const clean = {
                country: data?.country || null,
                city: data?.city || null,
                region: data?.region || null
            };
            try { sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(clean)); } catch (_) {}
            return clean;
        } catch {
            return fallback;
        }
    })();

    return geoPromise;
}

export async function trackEvent(eventType = 'page_view', extra = {}) {
    if (shouldSkipTracking()) return;

    const pagePath = extra.page_path || (window.location.hash || '#explore').slice(0, 180);
    const dedupeKey = `${eventType}|${pagePath}|${extra.post_slug || ''}|${extra.search_query || ''}`;
    const now = Date.now();
    if (eventType !== 'post_engagement' && dedupeKey === lastTrackedKey && now - lastTrackedAt < 2500) {
        return;
    }
    lastTrackedKey = dedupeKey;
    lastTrackedAt = now;

    try {
        const [device, geo] = await Promise.all([
            detectDeviceInfoAsync(),
            resolveGeoInfo()
        ]);
        const source = extractTrafficSource();

        await db.recordSiteVisit({
            visitor_id: getVisitorId(),
            session_id: getSessionId(),
            event_type: eventType,
            page_path: pagePath,
            post_slug: extra.post_slug || null,
            post_title: extra.post_title ? String(extra.post_title).slice(0, 180) : null,
            referrer: source.referrer,
            referrer_domain: source.referrer_domain,
            utm_source: source.utm_source,
            utm_medium: source.utm_medium,
            utm_campaign: source.utm_campaign,
            device_type: device.device_type,
            os: device.os,
            browser: device.browser,
            language: device.language,
            screen_resolution: device.screen_resolution,
            timezone: device.timezone,
            country: geo.country,
            city: geo.city,
            region: geo.region,
            is_pwa: device.is_pwa,
            user_id: state.activeUser?.id || null,
            user_email: state.activeUser?.email || null,
            scroll_depth: typeof extra.scroll_depth === 'number' ? extra.scroll_depth : null,
            duration_seconds: typeof extra.duration_seconds === 'number' ? extra.duration_seconds : null,
            search_query: extra.search_query || null,
            search_results_count: typeof extra.search_results_count === 'number' ? extra.search_results_count : null
        });
    } catch (_) {
        // Silent analytics failure — never disrupt UX
    }
}

export function trackPageView(pagePath, extra = {}) {
    trackEvent('page_view', { page_path: pagePath, ...extra });
}

export function trackSearchQuery(query, resultsCount) {
    const clean = String(query || '').trim().toLowerCase().slice(0, 100);
    if (clean.length < 2) return;
    if (clean === lastLoggedSearch) return;
    lastLoggedSearch = clean;
    trackEvent('search', {
        page_path: '#explore',
        search_query: clean,
        search_results_count: Number(resultsCount) || 0
    });
}

export function trackAuthCtaClick(sourcePath = '#explore') {
    trackEvent('auth_cta_click', {
        page_path: sourcePath
    });
}

function computeCurrentScrollPercent() {
    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const viewHeight = window.innerHeight || doc.clientHeight || 1;
    const fullHeight = Math.max(doc.scrollHeight || 1, document.body?.scrollHeight || 1);
    const maxScrollable = Math.max(fullHeight - viewHeight, 1);
    if (fullHeight <= viewHeight + 40) return 100;
    return Math.min(100, Math.max(0, Math.round((scrollTop / maxScrollable) * 100)));
}

function snapScrollMilestone(pct) {
    if (pct >= 95) return 100;
    if (pct >= 75) return 75;
    if (pct >= 50) return 50;
    if (pct >= 25) return 25;
    return Math.max(0, pct);
}

function handleReadingScroll() {
    if (!activeReading) return;
    const pct = computeCurrentScrollPercent();
    if (pct > activeReading.maxScroll) {
        activeReading.maxScroll = pct;
    }
}

export function flushReadingSession() {
    if (!activeReading || activeReading.flushed) return;
    const now = Date.now();
    if (!document.hidden && activeReading.visibleSince) {
        activeReading.accumulatedMs += (now - activeReading.visibleSince);
        activeReading.visibleSince = now;
    }

    const durationSec = Math.round(activeReading.accumulatedMs / 1000);
    const scrollPct = snapScrollMilestone(activeReading.maxScroll);

    if (durationSec >= 2 || scrollPct >= 25) {
        activeReading.flushed = true;
        trackEvent('post_engagement', {
            page_path: `#post?slug=${activeReading.slug}`,
            post_slug: activeReading.slug,
            post_title: activeReading.title,
            scroll_depth: scrollPct,
            duration_seconds: Math.min(durationSec, 3600)
        });
    }
    activeReading = null;
}

export function startReadingSession(postSlug, postTitle) {
    flushReadingSession();
    if (!postSlug || shouldSkipTracking()) return;

    activeReading = {
        slug: postSlug,
        title: postTitle || postSlug,
        visibleSince: document.hidden ? null : Date.now(),
        accumulatedMs: 0,
        maxScroll: computeCurrentScrollPercent(),
        flushed: false
    };

    if (!readingListenersBound) {
        readingListenersBound = true;
        window.addEventListener('scroll', handleReadingScroll, { passive: true });
        document.addEventListener('visibilitychange', () => {
            if (!activeReading) return;
            if (document.hidden) {
                if (activeReading.visibleSince) {
                    activeReading.accumulatedMs += (Date.now() - activeReading.visibleSince);
                    activeReading.visibleSince = null;
                }
                flushReadingSession();
            } else {
                activeReading.visibleSince = Date.now();
            }
        });
        window.addEventListener('pagehide', () => flushReadingSession());
    }
}

export async function identifyVisitor(userId, email) {
    if (!userId || shouldSkipTracking()) return;
    try {
        const visitorId = getVisitorId();
        await db.linkVisitorToUser(visitorId, userId, email || null);
    } catch (_) {}
}

export function initPrivacyNotice() {
    const banner = document.getElementById('privacy-notice-banner');
    const acceptBtn = document.getElementById('btn-accept-privacy-notice');
    if (!banner || !acceptBtn) return;

    try {
        if (!localStorage.getItem(PRIVACY_ACK_KEY)) {
            banner.classList.remove('hidden');
        }
    } catch (_) {}

    acceptBtn.addEventListener('click', () => {
        try { localStorage.setItem(PRIVACY_ACK_KEY, '1'); } catch (_) {}
        banner.classList.add('hidden');
    });
}
