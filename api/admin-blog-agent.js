// api/admin-blog-agent.js - Server-side Gemini proxy for approved admins only
// Keeps GEMINI_API_KEY in server env vars, validates Supabase JWT & admin role, and enforces rate limits.

const DEFAULT_SUPABASE_URL = 'https://pbfriozhmtyspfzgnkkq.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM';
const MAX_PROMPT_CHARS = 32000;
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_MAX_REQUESTS = 12;

// Best-effort per-instance rate limit bucket
const rateBuckets = new Map();

function checkRateLimit(userId) {
    const now = Date.now();
    const bucket = rateBuckets.get(userId) || [];
    const recent = bucket.filter(ts => now - ts < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_REQUESTS) {
        rateBuckets.set(userId, recent);
        return false;
    }
    recent.push(now);
    rateBuckets.set(userId, recent);
    return true;
}

async function verifyApprovedAdmin(bearerToken) {
    if (!bearerToken) {
        return { ok: false, status: 401, error: 'Oturum anahtarı eksik.' };
    }

    const supabaseUrl = (process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || DEFAULT_SUPABASE_ANON_KEY;

    // 1. Verify JWT via Supabase Auth API
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${bearerToken}`
        }
    });

    if (!userRes.ok) {
        return { ok: false, status: 401, error: 'Geçersiz veya süresi dolmuş oturum.' };
    }

    const user = await userRes.json();
    if (!user || !user.id) {
        return { ok: false, status: 401, error: 'Kullanıcı doğrulanamadı.' };
    }

    // 2. Verify approved admin role via caller's own RLS-protected profiles query
    const profileRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,email,status,role:roles(name)`,
        {
            headers: {
                apikey: supabaseAnonKey,
                Authorization: `Bearer ${bearerToken}`
            }
        }
    );

    let profile = null;
    if (profileRes.ok) {
        const rows = await profileRes.json();
        profile = Array.isArray(rows) ? rows[0] : null;
    }

    const isApproved = profile?.status === 'approved';
    const isAdminRole = profile?.role?.name === 'admin';

    if (!isApproved || !isAdminRole) {
        return { ok: false, status: 403, error: 'Bu uç yalnızca onaylı yöneticiye açıktır.' };
    }

    return { ok: true, user };
}

function validateAgentJsonPayload(data) {
    if (!data || typeof data !== 'object') return 'Yanıt JSON objesi değil.';
    if (typeof data.title !== 'string' || data.title.trim().length < 5) return 'title alanı eksik veya çok kısa.';
    if (typeof data.content_markdown !== 'string' || data.content_markdown.trim().length < 60) return 'content_markdown alanı eksik veya çok kısa.';
    return '';
}

async function requestGeminiJson({ apiKey, model, prompt }) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.4,
                responseMimeType: 'application/json'
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data?.error?.message || `Gemini API hatası (${response.status})`);
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) {
        throw new Error('Model boş yanıt döndürdü.');
    }

    const cleanedJsonStr = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();

    return JSON.parse(cleanedJsonStr);
}

export default async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    try {
        const authHeader = String(req.headers?.authorization || '');
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

        const authCheck = await verifyApprovedAdmin(token);
        if (!authCheck.ok) {
            return res.status(authCheck.status).json({ ok: false, error: authCheck.error });
        }

        if (!checkRateLimit(authCheck.user.id)) {
            return res.status(429).json({
                ok: false,
                error: 'İstek limiti aşıldı. Lütfen birkaç dakika bekleyip tekrar deneyin.'
            });
        }

        const serverApiKey = (process.env.GEMINI_API_KEY || '').trim();
        if (!serverApiKey) {
            return res.status(503).json({
                ok: false,
                errorCode: 'SERVER_KEY_NOT_CONFIGURED',
                error: 'Sunucuda GEMINI_API_KEY ortam değişkeni henüz tanımlı değil.'
            });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        const allowedModels = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
        const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
        const model = allowedModels.includes(requestedModel) ? requestedModel : 'gemini-2.5-flash';

        if (!prompt || prompt.length < 20) {
            return res.status(400).json({ ok: false, error: 'Geçersiz prompt içeriği.' });
        }
        if (prompt.length > MAX_PROMPT_CHARS) {
            return res.status(413).json({ ok: false, error: `Girdi sınırı aşıldı (en fazla ${MAX_PROMPT_CHARS} karakter).` });
        }

        let parsed = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const attemptPrompt = attempt === 0
                    ? prompt
                    : `${prompt}\n\nÖNCEKİ YANIT HATA VERDİ (${lastErr}). LÜTFEN YALNIZCA GEÇERLİ VE EKSİKSİZ BİR JSON OBJESİ DÖNDÜR.`;
                parsed = await requestGeminiJson({ apiKey: serverApiKey, model, prompt: attemptPrompt });
                const schemaErr = validateAgentJsonPayload(parsed);
                if (!schemaErr) {
                    return res.status(200).json({ ok: true, data: parsed, viaServerKey: true });
                }
                lastErr = schemaErr;
            } catch (err) {
                lastErr = err?.message || 'JSON parse hatası';
            }
        }

        return res.status(502).json({
            ok: false,
            error: `Model geçerli JSON üretemedi: ${lastErr || 'Bilinmeyen hata'}`
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: err?.message || 'Sunucu hatası oluştu.'
        });
    }
}
