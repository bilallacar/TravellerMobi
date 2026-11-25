// api/travel-news.js - Curated & Filtered Automatic Travel News Aggregator (RSS/Atom)

const DEFAULT_FEEDS = [
    {
        name: 'Vize & Pasaport',
        category: 'Vize & Pasaport',
        curated: true,
        url: 'https://news.google.com/rss/search?q=(Schengen+OR+%22vize+s%C3%BCre%C3%A7leri%22+OR+%22vizesiz+%C3%BClkeler%22+OR+%22kap%C4%B1da+vize%22+OR+%22pasaport+%C3%BCcreti%22)+when:14d&hl=tr&gl=TR&ceid=TR:tr'
    },
    {
        name: 'Havacılık & Uçuş',
        category: 'Havacılık',
        curated: true,
        url: 'https://news.google.com/rss/search?q=(%22u%C3%A7ak+bileti%22+OR+%22direkt+u%C3%A7u%C5%9F%22+OR+%22yeni+sefer%22+OR+%22THY+sefer%22+OR+%22Pegasus+kampanya%22+OR+%22AJet+sefer%22)+when:10d&hl=tr&gl=TR&ceid=TR:tr'
    },
    {
        name: 'Destinasyon & Gezi',
        category: 'Destinasyon',
        curated: true,
        url: 'https://news.google.com/rss/search?q=(%22yurt+d%C4%B1%C5%9F%C4%B1+tatil%22+OR+%22gezilecek+yerler%22+OR+%22seyahat+rotalar%C4%B1%22+OR+%22tren+rotas%C4%B1%22+OR+%22Avrupa+seyahat%22)+when:14d&hl=tr&gl=TR&ceid=TR:tr'
    },
    {
        name: 'Turizm & Seyahat',
        category: 'Turizm',
        curated: true,
        url: 'https://news.google.com/rss/search?q=(%22M%C3%BCzeKart%22+OR+%22turizm+sezonu%22+OR+%22yurt+d%C4%B1%C5%9F%C4%B1+%C3%A7%C4%B1k%C4%B1%C5%9F+harc%C4%B1%22+OR+%22havayolu+yolcu%22+OR+%22otel+rezervasyon%22)+when:10d&hl=tr&gl=TR&ceid=TR:tr'
    }
];

// Trusted mainstream & dedicated travel/aviation outlets for Google News items
const TRUSTED_SOURCE_PATTERNS = [
    'ntv',
    'euronews',
    'bbc',
    'dw',
    'hürriyet',
    'hurriyet',
    'milliyet',
    'sözcü',
    'sozcu',
    'habertürk',
    'haberturk',
    'cnn türk',
    'cnnturk',
    'trt haber',
    'anadolu ajansı',
    'bloomberg',
    'ekonomim',
    'dünya',
    'dunya',
    'oksijen',
    't24',
    'airporthaber',
    'airlinehaber',
    'havayolu101',
    'tolga özbek',
    'turizm güncel',
    'turizmguncel',
    'turizm ajansı',
    'turizm günlüğü',
    'turizmgunlugu',
    'turizmdays',
    'turizmnews',
    'enuygun',
    'obilet',
    'turna',
    'webtekno',
    'shiftdelete',
    'cumhuriyet',
    'sabah',
    'akşam',
    'karar',
    'nefes',
    'aposto',
    'indyturk',
    'independent türkçe'
];

// Always-blocked sources (normalized lowercase)
const DEFAULT_BLOCKED_SOURCES = [
    'rudaw',
    'sputnik',
    'yeni akit',
    'ensonhaber'
];

// Off-topic / noisy headline patterns that don't belong in a travel magazine feed
const NOISE_HEADLINE_PATTERNS = [
    /fuar[ıi]\s+kap[ıi]lar[ıi]n[ıi]\s+a[çc]t[ıi]/i,
    /fuar[ıi]\s+ba[şs]lad[ıi]/i,
    /\bfuar\b.*\bfirma\s+kat[ıi]l[ıi]yor/i,
    /\bcinayet\b|\b[öo]ld[üu]r[üu]ld[üu]\b|\btutukland[ıi]\b|\bg[öo]zalt[ıi]\b/i,
    /\bs[üu]per\s+loto\b|\b[şs]ans\s+topu\b|\bpiyango\b|\bbur[çc]\s+yorumu\b/i,
    /\btransfer\b.*\bfutbol\b|\bs[üu]per\s+lig\b|\bderbi\b/i,
    /\bmeclis\s+g[üu]ndemi\b|\bparti\s+kongresi\b|\bmilletvekili\b/i
];

