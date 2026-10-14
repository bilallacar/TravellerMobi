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

/**
 * Initialize Supabase Client if keys are configured.
 * Returns a Promise that resolves with the Supabase client.
 */
export function initSupabase() {
    if (supabaseReadyPromise) return supabaseReadyPromise;

    if (config.supabaseUrl && config.supabaseKey) {
        supabaseReadyPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
            .then((module) => {
                supabase = module.createClient(config.supabaseUrl, config.supabaseKey);
                console.log("Supabase Client initialized successfully.");
                // Start an immediate sync check when connected
                syncOfflineQueue();
                return supabase;
            })
            .catch((err) => {
                console.error("Failed to load Supabase module from CDN:", err);
                supabaseReadyPromise = null; // Reset to allow retry
                throw err;
            });
        return supabaseReadyPromise;
    }
    return Promise.resolve(null);
}

// Helper to await client readiness in auth/database actions
async function getSupabase() {
    if (!supabase) {
        if (supabaseReadyPromise) {
            await supabaseReadyPromise;
        } else {
            await initSupabase();
        }
    }
    return supabase;
}

// Ensure init runs immediately if possible
if (config.supabaseUrl && config.supabaseKey) {
    initSupabase();
}

/**
 * Helper to check connection status
 */
export function isOnline() {
    return navigator.onLine && supabase !== null;
}

/* ==========================================================================
   AUTHENTICATION API
   ========================================================================== */

export async function getCurrentUser() {
    try {
        const client = await getSupabase();
        if (!client) return null;
        const { data: { user } } = await client.auth.getUser();
        if (user) {
            currentCachedUserId = user.id;
        } else {
            currentCachedUserId = null;
        }
        return user;
    } catch (err) {
        console.error("Error in getCurrentUser:", err);
        return null;
    }
}

export async function signIn(email, password) {
    const client = await getSupabase();
    if (!client) throw new Error("Supabase bulut bağlantısı kurulu değil. Lütfen Ayarlar'dan yapılandırın.");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (data.user) {
        currentCachedUserId = data.user.id;
    }
    return data.user;
}

export async function signUp(email, password) {
    const client = await getSupabase();
    if (!client) throw new Error("Supabase bulut bağlantısı kurulu değil. Lütfen Ayarlar'dan yapılandırın.");
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user) {
        currentCachedUserId = data.user.id;
    }
    return data.user;
}

