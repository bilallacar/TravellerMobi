// api/geo.js - Privacy-friendly geolocation lookup via Vercel edge headers (no raw IP stored)

function safeDecodeHeader(val) {
    if (!val || typeof val !== 'string') return '';
    try {
        return decodeURIComponent(val).trim();
    } catch {
        return val.trim();
    }
}

export default function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');

    const country = safeDecodeHeader(req.headers['x-vercel-ip-country'] || '');
    const city = safeDecodeHeader(req.headers['x-vercel-ip-city'] || '');
    const rawRegion = safeDecodeHeader(req.headers['x-vercel-ip-country-region'] || '');
    const postalCode = safeDecodeHeader(req.headers['x-vercel-ip-postal-code'] || '');
    const timezone = safeDecodeHeader(req.headers['x-vercel-ip-timezone'] || '');

    const regionParts = [];
    if (rawRegion && rawRegion !== city) regionParts.push(rawRegion);
    if (postalCode) regionParts.push(`PK ${postalCode}`);

    return res.status(200).json({
        country: country || null,
        city: city || null,
        region: regionParts.join(' · ') || null,
        postalCode: postalCode || null,
        timezone: timezone || null
    });
}
