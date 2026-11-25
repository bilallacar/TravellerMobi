// js/modules/settings.js

import { state } from '../state.js';
import { config, savePreferences, saveGeminiConfig } from '../../config.js';
import * as db from '../../db.js';
import { showToast, escapeHtml } from '../utils.js';
import { hasAnalyticsConsent, setAnalyticsConsent } from './analytics.js';
import { setAiLauncherVisible } from './ai_assistant.js';
import { clearAdminViewState } from './admin.js';

export async function loadSettingsForm() {
    const currencySelect = document.getElementById('settings-base-currency');

    if (currencySelect) currencySelect.value = config.defaultCurrency || 'TRY';

    const geminiKeyInput = document.getElementById('settings-gemini-key');
    const geminiModelSelect = document.getElementById('settings-gemini-model');
    if (geminiKeyInput) geminiKeyInput.value = config.geminiApiKey || '';
    if (geminiModelSelect) geminiModelSelect.value = config.geminiModel || 'gemini-2.5-flash';

    const consentToggle = document.getElementById('settings-analytics-consent-toggle');
    if (consentToggle) consentToggle.checked = hasAnalyticsConsent();

    // Highlights active theme button style
    const isDark = config.theme === 'dark';
    
    const btnDark = document.getElementById('btn-theme-dark');
    const btnLight = document.getElementById('btn-theme-light');
    if (btnDark) btnDark.className = isDark ? 'btn btn-primary' : 'btn btn-secondary';
    if (btnLight) btnLight.className = !isDark ? 'btn btn-primary' : 'btn btn-secondary';

    // RENDER SENSITIVE ADMIN SECTIONS ONLY IF USER IS ADMIN
    renderAdminOnlySections();

    if (state.isAdmin) {
        state.categoriesList = await db.getCategories();
        renderSettingsCategories();
    }
}

export function renderAdminOnlySections() {
    const adminCard = document.getElementById('settings-admin-card');
    const categoriesCard = document.getElementById('settings-categories-card');

    if (state.isAdmin) {
        if (adminCard) adminCard.classList.remove('hidden');
        if (categoriesCard) categoriesCard.classList.remove('hidden');
    } else {
        if (adminCard) adminCard.classList.add('hidden');
        if (categoriesCard) categoriesCard.classList.add('hidden');
    }
}

function renderSettingsCategories() {
    const listEl = document.getElementById('settings-categories-list');
    if (!listEl) return;

    if (state.categoriesList.length === 0) {
        listEl.innerHTML = `<tr><td colspan="3" class="text-center text-muted">Kayıtlı kategori bulunamadı.</td></tr>`;
        return;
    }

    const iconMapping = {
        tag: '🔖',
        utensils: '🍔',
        home: '🏨',
        plane: '✈️',
        ticket: '🎟',
        'shopping-bag': '🛍',
        archive: '📦'
    };

    listEl.innerHTML = state.categoriesList.map(c => {
        const safeColor = /^#[0-9a-fA-F]{3,8}$|^var\(--[a-zA-Z0-9-]+\)$/.test(String(c.color || '')) ? c.color : '#6366f1';
        const safeIcon = escapeHtml(c.icon || 'tag');
        const safeId = escapeHtml(c.id || '');
        return `
        <tr>
            <td>
                <span style="display:inline-block; width:24px; height:24px; border-radius:50%; background-color:${safeColor}; text-align:center; line-height:24px; margin-right:8px;">
                    ${iconMapping[c.icon] || '🔖'}
                </span>
            </td>
            <td><strong>${escapeHtml(c.name)}</strong></td>
            <td>
                <button class="btn btn-primary btn-sm btn-edit-category" data-id="${safeId}" data-name="${escapeHtml(c.name)}" data-icon="${safeIcon}" data-color="${escapeHtml(safeColor)}">Düzenle</button>
                <button class="btn btn-secondary btn-sm btn-delete-category" data-id="${safeId}">Sil</button>
            </td>
        </tr>
    `;
    }).join('');

    // Edit handlers
    listEl.querySelectorAll('.btn-edit-category').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            const icon = btn.getAttribute('data-icon');
            const color = btn.getAttribute('data-color');

            document.getElementById('edit-cat-id').value = id;
            document.getElementById('new-cat-name').value = name;
            document.getElementById('new-cat-icon').value = icon;
            document.getElementById('new-cat-color').value = color;

            const submitBtn = document.getElementById('btn-submit-category');
            if (submitBtn) submitBtn.innerHTML = '<i data-lucide="edit-3"></i> Kategori Güncelle';
            if (window.lucide) window.lucide.createIcons();

            const cancelBtn = document.getElementById('btn-cancel-edit-category');
            if (cancelBtn) cancelBtn.classList.remove('hidden');
        });
    });

    // Delete handlers
    listEl.querySelectorAll('.btn-delete-category').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (confirm('Bu kategoriyi silmek istediğinizden emin misiniz?')) {
                try {
                    await db.deleteCategory(id);
                    showToast('Kategori silindi', 'success');
                    state.categoriesList = await db.getCategories();
                    renderSettingsCategories();
                } catch (err) {
                    showToast('Hata: ' + err.message, 'danger');
                }
            }
        });
    });
}

