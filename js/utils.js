// js/utils.js

import { state, fallbackRates } from './state.js';

// Toast Alert notification helper
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Limit active toasts to max 2 on mobile to avoid covering the map
    while (container.children.length >= 2) {
        container.removeChild(container.firstChild);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Choose icon based on type
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'warning') iconName = 'alert-triangle';
    if (type === 'danger') iconName = 'x-circle';

    // Safely build the elements to prevent XSS
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', iconName);
    
    const span = document.createElement('span');
    span.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(span);

    // Dismiss on click/tap
    toast.addEventListener('click', () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);
    
    // Trigger Lucide icon parsing for this new toast
    if (window.lucide) window.lucide.createIcons();
    
    // Force reflow and animate in
    setTimeout(() => toast.classList.add('show'), 10);

    // Fade out and remove after 3.5 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 250);
        }
    }, 3500);
}

// Convert currencies dynamically using API rates
export function convertCurrency(amount, from, to) {
    const rates = Object.keys(state.exchangeRates).length > 0 ? state.exchangeRates : fallbackRates;
    if (!rates[from] || !rates[to]) return amount;
    
    // Convert source to USD base, then USD to target currency
    const amountInUSD = amount / rates[from];
    return amountInUSD * rates[to];
}

// Client-side image compression using HTML Canvas
export function compressImage(file, maxWidth = 1000, quality = 0.7) {
    return new Promise((resolve) => {
        if (!file || !file.type.startsWith('image/')) {
            resolve(file);
            return;
        }
        
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                canvas.toBlob((blob) => {
                    if (blob) {
                        const compressedFile = new File([blob], file.name, {
                            type: file.type,
                            lastModified: Date.now()
                        });
                        resolve(compressedFile);
                    } else {
                        resolve(file);
                    }
                }, file.type, quality);
            };
            img.onerror = () => resolve(file);
            img.src = event.target.result;
        };
        reader.onerror = () => resolve(file);
        reader.readAsDataURL(file);
    });
}

/**
 * Escapes unsafe HTML characters to prevent XSS
 */
export function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Haversine formula to calculate distance in meters between two coordinates
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

/**
 * Validates numeric latitude/longitude coordinates (allows 0 equator/meridian)
 */
export function isValidCoord(lat, lng) {
    return typeof lat === 'number' && typeof lng === 'number' &&
           Number.isFinite(lat) && Number.isFinite(lng) &&
           lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
