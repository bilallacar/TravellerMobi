// config.js - Configuration state for Supabase API and user settings

export const config = {
    supabaseUrl: localStorage.getItem('supabase_url') || '',
    supabaseKey: localStorage.getItem('supabase_key') || '',
    defaultCurrency: localStorage.getItem('default_currency') || 'TRY',
    theme: localStorage.getItem('theme') || 'dark'
};


/**
 * Save Supabase connection details to localStorage
 */
export function saveConfig(url, key) {
    if (url) localStorage.setItem('supabase_url', url.trim());
    if (key) localStorage.setItem('supabase_key', key.trim());
    config.supabaseUrl = url.trim();
    config.supabaseKey = key.trim();
}

/**
 * Save user app settings and preferences
 */
export function savePreferences(currency, theme) {
    if (currency) localStorage.setItem('default_currency', currency);
    if (theme) localStorage.setItem('theme', theme);
    config.defaultCurrency = currency;
    config.theme = theme;
}

/**
 * Returns true if both Supabase URL and Anon key are provided
 */
export function isConfigured() {
    return !!(config.supabaseUrl && config.supabaseKey);
}
