// config.js - Configuration state for Supabase API and user settings

export const config = {
    supabaseUrl: localStorage.getItem('supabase_url') || 'https://pbfriozhmtyspfzgnkkq.supabase.co',
    supabaseKey: localStorage.getItem('supabase_key') || 'sb_publishable_cum_MND2ebOFOb2dmVJpnw_f5gDUUHM',
    defaultCurrency: localStorage.getItem('default_currency') || 'TRY',
    theme: localStorage.getItem('theme') || 'dark'
};


/**
 * Save Supabase connection details to localStorage
 */
export function saveConfig(url, key) {
    if (typeof url === 'string' && url.trim()) {
        const cleanUrl = url.trim();
        localStorage.setItem('supabase_url', cleanUrl);
        config.supabaseUrl = cleanUrl;
    }
    if (typeof key === 'string' && key.trim()) {
        const cleanKey = key.trim();
        localStorage.setItem('supabase_key', cleanKey);
        config.supabaseKey = cleanKey;
    }
}

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
 * Returns true if both Supabase URL and Anon key are provided
 */
export function isConfigured() {
    return !!(config.supabaseUrl && config.supabaseKey);
}
