// js/modules/settings.js

import { state } from '../state.js';
import { config, saveConfig, savePreferences } from '../../config.js';
import { initSupabase } from '../../db.js';
import * as db from '../../db.js';
import { showToast } from '../utils.js';

export async function loadSettingsForm() {
    const urlInput = document.getElementById('settings-supabase-url');
    const keyInput = document.getElementById('settings-supabase-key');
    const currencySelect = document.getElementById('settings-base-currency');

    if (urlInput) urlInput.value = config.supabaseUrl || '';
    if (keyInput) keyInput.value = config.supabaseKey || '';
    if (currencySelect) currencySelect.value = config.defaultCurrency || 'TRY';

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
    const sqlCard = document.getElementById('settings-sql-card');
    const apiCard = document.getElementById('settings-api-card');
    const adminCard = document.getElementById('settings-admin-card');
    const categoriesCard = document.getElementById('settings-categories-card');

    if (state.isAdmin) {
        if (sqlCard) sqlCard.classList.remove('hidden');
        if (apiCard) apiCard.classList.remove('hidden');
        if (adminCard) adminCard.classList.remove('hidden');
        if (categoriesCard) categoriesCard.classList.remove('hidden');
    } else {
        if (sqlCard) sqlCard.classList.add('hidden');
        if (apiCard) apiCard.classList.add('hidden');
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

    listEl.innerHTML = state.categoriesList.map(c => `
        <tr>
            <td>
                <span style="display:inline-block; width:24px; height:24px; border-radius:50%; background-color:${c.color}; text-align:center; line-height:24px; margin-right:8px;">
                    ${iconMapping[c.icon] || '🔖'}
                </span>
            </td>
            <td><strong>${escapeHTML(c.name)}</strong></td>
            <td>
                <button class="btn btn-primary btn-sm btn-edit-category" data-id="${c.id}" data-name="${escapeHTML(c.name)}" data-icon="${c.icon}" data-color="${c.color}">Düzenle</button>
                <button class="btn btn-secondary btn-sm btn-delete-category" data-id="${c.id}">Sil</button>
            </td>
        </tr>
    `).join('');

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
    const settingsApiForm = document.getElementById('settings-api-form');
    if (settingsApiForm) {
        settingsApiForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const url = document.getElementById('settings-supabase-url').value;
            const key = document.getElementById('settings-supabase-key').value;
            saveConfig(url, key);
            initSupabase();
            showToast('Bağlantı ayarları güncellendi', 'success');
            window.location.hash = '#dashboard';
        });
    }

    const settingsPrefForm = document.getElementById('settings-preferences-form');
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
            loadSettingsForm();
        });
        themeLight.addEventListener('click', () => {
            document.body.className = 'light-theme';
            savePreferences(config.defaultCurrency, 'light');
            loadSettingsForm();
        });
    }

    const copySqlBtn = document.getElementById('btn-copy-sql');
    if (copySqlBtn) {
        copySqlBtn.addEventListener('click', () => {
            const codeBlock = document.getElementById('sql-code-block');
            if (codeBlock) {
                navigator.clipboard.writeText(codeBlock.textContent.trim());
                showToast('SQL şeması panoya kopyalandı', 'success');
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

function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
