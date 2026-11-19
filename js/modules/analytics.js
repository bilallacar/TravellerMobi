// js/modules/analytics.js - Privacy-friendly Visitor Traffic Tracker & Identity Stitching

import * as db from '../../db.js';
import { state } from '../state.js';

const VISITOR_ID_KEY = 'travellermobi_visitor_id_v1';
const SESSION_ID_KEY = 'travellermobi_session_id_v1';
const GEO_CACHE_KEY = 'travellermobi_geo_cache_v1';
const PRIVACY_ACK_KEY = 'travellermobi_privacy_ack_v1';

let lastTrackedKey = '';
let lastTrackedAt = 0;
let geoPromise = null;

// Reading engagement tracker (scroll depth + active reading seconds)
let activeReading = null;
let readingListenersBound = false;
let lastLoggedSearch = '';

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

function detectDeviceInfo() {
    const ua = navigator.userAgent || '';
    const width = window.innerWidth || screen.width || 0;

    let device_type = 'desktop';
    if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (width >= 640 && width <= 1024 && 'ontouchstart' in window)) {
        device_type = 'tablet';
    } else if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || width < 640) {
        device_type = 'mobile';
    }

    let os = 'Diğer';
    if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let browser = 'Diğer';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
    else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung';
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

    return {
        device_type,
        os,
        browser,
        language: (navigator.language || 'tr').slice(0, 16),
        screen_resolution: `${screen.width || 0}x${screen.height || 0}`,
        timezone: timezone.slice(0, 64),
        is_pwa
    };
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
        if (!db.hasInternet()) return fallback;
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
    if (!db.hasInternet()) return;

    const pagePath = extra.page_path || (window.location.hash || '#explore').slice(0, 180);
    const dedupeKey = `${eventType}|${pagePath}|${extra.post_slug || ''}|${extra.search_query || ''}`;
    const now = Date.now();
    if (eventType !== 'post_engagement' && dedupeKey === lastTrackedKey && now - lastTrackedAt < 2500) {
        return;
    }
    lastTrackedKey = dedupeKey;
    lastTrackedAt = now;

    try {
        const device = detectDeviceInfo();
        const source = extractTrafficSource();
        const geo = await resolveGeoInfo();

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

    // Only log meaningful reading sessions (at least 2 seconds or 25% scrolled)
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
    if (!postSlug) return;

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
    if (!userId) return;
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
