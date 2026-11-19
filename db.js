// db.js - Supabase CDN wrapper and Offline Synchronization Queue

import { config } from './config.js';

// Load Supabase JS Client via ESM CDN
// Note: We use dynamic import so it doesn't block loading if offline, or if config is missing.
let supabase = null;

// Unique client UUID generator fallback
function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

let supabaseReadyPromise = null;
let currentCachedUserId = null;

const AUTH_USER_CACHE_KEY = 'travellermobi_cached_user_v1';
const AUTH_PROFILE_CACHE_KEY = 'travellermobi_cached_profile_v1';
const BLOG_CACHE_KEY = 'travellermobi_cached_blog_posts_v1';
const NEWS_SOURCES_CACHE_KEY = 'travellermobi_cached_news_sources_v1';

function saveCachedAuthUser(user) {
    try {
        if (user && user.id) {
            localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify({
                id: user.id,
                email: user.email || ''
            }));
        } else {
            localStorage.removeItem(AUTH_USER_CACHE_KEY);
        }
    } catch (_) {}
}

export function getCachedAuthUser() {
    try {
        const raw = localStorage.getItem(AUTH_USER_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id) return { ...parsed, _offlineSession: true };
    } catch (_) {}
    return null;
}

function saveCachedProfile(profile) {
    try {
        if (profile && profile.id) {
            localStorage.setItem(AUTH_PROFILE_CACHE_KEY, JSON.stringify(profile));
        } else {
            localStorage.removeItem(AUTH_PROFILE_CACHE_KEY);
        }
    } catch (_) {}
}

export function getCachedProfile(userId = null) {
    try {
        const raw = localStorage.getItem(AUTH_PROFILE_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && (!userId || parsed.id === userId)) return parsed;
    } catch (_) {}
    return null;
}

function clearCachedAuthState() {
    try {
        localStorage.removeItem(AUTH_USER_CACHE_KEY);
        localStorage.removeItem(AUTH_PROFILE_CACHE_KEY);
    } catch (_) {}
}

function isNetworkFailureError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    return (
        !hasInternet() ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('load failed') ||
        msg.includes('err_internet_disconnected') ||
        msg.includes('err_name_not_resolved') ||
        msg.includes('importing a module script failed')
    );
}

/**
 * Raw browser internet availability check
 */
export function hasInternet() {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
}

/**
 * Initialize Supabase Client if keys are configured.
 * Returns a Promise that resolves with the Supabase client.
 */
export function initSupabase() {
    if (supabase) return Promise.resolve(supabase);
    if (supabaseReadyPromise) return supabaseReadyPromise;

    if (config.supabaseUrl && config.supabaseKey) {
        if (!hasInternet()) {
            return Promise.resolve(null);
        }
        supabaseReadyPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
            .then((module) => {
                supabase = module.createClient(config.supabaseUrl, config.supabaseKey);
                console.log("Supabase Client initialized successfully.");
                // Start an immediate sync check when connected
                syncOfflineQueue();
                return supabase;
            })
            .catch((err) => {
                console.warn("Failed to load Supabase module from CDN:", err);
                supabaseReadyPromise = null; // Reset to allow retry
                return null;
            });
        return supabaseReadyPromise;
    }
    return Promise.resolve(null);
}

// Helper to await client readiness in auth/database actions
async function getSupabase() {
    if (!supabase) {
        try {
            if (supabaseReadyPromise) {
                await supabaseReadyPromise;
            } else {
                await initSupabase();
            }
        } catch {
            return null;
        }
    }
    return supabase;
}

// Ensure init runs immediately if possible
if (config.supabaseUrl && config.supabaseKey && hasInternet()) {
    initSupabase();
}

/**
 * Helper to check connection status (both network + initialized Supabase client)
 */
export function isOnline() {
    return hasInternet() && supabase !== null;
}

/* ==========================================================================
   AUTHENTICATION API
   ========================================================================== */

export async function getCurrentUser() {
    if (!hasInternet()) {
        const cached = getCachedAuthUser();
        currentCachedUserId = cached ? cached.id : null;
        return cached;
    }

    try {
        const client = await getSupabase();
        if (!client) {
            const cached = getCachedAuthUser();
            currentCachedUserId = cached ? cached.id : null;
            return cached;
        }
        const { data: { user }, error } = await client.auth.getUser();
        if (error) {
            if (isNetworkFailureError(error)) {
                const cached = getCachedAuthUser();
                currentCachedUserId = cached ? cached.id : null;
                return cached;
            }
            // Auth session invalid / expired
            currentCachedUserId = null;
            clearCachedAuthState();
            return null;
        }
        if (user) {
            currentCachedUserId = user.id;
            saveCachedAuthUser(user);
        } else {
            currentCachedUserId = null;
            clearCachedAuthState();
        }
        return user;
    } catch (err) {
        console.warn("Error in getCurrentUser:", err);
        if (isNetworkFailureError(err)) {
            const cached = getCachedAuthUser();
            currentCachedUserId = cached ? cached.id : null;
            return cached;
        }
        return null;
    }
}

export async function signIn(email, password) {
    if (!hasInternet()) {
        throw new Error("İnternet bağlantısı yok. Giriş yapabilmek için internet erişiminizi kontrol edin.");
    }
    const client = await getSupabase();
    if (!client) {
        throw new Error("Sunucuya ulaşılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.");
    }
    try {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) {
            currentCachedUserId = data.user.id;
            saveCachedAuthUser(data.user);
        }
        return data.user;
    } catch (err) {
        if (isNetworkFailureError(err)) {
            throw new Error("İnternet bağlantısı kesildi veya sunucuya erişilemedi. Lütfen bağlantınızı kontrol edin.");
        }
        throw err;
    }
}

export async function signUp(email, password) {
    if (!hasInternet()) {
        throw new Error("İnternet bağlantısı yok. Kayıt olabilmek için internet erişiminizi kontrol edin.");
    }
    const client = await getSupabase();
    if (!client) {
        throw new Error("Sunucuya ulaşılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.");
    }
    try {
        const { data, error } = await client.auth.signUp({ email, password });
        if (error) throw error;
        if (data.user) {
            currentCachedUserId = data.user.id;
            saveCachedAuthUser(data.user);
        }
        return data.user;
    } catch (err) {
        if (isNetworkFailureError(err)) {
            throw new Error("İnternet bağlantısı kesildi veya sunucuya erişilemedi. Lütfen bağlantınızı kontrol edin.");
        }
        throw err;
    }
}

export async function signOut() {
    currentCachedUserId = null;
    clearCachedAuthState();
    if (!hasInternet()) return;
    try {
        const client = await getSupabase();
        if (!client) return;
        await client.auth.signOut();
    } catch (err) {
        console.warn("Remote signOut skipped while offline:", err);
    }
}

export async function resetPassword(email) {
    if (!hasInternet()) {
        throw new Error("İnternet bağlantısı yok. Şifre sıfırlama bağlantısı göndermek için internet gereklidir.");
    }
    const client = await getSupabase();
    if (!client) {
        throw new Error("Sunucuya ulaşılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.");
    }
    const redirectTo = `${window.location.origin}${window.location.pathname}#reset-password`;
    try {
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
        if (error) throw error;
        return true;
    } catch (err) {
        if (isNetworkFailureError(err)) {
            throw new Error("İnternet bağlantısı kesildi. Lütfen bağlantınızı kontrol edin.");
        }
        throw err;
    }
}

export async function updateUserPassword(newPassword) {
    if (!hasInternet()) {
        throw new Error("İnternet bağlantısı yok. Şifrenizi güncellemek için internet erişimi gereklidir.");
    }
    const client = await getSupabase();
    if (!client) {
        throw new Error("Sunucuya ulaşılamadı. Lütfen internet bağlantınızı kontrol edip tekrar deneyin.");
    }
    const { data, error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data.user;
}


/* ==========================================================================
   OFFLINE STORAGE CACHING & SYNC QUEUE SYSTEM
   ========================================================================== */

// Offline data cache keys
const CACHE_KEYS = {
    TRIPS: 'cached_trips',
    EXPENSES: 'cached_expenses',
    MEMORIES: 'cached_memories',
    PLACES: 'cached_places',
    RESERVATIONS: 'cached_reservations',
    QUEUE: 'offline_sync_queue'
};

function getCacheKey(baseKey) {
    if (!currentCachedUserId) {
        return `${baseKey}_guest`;
    }
    return `${baseKey}_${currentCachedUserId}`;
}

function getLocalCache(baseKey) {
    const key = getCacheKey(baseKey);
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
}

function setLocalCache(baseKey, data) {
    const key = getCacheKey(baseKey);
    localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Adds an operation to the offline sync queue
 */
function addToSyncQueue(action, data) {
    const queue = getLocalCache(CACHE_KEYS.QUEUE);
    const id = generateUUID();
    queue.push({ id, action, data, timestamp: Date.now() });
    setLocalCache(CACHE_KEYS.QUEUE, queue);
    
    // Dispatch custom event to notify UI
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));
}

