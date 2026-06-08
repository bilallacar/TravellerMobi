// js/modules/journal.js

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast, compressImage } from '../utils.js';

export async function loadJournalData() {
    state.tripsList = await db.getTrips();
    
    if (!state.activeTripId && state.tripsList.length > 0) {
        state.activeTripId = state.tripsList[0].id;
    }
    
    const filterSelect = document.getElementById('journal-trip-filter');
    const modalSelect = document.getElementById('memory-trip-id');
    
    const tripOptions = state.tripsList.map(t => `<option value="${t.id}" ${t.id === state.activeTripId ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('');
    
    if (filterSelect) filterSelect.innerHTML = '<option value="">Seyahat Seçin...</option>' + tripOptions;
    if (modalSelect) modalSelect.innerHTML = tripOptions;

    if (state.activeTripId) {
        state.memoriesList = await db.getMemories(state.activeTripId);
    } else {
        state.memoriesList = [];
    }

    renderJournal();
}

export function getDisplayPhotoUrl(url) {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('blob:')) {
        return url;
    }
    
    if (state.photoBlobUrls[url]) {
        return state.photoBlobUrls[url];
    }
    
    let filePath = url;
    if (url.startsWith('http')) {
        filePath = url.split('/traveller-photos/').pop();
    }
    
    if (!state.pendingPhotoLoads.has(url)) {
        state.pendingPhotoLoads.add(url);
        
        db.downloadPhoto(filePath)
            .then(blob => {
                if (blob) {
                    const objectUrl = URL.createObjectURL(blob);
                    state.photoBlobUrls[url] = objectUrl;
                    
                    const hash = window.location.hash || '#dashboard';
                    if (hash === '#journal') {
                        renderJournal();
                    }
                }
                state.pendingPhotoLoads.delete(url);
            })
            .catch(err => {
                console.error("Error loading secure image:", err);
                state.pendingPhotoLoads.delete(url);
            });
    }
    
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23222"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="%23666" font-family="sans-serif" font-size="8">Yukleniyor...</text></svg>';
}

export function renderJournal() {
    const container = document.getElementById('journal-container');
    if (!container) return;

    if (!state.activeTripId) {
        container.innerHTML = `<div class="text-center text-muted pad-50">Lütfen listelemek için seyahat seçin.</div>`;
        return;
    }

    if (state.memoriesList.length === 0) {
        container.innerHTML = `
            <div class="card glass text-center" style="padding: 50px;">
                <i data-lucide="camera" style="width: 48px; height: 48px; margin-bottom: 16px; color: var(--text-muted);"></i>
                <h3>Seyahat Anısı Bulunmuyor</h3>
                <p class="text-muted" style="margin-top: 8px;">Uçak biletlerinizi, çektiğiniz fotoğrafları ve o güne dair küçük notlarınızı ekleyin!</p>
            </div>
        `;
        if (window.lucide) window.lucide.createIcons();
        return;
    }

    if (state.currentGalleryTab === 'photos') {
        const photosOnly = state.memoriesList.filter(m => m.photo_url);
        if (photosOnly.length === 0) {
            container.innerHTML = `<div class="text-center text-muted pad-50">Seyahate kayıtlı fotoğraf bulunmuyor.</div>`;
            return;
        }

        container.className = "journal-container photos-grid";
        container.innerHTML = photosOnly.map(mem => {
            return `
                <div class="photo-grid-item" data-id="${mem.id}">
                    <button class="btn-delete-memory btn-delete-photo-grid" data-id="${mem.id}" title="Anıyı Sil" style="position: absolute; top: 8px; right: 8px; background: rgba(239, 68, 68, 0.85); color: white; border: none; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 10;">
                        X
                    </button>
                    <img src="${getDisplayPhotoUrl(mem.photo_url)}" alt="${escapeHTML(mem.title)}">
                    <div class="photo-caption-overlay">
                        <strong>${escapeHTML(mem.title)}</strong><br>
                        ${formatDate(mem.date)} - ${escapeHTML(mem.location || '')}
                    </div>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.photo-grid-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('btn-delete-photo-grid')) return;
                const memId = item.getAttribute('data-id');
                const mem = state.memoriesList.find(m => m.id === memId);
                if (mem) alert(`[${mem.title}] - ${mem.location}\n\n${mem.description}`);
            });
        });

    } else {
        container.className = "journal-container";
        container.innerHTML = state.memoriesList.map(mem => {
            const hasImage = !!mem.photo_url;
            return `
                <div class="journal-card ${hasImage ? '' : 'no-image'}">
                    <div class="journal-info-col">
                        <div class="journal-meta">
                            <span>📅 ${formatDate(mem.date)}</span>
                            ${mem.location ? `<span>📍 ${escapeHTML(mem.location)}</span>` : ''}
                        </div>
                        <h2 class="journal-title">${escapeHTML(mem.title)}</h2>
                        <div class="journal-body">
                            <p>${escapeHTML(mem.description || '').replace(/\n/g, '<br>')}</p>
                        </div>
                        <div class="journal-actions" style="display: flex; gap: 8px;">
                            <button class="btn btn-secondary btn-sm btn-edit-memory" data-id="${mem.id}">
                                 Düzenle
                            </button>
                            <button class="btn btn-secondary btn-sm btn-delete-memory" data-id="${mem.id}">
                                 Sil
                            </button>
                        </div>
                    </div>
                    ${hasImage ? `
                        <div class="journal-image-col">
                            <img src="${getDisplayPhotoUrl(mem.photo_url)}" class="journal-img" alt="${escapeHTML(mem.title)}" onclick="window.open(this.src, '_blank')">
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    document.querySelectorAll('.btn-edit-memory').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const mem = state.memoriesList.find(m => m.id === id);
            if (mem) {
                document.getElementById('memory-id').value = mem.id;
                document.getElementById('memory-trip-id').value = mem.trip_id;
                document.getElementById('memory-title').value = mem.title;
                document.getElementById('memory-desc').value = mem.description || '';
                document.getElementById('memory-location').value = mem.location || '';
                document.getElementById('memory-date').value = mem.date;
                
                const previewImg = document.getElementById('photo-preview');
                const previewContainer = document.getElementById('photo-preview-container');
                const photoPlaceholder = document.getElementById('photo-upload-placeholder');
                
                if (mem.photo_url) {
                    previewImg.src = getDisplayPhotoUrl(mem.photo_url);
                    previewContainer.classList.remove('hidden');
                    photoPlaceholder.classList.add('hidden');
                } else {
                    previewImg.src = '';
                    previewContainer.classList.add('hidden');
                    photoPlaceholder.classList.remove('hidden');
                }
                
                document.getElementById('memory-modal-title').textContent = 'Anıyı Düzenle';
                document.getElementById('memory-modal').classList.remove('hidden');
                
                state.selectedPhotoFile = null;
                document.getElementById('memory-photo').value = '';
            }
        });
    });

    document.querySelectorAll('.btn-delete-memory, .btn-delete-photo-grid').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            if (confirm('Bu anıyı silmek istediğinizden emin misiniz?')) {
                try {
                    await db.deleteMemory(id);
                    showToast('Anı silindi', 'success');
                    await loadJournalData();
                } catch (err) {
                    showToast('Silme hatası: ' + err.message, 'danger');
                }
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

export function initJournalEvents() {
    const journalTripFilter = document.getElementById('journal-trip-filter');
    if (journalTripFilter) {
        journalTripFilter.addEventListener('change', async (e) => {
            state.activeTripId = e.target.value;
            await loadJournalData();
        });
    }

    const fileInput = document.getElementById('memory-photo');
    const photoPlaceholder = document.getElementById('photo-upload-placeholder');
    const previewContainer = document.getElementById('photo-preview-container');
    const previewImg = document.getElementById('photo-preview');
    const removePhotoBtn = document.getElementById('btn-remove-photo');

    if (fileInput && photoPlaceholder && previewContainer && previewImg) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const compressed = await compressImage(file);
                state.selectedPhotoFile = compressed;
                const reader = new FileReader();
                reader.onload = (event) => {
                    previewImg.src = event.target.result;
                    previewContainer.classList.remove('hidden');
                    photoPlaceholder.classList.add('hidden');
                };
                reader.readAsDataURL(compressed);
            }
        });

        removePhotoBtn.addEventListener('click', () => {
            state.selectedPhotoFile = null;
            fileInput.value = '';
            previewImg.src = '';
            previewContainer.classList.add('hidden');
            photoPlaceholder.classList.remove('hidden');
        });
    }

    const memoryForm = document.getElementById('memory-form');
    if (memoryForm) {
        memoryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const memoryId = document.getElementById('memory-id').value;
            const tripId = document.getElementById('memory-trip-id').value;
            const title = document.getElementById('memory-title').value;
            const description = document.getElementById('memory-desc').value;
            const location = document.getElementById('memory-location').value;
            const date = document.getElementById('memory-date').value;

            const submitBtn = memoryForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Kaydediliyor...';

            const progressBarContainer = document.getElementById('upload-progress-container');
            const progressBar = document.getElementById('upload-progress-bar');
            const progressText = document.getElementById('upload-progress-text');

            const hasExistingPhoto = !previewContainer.classList.contains('hidden') && previewImg.src.startsWith('http');
            const existingPhotoUrl = hasExistingPhoto ? previewImg.src : null;

            if (state.selectedPhotoFile && progressBarContainer && progressBar && progressText) {
                progressBarContainer.classList.remove('hidden');
                let progress = 0;
                const progressInterval = setInterval(() => {
                    if (progress < 90) {
                        progress += 10;
                        progressBar.style.width = `${progress}%`;
                        progressText.textContent = `Fotoğraf yükleniyor... %${progress}`;
                    }
                }, 100);

                try {
                    if (memoryId) {
                        await db.updateMemory(memoryId, { trip_id: tripId, title, description, location, date, photo_url: null }, state.selectedPhotoFile);
                    } else {
                        await db.createMemory({ trip_id: tripId, title, description, location, date }, state.selectedPhotoFile);
                    }
                    clearInterval(progressInterval);
                    
                    progressBar.style.width = '100%';
                    progressText.textContent = 'Fotoğraf başarıyla yüklendi! %100';
                    
                    setTimeout(() => {
                        showToast(memoryId ? 'Seyahat anısı güncellendi!' : 'Seyahat anısı ve fotoğraf başarıyla kaydedildi!', 'success');
                        closeModal();
                    }, 500);

                } catch (err) {
                    clearInterval(progressInterval);
                    showToast('Yükleme hatası: ' + err.message, 'danger');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Kaydet';
                }
            } else {
                try {
                    if (memoryId) {
                        await db.updateMemory(memoryId, { trip_id: tripId, title, description, location, date, photo_url: existingPhotoUrl }, null);
                        showToast('Seyahat anısı güncellendi!', 'success');
                    } else {
                        await db.createMemory({ trip_id: tripId, title, description, location, date }, null);
                        showToast('Seyahat anısı başarıyla kaydedildi!', 'success');
                    }
                    closeModal();
                } catch (err) {
                    showToast('Hata oluştu: ' + err.message, 'danger');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Kaydet';
                }
            }

            async function closeModal() {
                if (progressBarContainer) {
                    progressBarContainer.classList.add('hidden');
                    progressBar.style.width = '0%';
                }
                
                document.getElementById('memory-modal').classList.add('hidden');
                memoryForm.reset();
                document.getElementById('memory-id').value = '';
                
                state.selectedPhotoFile = null;
                previewContainer.classList.add('hidden');
                photoPlaceholder.classList.remove('hidden');
                
                submitBtn.disabled = false;
                submitBtn.textContent = 'Kaydet';
                
                state.activeTripId = tripId;
                await loadJournalData();
            }
        });
    }

    const tabAll = document.getElementById('tab-all-memories');
    const tabPhotos = document.getElementById('tab-only-photos');
    if (tabAll && tabPhotos) {
        tabAll.addEventListener('click', () => {
            state.currentGalleryTab = 'all';
            tabAll.classList.add('active');
            tabPhotos.classList.remove('active');
            renderJournal();
        });
        tabPhotos.addEventListener('click', () => {
            state.currentGalleryTab = 'photos';
            tabPhotos.classList.add('active');
            tabAll.classList.remove('active');
            renderJournal();
        });
    }
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
