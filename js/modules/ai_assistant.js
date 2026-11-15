// js/modules/ai_assistant.js - Universal Gemini AI Assistant Chatbox with Function Calling

import { config, saveGeminiConfig, saveGeminiAutoApply } from '../../config.js';
import * as db from '../../db.js';
import { state } from '../state.js';
import { showToast, escapeHtml, convertCurrency, isValidCoord } from '../utils.js';
import { PLACE_CATEGORIES } from './places.js';

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_TURNS = 24;

let chatMessages = []; // UI messages: { id, role: 'user'|'assistant', text, toolChips?, pendingActions?, actionStatus?: 'pending'|'applied'|'cancelled', error? }
let geminiHistory = []; // Gemini API contents array: { role: 'user'|'model'|'function', parts: [...] }
let isSending = false;
let loadedStorageKey = null;
let savedScrollY = 0;
let isMobileScrollLocked = false;

function getStorageKey() {
    const uid = state.activeUser?.id || 'guest';
    return `tm_ai_chat_${uid}`;
}

function saveChatSession() {
    try {
        sessionStorage.setItem(getStorageKey(), JSON.stringify({
            chatMessages: chatMessages.slice(-30),
            geminiHistory: geminiHistory.slice(-MAX_HISTORY_TURNS)
        }));
    } catch (_) {}
}

function loadChatSession() {
    const key = getStorageKey();
    if (loadedStorageKey === key) return;
    loadedStorageKey = key;
    chatMessages = [];
    geminiHistory = [];
    try {
        const raw = sessionStorage.getItem(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.chatMessages)) chatMessages = parsed.chatMessages;
        if (Array.isArray(parsed.geminiHistory)) geminiHistory = parsed.geminiHistory;
    } catch (_) {}
}

function getActiveTripContextLabel() {
    if (!state.activeTripId || state.activeTripId === 'city-guide') return 'Şehir Rehberi (Genel)';
    if (state.activeTripId === 'all-places') return 'Tüm Mekanlar';
    const trip = (state.tripsList || []).find(t => String(t.id) === String(state.activeTripId));
    return trip ? trip.name : 'Aktif Seyahat';
}

function updateContextSubtitle() {
    const el = document.getElementById('ai-context-label');
    if (el) {
        el.textContent = getActiveTripContextLabel();
    }
}

function syncKeyBannerVisibility() {
    const banner = document.getElementById('ai-no-key-banner');
    const quickPrompts = document.getElementById('ai-quick-prompts');
    const statusDot = document.getElementById('ai-key-status-dot');
    const hasKey = !!(config.geminiApiKey && config.geminiApiKey.trim());

    if (banner) {
        banner.classList.toggle('hidden', hasKey);
    }
    if (quickPrompts) {
        quickPrompts.classList.toggle('hidden', chatMessages.length > 0);
    }
    if (statusDot) {
        statusDot.classList.toggle('is-ready', hasKey);
        statusDot.classList.toggle('is-missing', !hasKey);
        statusDot.title = hasKey ? `Bağlı (${config.geminiModel || 'gemini-2.5-flash'})` : 'Gemini API Anahtarı Gerekli';
    }
}

function syncVisualViewportHeight() {
    const panel = document.getElementById('ai-chatbox-panel');
    if (!panel || panel.classList.contains('hidden')) return;
    if (window.visualViewport) {
        panel.style.setProperty('--ai-vh', `${Math.round(window.visualViewport.height)}px`);
    }
}

function lockBackgroundScroll() {
    if (window.innerWidth <= 768 && !isMobileScrollLocked) {
        savedScrollY = window.scrollY || window.pageYOffset || 0;
        isMobileScrollLocked = true;
        document.documentElement.classList.add('ai-scroll-locked');
        document.body.classList.add('ai-scroll-locked');
        document.body.style.top = `-${savedScrollY}px`;
    }
    syncVisualViewportHeight();
}

function unlockBackgroundScroll() {
    if (isMobileScrollLocked) {
        isMobileScrollLocked = false;
        document.documentElement.classList.remove('ai-scroll-locked');
        document.body.classList.remove('ai-scroll-locked');
        document.body.style.top = '';
        window.scrollTo(0, savedScrollY);
    }
}

function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 116);
    textarea.style.height = `${Math.max(nextHeight, 38)}px`;
}

/**
 * Formats safe inline markdown (bold, code, line breaks, simple lists)
 */