function deduplicateById(list) {
    const seen = new Set();
    return (list || []).filter(item => {
        if (!item || !item.id) return false;
        const key = String(item.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function mergePendingRecords(recordsList, { createAction, updateAction, deleteAction, filterFn = null }) {
    const queue = getLocalCache(CACHE_KEYS.QUEUE) || [];
    let result = [...(recordsList || [])];

    if (Array.isArray(queue) && queue.length > 0) {
        for (const item of queue) {
            if (!item || !item.data) continue;
            const itemId = String(item.data.id || '');
            if (item.action === createAction) {
                const matches = typeof filterFn === 'function' ? filterFn(item.data) : true;
                if (matches && !result.some(r => String(r.id) === itemId)) {
                    result.unshift(item.data);
                }
            } else if (item.action === updateAction) {
                const idx = result.findIndex(r => String(r.id) === itemId);
                if (idx > -1) result[idx] = { ...result[idx], ...item.data };
            } else if (item.action === deleteAction) {
                result = result.filter(r => String(r.id) !== itemId);
            }
        }
    }

    return deduplicateById(result);
}

function pruneSyncQueueByRecord(recordId, actionsToRemove, cascadeTripId = null) {
    const queue = getLocalCache(CACHE_KEYS.QUEUE) || [];
    if (!Array.isArray(queue) || queue.length === 0) return false;
    const targetId = String(recordId);
    const cascadeId = cascadeTripId ? String(cascadeTripId) : null;
    let hadPendingCreate = false;

    const nextQueue = queue.filter(item => {
        if (!item || !item.data) return true;
        const itemId = item.data.id !== undefined ? String(item.data.id) : '';
        if (itemId === targetId && actionsToRemove.includes(item.action)) {
            if (item.action.startsWith('create_')) hadPendingCreate = true;
            return false;
        }
        if (cascadeId && item.data.trip_id !== undefined && String(item.data.trip_id) === cascadeId) {
            return false;
        }
        return true;
    });

    if (nextQueue.length !== queue.length) {
        setLocalCache(CACHE_KEYS.QUEUE, nextQueue);
        window.dispatchEvent(new CustomEvent('offline-queue-changed'));
    }
    return hadPendingCreate;
}

let syncInFlightPromise = null;

let reservationsCloudTableMissing = false;

/**
 * Checks whether a Supabase error indicates a missing optional table (e.g. reservations before SQL migration).
 */
function isMissingTableError(error) {
    const code = String(error?.code || '');
    const msg = String(error?.message || '');
    return code === 'PGRST205' || code === '42P01' || /Could not find the table|relation .* does not exist/i.test(msg);
}

/**
 * Extracts a missing column name from PostgREST/Postgres schema-cache errors
 * (e.g. "Could not find the 'rating' column of 'places' in the schema cache").
 */
function extractMissingColumnName(error) {
    const msg = error?.message || '';
    const pgrstMatch = msg.match(/Could not find the '([a-zA-Z0-9_]+)' column of '[^']+' in the schema cache/i);
    if (pgrstMatch) return pgrstMatch[1];
    const pgMatch = msg.match(/column "([a-zA-Z0-9_]+)" of relation "[^"]+" does not exist/i);
    return pgMatch ? pgMatch[1] : null;
}

/**
 * Executes a Supabase insert/update operation and automatically strips any
 * missing columns reported by PostgREST schema cache so older DB schemas
 * never get permanently stuck in the sync queue.
 */
async function executeWithSchemaFallback(operationFn, payload) {
    const workingPayload = { ...payload };
    for (let attempt = 0; attempt < 6; attempt++) {
        const result = await operationFn(workingPayload);
        if (!result?.error) return result;

        const missingCol = extractMissingColumnName(result.error);
        if (!missingCol || !(missingCol in workingPayload)) {
            return result;
        }
        console.warn(`Supabase column '${missingCol}' missing in schema cache; retrying without it.`);
        delete workingPayload[missingCol];
    }
    return await operationFn(workingPayload);
}

async function processOfflineMemoryPhoto(itemData, payload) {
    if (!itemData.photo_base64 || !itemData.photo_name) return;
    const fileBlob = base64ToBlob(itemData.photo_base64);
    const mimeHeader = itemData.photo_base64.split(';')[0] || '';
    const fileType = mimeHeader.includes(':') ? mimeHeader.split(':')[1] : 'image/jpeg';
    const file = new File([fileBlob], itemData.photo_name, { type: fileType });
    payload.photo_url = await uploadPhotoToStorage(file);
}

/**
 * Processes items pending in the offline queue to Supabase (with single-flight lock)
 */
export async function syncOfflineQueue(onProgress) {
    if (syncInFlightPromise) {
        return syncInFlightPromise;
    }

    syncInFlightPromise = runOfflineQueueSync(onProgress);
    try {
        return await syncInFlightPromise;
    } finally {
        syncInFlightPromise = null;
    }
}

async function runOfflineQueueSync(onProgress) {
    if (!isOnline()) {
        console.log("App is offline. Sync postponed.");
        return { success: false, reason: 'offline' };
    }

    const queue = getLocalCache(CACHE_KEYS.QUEUE);
    if (queue.length === 0) return { success: true, count: 0 };

    const sb = await getSupabase();
    if (!sb) {
        return { success: false, reason: 'no_client' };
    }

    console.log(`Syncing ${queue.length} offline actions to Supabase...`);
    let completedCount = 0;
    const remainingQueue = [...queue];

    for (const item of queue) {
        try {
            if (onProgress) onProgress(`Eşitleniyor: ${item.action}...`);
            
            const user = await getCurrentUser();
            if (!user) {
                console.error("Sync aborted: User session not found.");
                return { success: false, reason: 'unauthorized' };
            }
            
            // Attach current user UUID
            const payload = { ...item.data, user_id: user.id };

            if (item.action === 'create_trip') {
                const { error } = await sb.from('trips').insert([payload]);
                if (error) throw error;
            } 
            else if (item.action === 'update_trip') {
                const { error } = await sb.from('trips').update(payload).eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'delete_trip') {
                const { error } = await sb.from('trips').delete().eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'create_expense') {
                const { error } = await sb.from('expenses').insert([payload]);
                if (error) throw error;
            }
            else if (item.action === 'update_expense') {
                const { error } = await sb.from('expenses').update(payload).eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'delete_expense') {
                const { error } = await sb.from('expenses').delete().eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'create_memory' || item.action === 'update_memory') {
                await processOfflineMemoryPhoto(item.data, payload);
                delete payload.photo_base64;
                delete payload.photo_name;

                const query = item.action === 'create_memory'
                    ? sb.from('memories').insert([payload])
                    : sb.from('memories').update(payload).eq('id', item.data.id);
                const { error } = await query;
                if (error) throw error;
            }
            else if (item.action === 'delete_memory') {
                const { error } = await sb.from('memories').delete().eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'create_place') {
                const { error } = await executeWithSchemaFallback((clean) => sb.from('places').insert([clean]), payload);
                if (error) throw error;
            }
            else if (item.action === 'update_place') {
                const { error } = await executeWithSchemaFallback((clean) => sb.from('places').update(clean).eq('id', item.data.id), payload);
                if (error) throw error;
            }
            else if (item.action === 'delete_place') {
                const { error } = await sb.from('places').delete().eq('id', item.data.id);
                if (error) throw error;
            }


            else if (item.action === 'create_reservation') {
                const { error } = await executeWithSchemaFallback((clean) => sb.from('reservations').insert([clean]), payload);
                if (error) {
                    if (isMissingTableError(error)) {
                        reservationsCloudTableMissing = true;
                        console.warn('Reservations table missing in Supabase; keeping locally cached.');
                    } else {
                        throw error;
                    }
                }
            }
            else if (item.action === 'update_reservation') {
                const { error } = await executeWithSchemaFallback((clean) => sb.from('reservations').update(clean).eq('id', item.data.id), payload);
                if (error) {
                    if (isMissingTableError(error)) {
                        reservationsCloudTableMissing = true;
                        console.warn('Reservations table missing in Supabase; keeping locally cached.');
                    } else {
                        throw error;
                    }
                }
            }
            else if (item.action === 'delete_reservation') {
                const { error } = await sb.from('reservations').delete().eq('id', item.data.id);
                if (error) {
                    if (isMissingTableError(error)) {
                        reservationsCloudTableMissing = true;
                        console.warn('Reservations table missing in Supabase; keeping locally cached.');
                    } else {
                        throw error;
                    }
                }
            }

            // Remove item from remaining list after success
            const index = remainingQueue.findIndex(q => q.id === item.id);
            if (index > -1) remainingQueue.splice(index, 1);
            completedCount++;
            
        } catch (err) {
            console.error(`Sync error on action: ${item.action}`, err);
            // Stop syncing rest of items if network issue occurred
            setLocalCache(CACHE_KEYS.QUEUE, remainingQueue);
            window.dispatchEvent(new CustomEvent('offline-queue-changed'));
            return { success: false, reason: 'error', error: err };
        }
    }

    // Update queue storage with leftover items
    setLocalCache(CACHE_KEYS.QUEUE, remainingQueue);
    window.dispatchEvent(new CustomEvent('offline-queue-changed'));

    // Reload active data lists to fetch cloud-fresh updates
    window.dispatchEvent(new CustomEvent('sync-completed'));
    return { success: true, count: completedCount };
}

// Helper to convert base64 back to raw Blob for uploads
function base64ToBlob(base64Str) {
    const block = base64Str.split(';');
    const contentType = block[0].split(':')[1];
    const realData = block[1].split(',')[1];
    
    const sliceSize = 512;
    const byteCharacters = atob(realData);
    const byteArrays = [];
    
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        byteArrays.push(byteArray);
    }
    
    return new Blob(byteArrays, { type: contentType });
}


/* ==========================================================================
   TRIPS RESOURCE API
   ========================================================================== */

const TRIP_QUEUE_CONFIG = {
    createAction: 'create_trip',
    updateAction: 'update_trip',
    deleteAction: 'delete_trip'
};

export async function getTrips() {
    if (!isOnline()) {
        return mergePendingRecords(getLocalCache(CACHE_KEYS.TRIPS), TRIP_QUEUE_CONFIG);
    }

    try {
        const sb = await getSupabase();
        if (!sb) return mergePendingRecords(getLocalCache(CACHE_KEYS.TRIPS), TRIP_QUEUE_CONFIG);
        const { data, error } = await sb
            .from('trips')
            .select('*')
            .order('start_date', { ascending: false });

        if (error) throw error;
        const merged = mergePendingRecords(data || [], TRIP_QUEUE_CONFIG);
        setLocalCache(CACHE_KEYS.TRIPS, merged);
        return merged;
    } catch (err) {
        console.warn("Error fetching trips, falling back to local cache", err);
        return mergePendingRecords(getLocalCache(CACHE_KEYS.TRIPS), TRIP_QUEUE_CONFIG);
    }
}

export async function createTrip(tripData) {
    const user = await getCurrentUser();
    const payload = {
        id: generateUUID(),
        name: tripData.name,
        start_date: tripData.start_date,
        end_date: tripData.end_date,
        budget: parseFloat(tripData.budget) || 0,
        currency: tripData.currency || 'TRY',
        user_id: user ? user.id : 'offline-user',
        participants: tripData.participants || []
    };

    // Optimistic Update Cache
    const trips = getLocalCache(CACHE_KEYS.TRIPS);
    trips.unshift(payload);
    setLocalCache(CACHE_KEYS.TRIPS, trips);

    if (!isOnline()) {
        addToSyncQueue('create_trip', payload);
        return payload;
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı');
        const { data, error } = await sb
            .from('trips')
            .insert([payload])
            .select();
        
        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued trip creation:", err);
        addToSyncQueue('create_trip', payload);
        return payload;
    }
}

export async function updateTrip(tripId, tripData) {
    const payload = {
        id: tripId,
        name: tripData.name,
        start_date: tripData.start_date,
        end_date: tripData.end_date,
        budget: parseFloat(tripData.budget) || 0,
        currency: tripData.currency || 'TRY',
        participants: tripData.participants || []
    };

    // Optimistic Update Cache
    const trips = getLocalCache(CACHE_KEYS.TRIPS);
    const index = trips.findIndex(t => t.id === tripId);
    if (index > -1) {
        trips[index] = { ...trips[index], ...payload };
        setLocalCache(CACHE_KEYS.TRIPS, trips);
    }

    if (!isOnline()) {
        addToSyncQueue('update_trip', payload);
        return payload;
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        const { data, error } = await sb
            .from('trips')
            .update(payload)
            .eq('id', tripId)
            .select();
        
        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued trip update:", err);
        addToSyncQueue('update_trip', payload);
        return payload;
    }
}


export async function deleteTrip(tripId) {
    const targetId = String(tripId);

    // Optimistic Update Cache
    const trips = getLocalCache(CACHE_KEYS.TRIPS).filter(t => String(t.id) !== targetId);
    setLocalCache(CACHE_KEYS.TRIPS, trips);

    // Cascading local delete for related items
    const expenses = getLocalCache(CACHE_KEYS.EXPENSES).filter(e => String(e.trip_id) !== targetId);
    setLocalCache(CACHE_KEYS.EXPENSES, expenses);
    const memories = getLocalCache(CACHE_KEYS.MEMORIES).filter(m => String(m.trip_id) !== targetId);
    setLocalCache(CACHE_KEYS.MEMORIES, memories);
    const places = getLocalCache(CACHE_KEYS.PLACES).filter(p => String(p.trip_id) !== targetId);
    setLocalCache(CACHE_KEYS.PLACES, places);

    // Cancel pending create/update and orphan child actions in sync queue
    const hadPendingCreate = pruneSyncQueueByRecord(
        targetId,
        ['create_trip', 'update_trip', 'delete_trip'],
        targetId
    );
    if (hadPendingCreate) {
        return { success: true, removedLocalOnly: true };
    }

    if (!isOnline()) {
        addToSyncQueue('delete_trip', { id: tripId });
        return { success: true };
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        const { error } = await sb.from('trips').delete().eq('id', tripId);
        if (error) throw error;
        return { success: true };
    } catch (err) {
        console.error("DB error on delete trip:", err);
        // If it is a network error, queue it
        if (err.message && (err.message.includes('fetch') || err.message.includes('Network') || err.status === 0)) {
            addToSyncQueue('delete_trip', { id: tripId });
            return { success: true };
        }
        // Restore local cache
        await getTrips();
        throw err;
    }
}

/* ==========================================================================
   EXPENSES RESOURCE API
   ========================================================================== */

function getTripScopedQueueConfig(createAction, updateAction, deleteAction, tripId) {
    return {
        createAction,
        updateAction,
        deleteAction,
        filterFn: (item) => !tripId || String(item.trip_id) === String(tripId)
    };
}

export async function getExpenses(tripId = null) {
    const queueCfg = getTripScopedQueueConfig('create_expense', 'update_expense', 'delete_expense', tripId);
    const filterLocal = () => {
        const local = getLocalCache(CACHE_KEYS.EXPENSES);
        const scoped = tripId ? local.filter(e => String(e.trip_id) === String(tripId)) : local;
        return mergePendingRecords(scoped, queueCfg);
    };

    if (!isOnline()) {
        return filterLocal();
    }

    try {
        const sb = await getSupabase();
        if (!sb) return filterLocal();
        let query = sb.from('expenses').select('*').order('date', { ascending: false });
        if (tripId) query = query.eq('trip_id', tripId);
        
        const { data, error } = await query;
        if (error) throw error;

        const mergedRemote = mergePendingRecords(data || [], queueCfg);

        // If caching for a specific trip, merge it back to global list without duplicates
        const cachedList = getLocalCache(CACHE_KEYS.EXPENSES);
        const updatedList = tripId
            ? deduplicateById([...cachedList.filter(e => String(e.trip_id) !== String(tripId)), ...mergedRemote])
            : mergedRemote;
        setLocalCache(CACHE_KEYS.EXPENSES, updatedList);
        return mergedRemote;
    } catch (err) {
        console.warn("Error fetching expenses, falling back to local cache", err);
        return filterLocal();
    }
}

export async function createExpense(expenseData) {
    const user = await getCurrentUser();
    const payload = {
        id: generateUUID(),
        trip_id: expenseData.trip_id,
        title: expenseData.title,
        amount: parseFloat(expenseData.amount),
        currency: expenseData.currency,
        category: expenseData.category,
        category_id: expenseData.category_id || null,
        date: expenseData.date,
        user_id: user ? user.id : 'offline-user',
        paid_by: expenseData.paid_by || null,
        split_with: expenseData.split_with || []
    };

    // Optimistic Update Cache
    const expenses = getLocalCache(CACHE_KEYS.EXPENSES);
    expenses.unshift(payload);
    setLocalCache(CACHE_KEYS.EXPENSES, expenses);

    if (!isOnline()) {
        addToSyncQueue('create_expense', payload);
        return payload;
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı');
        const { data, error } = await sb
            .from('expenses')
            .insert([payload])
            .select();

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued expense creation:", err);
        addToSyncQueue('create_expense', payload);
        return payload;
    }
}

export async function updateExpense(expenseId, expenseData) {
    const payload = {
        id: expenseId,
        trip_id: expenseData.trip_id,
        title: expenseData.title,
        amount: parseFloat(expenseData.amount),
        currency: expenseData.currency,
        category: expenseData.category,
        category_id: expenseData.category_id || null,
        date: expenseData.date,
        paid_by: expenseData.paid_by || null,
        split_with: expenseData.split_with || []
    };

    // Optimistic Update Cache
    const expenses = getLocalCache(CACHE_KEYS.EXPENSES);
    const index = expenses.findIndex(e => e.id === expenseId);
    if (index > -1) {
        expenses[index] = { ...expenses[index], ...payload };
        setLocalCache(CACHE_KEYS.EXPENSES, expenses);
    }

    if (!isOnline()) {
        addToSyncQueue('update_expense', payload);
        return payload;
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        const { data, error } = await sb
            .from('expenses')
            .update(payload)
            .eq('id', expenseId)
            .select();

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued expense update:", err);
        addToSyncQueue('update_expense', payload);
        return payload;
    }
}


export async function deleteExpense(expenseId) {
    const targetId = String(expenseId);

    // Optimistic Update Cache
    const expenses = getLocalCache(CACHE_KEYS.EXPENSES).filter(e => String(e.id) !== targetId);
    setLocalCache(CACHE_KEYS.EXPENSES, expenses);

    const hadPendingCreate = pruneSyncQueueByRecord(targetId, ['create_expense', 'update_expense', 'delete_expense']);
    if (hadPendingCreate) {
        return { success: true, removedLocalOnly: true };
    }

    if (!isOnline()) {
        addToSyncQueue('delete_expense', { id: expenseId });
        return { success: true };
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        const { error } = await sb.from('expenses').delete().eq('id', expenseId);
        if (error) throw error;
        return { success: true };
    } catch (err) {
        console.error("DB error on delete expense:", err);
        // If it is a network error, queue it
        if (err.message && (err.message.includes('fetch') || err.message.includes('Network') || err.status === 0)) {
            addToSyncQueue('delete_expense', { id: expenseId });
            return { success: true };
        }
        // Restore local cache
        await getExpenses();
        throw err;
    }
}

/* ==========================================================================
   JOURNAL / MEMORIES RESOURCE API
   ========================================================================== */

export async function getMemories(tripId = null) {
    const queueCfg = getTripScopedQueueConfig('create_memory', 'update_memory', 'delete_memory', tripId);
    const filterLocal = () => {
        const local = getLocalCache(CACHE_KEYS.MEMORIES);
        const scoped = tripId ? local.filter(m => String(m.trip_id) === String(tripId)) : local;
        return mergePendingRecords(scoped, queueCfg);
    };

    if (!isOnline()) {
        return filterLocal();
    }

    try {
        const sb = await getSupabase();
        if (!sb) return filterLocal();
        let query = sb.from('memories').select('*').order('date', { ascending: false });
        if (tripId) query = query.eq('trip_id', tripId);
        
        const { data, error } = await query;
        if (error) throw error;

        const mergedRemote = mergePendingRecords(data || [], queueCfg);

        const cachedList = getLocalCache(CACHE_KEYS.MEMORIES);
        const updatedList = tripId
            ? deduplicateById([...cachedList.filter(m => String(m.trip_id) !== String(tripId)), ...mergedRemote])
            : mergedRemote;
        setLocalCache(CACHE_KEYS.MEMORIES, updatedList);
        return mergedRemote;
    } catch (err) {
        console.warn("Error fetching memories, falling back to local cache", err);
        return filterLocal();
    }
}

export async function createMemory(memoryData, photoFile = null) {
    const user = await getCurrentUser();
    const payload = {
        id: generateUUID(),
        trip_id: memoryData.trip_id,
        title: memoryData.title,
        description: memoryData.description,
        location: memoryData.location,
        date: memoryData.date,
        photo_url: null,
        user_id: user ? user.id : 'offline-user'
    };

    // Handling file uploads
    if (photoFile) {
        if (isOnline()) {
            try {
                const publicUrl = await uploadPhotoToStorage(photoFile);
                payload.photo_url = publicUrl;
            } catch (uploadErr) {
                console.error("Photo upload failed, memory text will be logged. error:", uploadErr);
            }
        } else {
            // Offline: Store image preview as Base64 encoded temporarily
            try {
                const base64Data = await fileToBase64(photoFile);
                payload.photo_base64 = base64Data;
                payload.photo_name = `${generateUUID()}_${photoFile.name}`;
                payload.photo_url = base64Data; // Temporary URL for offline UI rendering
            } catch (fileErr) {
                console.error("Could not convert image to base64 for offline cache:", fileErr);
            }
        }
    }

    // Optimistic Update Cache
    const memories = getLocalCache(CACHE_KEYS.MEMORIES);
    memories.unshift(payload);
    setLocalCache(CACHE_KEYS.MEMORIES, memories);

    if (!isOnline()) {
        addToSyncQueue('create_memory', payload);
        return payload;
    }

    try {
        // Remove temporary client base64 props before querying DB
        const dbPayload = { ...payload };
        delete dbPayload.photo_base64;
        delete dbPayload.photo_name;

        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı');
        const { data, error } = await sb
            .from('memories')
            .insert([dbPayload])
            .select();

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued memory creation:", err);
        addToSyncQueue('create_memory', payload);
        return payload;
    }
}

export async function updateMemory(memoryId, memoryData, photoFile = null) {
    const payload = {
        id: memoryId,
        trip_id: memoryData.trip_id,
        title: memoryData.title,
        description: memoryData.description,
        location: memoryData.location,
        date: memoryData.date,
        photo_url: memoryData.photo_url || null
    };

    if (photoFile) {
        if (isOnline()) {
            try {
                const publicUrl = await uploadPhotoToStorage(photoFile);
                payload.photo_url = publicUrl;
            } catch (uploadErr) {
                console.error("Photo upload failed, keeping old URL if any.", uploadErr);
            }
        } else {
            try {
                const base64Data = await fileToBase64(photoFile);
                payload.photo_base64 = base64Data;
                payload.photo_name = `${generateUUID()}_${photoFile.name}`;
                payload.photo_url = base64Data; // Temporary URL for optimistic render
            } catch (fileErr) {
                console.error("Could not convert image to base64 for offline cache:", fileErr);
            }
        }
    }

    // Optimistic Update Cache
    const memories = getLocalCache(CACHE_KEYS.MEMORIES);
    const index = memories.findIndex(m => m.id === memoryId);
    if (index > -1) {
        memories[index] = { ...memories[index], ...payload };
        setLocalCache(CACHE_KEYS.MEMORIES, memories);
    }

    if (!isOnline()) {
        addToSyncQueue('update_memory', payload);
        return payload;
    }

    try {
        const dbPayload = { ...payload };
        delete dbPayload.photo_base64;
        delete dbPayload.photo_name;

        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı');
        const { data, error } = await sb
            .from('memories')
            .update(dbPayload)
            .eq('id', memoryId)
            .select();

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued memory update:", err);
        addToSyncQueue('update_memory', payload);
        return payload;
    }
}


export async function deleteMemory(memoryId) {
    const targetId = String(memoryId);

    // Optimistic Update Cache
    const memories = getLocalCache(CACHE_KEYS.MEMORIES).filter(m => String(m.id) !== targetId);
    setLocalCache(CACHE_KEYS.MEMORIES, memories);

    const hadPendingCreate = pruneSyncQueueByRecord(targetId, ['create_memory', 'update_memory', 'delete_memory']);
    if (hadPendingCreate) {
        return { success: true, removedLocalOnly: true };
    }

    if (!isOnline()) {
        addToSyncQueue('delete_memory', { id: memoryId });
        return { success: true };
    }

    try {
        const sb = await getSupabase();
        if (!sb) throw new Error("Supabase connection is unconfigured.");
        const { error } = await sb.from('memories').delete().eq('id', memoryId);
        if (error) throw error;
        return { success: true };
    } catch (err) {
        console.error("DB error on delete memory:", err);
        // If it is a network error, queue it
        if (err.message && (err.message.includes('fetch') || err.message.includes('Network') || err.status === 0)) {
            addToSyncQueue('delete_memory', { id: memoryId });
            return { success: true };
        }
        // Restore local cache
        await getMemories();
        throw err;
    }
}

/* ==========================================================================
   SUPABASE STORAGE UPLOAD SERVICE
   ========================================================================== */

async function uploadPhotoToStorage(file) {
    const sb = await getSupabase();
    if (!sb) throw new Error("Supabase connection is unconfigured.");
    const user = await getCurrentUser();
    if (!user) throw new Error("Kullanıcı oturumu bulunamadı.");
    
    // Bucket name
    const BUCKET_NAME = 'traveller-photos';
    // Generate unique name path inside bucket
    const fileExtension = file.name.split('.').pop();
    const fileName = `${generateUUID()}.${fileExtension}`;
    const filePath = `${user.id}/${fileName}`;

    // Upload payload
    const { data, error } = await sb.storage
        .from(BUCKET_NAME)
        .upload(filePath, file, {
            cacheControl: '3600',
            upsert: false
        });

    if (error) throw error;

    // Return the relative storage path (e.g., user_id/filename.ext)
    return filePath;
}

export async function downloadPhoto(filePath) {
    const client = await getSupabase();
    if (!client) return null;
    const BUCKET_NAME = 'traveller-photos';
    const { data, error } = await client.storage
        .from(BUCKET_NAME)
        .download(filePath);
    if (error) throw error;
    return data; // returns a Blob
}

// Convert File Object to Base64 String
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Queue Helper API
export function getPendingQueueCount() {
    return getLocalCache(CACHE_KEYS.QUEUE).length;
}

// Register browser network & sync listeners
window.addEventListener('online', async () => {
    console.log("Network online detected. Re-initializing Supabase and triggering queue sync.");
    window.dispatchEvent(new CustomEvent('network-status-changed', { detail: { online: true } }));
    try {
        await initSupabase();
        await syncOfflineQueue();
    } catch (err) {
        console.warn("Online recovery warning:", err);
    }
});

window.addEventListener('offline', () => {
    console.log("Network offline detected.");
    window.dispatchEvent(new CustomEvent('network-status-changed', { detail: { online: false } }));
});

/* ==========================================================================
   USER PROFILES / ADMIN API
   ========================================================================== */

export async function getUserProfile(userId) {
    if (!hasInternet()) {
        return getCachedProfile(userId);
    }
    const client = await getSupabase();
    if (!client) return getCachedProfile(userId);
    try {
        const { data, error } = await client
            .from('profiles')
            .select('*, role:roles(name)')
            .eq('id', userId)
            .maybeSingle();
        if (error) {
            console.error("Error fetching user profile:", error);
            if (isNetworkFailureError(error)) return getCachedProfile(userId);
            return null;
        }
        if (data) saveCachedProfile(data);
        return data;
    } catch (err) {
        console.warn("Network error fetching user profile:", err);
        return getCachedProfile(userId);
    }
}

export async function createUserProfile(userId, email) {
    const client = await getSupabase();
    if (!client) return null;
    
    // Auto-resolve role ID for admin vs member
    const isAdmin = email === 'bllacrr@gmail.com';
    const status = isAdmin ? 'approved' : 'pending';
    
    let roleName = isAdmin ? 'admin' : 'member';
    let roleId = null;
    
    try {
        const { data: roleData } = await client.from('roles').select('id').eq('name', roleName).maybeSingle();
        if (roleData) roleId = roleData.id;
    } catch(e) {
        console.error("Failed to query role ID", e);
    }
    
    const payload = { id: userId, email, status: status, role_id: roleId };
    const { data, error } = await client
        .from('profiles')
        .upsert([payload])
        .select('*, role:roles(name)')
        .maybeSingle();
    if (error) {
        console.error("Error creating user profile:", error);
        return null;
    }
    return data;
}

export async function getAllProfiles() {
    const client = await getSupabase();
    if (!client) return [];
    const { data, error } = await client
        .from('profiles')
        .select('*, role:roles(name)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function updateProfileStatus(profileId, status) {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client
        .from('profiles')
        .update({ status })
        .eq('id', profileId)
        .select('*, role:roles(name)')
        .maybeSingle();
    if (error) throw error;
    return data;
}

/* ==========================================================================
   DYNAMIC CATEGORIES API
   ========================================================================== */

export async function getCategories() {
    if (!isOnline()) {
        const local = localStorage.getItem('cached_categories');
        return local ? JSON.parse(local) : [];
    }

    try {
        const client = await getSupabase();
        if (!client) return [];
        const { data, error } = await client
            .from('categories')
            .select('*')
            .order('name', { ascending: true });
        if (error) throw error;

        localStorage.setItem('cached_categories', JSON.stringify(data));
        return data;
    } catch (err) {
        console.warn("Error fetching categories, falling back to local cache", err);
        const local = localStorage.getItem('cached_categories');
        return local ? JSON.parse(local) : [];
    }
}

export async function createCategory(name, icon, color) {
    const client = await getSupabase();
    if (!client) throw new Error("Çevrimdışı iken kategori oluşturulamaz.");
    
    const payload = { name, icon, color };
    const { data, error } = await client
        .from('categories')
        .insert([payload])
        .select();
    if (error) throw error;
    return data[0];
}

export async function updateCategory(id, name, icon, color) {
    const client = await getSupabase();
    if (!client) throw new Error("Çevrimdışı iken kategori güncellenemez.");
    
    const payload = { name, icon, color };
    const { data, error } = await client
        .from('categories')
        .update(payload)
        .eq('id', id)
        .select();
    if (error) throw error;
    return data[0];
}

export async function deleteCategory(id) {
    const client = await getSupabase();
    if (!client) throw new Error("Çevrimdışı iken kategori silinemez.");
    
    const { error } = await client
        .from('categories')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return { success: true };
}

/* ==========================================================================
   PLACES & MAP RESOURCE API
   ========================================================================== */

function mergePendingPlaces(placesList, tripId) {
    return mergePendingRecords(placesList, {
        createAction: 'create_place',
        updateAction: 'update_place',
        deleteAction: 'delete_place',
        filterFn: (p) => {
            if (!p) return false;
            if (!tripId || tripId === 'all-places' || tripId === 'all') return true;
            if (tripId === 'city-guide') return !p.trip_id;
            return String(p.trip_id) === String(tripId);
        }
    });
}

export async function getPlaces(tripId = null) {
    const filterCache = (items) => {
        if (!items) return [];
        if (!tripId || tripId === 'all-places' || tripId === 'all') return items;
        if (tripId === 'city-guide') return items.filter(p => !p.trip_id);
        return items.filter(p => p.trip_id === tripId);
    };

    if (!isOnline()) {
        const local = getLocalCache(CACHE_KEYS.PLACES);
        return mergePendingPlaces(filterCache(local), tripId);
    }

    try {
        const client = await getSupabase();
        if (!client) {
            const local = getLocalCache(CACHE_KEYS.PLACES);
            return mergePendingPlaces(filterCache(local), tripId);
        }

        let query = client
            .from('places')
            .select('*')
            .order('created_at', { ascending: false });

        if (tripId === 'city-guide') {
            query = query.is('trip_id', null);
        } else if (tripId && tripId !== 'all-places' && tripId !== 'all') {
            query = query.eq('trip_id', tripId);
        }

        const { data, error } = await query;
        if (error) throw error;

        const mergedRemote = mergePendingPlaces(data || [], tripId);

        // Merge with local cache without dropping pending queue additions
        const allLocal = getLocalCache(CACHE_KEYS.PLACES);
        let updated;
        if (tripId === 'city-guide') {
            updated = deduplicateById(allLocal.filter(p => !!p.trip_id).concat(mergedRemote));
        } else if (tripId && tripId !== 'all-places' && tripId !== 'all') {
            updated = deduplicateById(allLocal.filter(p => String(p.trip_id) !== String(tripId)).concat(mergedRemote));
        } else {
            updated = mergedRemote;
        }
        setLocalCache(CACHE_KEYS.PLACES, updated);
        return mergedRemote;
    } catch (err) {
        console.warn("Error fetching places, falling back to local cache", err);
        const local = getLocalCache(CACHE_KEYS.PLACES);
        return mergePendingPlaces(filterCache(local), tripId);
    }
}

export async function createPlace(placeData) {
    const validTripId = (placeData.trip_id && placeData.trip_id !== 'city-guide' && placeData.trip_id !== 'all-places') ? placeData.trip_id : null;
    const payload = {
        id: generateUUID(),
        trip_id: validTripId,
        name: placeData.name,
        category: placeData.category || 'other',
        status: placeData.status || 'planned',
        latitude: parseFloat(placeData.latitude),
        longitude: parseFloat(placeData.longitude),
        address: placeData.address || '',
        notes: placeData.notes || '',
        opening_hours: placeData.opening_hours || '',
        estimated_cost: parseFloat(placeData.estimated_cost) || 0,
        currency: placeData.currency || 'EUR',
        visit_order: parseInt(placeData.visit_order) || 0,
        rating: parseInt(placeData.rating) || 0,
        visited_at: placeData.status === 'visited' ? new Date().toISOString() : null,
        created_at: new Date().toISOString()
    };

    // Optimistic cache update
    const places = getLocalCache(CACHE_KEYS.PLACES);
    places.unshift(payload);
    setLocalCache(CACHE_KEYS.PLACES, places);

    if (!isOnline()) {
        addToSyncQueue('create_place', payload);
        return payload;
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('create_place', payload);
            return payload;
        }
        const user = await getCurrentUser();
        if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı');
        payload.user_id = user.id;

        const { data, error } = await executeWithSchemaFallback((clean) => client.from('places').insert([clean]).select(), payload);

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued place creation:", err);
        addToSyncQueue('create_place', payload);
        return { ...payload, _syncError: err?.message || 'Veritabanı senkronizasyonu ertelendi' };
    }
}

export async function updatePlace(placeId, placeData) {
    const places = getLocalCache(CACHE_KEYS.PLACES);
    const existing = places.find(p => p.id === placeId) || {};
    const merged = { ...existing, ...placeData };

    const validTripId = (merged.trip_id && merged.trip_id !== 'city-guide' && merged.trip_id !== 'all-places') ? merged.trip_id : null;
    const payload = {
        id: placeId,
        trip_id: validTripId,
        name: merged.name,
        category: merged.category,
        status: merged.status,
        latitude: parseFloat(merged.latitude),
        longitude: parseFloat(merged.longitude),
        address: merged.address || '',
        notes: merged.notes || '',
        opening_hours: merged.opening_hours || '',
        estimated_cost: parseFloat(merged.estimated_cost) || 0,
        currency: merged.currency || 'EUR',
        visit_order: parseInt(merged.visit_order) || 0,
        rating: parseInt(merged.rating) || 0
    };

    if (merged.status === 'visited') {
        payload.visited_at = merged.visited_at || new Date().toISOString();
    } else {
        payload.visited_at = null;
    }

    // Optimistic cache update
    const index = places.findIndex(p => p.id === placeId);
    if (index > -1) {
        places[index] = { ...places[index], ...payload };
        setLocalCache(CACHE_KEYS.PLACES, places);
    }

    if (!isOnline()) {
        addToSyncQueue('update_place', payload);
        return payload;
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('update_place', payload);
            return payload;
        }
        const { data, error } = await executeWithSchemaFallback((clean) => client.from('places').update(clean).eq('id', placeId).select(), payload);

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued place update:", err);
        addToSyncQueue('update_place', payload);
        return payload;
    }
}

export async function updatePlaceStatus(placeId, newStatus) {
    const visitedAt = newStatus === 'visited' ? new Date().toISOString() : null;
    const updatePayload = {
        status: newStatus,
        visited_at: visitedAt
    };

    // Optimistic cache update
    const places = getLocalCache(CACHE_KEYS.PLACES);
    const index = places.findIndex(p => p.id === placeId);
    if (index > -1) {
        places[index] = { ...places[index], ...updatePayload };
        setLocalCache(CACHE_KEYS.PLACES, places);
    }

    if (!isOnline()) {
        addToSyncQueue('update_place', { id: placeId, ...updatePayload });
        return { success: true, status: newStatus };
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('update_place', { id: placeId, ...updatePayload });
            return { success: true, status: newStatus };
        }
        const { error } = await client
            .from('places')
            .update(updatePayload)
            .eq('id', placeId);

        if (error) throw error;
        return { success: true, status: newStatus };
    } catch (err) {
        console.warn("DB error updating place status, queued offline:", err);
        addToSyncQueue('update_place', { id: placeId, ...updatePayload });
        return { success: true, status: newStatus };
    }
}

export async function deletePlace(placeId) {
    const targetId = String(placeId);

    // Optimistic cache update
    const places = getLocalCache(CACHE_KEYS.PLACES).filter(p => String(p.id) !== targetId);
    setLocalCache(CACHE_KEYS.PLACES, places);

    // Cancel any unsynced create/update for this place so mergePendingPlaces cannot resurrect it
    const hadPendingCreate = pruneSyncQueueByRecord(targetId, ['create_place', 'update_place', 'delete_place']);
    if (hadPendingCreate) {
        return { success: true, removedLocalOnly: true };
    }

    if (!isOnline()) {
        addToSyncQueue('delete_place', { id: placeId });
        return { success: true };
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('delete_place', { id: placeId });
            return { success: true };
        }
        const { error } = await client.from('places').delete().eq('id', placeId);
        if (error) throw error;
        return { success: true };
    } catch (err) {
        console.error("DB error deleting place:", err);
        addToSyncQueue('delete_place', { id: placeId });
        return { success: true };
    }
}

