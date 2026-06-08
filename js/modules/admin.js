// js/modules/admin.js

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast } from '../utils.js';

export async function loadAdminData() {
    try {
        const profiles = await db.getAllProfiles();
        renderAdminUsers(profiles);
    } catch (err) {
        showToast('Üye listesi yüklenemedi: ' + err.message, 'danger');
    }
}

export function renderAdminUsers(profiles) {
    const listEl = document.getElementById('admin-users-list');
    if (!listEl) return;

    if (profiles.length === 0) {
        listEl.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Kayıtlı üye bulunmamaktadır.</td></tr>`;
        return;
    }

    listEl.innerHTML = profiles.map(profile => {
        let statusBadge = '';
        if (profile.status === 'approved') {
            statusBadge = '<span class="badge badge-activity">Onaylı</span>';
        } else if (profile.status === 'rejected') {
            statusBadge = '<span class="badge badge-food">Reddedildi</span>';
        } else {
            statusBadge = '<span class="badge" style="background-color: rgba(245, 158, 11, 0.15); color: #f59e0b;">Bekliyor</span>';
        }

        const isSelf = profile.id === state.activeUser?.id;

        return `
            <tr>
                <td>
                    <strong>${escapeHTML(profile.email)}</strong>
                    ${profile.is_admin ? ' <span class="badge badge-lodge" style="font-size:8px; padding:2px 4px;">Yönetici</span>' : ''}
                </td>
                <td>${formatDate(profile.created_at)}</td>
                <td>${statusBadge}</td>
                <td>
                    ${isSelf ? '<span class="text-muted">Aktif Oturum</span>' : `
                        <div style="display:flex; gap:8px;">
                            ${profile.status !== 'approved' ? `
                                <button class="btn btn-secondary btn-sm btn-approve-user" data-id="${profile.id}" style="background-color: var(--color-success-light); color: var(--color-success); padding: 6px 12px;">
                                    Onayla
                                </button>
                            ` : ''}
                            ${profile.status !== 'rejected' ? `
                                <button class="btn btn-secondary btn-sm btn-reject-user" data-id="${profile.id}" style="background-color: var(--color-danger-light); color: var(--color-danger); padding: 6px 12px;">
                                    Reddet
                                </button>
                            ` : ''}
                        </div>
                    `}
                </td>
            </tr>
        `;
    }).join('');

    // Bind click handlers
    document.querySelectorAll('.btn-approve-user').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            try {
                await db.updateProfileStatus(id, 'approved');
                showToast('Kullanıcı onaylandı', 'success');
                await loadAdminData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    });

    document.querySelectorAll('.btn-reject-user').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            try {
                await db.updateProfileStatus(id, 'rejected');
                showToast('Kullanıcı reddedildi', 'warning');
                await loadAdminData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

// Helpers
function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const options = { year: 'numeric', month: 'long', day: 'numeric' };
        return new Date(dateString).toLocaleDateString('tr-TR', options);
    } catch {
        return dateString;
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