function formatAssistantText(text) {
    if (!text) return '';
    let safe = escapeHtml(text);
    safe = safe.replace(/`([^`\n]+)`/g, '<code class="ai-inline-code">$1</code>');
    safe = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
}

/**
 * Resolves a trip ID from explicit trip_id, trip_name, or activeTripId fallback
 */
function resolveTripId(tripIdArg, tripNameArg, trips) {
    const list = trips || state.tripsList || [];
    if (tripIdArg && tripIdArg !== 'city-guide' && tripIdArg !== 'all-places') {
        const exact = list.find(t => String(t.id) === String(tripIdArg));
        if (exact) return exact.id;
    }
    if (tripNameArg) {
        const needle = tripNameArg.trim().toLowerCase();
        const byName = list.find(t => (t.name || '').toLowerCase() === needle)
            || list.find(t => (t.name || '').toLowerCase().includes(needle));
        if (byName) return byName.id;
    }
    if (state.activeTripId && state.activeTripId !== 'city-guide' && state.activeTripId !== 'all-places') {
        return state.activeTripId;
    }
    return list.length > 0 ? list[0].id : null;
}

/**
 * Resolves category_id and category name from state.categoriesList
 */
async function resolveExpenseCategory(categoryNameArg) {
    if (!state.categoriesList || state.categoriesList.length === 0) {
        state.categoriesList = await db.getCategories();
    }
    const cats = state.categoriesList || [];
    if (cats.length === 0) return { category_id: null, category: categoryNameArg || 'Diğer' };

    const needle = (categoryNameArg || '').trim().toLowerCase();
    const matched = (needle && (
        cats.find(c => c.name.toLowerCase() === needle) ||
        cats.find(c => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()))
    )) || cats.find(c => c.name.toLowerCase().includes('diğer')) || cats[0];

    return {
        category_id: matched.id,
        category: matched.name
    };
}

/**
 * Builds the Gemini system instruction with live app context
 */
function buildSystemInstruction() {
    const today = new Date().toISOString().split('T')[0];
    const currentHash = window.location.hash || '#dashboard';
    const tripsSummary = (state.tripsList || []).map(t =>
        `- "${t.name}" (id: ${t.id}, ${t.start_date || '?'} - ${t.end_date || '?'}, bütçe: ${t.budget || 0} ${t.currency || 'TRY'})`
    ).join('\n') || '- Henüz kayıtlı seyahat yok';

    const placeCats = Object.entries(PLACE_CATEGORIES)
        .map(([k, v]) => `${k} (${v.name})`)
        .join(', ');

    const expenseCats = (state.categoriesList || []).map(c => c.name).join(', ') || 'Yemek, Konaklama, Ulaşım, Aktivite, Alışveriş, Diğer';

    return `Sen TravellerMobi uygulamasının yerleşik akıllı seyahat, şehir rehberi ve bütçe asistanısın.
Kullanıcıyla doğal, net ve yardımcı bir Türkçe ile konuş.

BUGÜNÜN TARİHİ: ${today}
AÇIK EKRAN: ${currentHash}
AKTİF SEYAHAT CONTEXT: ${state.activeTripId || 'Genel'} (${getActiveTripContextLabel()})
VARSAYILAN PARA BİRİMİ: ${config.defaultCurrency || 'TRY'}

MEVCUT SEYAHATLER:
${tripsSummary}

MEKAN KATEGORİLERİ (add_places için sadece bu anahtarları kullan):
${placeCats}

MASRAF KATEGORİLERİ:
${expenseCats}