/* ==========================================================================
   RESERVATIONS & TICKETS RESOURCE API (Cloud + Zero-Friction Local Fallback)
   ========================================================================== */

const RESERVATION_QUEUE_CONFIG = {
    createAction: 'create_reservation',
    updateAction: 'update_reservation',
    deleteAction: 'delete_reservation'
};

function mergeReservationsWithCache(remoteList, localAll, tripId) {
    const mergedRemote = mergePendingRecords(remoteList || [], {
        ...RESERVATION_QUEUE_CONFIG,
        filterFn: (r) => !tripId || String(r?.trip_id) === String(tripId)
    });
    const mergedIds = new Set(mergedRemote.map(r => String(r.id)));
    const localOnlyItems = (localAll || []).filter(r => {
        if (!r || !r.id || mergedIds.has(String(r.id))) return false;
        if (!r._localOnly) return false;
        return !tripId || String(r.trip_id) === String(tripId);
    });
    return deduplicateById(mergedRemote.concat(localOnlyItems));
}

export async function getReservations(tripId = null) {
    const localAll = getLocalCache(CACHE_KEYS.RESERVATIONS);
    const filterCache = (items) => {
        const list = items || [];
        const filtered = !tripId ? list : list.filter(r => String(r?.trip_id) === String(tripId));
        return [...filtered].sort((a, b) => String(a.start_datetime || '').localeCompare(String(b.start_datetime || '')));
    };

    if (!isOnline() || reservationsCloudTableMissing) {
        return filterCache(mergePendingRecords(localAll, RESERVATION_QUEUE_CONFIG));
    }

    try {
        const client = await getSupabase();
        if (!client) return filterCache(mergePendingRecords(localAll, RESERVATION_QUEUE_CONFIG));

        let query = client
            .from('reservations')
            .select('*')
            .order('start_datetime', { ascending: true });

        if (tripId) {
            query = query.eq('trip_id', tripId);
        }

        const { data, error } = await query;
        if (error) {
            if (isMissingTableError(error)) {
                reservationsCloudTableMissing = true;
                return filterCache(localAll);
            }
            throw error;
        }

        const mergedTripItems = mergeReservationsWithCache(data || [], localAll, tripId);
        const updatedCache = tripId
            ? deduplicateById(localAll.filter(r => String(r.trip_id) !== String(tripId)).concat(mergedTripItems))
            : mergedTripItems;
        setLocalCache(CACHE_KEYS.RESERVATIONS, updatedCache);
        return filterCache(mergedTripItems);
    } catch (err) {
        console.warn('Error fetching reservations, falling back to local cache:', err);
        return filterCache(mergePendingRecords(localAll, RESERVATION_QUEUE_CONFIG));
    }
}

