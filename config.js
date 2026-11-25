// config.js - Configuration state for Supabase API, Gemini AI and user settings

export const config = {
    supabaseUrl: 'https://pbfriozhmtyspfzgnkkq.supabase.co',
    supabaseKey: 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM',
    appPublicUrl: 'https://travellermobi.vercel.app',
    defaultCurrency: localStorage.getItem('default_currency') || 'TRY',
    theme: localStorage.getItem('theme') || 'light',
    geminiApiKey: localStorage.getItem('gemini_api_key') || '',
    geminiModel: localStorage.getItem('gemini_model') || 'gemini-2.5-flash',
    geminiAutoApply: localStorage.getItem('gemini_auto_apply') === 'true'
};

/**
 * Save user app settings and preferences
 */
export function savePreferences(currency, theme) {
    if (currency) {
        localStorage.setItem('default_currency', currency);
        config.defaultCurrency = currency;
    }
    if (theme) {
        localStorage.setItem('theme', theme);
        config.theme = theme;
    }
}

/**
 * Save Gemini AI Assistant API key and model to device localStorage
 */
export function saveGeminiConfig(apiKey, model) {
    if (typeof apiKey === 'string') {
        const cleanKey = apiKey.trim();
        if (cleanKey) {
            localStorage.setItem('gemini_api_key', cleanKey);
        } else {
            localStorage.removeItem('gemini_api_key');
        }
        config.geminiApiKey = cleanKey;
    }
    if (typeof model === 'string' && model.trim()) {
        const cleanModel = model.trim();
        localStorage.setItem('gemini_model', cleanModel);
        config.geminiModel = cleanModel;
    }
}

/**
 * Save auto-apply preference for AI Assistant write actions
 */
export function saveGeminiAutoApply(enabled) {
    const flag = !!enabled;
    localStorage.setItem('gemini_auto_apply', flag ? 'true' : 'false');
    config.geminiAutoApply = flag;
}

/**
 * Returns true if both Supabase URL and Anon key are configured
 */
export function isConfigured() {
    return !!(config.supabaseUrl && config.supabaseKey);
}
