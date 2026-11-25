// api/sitemap.js - Dynamic XML Sitemap for TravellerMobi

const DEFAULT_SUPABASE_URL = 'https://pbfriozhmtyspfzgnkkq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM';
const SITE_URL = (process.env.SITE_URL || 'https://traveller-mobi.vercel.app').replace(/\/+$/, '');

function escapeXml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');

    const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || DEFAULT_SUPABASE_ANON_KEY;

    const urls = [
        {
            loc: `${SITE_URL}/`,
            lastmod: new Date().toISOString().slice(0, 10),
            changefreq: 'daily',
            priority: '1.0'
        }
    ];

    try {
        const postsRes = await fetch(
            `${supabaseUrl}/rest/v1/blog_posts?status=eq.published&select=slug,updated_at,published_at&order=published_at.desc`,
            {
                headers: {
                    apikey: supabaseAnonKey,
                    Authorization: `Bearer ${supabaseAnonKey}`
                }
            }
        );
        if (postsRes.ok) {
            const rows = await postsRes.json();
            if (Array.isArray(rows)) {
                for (const post of rows) {
                    if (!post?.slug) continue;
                    const lastmod = String(post.updated_at || post.published_at || new Date().toISOString()).slice(0, 10);
                    urls.push({
                        loc: `${SITE_URL}/blog/${encodeURIComponent(post.slug)}`,
                        lastmod,
                        changefreq: 'weekly',
                        priority: '0.8'
                    });
                }
            }
        }
    } catch (_) {}

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${escapeXml(u.lastmod)}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

    return res.status(200).send(xml);
}