export async function createReservation(resData) {
    const payload = {
        id: generateUUID(),
        trip_id: resData.trip_id || null,
        type: resData.type || 'other',
        title: (resData.title || '').trim(),
        provider: (resData.provider || '').trim(),
        pnr: (resData.pnr || '').trim().toUpperCase(),
        start_datetime: resData.start_datetime || '',
        end_datetime: resData.end_datetime || '',
        location: (resData.location || '').trim(),
        notes: (resData.notes || '').trim(),
        created_at: new Date().toISOString()
    };

    const cached = getLocalCache(CACHE_KEYS.RESERVATIONS);
    cached.push(payload);
    setLocalCache(CACHE_KEYS.RESERVATIONS, cached);

    if (!isOnline() || reservationsCloudTableMissing) {
        if (reservationsCloudTableMissing) {
            payload._localOnly = true;
            setLocalCache(CACHE_KEYS.RESERVATIONS, cached);
        } else {
            addToSyncQueue('create_reservation', payload);
        }
        return payload;
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('create_reservation', payload);
            return payload;
        }
        const user = await getCurrentUser();
        if (!user) throw new Error('Aktif kullanıcı oturumu bulunamadı');
        payload.user_id = user.id;

        const { data, error } = await executeWithSchemaFallback(
            (clean) => client.from('reservations').insert([clean]).select(),
            payload
        );
        if (error) {
            if (isMissingTableError(error)) {
                reservationsCloudTableMissing = true;
                payload._localOnly = true;
                setLocalCache(CACHE_KEYS.RESERVATIONS, cached);
                return payload;
            }
            throw error;
        }
        return data[0] || payload;
    } catch (err) {
        console.warn('Queued reservation creation offline:', err);
        addToSyncQueue('create_reservation', payload);
        return payload;
    }
}