function normalizeText(str) {
    return String(str || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/\s+/g, ' ')
        .trim();
}

function isSafePublicHttpsUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
            const parts = host.split('.').map(Number);
            if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
            if (parts[0] === 169 && parts[1] === 254) return false;
            if (parts[0] === 192 && parts[1] === 168) return false;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
        }
        if (host.includes(':')) return false;
        return true;
    } catch {
        return false;
    }
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    let out = String(str).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    // Decode up to 2 passes to catch double-escaped entities like &amp;nbsp;
    for (let i = 0; i < 2; i++) {
        out = out
            .replace(/&nbsp;|&#160;|&#xA0;|\u00A0/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
    }
    return out;
}

function stripHtml(html) {
    if (!html) return '';
    return decodeHtmlEntities(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTag(block, tagName) {
    const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = block.match(regex);
    return match ? match[1].trim() : '';
}

function extractImageFromBlock(block, rawDescription) {
    const mediaMatch = block.match(/<(?:media:content|media:thumbnail|enclosure)[^>]+url=["']([^"']+)["']/i);
    if (mediaMatch && isSafePublicHttpsUrl(mediaMatch[1])) {
        return mediaMatch[1];
    }
    const decodedDesc = decodeHtmlEntities(rawDescription || '');
    const imgMatch = decodedDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch && isSafePublicHttpsUrl(imgMatch[1])) {
        return imgMatch[1];
    }
    return '';
}

function isSourceAllowed(sourceName, link, isCuratedFeed, customBlockedList) {
    const normSource = normalizeText(sourceName);
    const normLink = normalizeText(link);

    const allBlocked = [...DEFAULT_BLOCKED_SOURCES, ...customBlockedList];
    for (const blk of allBlocked) {
        if (!blk) continue;
        if (normSource.includes(blk) || normLink.includes(blk)) {
            return false;
        }
    }

    // Admin's custom RSS feeds always pass (unless explicitly blocked above)
    if (!isCuratedFeed) return true;

    // For Google News curated feeds, require a reputable known Turkish/travel source
    return TRUSTED_SOURCE_PATTERNS.some(pat => normSource.includes(pat));
}

function isHeadlineRelevant(title) {
    if (!title || title.length < 18) return false;
    for (const pattern of NOISE_HEADLINE_PATTERNS) {
        if (pattern.test(title)) return false;
    }
    return true;
}

function cleanSummary(rawDesc, title, sourceName) {
    let summary = stripHtml(rawDesc);
    if (!summary) return '';

    // Remove duplicate title prefix from Google News descriptions
    const normSum = normalizeText(summary);
    const normTitle = normalizeText(title);
    if (normTitle && normSum.startsWith(normTitle)) {
        summary = summary.slice(title.length).replace(/^[\s\-–|:•·]+/, '').trim();
    }

    // Remove trailing or standalone source name (e.g. "Euronews.com", "Hürriyet")
    if (sourceName) {
        const escapedSrc = sourceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        summary = summary
            .replace(new RegExp(`^${escapedSrc}$`, 'i'), '')
            .replace(new RegExp(`[\\s\\-–|:•·]*${escapedSrc}$`, 'i'), '')
            .trim();
    }

    // If remaining text is too short or just punctuation/source remnant, leave empty (clean headline-only card)
    if (summary.length < 32) return '';

    if (summary.length > 190) {
        summary = summary.slice(0, 187).trim() + '...';
    }
    return summary;
}

function parseFeedXml(xml, feedMeta, customBlockedList) {
    const items = [];
    const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

    for (const block of itemMatches.slice(0, 25)) {
        const rawTitle = extractTag(block, 'title');
        let title = stripHtml(rawTitle);
        if (!title) continue;

        let link = stripHtml(extractTag(block, 'link'));
        if (!link) {
            const atomLink = block.match(/<link[^>]+href=["']([^"']+)["']/i);
            if (atomLink) link = decodeHtmlEntities(atomLink[1]);
        }
        if (!link || !link.startsWith('http')) continue;

        const rawDesc = extractTag(block, 'description') || extractTag(block, 'summary') || extractTag(block, 'content:encoded');
        const pubDateRaw = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated');
        let sourceName = stripHtml(extractTag(block, 'source')) || feedMeta.name;

        // Google News titles end with " - Source Name"
        const dashIdx = title.lastIndexOf(' - ');
        if (dashIdx > 20 && title.length - dashIdx < 50) {
            const possibleSource = title.slice(dashIdx + 3).trim();
            if (possibleSource) {
                sourceName = possibleSource;
                title = title.slice(0, dashIdx).trim();
            }
        }

        if (!isSourceAllowed(sourceName, link, !!feedMeta.curated, customBlockedList)) continue;
        if (!isHeadlineRelevant(title)) continue;

        const summary = cleanSummary(rawDesc, title, sourceName);
        const parsedDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
        const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
        const imageUrl = extractImageFromBlock(block, rawDesc);

        items.push({
            id: Buffer.from(link).toString('base64url').slice(0, 24),
            title,
            summary,
            link,
            source: sourceName,
            category: feedMeta.category || 'Seyahat',
            image_url: imageUrl,
            published_at: publishedAt
        });
    }

    return items;
}

async function fetchSingleFeed(feedMeta, customBlockedList) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(feedMeta.url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'TravellerMobi-NewsBot/1.1 (+https://traveller-mobi.vercel.app)',
                'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml'
            }
        });
        if (!response.ok) return [];
        const xml = await response.text();
        return parseFeedXml(xml, feedMeta, customBlockedList);
    } catch {
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

const DEFAULT_SUPABASE_URL = 'https://pbfriozhmtyspfzgnkkq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM';

async function loadServerNewsSources() {
    const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || DEFAULT_SUPABASE_ANON_KEY;
    const customFeeds = [];
    const blockedSources = [];

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
            const res = await fetch(
                `${supabaseUrl}/rest/v1/news_sources?is_enabled=eq.true&select=name,rss_url,category&order=created_at.asc`,
                {
                    signal: controller.signal,
                    headers: {
                        apikey: supabaseAnonKey,
                        Authorization: `Bearer ${supabaseAnonKey}`
                    }
                }
            );
            if (!res.ok) return { customFeeds, blockedSources };
            const rows = await res.json();
            if (!Array.isArray(rows)) return { customFeeds, blockedSources };

            for (const row of rows) {
                if (!row) continue;
                if (row.category === '__block__') {
                    const norm = normalizeText(row.name);
                    if (norm.length >= 2 && blockedSources.length < 30) {
                        blockedSources.push(norm);
                    }
                } else if (customFeeds.length < 6 && typeof row.rss_url === 'string' && isSafePublicHttpsUrl(row.rss_url)) {
                    customFeeds.push({
                        name: String(row.name || 'Özel Kaynak').slice(0, 60),
                        category: String(row.category || 'Seyahat').slice(0, 30),
                        curated: false,
                        url: row.rss_url
                    });
                }
            }
        } finally {
            clearTimeout(timeout);
        }
    } catch {
        // Fallback silently to curated default feeds
    }

    return { customFeeds, blockedSources };
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Load admin-configured RSS sources & blocked outlets server-side from Supabase
        // (Untrusted client ?custom= query URLs are intentionally ignored to prevent SSRF/open-proxy abuse)
        const { customFeeds, blockedSources } = await loadServerNewsSources();
        const feeds = [...DEFAULT_FEEDS, ...customFeeds];
        const customBlockedList = blockedSources;

        const results = await Promise.allSettled(feeds.map(f => fetchSingleFeed(f, customBlockedList)));
        const allItems = [];
        const seenTitles = new Set();

        for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            for (const item of r.value) {
                const normKey = normalizeText(item.title).replace(/[^a-z0-9ğüşıöç]/gi, '').slice(0, 52);
                if (!normKey || seenTitles.has(normKey)) continue;
                seenTitles.add(normKey);
                allItems.push(item);
            }
        }

        allItems.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 24, 6), 50);

        return res.status(200).json({
            ok: true,
            updatedAt: new Date().toISOString(),
            count: Math.min(allItems.length, limit),
            items: allItems.slice(0, limit)
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: 'Seyahat haberleri şu anda alınamadı.',
            details: err?.message || 'Unknown error'
        });
    }
}
