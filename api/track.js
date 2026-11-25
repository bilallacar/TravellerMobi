// api/track.js - Rate-limited server-side proxy for analytics & blog views
// Uses trusted Vercel Edge geo headers instead of client-supplied country/city.

const DEFAULT_SUPABASE_URL = 'https://pbfriozhmtyspfzgnkkq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM';

const EVENT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const EVENT_MAX_PER_IP = 45;
const VIEW_WINDOW_MS = 10 * 60 * 1000; // 10 minutes per IP+slug

const ALLOWED_EVENTS = new Set([
    'page_view',
    'post_view',
    'post_engagement',
    'news_click',
    'search',
    'auth_cta_click',
    'auth_login',
    'auth_signup'
]);

const ipBuckets = new Map();
const blogViewSeen = new Map();

function getClientIp(req) {
    const fwd = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
    return fwd || 'unknown';
}

function safeDecodeHeader(val) {
    if (!val || typeof val !== 'string') return null;
    try {
        return decodeURIComponent(val).trim() || null;
    } catch {
        return val.trim() || null;
    }
}

function checkIpRateLimit(ip) {
    const now = Date.now();
    const list = (ipBuckets.get(ip) || []).filter(ts => now - ts < EVENT_WINDOW_MS);
    if (list.length >= EVENT_MAX_PER_IP) {
        ipBuckets.set(ip, list);
        return false;
    }
    list.push(now);
    ipBuckets.set(ip, list);
    if (ipBuckets.size > 4000) {
        ipBuckets.clear();
    }
    return true;
}

function clip(val, maxLen) {
    if (val === null || val === undefined) return null;
    const s = String(val).trim();
    return s ? s.slice(0, maxLen) : null;
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const ip = getClientIp(req);
    if (!checkIpRateLimit(ip)) {
        return res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
    }

    const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || DEFAULT_SUPABASE_ANON_KEY;

    let body = {};
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch {
        return res.status(400).json({ ok: false, error: 'Invalid JSON' });
    }

    const authHeader = String(req.headers?.authorization || '');
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : supabaseAnonKey;

    try {
        // 1. Blog view counter with per-IP+slug deduplication
        if (body.action === 'blog_view') {
            const slug = clip(body.slug, 140);
            if (!slug || slug.length < 2) {
                return res.status(400).json({ ok: false, error: 'Invalid slug' });
            }
            const dedupKey = `${ip}|${slug}`;
            const now = Date.now();
            const lastSeen = blogViewSeen.get(dedupKey) || 0;
            if (now - lastSeen < VIEW_WINDOW_MS) {
                return res.status(200).json({ ok: true, deduplicated: true });
            }
            blogViewSeen.set(dedupKey, now);
            if (blogViewSeen.size > 5000) blogViewSeen.clear();

            await fetch(`${supabaseUrl}/rest/v1/rpc/increment_blog_view`, {
                method: 'POST',
                headers: {
                    apikey: supabaseAnonKey,
                    Authorization: `Bearer ${supabaseAnonKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ p_slug: slug })
            });

            return res.status(200).json({ ok: true });
        }

        // 2. Site visit / event analytics (server-verified geo headers)
        const visitorId = clip(body.p_visitor_id, 80);
        const eventType = clip(body.p_event_type || 'page_view', 40);
        if (!visitorId || visitorId.length < 6 || !ALLOWED_EVENTS.has(eventType)) {
            return res.status(400).json({ ok: false, error: 'Invalid analytics payload' });
        }

        const edgeCountry = safeDecodeHeader(req.headers['x-vercel-ip-country']);
        const edgeCity = safeDecodeHeader(req.headers['x-vercel-ip-city']);
        const edgeRegion = safeDecodeHeader(req.headers['x-vercel-ip-country-region']);

        const rpcPayload = {
            p_visitor_id: visitorId,
            p_session_id: clip(body.p_session_id, 80),
            p_event_type: eventType,
            p_page_path: clip(body.p_page_path || '#explore', 200),
            p_post_slug: clip(body.p_post_slug, 140),
            p_post_title: clip(body.p_post_title, 180),
            p_referrer: clip(body.p_referrer, 300),
            p_referrer_domain: clip(body.p_referrer_domain, 120),
            p_utm_source: clip(body.p_utm_source, 80),
            p_utm_medium: clip(body.p_utm_medium, 80),
            p_utm_campaign: clip(body.p_utm_campaign, 100),
            p_device_type: clip(body.p_device_type, 24),
            p_os: clip(body.p_os, 80),
            p_browser: clip(body.p_browser, 40),
            p_language: clip(body.p_language, 16),
            p_screen_resolution: clip(body.p_screen_resolution, 32),
            p_timezone: clip(body.p_timezone, 64),
            p_country: edgeCountry ? edgeCountry.slice(0, 64) : null,
            p_city: edgeCity ? edgeCity.slice(0, 80) : null,
            p_region: edgeRegion ? edgeRegion.slice(0, 80) : null,
            p_is_pwa: !!body.p_is_pwa,
            p_user_id: null,
            p_user_email: null,
            p_scroll_depth: typeof body.p_scroll_depth === 'number' ? Math.max(0, Math.min(100, Math.round(body.p_scroll_depth))) : null,
            p_duration_seconds: typeof body.p_duration_seconds === 'number' ? Math.max(0, Math.min(3600, Math.round(body.p_duration_seconds))) : null,
            p_search_query: clip(body.p_search_query, 120),
            p_search_results_count: typeof body.p_search_results_count === 'number' ? Math.max(0, Math.min(10000, Math.round(body.p_search_results_count))) : null
        };

        const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/record_site_visit`, {
            method: 'POST',
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${bearer}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(rpcPayload)
        });

        return res.status(rpcRes.ok ? 200 : 202).json({ ok: rpcRes.ok });
    } catch {
        return res.status(200).json({ ok: false });
    }
}