export async function updateReservation(resId, resData) {
    const cached = getLocalCache(CACHE_KEYS.RESERVATIONS);
    const existing = cached.find(r => String(r.id) === String(resId)) || {};
    const payload = {
        id: resId,
        trip_id: resData.trip_id !== undefined ? (resData.trip_id || null) : (existing.trip_id || null),
        type: resData.type || existing.type || 'other',
        title: (resData.title ?? existing.title ?? '').trim(),
        provider: (resData.provider ?? existing.provider ?? '').trim(),
        pnr: (resData.pnr ?? existing.pnr ?? '').trim().toUpperCase(),
        start_datetime: resData.start_datetime ?? existing.start_datetime ?? '',
        end_datetime: resData.end_datetime ?? existing.end_datetime ?? '',
        location: (resData.location ?? existing.location ?? '').trim(),
        notes: (resData.notes ?? existing.notes ?? '').trim()
    };

    const idx = cached.findIndex(r => String(r.id) === String(resId));
    if (idx > -1) {
        cached[idx] = { ...cached[idx], ...payload };
        setLocalCache(CACHE_KEYS.RESERVATIONS, cached);
    }

    if (!isOnline() || reservationsCloudTableMissing) {
        if (!reservationsCloudTableMissing) {
            addToSyncQueue('update_reservation', payload);
        }
        return payload;
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('update_reservation', payload);
            return payload;
        }
        const { data, error } = await executeWithSchemaFallback(
            (clean) => client.from('reservations').update(clean).eq('id', resId).select(),
            payload
        );
        if (error) {
            if (isMissingTableError(error)) {
                reservationsCloudTableMissing = true;
                return payload;
            }
            throw error;
        }
        return data[0] || payload;
    } catch (err) {
        console.warn('Queued reservation update offline:', err);
        addToSyncQueue('update_reservation', payload);
        return payload;
    }
}

