// api/travel-news.js - Vercel Serverless Automatic Travel News Aggregator (RSS/Atom)

const DEFAULT_FEEDS = [
    {
        name: 'Seyahat & Turizm',
        category: 'Turizm',
        url: 'https://news.google.com/rss/search?q=seyahat+OR+turizm+OR+%22gezi+rehberi%22+when:7d&hl=tr&gl=TR&ceid=TR:tr'
    },
    {
        name: 'Havacılık & Uçuş',
        category: 'Havacılık',
        url: 'https://news.google.com/rss/search?q=THY+OR+Pegasus+OR+havaliman%C4%B1+OR+%22u%C3%A7ak+bileti%22+when:7d&hl=tr&gl=TR&ceid=TR:tr'
    },
    {
        name: 'Vize & Pasaport',
        category: 'Vize & Pasaport',
        url: 'https://news.google.com/rss/search?q=Schengen+OR+vize+OR+pasaport+OR+%22vizesiz+%C3%BClkeler%22+when:14d&hl=tr&gl=TR&ceid=TR:tr'
    },
    {
        name: 'Dünya Destinasyonları',
        category: 'Destinasyon',
        url: 'https://news.google.com/rss/search?q=%22yurt+d%C4%B1%C5%9F%C4%B1+tatil%22+OR+%22tatil+rotalar%C4%B1%22+OR+otel+turizm+when:14d&hl=tr&gl=TR&ceid=TR:tr'
    }
];

function isSafePublicHttpsUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:') return false;
        const host = parsed.hostname.toLowerCase();
        if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
        // Reject raw IPv4 private / loopback / link-local / metadata ranges
        if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) {
            const parts = host.split('.').map(Number);
            if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return false;
            if (parts[0] === 169 && parts[1] === 254) return false;
            if (parts[0] === 192 && parts[1] === 168) return false;
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
        }
        if (host.includes(':')) return false; // Skip IPv6 literals
        return true;
    } catch {
        return false;
    }
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    return String(str)
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function stripHtml(html) {
    if (!html) return '';
    return decodeHtmlEntities(html)
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
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

function parseFeedXml(xml, feedMeta) {
    const items = [];
    const itemMatches = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];

    for (const block of itemMatches.slice(0, 15)) {
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

        // Google News titles often end with " - Source Name"
        const dashIdx = title.lastIndexOf(' - ');
        if (dashIdx > 25 && title.length - dashIdx < 45) {
            const possibleSource = title.slice(dashIdx + 3).trim();
            if (possibleSource) {
                sourceName = possibleSource;
                title = title.slice(0, dashIdx).trim();
            }
        }

        let summary = stripHtml(rawDesc);
        // Remove duplicate title prefix from Google News descriptions
        if (summary.toLowerCase().startsWith(title.toLowerCase())) {
            summary = summary.slice(title.length).replace(/^[\s\-–|:]+/, '').trim();
        }
        if (summary.length > 220) {
            summary = summary.slice(0, 217).trim() + '...';
        }

        const parsedDate = pubDateRaw ? new Date(pubDateRaw) : new Date();
        const publishedAt = Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
        const imageUrl = extractImageFromBlock(block, rawDesc);

        items.push({
            id: Buffer.from(link).toString('base64url').slice(0, 24),
            title,
            summary: summary || `${sourceName} kaynağından güncel seyahat haberi.`,
            link,
            source: sourceName,
            category: feedMeta.category || 'Seyahat',
            image_url: imageUrl,
            published_at: publishedAt
        });
    }

    return items;
}

async function fetchSingleFeed(feedMeta) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(feedMeta.url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'TravellerMobi-NewsBot/1.0 (+https://travellermobi.vercel.app)',
                'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml'
            }
        });
        if (!response.ok) return [];
        const xml = await response.text();
        return parseFeedXml(xml, feedMeta);
    } catch {
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=1800');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const feeds = [...DEFAULT_FEEDS];

        // Allow optional custom RSS sources passed as JSON-encoded query param (max 6)
        const customParam = req.query?.custom;
        if (typeof customParam === 'string' && customParam.trim()) {
            try {
                const parsed = JSON.parse(customParam);
                if (Array.isArray(parsed)) {
                    for (const src of parsed.slice(0, 6)) {
                        if (src && typeof src.url === 'string' && isSafePublicHttpsUrl(src.url)) {
                            feeds.push({
                                name: String(src.name || 'Özel Kaynak').slice(0, 60),
                                category: String(src.category || 'Seyahat').slice(0, 30),
                                url: src.url
                            });
                        }
                    }
                }
            } catch {
                // Ignore malformed custom feed param
            }
        }

        const results = await Promise.allSettled(feeds.map(fetchSingleFeed));
        const allItems = [];
        const seenTitles = new Set();

        for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            for (const item of r.value) {
                const normKey = item.title.toLowerCase().replace(/[^a-z0-9ğüşıöç]/gi, '').slice(0, 60);
                if (!normKey || seenTitles.has(normKey)) continue;
                seenTitles.add(normKey);
                allItems.push(item);
            }
        }

        allItems.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

        const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 36, 6), 60);

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