export async function signOut() {
    const client = await getSupabase();
    if (!client) return;
    await client.auth.signOut();
    currentCachedUserId = null;
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

/**
 * Processes items pending in the offline queue to Supabase
 */
export async function syncOfflineQueue(onProgress) {
    if (!isOnline()) {
        console.log("App is offline. Sync postponed.");
        return { success: false, reason: 'offline' };
    }

    const queue = getLocalCache(CACHE_KEYS.QUEUE);
    if (queue.length === 0) return { success: true, count: 0 };

    console.log(`Syncing ${queue.length} offline actions to Supabase...`);
    let completedCount = 0;
    
    // Copy queue to process elements
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
                const { error } = await supabase.from('trips').insert([payload]);
                if (error) throw error;
            } 
            else if (item.action === 'update_trip') {
                const { error } = await supabase.from('trips').update(payload).eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'delete_trip') {
                const { error } = await supabase.from('trips').delete().eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'create_expense') {
                const { error } = await supabase.from('expenses').insert([payload]);
                if (error) throw error;
            }
            else if (item.action === 'update_expense') {
                const { error } = await supabase.from('expenses').update(payload).eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'delete_expense') {
                const { error } = await supabase.from('expenses').delete().eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'create_memory') {
                // Check if memory has base64 data to upload first
                if (item.data.photo_base64 && item.data.photo_name) {
                    const fileBlob = base64ToBlob(item.data.photo_base64);
                    const fileType = item.data.photo_base64.split(';')[0].split(':')[1];
                    const file = new File([fileBlob], item.data.photo_name, { type: fileType });
                    
                    // Upload file now
                    const publicUrl = await uploadPhotoToStorage(file);
                    payload.photo_url = publicUrl;
                }
                
                // Remove temporary client helpers
                delete payload.photo_base64;
                delete payload.photo_name;

                const { error } = await supabase.from('memories').insert([payload]);
                if (error) throw error;
            }
            else if (item.action === 'update_memory') {
                if (item.data.photo_base64 && item.data.photo_name) {
                    const fileBlob = base64ToBlob(item.data.photo_base64);
                    const fileType = item.data.photo_base64.split(';')[0].split(':')[1];
                    const file = new File([fileBlob], item.data.photo_name, { type: fileType });
                    const publicUrl = await uploadPhotoToStorage(file);
                    payload.photo_url = publicUrl;
                }
                delete payload.photo_base64;
                delete payload.photo_name;
                const { error } = await supabase.from('memories').update(payload).eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'delete_memory') {
                const { error } = await supabase.from('memories').delete().eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'create_place') {
                const { error } = await supabase.from('places').insert([payload]);
                if (error) throw error;
            }
            else if (item.action === 'update_place') {
                const { error } = await supabase.from('places').update(payload).eq('id', item.data.id);
                if (error) throw error;
            }
            else if (item.action === 'delete_place') {
                const { error } = await supabase.from('places').delete().eq('id', item.data.id);
                if (error) throw error;
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

export async function getTrips() {
    if (!isOnline()) {
        return getLocalCache(CACHE_KEYS.TRIPS);
    }

    try {
        const { data, error } = await supabase
            .from('trips')
            .select('*')
            .order('start_date', { ascending: false });

        if (error) throw error;
        setLocalCache(CACHE_KEYS.TRIPS, data);
        return data;
    } catch (err) {
        console.warn("Error fetching trips, falling back to local cache", err);
        return getLocalCache(CACHE_KEYS.TRIPS);
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
    // Optimistic Update Cache
    const trips = getLocalCache(CACHE_KEYS.TRIPS).filter(t => t.id !== tripId);
    setLocalCache(CACHE_KEYS.TRIPS, trips);

    // Cascading local delete for related items
    const expenses = getLocalCache(CACHE_KEYS.EXPENSES).filter(e => e.trip_id !== tripId);
    setLocalCache(CACHE_KEYS.EXPENSES, expenses);
    const memories = getLocalCache(CACHE_KEYS.MEMORIES).filter(m => m.trip_id !== tripId);
    setLocalCache(CACHE_KEYS.MEMORIES, memories);

    if (!isOnline()) {
        addToSyncQueue('delete_trip', { id: tripId });
        return { success: true };
    }

    try {
        const { error } = await supabase.from('trips').delete().eq('id', tripId);
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

export async function getExpenses(tripId = null) {
    if (!isOnline()) {
        const local = getLocalCache(CACHE_KEYS.EXPENSES);
        return tripId ? local.filter(e => e.trip_id === tripId) : local;
    }

    try {
        let query = supabase.from('expenses').select('*').order('date', { ascending: false });
        if (tripId) query = query.eq('trip_id', tripId);
        
        const { data, error } = await query;
        if (error) throw error;

        // If caching for a specific trip, merge it back to global list
        const cachedList = getLocalCache(CACHE_KEYS.EXPENSES);
        let updatedList;
        if (tripId) {
            updatedList = [
                ...cachedList.filter(e => e.trip_id !== tripId),
                ...data
            ];
        } else {
            updatedList = data;
        }
        setLocalCache(CACHE_KEYS.EXPENSES, updatedList);
        return data;
    } catch (err) {
        console.warn("Error fetching expenses, falling back to local cache", err);
        const local = getLocalCache(CACHE_KEYS.EXPENSES);
        return tripId ? local.filter(e => e.trip_id === tripId) : local;
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
    // Optimistic Update Cache
    const expenses = getLocalCache(CACHE_KEYS.EXPENSES).filter(e => e.id !== expenseId);
    setLocalCache(CACHE_KEYS.EXPENSES, expenses);

    if (!isOnline()) {
        addToSyncQueue('delete_expense', { id: expenseId });
        return { success: true };
    }

    try {
        const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
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
    if (!isOnline()) {
        const local = getLocalCache(CACHE_KEYS.MEMORIES);
        return tripId ? local.filter(m => m.trip_id === tripId) : local;
    }

    try {
        let query = supabase.from('memories').select('*').order('date', { ascending: false });
        if (tripId) query = query.eq('trip_id', tripId);
        
        const { data, error } = await query;
        if (error) throw error;

        const cachedList = getLocalCache(CACHE_KEYS.MEMORIES);
        let updatedList;
        if (tripId) {
            updatedList = [
                ...cachedList.filter(m => m.trip_id !== tripId),
                ...data
            ];
        } else {
            updatedList = data;
        }
        setLocalCache(CACHE_KEYS.MEMORIES, updatedList);
        return data;
    } catch (err) {
        console.warn("Error fetching memories, falling back to local cache", err);
        const local = getLocalCache(CACHE_KEYS.MEMORIES);
        return tripId ? local.filter(m => m.trip_id === tripId) : local;
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

        const { data, error } = await supabase
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

        const { data, error } = await supabase
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
    // Optimistic Update Cache
    const memories = getLocalCache(CACHE_KEYS.MEMORIES).filter(m => m.id !== memoryId);
    setLocalCache(CACHE_KEYS.MEMORIES, memories);

    if (!isOnline()) {
        addToSyncQueue('delete_memory', { id: memoryId });
        return { success: true };
    }

    try {
        const { error } = await supabase.from('memories').delete().eq('id', memoryId);
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
    if (!supabase) throw new Error("Supabase connection is unconfigured.");
    const user = await getCurrentUser();
    if (!user) throw new Error("Kullanıcı oturumu bulunamadı.");
    
    // Bucket name
    const BUCKET_NAME = 'traveller-photos';
    // Generate unique name path inside bucket
    const fileExtension = file.name.split('.').pop();
    const fileName = `${generateUUID()}.${fileExtension}`;
    const filePath = `${user.id}/${fileName}`;

    // Upload payload
    const { data, error } = await supabase.storage
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

// Register browser sync listeners
window.addEventListener('online', () => {
    console.log("Network online detected. Triggering queue sync.");
    syncOfflineQueue();
});

/* ==========================================================================
   USER PROFILES / ADMIN API
   ========================================================================== */

export async function getUserProfile(userId) {
    const client = await getSupabase();
    if (!client) return null;
    const { data, error } = await client
        .from('profiles')
        .select('*, role:roles(name)')
        .eq('id', userId)
        .maybeSingle();
    if (error) {
        console.error("Error fetching user profile:", error);
        return null;
    }
    return data;
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

export async function getPlaces(tripId = null) {
    if (!isOnline()) {
        const local = getLocalCache(CACHE_KEYS.PLACES);
        return tripId ? local.filter(p => p.trip_id === tripId) : local;
    }

    try {
        const client = await getSupabase();
        if (!client) {
            const local = getLocalCache(CACHE_KEYS.PLACES);
            return tripId ? local.filter(p => p.trip_id === tripId) : local;
        }

        let query = client
            .from('places')
            .select('*')
            .order('created_at', { ascending: false });

        if (tripId) {
            query = query.eq('trip_id', tripId);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Merge with local cache
        const allLocal = getLocalCache(CACHE_KEYS.PLACES);
        let updated;
        if (tripId) {
            updated = allLocal.filter(p => p.trip_id !== tripId).concat(data || []);
        } else {
            updated = data || [];
        }
        setLocalCache(CACHE_KEYS.PLACES, updated);
        return data || [];
    } catch (err) {
        console.warn("Error fetching places, falling back to local cache", err);
        const local = getLocalCache(CACHE_KEYS.PLACES);
        return tripId ? local.filter(p => p.trip_id === tripId) : local;
    }
}

export async function createPlace(placeData) {
    const payload = {
        id: generateUUID(),
        trip_id: placeData.trip_id,
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
        if (user) payload.user_id = user.id;

        const { data, error } = await client
            .from('places')
            .insert([payload])
            .select();

        if (error) throw error;
        return data[0];
    } catch (err) {
        console.warn("DB offline or error, queued place creation:", err);
        addToSyncQueue('create_place', payload);
        return payload;
    }
}

export async function updatePlace(placeId, placeData) {
    const payload = {
        id: placeId,
        trip_id: placeData.trip_id,
        name: placeData.name,
        category: placeData.category,
        status: placeData.status,
        latitude: parseFloat(placeData.latitude),
        longitude: parseFloat(placeData.longitude),
        address: placeData.address || '',
        notes: placeData.notes || '',
        opening_hours: placeData.opening_hours || '',
        estimated_cost: parseFloat(placeData.estimated_cost) || 0,
        currency: placeData.currency || 'EUR',
        visit_order: parseInt(placeData.visit_order) || 0
    };

    if (placeData.status === 'visited') {
        payload.visited_at = placeData.visited_at || new Date().toISOString();
    } else {
        payload.visited_at = null;
    }

    // Optimistic cache update
    const places = getLocalCache(CACHE_KEYS.PLACES);
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
        const { data, error } = await client
            .from('places')
            .update(payload)
            .eq('id', placeId)
            .select();

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
    // Optimistic cache update
    const places = getLocalCache(CACHE_KEYS.PLACES).filter(p => p.id !== placeId);
    setLocalCache(CACHE_KEYS.PLACES, places);

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
   SHARED ROUTES API (Short Links & Guest Read-Only Access)
   ========================================================================== */

export async function saveSharedRoute(slug, tripName, places, pinHash = '') {
    try {
        const client = await getSupabase();
        if (!client) return null;

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

// Initialize active user on load if config is present
if (config.supabaseUrl && config.supabaseKey) {
    getCurrentUser().catch(() => {});
}