export async function deleteReservation(resId) {
    const targetId = String(resId);
    const cached = getLocalCache(CACHE_KEYS.RESERVATIONS);
    const targetItem = cached.find(r => String(r.id) === targetId);
    setLocalCache(CACHE_KEYS.RESERVATIONS, cached.filter(r => String(r.id) !== targetId));

    const hadPendingCreate = pruneSyncQueueByRecord(targetId, ['create_reservation', 'update_reservation', 'delete_reservation']);
    if (hadPendingCreate || targetItem?._localOnly || reservationsCloudTableMissing) {
        return { success: true };
    }

    if (!isOnline()) {
        addToSyncQueue('delete_reservation', { id: resId });
        return { success: true };
    }

    try {
        const client = await getSupabase();
        if (!client) {
            addToSyncQueue('delete_reservation', { id: resId });
            return { success: true };
        }
        const { error } = await client.from('reservations').delete().eq('id', resId);
        if (error) {
            if (isMissingTableError(error)) {
                reservationsCloudTableMissing = true;
                return { success: true };
            }
            throw error;
        }
        return { success: true };
    } catch (err) {
        console.warn('Queued reservation deletion offline:', err);
        addToSyncQueue('delete_reservation', { id: resId });
        return { success: true };
    }
}

/* ==========================================================================
   SHARED ROUTES API (Short Links & Guest Read-Only Access)
   ========================================================================== */