DAVRANIŞ KURALLARI:
1. Kullanıcı bir yer, rota, masraf, seyahat veya anı sormak/incelemek istediğinde önce ilgili okuma aracını (list_trips, list_places, list_expenses, list_memories) çağırıp gerçek veriye göre yanıt ver.
2. Kullanıcı "ekle", "kaydet", "planla", "oluştur", "gittim işaretle", "masraf yaz", "anı ekle" gibi bir işlem istediğinde uygun yazma aracını (add_places, create_trip, update_place_status, add_expense, add_memory) çağır.
3. add_places çağırırken her mekan için GERÇEKÇİ ve DOĞRU latitude/longitude koordinatları, doğru category kodu, adres, kısa not, ne denenmeli (must_try) ve varsa tahmini maliyet (estimated_cost, currency) bilgilerini doldur.
4. Kullanıcı "Şehir Rehberi'ne" veya genel bir günlük mekana (belirli bir seyahate değil) eklemek isterse target: "city-guide" kullan. Belirli bir seyahat adı verirse target: "trip" ve trip_id / trip_name belirt. Belirtmezse aktif seyahati (veya Şehir Rehberi aktifse city-guide) seç.
5. Kullanıcı aynı anda hem yeni seyahat açıp hem içine mekan eklemek isterse create_trip ile birlikte add_places çağırabilirsin (trip_name alanını yeni seyahat adıyla aynı ver).
6. Yazma araçları kullanıcıya onay kartı olarak gösterilebilir veya otomatik uygulanabilir; tool response içinde dönen duruma göre kullanıcıya kısa ve net bilgi ver.`;
}

/**
 * Gemini Function Declarations
 */
function getToolDeclarations() {
    return [
        {
            functionDeclarations: [
                {
                    name: 'list_trips',
                    description: 'Kullanıcının tüm kayıtlı seyahatlerini (id, ad, tarihler, bütçe, para birimi, katılımcılar) listeler.',
                    parameters: { type: 'OBJECT', properties: {} }
                },
                {
                    name: 'list_places',
                    description: 'Kayıtlı mekanları listeler. Belirli bir seyahat, genel Şehir Rehberi veya tüm mekanlar için kullanılabilir.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            trip_id: {
                                type: 'STRING',
                                description: 'Opsiyonel. Seyahat UUID, "city-guide" (genel şehir rehberi) veya "all-places" (tüm mekanlar).'
                            }
                        }
                    }
                },
                {
                    name: 'list_expenses',
                    description: 'Masrafları ve toplam harcama özetini getirir.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            trip_id: {
                                type: 'STRING',
                                description: 'Opsiyonel seyahat UUID. Boş bırakılırsa tüm masraflar döner.'
                            }
                        }
                    }
                },
                {
                    name: 'list_memories',
                    description: 'Seyahat anılarını ve günlük notlarını getirir.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            trip_id: {
                                type: 'STRING',
                                description: 'Opsiyonel seyahat UUID.'
                            }
                        }
                    }
                },
                {
                    name: 'create_trip',
                    description: 'Yeni bir seyahat/rota planı oluşturur.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            name: { type: 'STRING', description: 'Seyahat adı (örn: Roma 2026)' },
                            start_date: { type: 'STRING', description: 'Başlangıç tarihi YYYY-MM-DD' },
                            end_date: { type: 'STRING', description: 'Bitiş tarihi YYYY-MM-DD' },
                            budget: { type: 'NUMBER', description: 'Toplam bütçe tutarı' },
                            currency: { type: 'STRING', enum: ['TRY', 'EUR', 'USD', 'GBP'], description: 'Para birimi' },
                            participants: {
                                type: 'ARRAY',
                                items: { type: 'STRING' },
                                description: 'Katılımcı isimleri listesi'
                            }
                        },
                        required: ['name', 'start_date', 'end_date']
                    }
                },
                {
                    name: 'add_places',
                    description: 'Genel Şehir Rehberine veya bir seyahate bir ya da daha fazla mekan ekler.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            target: {
                                type: 'STRING',
                                enum: ['city-guide', 'trip'],
                                description: '"city-guide" genel şehir rehberi için, "trip" belirli bir seyahat için.'
                            },
                            trip_id: { type: 'STRING', description: 'Hedef seyahat UUID (varsa)' },
                            trip_name: { type: 'STRING', description: 'Hedef seyahat adı (trip_id bilinmiyorsa veya yeni oluşturuluyorsa)' },
                            places: {
                                type: 'ARRAY',
                                description: 'Eklenecek mekanlar listesi',
                                items: {
                                    type: 'OBJECT',
                                    properties: {
                                        name: { type: 'STRING', description: 'Mekan adı' },
                                        category: {
                                            type: 'STRING',
                                            enum: ['cafe', 'food', 'bar', 'bakery', 'viewpoint', 'museum', 'historical', 'shopping', 'hotel', 'other']
                                        },
                                        latitude: { type: 'NUMBER', description: 'Enlem (ondalıklı derece)' },
                                        longitude: { type: 'NUMBER', description: 'Boylam (ondalıklı derece)' },
                                        address: { type: 'STRING', description: 'Semt / cadde / şehir adresi' },
                                        status: { type: 'STRING', enum: ['planned', 'visited'], description: 'planned = istek listesi, visited = gidildi' },
                                        must_try: { type: 'STRING', description: 'Burada ne denenmeli / öne çıkan tavsiye' },
                                        tags: {
                                            type: 'ARRAY',
                                            items: { type: 'STRING' },
                                            description: 'Kısa etiketler'
                                        },
                                        estimated_cost: { type: 'NUMBER', description: 'Tahmini giriş/kişi başı tutar' },
                                        currency: { type: 'STRING', enum: ['EUR', 'USD', 'TRY', 'GBP'] },
                                        notes: { type: 'STRING', description: 'Kısa gezi notu veya ipucu' }
                                    },
                                    required: ['name', 'category', 'latitude', 'longitude']
                                }
                            }
                        },
                        required: ['target', 'places']
                    }
                },
                {
                    name: 'update_place_status',
                    description: 'Mevcut bir mekanın durumunu Gidildi (visited) veya İstek (planned) olarak günceller.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            place_id: { type: 'STRING', description: 'Mekan UUID (biliniyorsa)' },
                            place_name: { type: 'STRING', description: 'Mekan adı' },
                            status: { type: 'STRING', enum: ['visited', 'planned'] }
                        },
                        required: ['status']
                    }
                },
                {
                    name: 'add_expense',
                    description: 'Bir seyahate yeni bir harcama/masraf kaydı ekler.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            trip_id: { type: 'STRING', description: 'Seyahat UUID (varsa)' },
                            trip_name: { type: 'STRING', description: 'Seyahat adı' },
                            title: { type: 'STRING', description: 'Harcama açıklaması' },
                            amount: { type: 'NUMBER', description: 'Tutar' },
                            currency: { type: 'STRING', enum: ['TRY', 'EUR', 'USD', 'GBP'] },
                            category_name: { type: 'STRING', description: 'Kategori adı (örn: Yemek, Konaklama, Ulaşım, Aktivite, Alışveriş, Diğer)' },
                            date: { type: 'STRING', description: 'Tarih YYYY-MM-DD (varsayılan bugün)' },
                            paid_by: { type: 'STRING', description: 'Ödeyen kişi (opsiyonel)' }
                        },
                        required: ['title', 'amount', 'currency']
                    }
                },
                {
                    name: 'add_memory',
                    description: 'Bir seyahate anı / günlük notu ekler.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            trip_id: { type: 'STRING', description: 'Seyahat UUID (varsa)' },
                            trip_name: { type: 'STRING', description: 'Seyahat adı' },
                            title: { type: 'STRING', description: 'Anı başlığı' },
                            description: { type: 'STRING', description: 'Anı metni / detaylar' },
                            location: { type: 'STRING', description: 'Konum adı' },
                            date: { type: 'STRING', description: 'Tarih YYYY-MM-DD' }
                        },
                        required: ['title']
                    }
                }
            ]
        }
    ];
}

const READ_TOOLS = new Set(['list_trips', 'list_places', 'list_expenses', 'list_memories']);

async function executeReadTool(name, args = {}) {
    if (name === 'list_trips') {
        const trips = await db.getTrips();
        state.tripsList = trips;
        return {
            count: trips.length,
            active_trip_id: state.activeTripId,
            trips: trips.map(t => ({
                id: t.id,
                name: t.name,
                start_date: t.start_date,
                end_date: t.end_date,
                budget: t.budget,
                currency: t.currency,
                participants: t.participants || []
            }))
        };
    }

    if (name === 'list_places') {
        const targetId = args.trip_id || 'all-places';
        const places = await db.getPlaces(targetId);
        return {
            count: places.length,
            places: places.slice(0, 60).map(p => ({
                id: p.id,
                name: p.name,
                category: p.category,
                status: p.status,
                trip_id: p.trip_id || 'city-guide',
                address: p.address,
                latitude: p.latitude,
                longitude: p.longitude,
                rating: p.rating,
                estimated_cost: p.estimated_cost,
                currency: p.currency,
                notes: p.notes
            }))
        };
    }

    if (name === 'list_expenses') {
        if (!state.categoriesList || state.categoriesList.length === 0) {
            state.categoriesList = await db.getCategories();
        }
        const expenses = await db.getExpenses(args.trip_id || null);
        const baseCur = config.defaultCurrency || 'TRY';
        let totalBase = 0;
        const mapped = expenses.slice(0, 60).map(e => {
            const amt = Number(e.amount) || 0;
            const cur = e.currency || baseCur;
            totalBase += convertCurrency(amt, cur, baseCur);
            const cat = (state.categoriesList || []).find(c => c.id === e.category_id);
            return {
                id: e.id,
                trip_id: e.trip_id,
                title: e.title,
                amount: amt,
                currency: cur,
                category: cat ? cat.name : (e.category || 'Diğer'),
                date: e.date,
                paid_by: e.paid_by
            };
        });
        return {
            count: expenses.length,
            base_currency: baseCur,
            total_in_base_currency: Number(totalBase.toFixed(2)),
            expenses: mapped
        };
    }

    if (name === 'list_memories') {
        const memories = await db.getMemories(args.trip_id || null);
        return {
            count: memories.length,
            memories: memories.slice(0, 30).map(m => ({
                id: m.id,
                trip_id: m.trip_id,
                title: m.title,
                location: m.location,
                date: m.date,
                description: m.description
            }))
        };
    }

    return { error: `Bilinmeyen okuma aracı: ${name}` };
}

/**
 * Executes a single write action against Supabase/local cache via db.js
 */
async function executeWriteAction(action, runtimeTrips) {
    const { name, args = {} } = action;
    const trips = runtimeTrips || state.tripsList || [];

    if (name === 'create_trip') {
        const created = await db.createTrip({
            name: args.name,
            start_date: args.start_date || new Date().toISOString().split('T')[0],
            end_date: args.end_date || args.start_date || new Date().toISOString().split('T')[0],
            budget: Number(args.budget) || 0,
            currency: args.currency || config.defaultCurrency || 'EUR',
            participants: Array.isArray(args.participants) ? args.participants : []
        });
        state.tripsList = await db.getTrips();
        if (created?.id) {
            state.activeTripId = created.id;
        }
        return { type: 'trips', message: `Seyahat oluşturuldu: ${created.name}`, createdTrip: created };
    }

    if (name === 'add_places') {
        const isCityGuide = args.target === 'city-guide';
        const resolvedTripId = isCityGuide ? null : resolveTripId(args.trip_id, args.trip_name, trips);
        const placesInput = Array.isArray(args.places) ? args.places : [];
        let savedCount = 0;

        for (const p of placesInput) {
            const lat = Number(p.latitude);
            const lng = Number(p.longitude);
            if (!p.name || !isValidCoord(lat, lng)) continue;

            const category = PLACE_CATEGORIES[p.category] ? p.category : 'other';
            const tagsArray = Array.isArray(p.tags) ? p.tags.map(t => String(t).trim()).filter(Boolean) : [];
            const mustTry = (p.must_try || '').trim();
            let finalNotes = (p.notes || '').trim();

            if (mustTry) {
                finalNotes = `[Tavsiye: ${mustTry}]\n` + finalNotes;
            }
            if (tagsArray.length > 0) {
                finalNotes = `[Etiketler: ${tagsArray.join(', ')}]\n` + finalNotes;
            }

            await db.createPlace({
                trip_id: resolvedTripId,
                name: p.name.trim(),
                category,
                status: p.status === 'visited' ? 'visited' : 'planned',
                latitude: lat,
                longitude: lng,
                address: (p.address || '').trim(),
                notes: finalNotes.trim(),
                estimated_cost: Number(p.estimated_cost) || 0,
                currency: p.currency || 'EUR',
                must_try: mustTry,
                tags: tagsArray
            });
            savedCount++;
        }

        if (resolvedTripId && state.activeTripId !== 'all-places') {
            state.activeTripId = resolvedTripId;
        } else if (isCityGuide && state.activeTripId !== 'all-places') {
            state.activeTripId = 'city-guide';
        }

        return { type: 'places', message: `${savedCount} mekan kaydedildi` };
    }

    if (name === 'update_place_status') {
        const allPlaces = await db.getPlaces('all-places');
        let targetPlace = null;
        if (args.place_id) {
            targetPlace = allPlaces.find(p => String(p.id) === String(args.place_id));
        }
        if (!targetPlace && args.place_name) {
            const needle = args.place_name.trim().toLowerCase();
            targetPlace = allPlaces.find(p => (p.name || '').toLowerCase() === needle)
                || allPlaces.find(p => (p.name || '').toLowerCase().includes(needle));
        }
        if (!targetPlace) {
            throw new Error(`Mekan bulunamadı: ${args.place_name || args.place_id}`);
        }
        const newStatus = args.status === 'visited' ? 'visited' : 'planned';
        await db.updatePlaceStatus(targetPlace.id, newStatus);
        return { type: 'places', message: `"${targetPlace.name}" durumu güncellendi` };
    }

    if (name === 'add_expense') {
        const targetTripId = resolveTripId(args.trip_id, args.trip_name, trips);
        if (!targetTripId) {
            throw new Error('Masraf eklemek için önce bir seyahat oluşturmalısınız.');
        }
        const catInfo = await resolveExpenseCategory(args.category_name);
        const tripObj = trips.find(t => String(t.id) === String(targetTripId));
        const defaultPayer = (tripObj?.participants && tripObj.participants.length > 0)
            ? tripObj.participants[0]
            : (state.activeUser?.email || null);

        await db.createExpense({
            trip_id: targetTripId,
            title: args.title || 'Harcama',
            amount: Number(args.amount) || 0,
            currency: args.currency || tripObj?.currency || config.defaultCurrency || 'TRY',
            category: catInfo.category,
            category_id: catInfo.category_id,
            date: args.date || new Date().toISOString().split('T')[0],
            paid_by: args.paid_by || defaultPayer,
            split_with: tripObj?.participants || []
        });
        return { type: 'expenses', message: `Masraf eklendi: ${args.title}` };
    }

    if (name === 'add_memory') {
        const targetTripId = resolveTripId(args.trip_id, args.trip_name, trips);
        if (!targetTripId) {
            throw new Error('Anı eklemek için önce bir seyahat oluşturmalısınız.');
        }
        await db.createMemory({
            trip_id: targetTripId,
            title: args.title || 'Seyahat Anısı',
            description: args.description || '',
            location: args.location || '',
            date: args.date || new Date().toISOString().split('T')[0]
        });
        return { type: 'memories', message: `Anı kaydedildi: ${args.title}` };
    }

    throw new Error(`Desteklenmeyen işlem: ${name}`);
}

/**
 * Executes a batch of write actions sequentially (so create_trip + add_places work together)
 */
async function executeActionBatch(actions) {
    let currentTrips = await db.getTrips();
    state.tripsList = currentTrips;
    const mutatedTypes = new Set();
    const results = [];

    for (const action of actions) {
        const res = await executeWriteAction(action, currentTrips);
        mutatedTypes.add(res.type);
        results.push(res.message);
        if (res.createdTrip) {
            currentTrips = state.tripsList;
        }
    }

    window.dispatchEvent(new CustomEvent('ai-data-mutated', {
        detail: { types: Array.from(mutatedTypes) }
    }));

    return results;
}

/**
 * Human-readable summary item for confirmation cards
 */
function describeAction(action) {
    const { name, args = {} } = action;
    if (name === 'create_trip') {
        return {
            icon: 'compass',
            title: `Yeni Seyahat: ${args.name || 'Seyahat'}`,
            subtitle: `${args.start_date || '?'} → ${args.end_date || '?'} • Bütçe: ${args.budget || 0} ${args.currency || 'EUR'}`
        };
    }
    if (name === 'add_places') {
        const count = Array.isArray(args.places) ? args.places.length : 0;
        const targetLabel = args.target === 'city-guide'
            ? 'Şehir Rehberi (Genel)'
            : (args.trip_name || getActiveTripContextLabel());
        const names = (args.places || []).slice(0, 4).map(p => p.name).join(', ');
        const extra = count > 4 ? ` +${count - 4} daha` : '';
        return {
            icon: 'map-pin',
            title: `${count} Mekan → ${targetLabel}`,
            subtitle: `${names}${extra}`
        };
    }
    if (name === 'update_place_status') {
        const statusText = args.status === 'visited' ? 'Gidildi' : 'İstek Listesi';
        return {
            icon: 'check-circle',
            title: `Durum Güncelleme: ${args.place_name || 'Mekan'}`,
            subtitle: `Yeni durum: ${statusText}`
        };
    }
    if (name === 'add_expense') {
        return {
            icon: 'wallet',
            title: `Masraf: ${args.title || 'Harcama'}`,
            subtitle: `${args.amount || 0} ${args.currency || 'TRY'} • ${args.category_name || 'Diğer'}`
        };
    }
    if (name === 'add_memory') {
        return {
            icon: 'book-open',
            title: `Anı: ${args.title || 'Günlük Notu'}`,
            subtitle: args.location ? `Konum: ${args.location}` : (args.date || 'Bugün')
        };
    }
    return { icon: 'sparkles', title: name, subtitle: '' };
}

/**
 * Calls Gemini REST API generateContent
 */
async function callGeminiAPI(contents) {
    const apiKey = (config.geminiApiKey || '').trim();
    const model = (config.geminiModel || 'gemini-2.5-flash').trim();
    if (!apiKey) {
        throw new Error('Gemini API anahtarı bulunamadı. Lütfen yukarıdan veya Ayarlar sayfasından anahtarınızı girin.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction: {
                parts: [{ text: buildSystemInstruction() }]
            },
            contents,
            tools: getToolDeclarations(),
            toolConfig: {
                functionCallingConfig: { mode: 'AUTO' }
            }
        })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const msg = data?.error?.message || `HTTP ${response.status}`;
        throw new Error(`Gemini API Hatası: ${msg}`);
    }

    const candidate = data?.candidates?.[0];
    if (!candidate || !candidate.content) {
        throw new Error('Gemini boş bir yanıt döndürdü.');
    }

    return candidate.content;
}

/**
 * Sends a user prompt through Gemini multi-turn tool loop
 */
async function sendPromptToGemini(userText) {
    if (isSending) return;
    const text = (userText || '').trim();
    if (!text) return;

    if (!config.geminiApiKey) {
        showToast('Önce Gemini API anahtarınızı kaydetmelisiniz.', 'warning');
        syncKeyBannerVisibility();
        return;
    }

    isSending = true;
    setSendingUIState(true);

    const userMsg = {
        id: `u_${Date.now()}`,
        role: 'user',
        text
    };
    chatMessages.push(userMsg);
    geminiHistory.push({ role: 'user', parts: [{ text }] });
    if (geminiHistory.length > MAX_HISTORY_TURNS) {
        geminiHistory = geminiHistory.slice(-MAX_HISTORY_TURNS);
    }
    renderChatMessages();

    const collectedToolChips = [];
    const queuedWriteActions = [];
    let finalAssistantText = '';

    try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const modelContent = await callGeminiAPI(geminiHistory);
            geminiHistory.push({
                role: 'model',
                parts: modelContent.parts || []
            });

            const parts = modelContent.parts || [];
            const fnCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
            const textParts = parts.filter(p => typeof p.text === 'string').map(p => p.text).join('\n').trim();

            if (textParts) {
                finalAssistantText = textParts;
            }

            if (fnCalls.length === 0) {
                break;
            }

            const functionResponseParts = [];
            for (const fc of fnCalls) {
                if (READ_TOOLS.has(fc.name)) {
                    const result = await executeReadTool(fc.name, fc.args || {});
                    collectedToolChips.push(formatReadChip(fc.name, result));
                    functionResponseParts.push({
                        functionResponse: {
                            name: fc.name,
                            response: result
                        }
                    });
                } else {
                    const writeAction = { name: fc.name, args: fc.args || {} };
                    if (config.geminiAutoApply) {
                        try {
                            const appliedMessages = await executeActionBatch([writeAction]);
                            collectedToolChips.push(`✓ ${appliedMessages.join(', ')}`);
                            functionResponseParts.push({
                                functionResponse: {
                                    name: fc.name,
                                    response: { status: 'applied', details: appliedMessages }
                                }
                            });
                        } catch (execErr) {
                            functionResponseParts.push({
                                functionResponse: {
                                    name: fc.name,
                                    response: { status: 'error', error: execErr.message }
                                }
                            });
                        }
                    } else {
                        queuedWriteActions.push(writeAction);
                        functionResponseParts.push({
                            functionResponse: {
                                name: fc.name,
                                response: {
                                    status: 'awaiting_user_confirmation',
                                    message: 'Kullanıcıya önizleme ve tek tık onay kartı gösterildi.'
                                }
                            }
                        });
                    }
                }
            }

            geminiHistory.push({
                role: 'function',
                parts: functionResponseParts
            });
        }

        const assistantMsg = {
            id: `a_${Date.now()}`,
            role: 'assistant',
            text: finalAssistantText || (queuedWriteActions.length > 0 ? 'Önerilen işlemleri aşağıdan onaylayıp kaydedebilirsiniz:' : 'Tamamlandı.'),
            toolChips: collectedToolChips,
            pendingActions: queuedWriteActions,
            actionStatus: queuedWriteActions.length > 0 ? 'pending' : null
        };
        chatMessages.push(assistantMsg);
    } catch (err) {
        console.error('AI Assistant error:', err);
        chatMessages.push({
            id: `e_${Date.now()}`,
            role: 'assistant',
            text: err.message || 'Bir hata oluştu.',
            error: true
        });
    } finally {
        isSending = false;
        setSendingUIState(false);
        saveChatSession();
        renderChatMessages();
    }
}

function formatReadChip(toolName, result) {
    if (toolName === 'list_trips') return `🧭 ${result.count || 0} seyahat incelendi`;
    if (toolName === 'list_places') return `📍 ${result.count || 0} mekan incelendi`;
    if (toolName === 'list_expenses') return `💳 ${result.count || 0} masraf incelendi`;
    if (toolName === 'list_memories') return `📸 ${result.count || 0} anı incelendi`;
    return `✓ ${toolName}`;
}

function setSendingUIState(busy) {
    const sendBtn = document.getElementById('btn-ai-send');
    const input = document.getElementById('ai-chat-input');
    const typingEl = document.getElementById('ai-typing-indicator');
    if (sendBtn) sendBtn.disabled = busy;
    if (input) input.disabled = busy;
    if (typingEl) typingEl.classList.toggle('hidden', !busy);
}

function renderChatMessages() {
    const listEl = document.getElementById('ai-chat-messages');
    if (!listEl) return;

    syncKeyBannerVisibility();

    if (chatMessages.length === 0) {
        listEl.innerHTML = `
            <div class="ai-welcome-box">
                <div class="ai-welcome-glow"></div>
                <div class="ai-welcome-icon"><i data-lucide="sparkles"></i></div>
                <h4>TravellerMobi AI Asistan</h4>
                <p>Doğal dille yaz; mekanları haritana, harcamaları bütçene ve anılarını günlüğüne doğrudan işleyeyim.</p>
                <div class="ai-capability-grid">
                    <span class="ai-cap-pill"><i data-lucide="map-pin"></i> Mekan & Rehber</span>
                    <span class="ai-cap-pill"><i data-lucide="compass"></i> Seyahat & Rota</span>
                    <span class="ai-cap-pill"><i data-lucide="wallet"></i> Masraf & Bütçe</span>
                    <span class="ai-cap-pill"><i data-lucide="book-open"></i> Anı & Not</span>
                </div>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    listEl.innerHTML = chatMessages.map(msg => {
        if (msg.role === 'user') {
            return `
                <div class="ai-msg ai-msg-user">
                    <div class="ai-msg-bubble">${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>
                </div>
            `;
        }

        const chipsHtml = (msg.toolChips && msg.toolChips.length > 0)
            ? `<div class="ai-tool-chips">${msg.toolChips.map(c => `<span class="ai-tool-chip">${escapeHtml(c)}</span>`).join('')}</div>`
            : '';

        let actionsHtml = '';
        if (msg.pendingActions && msg.pendingActions.length > 0) {
            const itemsHtml = msg.pendingActions.map(act => {
                const desc = describeAction(act);
                return `
                    <div class="ai-action-item">
                        <i data-lucide="${desc.icon}"></i>
                        <div>
                            <strong>${escapeHtml(desc.title)}</strong>
                            ${desc.subtitle ? `<span>${escapeHtml(desc.subtitle)}</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

            let footerHtml = '';
            if (msg.actionStatus === 'pending') {
                footerHtml = `
                    <div class="ai-action-buttons">
                        <button type="button" class="btn btn-primary btn-sm btn-ai-confirm-action" data-msg-id="${msg.id}">
                            <i data-lucide="check"></i> Onayla & Kaydet
                        </button>
                        <button type="button" class="btn btn-secondary btn-sm btn-ai-cancel-action" data-msg-id="${msg.id}">
                            Vazgeç
                        </button>
                    </div>
                `;
            } else if (msg.actionStatus === 'applied') {
                footerHtml = `<div class="ai-action-done"><i data-lucide="check-circle"></i> Uygulandı ve kaydedildi</div>`;
            } else if (msg.actionStatus === 'cancelled') {
                footerHtml = `<div class="ai-action-cancelled">İptal edildi</div>`;
            }

            actionsHtml = `
                <div class="ai-action-card">
                    ${itemsHtml}
                    ${footerHtml}
                </div>
            `;
        }

        return `
            <div class="ai-msg ai-msg-assistant ${msg.error ? 'is-error' : ''}">
                <div class="ai-msg-avatar-mini"><i data-lucide="sparkles"></i></div>
                <div class="ai-msg-bubble">
                    ${chipsHtml}
                    <div class="ai-msg-text">${formatAssistantText(msg.text)}</div>
                    ${actionsHtml}
                </div>
            </div>
        `;
    }).join('');

    // Bind confirmation buttons
    listEl.querySelectorAll('.btn-ai-confirm-action').forEach(btn => {
        btn.addEventListener('click', async () => {
            const msgId = btn.getAttribute('data-msg-id');
            const msg = chatMessages.find(m => m.id === msgId);
            if (!msg || !msg.pendingActions || msg.actionStatus !== 'pending') return;

            btn.disabled = true;
            btn.textContent = 'Kaydediliyor...';
            try {
                const summary = await executeActionBatch(msg.pendingActions);
                msg.actionStatus = 'applied';
                saveChatSession();
                renderChatMessages();
                showToast(summary.join(' • '), 'success');
            } catch (err) {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="check"></i> Onayla & Kaydet';
                if (window.lucide) window.lucide.createIcons();
                showToast('İşlem uygulanamadı: ' + err.message, 'danger');
            }
        });
    });

    listEl.querySelectorAll('.btn-ai-cancel-action').forEach(btn => {
        btn.addEventListener('click', () => {
            const msgId = btn.getAttribute('data-msg-id');
            const msg = chatMessages.find(m => m.id === msgId);
            if (!msg || msg.actionStatus !== 'pending') return;
            msg.actionStatus = 'cancelled';
            saveChatSession();
            renderChatMessages();
        });
    });

    if (window.lucide) window.lucide.createIcons();
    listEl.scrollTop = listEl.scrollHeight;
}

export function openAiChatbox() {
    const panel = document.getElementById('ai-chatbox-panel');
    const backdrop = document.getElementById('ai-chatbox-backdrop');
    const fab = document.getElementById('btn-ai-fab');
    if (backdrop) backdrop.classList.remove('hidden');
    if (panel) panel.classList.remove('hidden');
    if (fab) fab.classList.add('is-open');
    lockBackgroundScroll();
    updateContextSubtitle();
    syncKeyBannerVisibility();
    renderChatMessages();
    const input = document.getElementById('ai-chat-input');
    if (input && config.geminiApiKey) {
        setTimeout(() => input.focus({ preventScroll: true }), 100);
    }
}

export function closeAiChatbox() {
    const panel = document.getElementById('ai-chatbox-panel');
    const backdrop = document.getElementById('ai-chatbox-backdrop');
    const fab = document.getElementById('btn-ai-fab');
    if (panel) panel.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
    if (fab) fab.classList.remove('is-open');
    unlockBackgroundScroll();
}

export function setAiLauncherVisible(visible) {
    const fab = document.getElementById('btn-ai-fab');
    if (fab) fab.classList.toggle('hidden', !visible);
    if (visible) {
        loadChatSession();
        updateContextSubtitle();
    } else {
        closeAiChatbox();
    }
}

export function initAiAssistant() {
    loadChatSession();

    const fab = document.getElementById('btn-ai-fab');
    const panel = document.getElementById('ai-chatbox-panel');
    const backdrop = document.getElementById('ai-chatbox-backdrop');
    const messagesEl = document.getElementById('ai-chat-messages');
    const closeBtn = document.getElementById('btn-ai-close');
    const clearBtn = document.getElementById('btn-ai-clear');
    const form = document.getElementById('ai-chat-form');
    const input = document.getElementById('ai-chat-input');
    const autoToggle = document.getElementById('ai-auto-apply-toggle');
    const inlineKeyForm = document.getElementById('ai-inline-key-form');
    const quickPromptsEl = document.getElementById('ai-quick-prompts');

    if (fab && panel) {
        fab.addEventListener('click', () => {
            if (panel.classList.contains('hidden')) openAiChatbox();
            else closeAiChatbox();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeAiChatbox);
    }

    if (backdrop) {
        backdrop.addEventListener('click', closeAiChatbox);
        backdrop.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    if (panel && messagesEl) {
        panel.addEventListener('wheel', (e) => {
            const insideMessages = messagesEl.contains(e.target);
            if (!insideMessages) {
                e.preventDefault();
                return;
            }
            const atTop = messagesEl.scrollTop <= 0 && e.deltaY < 0;
            const atBottom = messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - 1 && e.deltaY > 0;
            if (atTop || atBottom) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', syncVisualViewportHeight);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel && !panel.classList.contains('hidden')) {
            closeAiChatbox();
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            chatMessages = [];
            geminiHistory = [];
            saveChatSession();
            renderChatMessages();
        });
    }

    if (autoToggle) {
        autoToggle.checked = !!config.geminiAutoApply;
        autoToggle.addEventListener('change', (e) => {
            saveGeminiAutoApply(e.target.checked);
            showToast(
                e.target.checked
                    ? 'Otomatik kaydet açıldı: AI işlemleri onay sormadan uygulanacak.'
                    : 'Önizleme ve onay modu açıldı.',
                'info'
            );
        });
    }

    if (inlineKeyForm) {
        inlineKeyForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const keyInput = document.getElementById('ai-inline-key-input');
            const val = (keyInput?.value || '').trim();
            if (!val) {
                showToast('Lütfen geçerli bir Gemini API anahtarı girin.', 'warning');
                return;
            }
            saveGeminiConfig(val, config.geminiModel);
            if (keyInput) keyInput.value = '';
            window.dispatchEvent(new CustomEvent('gemini-config-updated'));
            syncKeyBannerVisibility();
            showToast('Gemini API anahtarı cihaza kaydedildi!', 'success');
        });
    }

    if (quickPromptsEl) {
        quickPromptsEl.addEventListener('click', (e) => {
            const chip = e.target.closest('.ai-quick-chip');
            if (!chip) return;
            const prompt = chip.getAttribute('data-prompt') || '';
            const mode = chip.getAttribute('data-mode') || 'prefill';
            if (mode === 'send') {
                sendPromptToGemini(prompt);
            } else if (input) {
                input.value = prompt;
                autoResizeTextarea(input);
                input.focus({ preventScroll: true });
            }
        });
    }

    if (form && input) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text || isSending) return;
            input.value = '';
            autoResizeTextarea(input);
            await sendPromptToGemini(text);
        });

        input.addEventListener('input', () => autoResizeTextarea(input));

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                form.dispatchEvent(new Event('submit', { cancelable: true }));
            }
        });
    }

    window.addEventListener('gemini-config-updated', () => {
        syncKeyBannerVisibility();
        updateContextSubtitle();
    });

    window.addEventListener('hashchange', () => {
        updateContextSubtitle();
    });

    renderChatMessages();
    updateContextSubtitle();
}