function resetCategoryForm() {
    const form = document.getElementById('admin-category-form');
    if (form) {
        form.reset();
        const editIdInput = document.getElementById('edit-cat-id');
        if (editIdInput) editIdInput.value = '';
        const submitBtn = document.getElementById('btn-submit-category');
        if (submitBtn) submitBtn.innerHTML = '<i data-lucide="plus"></i> Kategori Ekle';
        if (window.lucide) window.lucide.createIcons();
        const cancelBtn = document.getElementById('btn-cancel-edit-category');
        if (cancelBtn) cancelBtn.classList.add('hidden');
    }
}

export function initSettingsEvents() {
    const settingsPrefForm = document.getElementById('settings-preferences-form');
    const geminiForm = document.getElementById('settings-gemini-form');
    if (geminiForm) {
        geminiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const keyVal = document.getElementById('settings-gemini-key')?.value || '';
            const modelVal = document.getElementById('settings-gemini-model')?.value || 'gemini-2.5-flash';
            saveGeminiConfig(keyVal, modelVal);
            window.dispatchEvent(new CustomEvent('gemini-config-updated'));
            showToast(keyVal.trim() ? 'Mobi AI ayarları cihaza kaydedildi' : 'Mobi AI API anahtarı temizlendi', 'success');
        });
    }

    const toggleGeminiKeyBtn = document.getElementById('btn-toggle-gemini-key');
    if (toggleGeminiKeyBtn) {
        toggleGeminiKeyBtn.addEventListener('click', () => {
            const keyInput = document.getElementById('settings-gemini-key');
            if (!keyInput) return;
            keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
        });
    }

    const clearGeminiKeyBtn = document.getElementById('btn-clear-gemini-key');
    if (clearGeminiKeyBtn) {
        clearGeminiKeyBtn.addEventListener('click', () => {
            const keyInput = document.getElementById('settings-gemini-key');
            const modelVal = document.getElementById('settings-gemini-model')?.value || 'gemini-2.5-flash';
            if (keyInput) keyInput.value = '';
            saveGeminiConfig('', modelVal);
            window.dispatchEvent(new CustomEvent('gemini-config-updated'));
            showToast('Mobi AI API anahtarı cihazdan silindi', 'info');
        });
    }
    if (settingsPrefForm) {
        settingsPrefForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const currency = document.getElementById('settings-base-currency').value;
            savePreferences(currency, config.theme);
            showToast('Tercihleriniz kaydedildi', 'success');
            // Notify dashboard to re-render
            window.dispatchEvent(new CustomEvent('dashboard-reload-needed'));
        });
    }

    const themeDark = document.getElementById('btn-theme-dark');
    const themeLight = document.getElementById('btn-theme-light');
    if (themeDark && themeLight) {
        themeDark.addEventListener('click', () => {
            document.body.className = 'dark-theme';
            savePreferences(config.defaultCurrency, 'dark');
            window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'dark' } }));
            loadSettingsForm();
        });
        themeLight.addEventListener('click', () => {
            document.body.className = 'light-theme';
            savePreferences(config.defaultCurrency, 'light');
            window.dispatchEvent(new CustomEvent('theme-changed', { detail: { theme: 'light' } }));
            loadSettingsForm();
        });
    }

    const exportBackupBtn = document.getElementById('btn-export-backup');
    if (exportBackupBtn) {
        exportBackupBtn.addEventListener('click', async () => {
            const prevHtml = exportBackupBtn.innerHTML;
            exportBackupBtn.disabled = true;
            exportBackupBtn.textContent = 'Hazırlanıyor...';
            try {
                const [trips, places, expenses, memories, categories] = await Promise.all([
                    db.getTrips(),
                    db.getPlaces(null),
                    db.getExpenses(null),
                    db.getMemories(null),
                    db.getCategories()
                ]);
                const payload = {
                    app: 'TravellerMobi',
                    exportedAt: new Date().toISOString(),
                    trips,
                    places,
                    expenses,
                    memories,
                    categories
                };
                const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `travellermobi-yedek-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                showToast('JSON yedeği indirildi.', 'success');
            } catch (err) {
                showToast('Yedek oluşturulamadı: ' + err.message, 'danger');
            } finally {
                exportBackupBtn.disabled = false;
                exportBackupBtn.innerHTML = prevHtml;
                if (window.lucide) window.lucide.createIcons();
            }
        });
    }

    // Password Change Form (Settings)
    const passwordForm = document.getElementById('settings-password-form');
    if (passwordForm) {
        passwordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const p1 = document.getElementById('settings-new-password')?.value || '';
            const p2 = document.getElementById('settings-new-password-confirm')?.value || '';
            const btn = document.getElementById('btn-settings-change-password');

            if (p1.length < 8) {
                showToast('Yeni şifreniz en az 8 karakter olmalıdır.', 'warning');
                return;
            }
            if (p1 !== p2) {
                showToast('Girdiğiniz şifreler eşleşmiyor.', 'danger');
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Güncelleniyor...';
            }
            try {
                await db.updateUserPassword(p1);
                passwordForm.reset();
                showToast('Şifreniz başarıyla güncellendi.', 'success');
            } catch (err) {
                showToast(err?.message || 'Şifre güncellenemedi.', 'danger');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Şifreyi Güncelle';
                }
            }
        });
    }

    // Analytics Consent Toggle (KVKK)
    const consentToggle = document.getElementById('settings-analytics-consent-toggle');
    if (consentToggle) {
        consentToggle.addEventListener('change', (e) => {
            const granted = !!e.target.checked;
            setAnalyticsConsent(granted ? 'granted' : 'denied');
            const banner = document.getElementById('privacy-notice-banner');
            if (banner) banner.classList.add('hidden');
            showToast(
                granted
                    ? 'İsteğe bağlı kullanım analitiği etkinleştirildi.'
                    : 'Analitik izni kapatıldı. Bundan sonra yalnızca zorunlu veriler kullanılır.',
                'info'
            );
        });
    }

    // Permanent Account & Data Deletion (KVKK)
    const deleteAccountForm = document.getElementById('settings-delete-account-form');
    if (deleteAccountForm) {
        deleteAccountForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const confirmInput = document.getElementById('settings-delete-confirm-input');
            const btn = document.getElementById('btn-settings-delete-account');
            const typed = (confirmInput?.value || '').trim().toLocaleUpperCase('tr-TR');

            if (typed !== 'SİL' && typed !== 'SIL') {
                showToast('Onaylamak için kutuya büyük harfle SİL yazmalısınız.', 'warning');
                return;
            }

            if (!confirm('Hesabınız ve tüm seyahat, harcama, mekan, anı ve fotoğraf verileriniz kalıcı olarak silinecek. Bu işlem geri alınamaz. Devam edilsin mi?')) {
                return;
            }

            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Hesap Siliniyor...';
            }
            try {
                await db.deleteOwnAccount();
                state.activeUser = null;
                state.userProfile = null;
                state.isAdmin = false;
                setAiLauncherVisible(false);
                clearAdminViewState();
                deleteAccountForm.reset();
                showToast('Hesabınız ve tüm kişisel verileriniz kalıcı olarak silindi.', 'info');
                window.location.hash = '#explore';
            } catch (err) {
                showToast(err?.message || 'Hesap silinemedi.', 'danger');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = 'Hesabımı ve Verilerimi Kalıcı Sil';
                }
            }
        });
    }

    const cancelCatBtn = document.getElementById('btn-cancel-edit-category');
    if (cancelCatBtn) {
        cancelCatBtn.addEventListener('click', () => {
            resetCategoryForm();
        });
    }

    const catForm = document.getElementById('admin-category-form');
    if (catForm) {
        catForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-cat-id').value;
            const name = document.getElementById('new-cat-name').value.trim();
            const icon = document.getElementById('new-cat-icon').value;
            const color = document.getElementById('new-cat-color').value;

            try {
                if (id) {
                    await db.updateCategory(id, name, icon, color);
                    showToast('Kategori başarıyla güncellendi', 'success');
                } else {
                    await db.createCategory(name, icon, color);
                    showToast('Yeni kategori başarıyla eklendi', 'success');
                }
                resetCategoryForm();
                state.categoriesList = await db.getCategories();
                renderSettingsCategories();
            } catch (err) {
                showToast('Hata: ' + err.message, 'danger');
            }
        });
    }
}