export async function saveSharedRoute(slug, tripName, places, pinHash = '') {
    try {
        const client = await getSupabase();
        if (!client) return null;

        // Ensure user ID is up to date if user is logged in
        if (!currentCachedUserId && client.auth) {
            try {
                const { data: { user } } = await client.auth.getUser();
                if (user) currentCachedUserId = user.id;
            } catch (e) {}
        }

        const record = {
            id: slug,
            user_id: currentCachedUserId || null,
            trip_name: tripName,
            pin_hash: pinHash || null,
            places: places,
            created_at: new Date().toISOString()
        };

        const { data, error } = await client
            .from('shared_routes')
            .upsert(record)
            .select()
            .single();

        if (error) {
            console.warn("Could not save to shared_routes table (table may not exist yet):", error.message);
            return null;
        }
        return data;
    } catch (err) {
        console.warn("Error in saveSharedRoute:", err);
        return null;
    }
}

export async function getSharedRoute(slug) {
    try {
        const client = await getSupabase();
        if (!client) return null;

        const { data, error } = await client
            .from('shared_routes')
            .select('*')
            .eq('id', slug)
            .single();

        if (error) {
            console.warn("Could not fetch shared route from DB:", error.message);
            return null;
        }
        return data;
    } catch (err) {
        console.warn("Error in getSharedRoute:", err);
        return null;
    }
}

/* ==========================================================================
   PUBLIC BLOG POSTS & CMS API
   ========================================================================== */

function getCachedBlogPosts() {
    try {
        const raw = localStorage.getItem(BLOG_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function setCachedBlogPosts(posts) {
    try {
        localStorage.setItem(BLOG_CACHE_KEY, JSON.stringify(posts || []));
    } catch (_) {}
}

export async function getPublishedBlogPosts() {
    if (!hasInternet()) {
        return getCachedBlogPosts();
    }
    try {
        const client = await getSupabase();
        if (!client) return getCachedBlogPosts();
        const { data, error } = await client
            .from('blog_posts')
            .select('*')
            .eq('status', 'published')
            .order('is_featured', { ascending: false })
            .order('published_at', { ascending: false, nullsFirst: false })
            .order('created_at', { ascending: false });
        if (error) {
            if (isMissingTableError(error)) {
                return getCachedBlogPosts();
            }
            throw error;
        }
        const list = data || [];
        setCachedBlogPosts(list);
        return list;
    } catch (err) {
        console.warn("Could not fetch published blog posts, using cache:", err);
        return getCachedBlogPosts();
    }
}

export async function getBlogPostBySlug(slug) {
    if (!slug) return null;
    const cached = getCachedBlogPosts().find(p => p.slug === slug);
    if (!hasInternet()) return cached || null;

    try {
        const client = await getSupabase();
        if (!client) return cached || null;
        const { data, error } = await client
            .from('blog_posts')
            .select('*')
            .eq('slug', slug)
            .maybeSingle();
        if (error) throw error;
        return data || cached || null;
    } catch (err) {
        console.warn("Error fetching blog post by slug:", err);
        return cached || null;
    }
}

export async function getAllBlogPostsAdmin() {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");
    const { data, error } = await client
        .from('blog_posts')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function uploadPublicContentImage(file) {
    if (!file) return '';
    if (!hasInternet()) throw new Error("Görsel yüklemek için internet bağlantısı gereklidir.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");

    const rawExt = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(rawExt) ? rawExt : 'jpg';
    const filePath = `blog/${Date.now()}_${generateUUID().slice(0, 8)}.${safeExt}`;

    const { error: uploadError } = await client.storage
        .from('public-content')
        .upload(filePath, file, {
            cacheControl: '31536000',
            upsert: false,
            contentType: file.type || 'image/jpeg'
        });

    if (uploadError) {
        throw new Error(`Kapak görseli yüklenemedi ("public-content" bucket'ı kurulu mu?): ${uploadError.message}`);
    }

    const { data } = client.storage.from('public-content').getPublicUrl(filePath);
    return data?.publicUrl || '';
}

export async function createBlogPost(postData, coverFile = null) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");

    let coverUrl = (postData.cover_image_url || '').trim();
    if (coverFile) {
        coverUrl = await uploadPublicContentImage(coverFile);
    }

    const nowIso = new Date().toISOString();
    const record = {
        slug: postData.slug,
        title: postData.title,
        summary: postData.summary || '',
        content: postData.content,
        cover_image_url: coverUrl || null,
        category: postData.category || 'Rehber',
        tags: Array.isArray(postData.tags) ? postData.tags : [],
        author_name: postData.author_name || 'TravellerMobi Editör',
        author_id: currentCachedUserId || null,
        status: postData.status === 'published' ? 'published' : 'draft',
        is_featured: !!postData.is_featured,
        read_time_minutes: Number(postData.read_time_minutes) || 3,
        published_at: postData.status === 'published' ? (postData.published_at || nowIso) : null,
        updated_at: nowIso
    };

    const { data, error } = await client
        .from('blog_posts')
        .insert([record])
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateBlogPost(postId, postData, coverFile = null) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");

    let coverUrl = (postData.cover_image_url || '').trim();
    if (coverFile) {
        coverUrl = await uploadPublicContentImage(coverFile);
    }

    const nowIso = new Date().toISOString();
    const record = {
        slug: postData.slug,
        title: postData.title,
        summary: postData.summary || '',
        content: postData.content,
        cover_image_url: coverUrl || null,
        category: postData.category || 'Rehber',
        tags: Array.isArray(postData.tags) ? postData.tags : [],
        author_name: postData.author_name || 'TravellerMobi Editör',
        status: postData.status === 'published' ? 'published' : 'draft',
        is_featured: !!postData.is_featured,
        read_time_minutes: Number(postData.read_time_minutes) || 3,
        updated_at: nowIso
    };
    if (record.status === 'published') {
        record.published_at = postData.published_at || nowIso;
    }

    const { data, error } = await client
        .from('blog_posts')
        .update(record)
        .eq('id', postId)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteBlogPost(postId) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");
    const { error } = await client.from('blog_posts').delete().eq('id', postId);
    if (error) throw error;
    return true;
}

export async function incrementBlogPostView(slug) {
    if (!slug || !hasInternet()) return;
    try {
        const client = await getSupabase();
        if (!client) return;
        await client.rpc('increment_blog_view', { p_slug: slug });
    } catch (_) {}
}

/* ==========================================================================
   AUTOMATIC TRAVEL NEWS SOURCES API
   ========================================================================== */

export async function getNewsSources(onlyEnabled = false) {
    const readCache = () => {
        try {
            const raw = localStorage.getItem(NEWS_SOURCES_CACHE_KEY);
            const list = raw ? JSON.parse(raw) : [];
            return onlyEnabled ? list.filter(s => s.is_enabled !== false) : list;
        } catch {
            return [];
        }
    };

    if (!hasInternet()) return readCache();
    try {
        const client = await getSupabase();
        if (!client) return readCache();
        let query = client.from('news_sources').select('*').order('created_at', { ascending: true });
        if (onlyEnabled) query = query.eq('is_enabled', true);
        const { data, error } = await query;
        if (error) {
            if (isMissingTableError(error)) return [];
            throw error;
        }
        if (!onlyEnabled) {
            try { localStorage.setItem(NEWS_SOURCES_CACHE_KEY, JSON.stringify(data || [])); } catch (_) {}
        }
        return data || [];
    } catch (err) {
        console.warn("Could not load news sources:", err);
        return readCache();
    }
}

export async function createNewsSource(sourceData) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");
    const { data, error } = await client
        .from('news_sources')
        .insert([{
            name: sourceData.name,
            rss_url: sourceData.rss_url,
            category: sourceData.category || 'Seyahat',
            is_enabled: sourceData.is_enabled !== false
        }])
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateNewsSource(id, patch) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");
    const { data, error } = await client
        .from('news_sources')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteNewsSource(id) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");
    const { error } = await client.from('news_sources').delete().eq('id', id);
    if (error) throw error;
    return true;
}

/* ==========================================================================
   VISITOR ANALYTICS & IDENTITY STITCHING API
   ========================================================================== */

export async function recordSiteVisit(payload) {
    if (!hasInternet() || !payload?.visitor_id) return false;
    const rpcBody = {
        p_visitor_id: payload.visitor_id,
        p_session_id: payload.session_id || null,
        p_event_type: payload.event_type || 'page_view',
        p_page_path: payload.page_path || '#explore',
        p_post_slug: payload.post_slug || null,
        p_post_title: payload.post_title || null,
        p_referrer: payload.referrer || null,
        p_referrer_domain: payload.referrer_domain || null,
        p_utm_source: payload.utm_source || null,
        p_utm_medium: payload.utm_medium || null,
        p_utm_campaign: payload.utm_campaign || null,
        p_device_type: payload.device_type || null,
        p_os: payload.os || null,
        p_browser: payload.browser || null,
        p_language: payload.language || null,
        p_screen_resolution: payload.screen_resolution || null,
        p_timezone: payload.timezone || null,
        p_country: payload.country || null,
        p_city: payload.city || null,
        p_region: payload.region || null,
        p_is_pwa: !!payload.is_pwa,
        p_user_id: payload.user_id || null,
        p_user_email: payload.user_email || null,
        p_scroll_depth: typeof payload.scroll_depth === 'number' ? Math.round(payload.scroll_depth) : null,
        p_duration_seconds: typeof payload.duration_seconds === 'number' ? Math.round(payload.duration_seconds) : null,
        p_search_query: payload.search_query ? String(payload.search_query).slice(0, 120) : null,
        p_search_results_count: typeof payload.search_results_count === 'number' ? Math.round(payload.search_results_count) : null
    };

    try {
        // Use keepalive fetch for outbound clicks & page-exit reading events so iOS Safari never cancels them
        if (payload._keepalive && config.supabaseUrl && config.supabaseKey) {
            let authToken = config.supabaseKey;
            try {
                if (supabase?.auth) {
                    const { data } = await supabase.auth.getSession();
                    if (data?.session?.access_token) authToken = data.session.access_token;
                }
            } catch (_) {}

            const url = `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/record_site_visit`;
            const res = await fetch(url, {
                method: 'POST',
                keepalive: true,
                headers: {
                    'apikey': config.supabaseKey,
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(rpcBody)
            });
            return res.ok;
        }

        const client = await getSupabase();
        if (!client) return false;
        const { error } = await client.rpc('record_site_visit', rpcBody);
        if (error) {
            if (!isMissingTableError(error)) {
                console.warn("record_site_visit RPC error:", error.message);
            }
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export async function linkVisitorToUser(visitorId, userId, email) {
    if (!hasInternet() || !visitorId || !userId) return false;
    try {
        const client = await getSupabase();
        if (!client) return false;
        const { error } = await client.rpc('link_visitor_to_user', {
            p_visitor_id: visitorId,
            p_user_id: userId,
            p_user_email: email || null
        });
        return !error;
    } catch {
        return false;
    }
}

export async function getAnalyticsOverview(limitVisitors = 150, limitEvents = 500) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");

    const [visitorsRes, eventsRes] = await Promise.all([
        client
            .from('site_visitors')
            .select('*')
            .order('last_seen_at', { ascending: false })
            .limit(limitVisitors),
        client
            .from('site_events')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limitEvents)
    ]);

    if (visitorsRes.error) throw visitorsRes.error;
    if (eventsRes.error) throw eventsRes.error;

    return {
        visitors: visitorsRes.data || [],
        events: eventsRes.data || []
    };
}

export async function getVisitorTimelineAdmin(visitorId, limit = 80) {
    if (!hasInternet()) throw new Error("İnternet bağlantısı yok.");
    if (!visitorId) return [];
    const client = await getSupabase();
    if (!client) throw new Error("Sunucuya ulaşılamadı.");

    const { data, error } = await client
        .from('site_events')
        .select('*')
        .eq('visitor_id', visitorId)
        .order('created_at', { ascending: true })
        .limit(limit);

    if (error) throw error;
    return data || [];
}

// Initialize active user on load if config is present
if (config.supabaseUrl && config.supabaseKey && hasInternet()) {
    getCurrentUser().catch(() => {});
}

