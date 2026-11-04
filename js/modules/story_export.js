// js/modules/story_export.js - Native 9:16 Instagram Story & Infographic Card Generator for TravellerMobi

import { showToast } from '../utils.js';
import { parsePlaceMetadata, PLACE_CATEGORIES } from './places.js';

let activeStoryCanvas = null;
let activeStoryBlob = null;
let activeStoryTitle = 'Seyahat Rotası';

/**
 * Generate 1080x1920 high-res retina story infographic card
 */
export async function generateStoryCanvas({
    title = 'Seyahat Rotası',
    subtitle = '',
    places = [],
    totalDistMeters = 0
}) {
    activeStoryTitle = title || 'Seyahat Rotası';
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');

    // 1. Sleek Carbon/Dark Background Gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 1080, 1920);
    bgGrad.addColorStop(0, '#090a10');
    bgGrad.addColorStop(0.35, '#0d111b');
    bgGrad.addColorStop(0.75, '#101424');
    bgGrad.addColorStop(1, '#07080e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1080, 1920);

    // 2. Ambient Radial Glow Accents (Cyan & Indigo glows)
    // Top-right cyan glow
    const glowTop = ctx.createRadialGradient(850, 200, 10, 850, 200, 600);
    glowTop.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
    glowTop.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = glowTop;
    ctx.fillRect(0, 0, 1080, 1920);

    // Center-left subtle violet glow
    const glowCenter = ctx.createRadialGradient(150, 1000, 10, 150, 1000, 650);
    glowCenter.addColorStop(0, 'rgba(129, 140, 248, 0.12)');
    glowCenter.addColorStop(1, 'rgba(129, 140, 248, 0)');
    ctx.fillStyle = glowCenter;
    ctx.fillRect(0, 0, 1080, 1920);

    // Bottom-center emerald glow
    const glowBottom = ctx.createRadialGradient(540, 1750, 10, 540, 1750, 500);
    glowBottom.addColorStop(0, 'rgba(34, 197, 94, 0.10)');
    glowBottom.addColorStop(1, 'rgba(34, 197, 94, 0)');
    ctx.fillStyle = glowBottom;
    ctx.fillRect(0, 0, 1080, 1920);

    // 3. Elegant Outer Frame Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, 40, 40, 1000, 1840, 36);
    ctx.stroke();

    // 4. Header: Sleek Geometric Compass Monogram & Brand Tracking
    const brandY = 120;
    
    // Minimalist Compass Monogram Icon
    ctx.save();
    ctx.translate(110, brandY);
    // Outer thin ring
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.stroke();
    // Inner north needle (cyan)
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(0, -18);
    ctx.lineTo(6, -2);
    ctx.lineTo(0, 2);
    ctx.lineTo(-6, -2);
    ctx.closePath();
    ctx.fill();
    // South needle (muted slate)
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(0, 18);
    ctx.lineTo(6, 2);
    ctx.lineTo(0, -2);
    ctx.lineTo(-6, 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Brand Name: TRAVELLERMOBI
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.letterSpacing = '5px';
    ctx.fillText('TRAVELLERMOBI', 150, brandY + 9);
    ctx.letterSpacing = '0px';

    // Top Category Pill: "ÖZEL ROTA PLANI"
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 770, brandY - 22, 210, 44, 22);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ROTA REHBERİ', 875, brandY + 7);
    ctx.textAlign = 'left';

    // 5. Hero Trip Title (Clean Large Typography)
    const titleY = 225;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    // Wrap title if long
    const displayTitle = (title || 'Seyahat Rotası').toUpperCase();
    const wrappedTitle = wrapText(ctx, displayTitle, 900);
    let currentY = titleY;
    wrappedTitle.slice(0, 2).forEach(line => {
        ctx.fillText(line, 95, currentY);
        currentY += 62;
    });

    // 6. Subtitle / Route Stats Capsule
    const totalKm = (totalDistMeters / 1000).toFixed(1);
    const estWalkMin = Math.round(totalDistMeters / 80);
    const placeCount = places.length;

    let statText = `${placeCount} Durak`;
    if (totalDistMeters > 0) {
        statText += `  •  Toplam ${totalKm} km  •  ~${estWalkMin} dk Yürüyüş`;
    }
    if (subtitle) {
        statText += `  •  ${subtitle}`;
    }

    const pillY = currentY + 10;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 95, pillY - 26, 890, 52, 26);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(statText, 125, pillY + 8);

    // 7. Render Itinerary Stops (Max 5 or 6 items with sleek vertical timeline)
    const listStartY = pillY + 68;
    const availableHeight = 1630 - listStartY;
    const maxPlaces = places.length > 5 ? 5 : places.length;
    const displayPlaces = places.slice(0, maxPlaces);
    const cardHeight = Math.min(185, Math.floor(availableHeight / Math.max(1, displayPlaces.length + (places.length > 5 ? 1 : 0)) - 18));
    const cardGap = 16;

    let itemY = listStartY;

    displayPlaces.forEach((place, index) => {
        const itemNumber = String(index + 1).padStart(2, '0');
        const catKey = place.category || 'other';
        const catConfig = PLACE_CATEGORIES[catKey] || PLACE_CATEGORIES.other;
        const meta = parsePlaceMetadata(place);

        // Vertical timeline connector line
        if (index < displayPlaces.length - 1 || places.length > 5) {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 8]);
            ctx.beginPath();
            ctx.moveTo(140, itemY + 45);
            ctx.lineTo(140, itemY + cardHeight + cardGap + 20);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Circular Number Node (Left)
        ctx.fillStyle = '#111625';
        ctx.strokeStyle = catConfig.color || '#38bdf8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(140, itemY + 45, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(itemNumber, 140, itemY + 53);
        ctx.textAlign = 'left';

        // Stop Card Container (Right)
        const cardX = 195;
        const cardW = 790;
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, cardX, itemY, cardW, cardHeight, 20);
        ctx.fill();
        ctx.stroke();

        // Card Category Chip + Rating
        const chipY = itemY + 36;
        ctx.fillStyle = catConfig.bg || 'rgba(56, 189, 248, 0.15)';
        ctx.strokeStyle = catConfig.color || '#38bdf8';
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, cardX + 22, chipY - 20, 160, 32, 16);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = catConfig.color || '#38bdf8';
        ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText((catConfig.name || 'Mekan').toUpperCase(), cardX + 36, chipY + 2);

        // Rating Stars (if exists)
        const rating = parseInt(place.rating) || 0;
        if (rating > 0) {
            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText('★'.repeat(rating) + ` (${rating}.0)`, cardX + 200, chipY + 2);
        }

        // Place Name
        const nameY = chipY + 36;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const truncatedName = truncateText(ctx, place.name || 'Mekan', cardW - 50);
        ctx.fillText(truncatedName, cardX + 22, nameY);

        // "Mutlaka Dene" / Highlight Callout or Address
        const calloutY = nameY + 28;
        if (meta.mustTry) {
            // Gold highlighted callout badge
            ctx.fillStyle = 'rgba(251, 191, 36, 0.12)';
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
            ctx.lineWidth = 1;
            drawRoundedRect(ctx, cardX + 20, calloutY - 18, cardW - 40, 34, 12);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fbbf24';
            ctx.font = 'bold 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const tryText = `★ MUTLAKA DENE: ${meta.mustTry}`;
            ctx.fillText(truncateText(ctx, tryText, cardW - 60), cardX + 34, calloutY + 5);
        } else if (place.address) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            const addrText = `📍 ${place.address}`;
            ctx.fillText(truncateText(ctx, addrText, cardW - 50), cardX + 24, calloutY + 4);
        } else if (place.notes) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(truncateText(ctx, place.notes, cardW - 50), cardX + 24, calloutY + 4);
        }

        itemY += cardHeight + cardGap;
    });

    // If more places than 5, render an "+N Diğer Durak" card
    if (places.length > 5) {
        const remainingCount = places.length - 5;
        const cardX = 195;
        const cardW = 790;
        
        ctx.fillStyle = 'rgba(56, 189, 248, 0.08)';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, cardX, itemY, cardW, 85, 20);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(`+ ${remainingCount} DİĞER DURAK & HARİTA GÜZERGAHI`, cardX + 30, itemY + 50);
    }

    // 8. Footer: Route Summary 3-Column Glass Box
    const footerY = 1665;
    const statBoxW = 286;
    const statBoxH = 100;
    const gap = 20;
    const startX = 95;

    // Box 1: Toplam Durak
    renderStatBox(ctx, startX, footerY, statBoxW, statBoxH, `${places.length}`, 'TOPLAM DURAK', '#38bdf8');
    // Box 2: Rota Mesafesi
    renderStatBox(ctx, startX + statBoxW + gap, footerY, statBoxW, statBoxH, `${totalKm} km`, 'YÜRÜYÜŞ MESAFESİ', '#22c55e');
    // Box 3: Tahmini Süre
    renderStatBox(ctx, startX + (statBoxW + gap) * 2, footerY, statBoxW, statBoxH, `~${estWalkMin} dk`, 'TAHMİNİ GEZİ SÜRESİ', '#a855f7');

    // 9. Watermark & Share Hint
    ctx.fillStyle = '#64748b';
    ctx.font = '600 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('travellermobi.app  •  Akıllı Rota & Seyahat Asistanı', 540, 1815);
    ctx.textAlign = 'left';

    activeStoryCanvas = canvas;
    return canvas;
}

/**
 * Render small executive stat box inside footer
 */
function renderStatBox(ctx, x, y, w, h, val, label, accentColor) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, x, y, w, h, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.font = 'bold 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(val, x + w / 2, y + 46);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.letterSpacing = '1px';
    ctx.fillText(label, x + w / 2, y + 78);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
}

/**
 * Draw canvas rounded rectangle helper
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Canvas multi-line word wrapping helper
 */
function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
        const testLine = currentLine ? currentLine + ' ' + words[i] : words[i];
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
            lines.push(currentLine);
            currentLine = words[i];
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
}

/**
 * Truncate single line text with ellipsis
 */
function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
        truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
}

/**
 * Open Story Preview Modal and render live canvas
 */
export async function openStoryModal({ title, subtitle, places, totalDistMeters }) {
    const modal = document.getElementById('modal-story-export');
    const previewWrapper = document.getElementById('story-preview-container');
    if (!modal || !previewWrapper) {
        console.error("Story export modal DOM elements not found");
        return;
    }

    previewWrapper.innerHTML = `
        <div style="padding: 40px; text-align: center; color: var(--text-muted);">
            <div class="spinner" style="margin: 0 auto 16px auto;"></div>
            <p>1080x1920 Retina Story Kartı Hazırlanıyor...</p>
        </div>
    `;
    modal.classList.remove('hidden');

    try {
        const canvas = await generateStoryCanvas({ title, subtitle, places, totalDistMeters });
        
        // Display scaled canvas in preview container
        previewWrapper.innerHTML = '';
        canvas.id = 'story-live-canvas';
        canvas.style.width = '100%';
        canvas.style.height = 'auto';
        canvas.style.display = 'block';
        canvas.style.borderRadius = '16px';
        canvas.style.boxShadow = '0 20px 50px rgba(0, 0, 0, 0.7)';
        previewWrapper.appendChild(canvas);

        // Cache canvas as Blob
        canvas.toBlob((blob) => {
            activeStoryBlob = blob;
        }, 'image/png');

        if (window.lucide) window.lucide.createIcons();
    } catch (err) {
        console.error("Story canvas generation failed:", err);
        previewWrapper.innerHTML = `<p style="color:var(--danger); padding:20px;">Görsel oluşturulamadı: ${err.message}</p>`;
    }
}

export function closeStoryModal() {
    const modal = document.getElementById('modal-story-export');
    if (modal) modal.classList.add('hidden');
}

/**
 * Download high-resolution PNG
 */
export function downloadStoryCanvas() {
    if (!activeStoryCanvas) {
        showToast("İndirilecek görsel hazır değil", "warning");
        return;
    }
    const cleanSlug = (activeStoryTitle || 'rota')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const link = document.createElement('a');
    link.download = `travellermobi-story-${cleanSlug || 'rota'}.png`;
    link.href = activeStoryCanvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Instagram Story kartı (1080x1920) başarıyla indirildi!", "success");
}

/**
 * Direct native Instagram / Social Share (via Web Share API with Files)
 */
export async function shareStoryNative() {
    if (!activeStoryCanvas) {
        showToast("Paylaşılacak görsel bulunamadı", "warning");
        return;
    }

    const cleanSlug = (activeStoryTitle || 'rota')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    const shareAction = async (blob) => {
        const file = new File([blob], `travellermobi-story-${cleanSlug}.png`, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: activeStoryTitle,
                    text: `${activeStoryTitle} - TravellerMobi Rota Rehberi`
                });
                showToast("Paylaşım penceresi açıldı!", "success");
            } catch (shareErr) {
                if (shareErr.name !== 'AbortError') {
                    console.warn("Native share error, falling back to download:", shareErr);
                    downloadStoryCanvas();
                }
            }
        } else {
            // Web share with files not supported (e.g. desktop), fallback to direct download
            showToast("Cihazınız doğrudan dosya paylaşımını desteklemiyor, görsel indiriliyor...", "info");
            downloadStoryCanvas();
        }
    };

    if (activeStoryBlob) {
        await shareAction(activeStoryBlob);
    } else {
        activeStoryCanvas.toBlob(async (blob) => {
            activeStoryBlob = blob;
            await shareAction(blob);
        }, 'image/png');
    }
}

/**
 * Copy PNG image directly to clipboard
 */
export async function copyStoryToClipboard() {
    if (!activeStoryCanvas) return;
    try {
        if (!navigator.clipboard || !window.ClipboardItem) {
            downloadStoryCanvas();
            return;
        }
        activeStoryCanvas.toBlob(async (blob) => {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
                showToast("Story kartı panoya kopyalandı! Instagram veya WhatsApp'a yapıştırabilirsiniz.", "success");
            } catch (clipErr) {
                console.warn("Clipboard write failed:", clipErr);
                downloadStoryCanvas();
            }
        }, 'image/png');
    } catch (err) {
        downloadStoryCanvas();
    }
}

/**
 * Initialize Story Export Event Listeners
 */
export function initStoryExportEvents() {
    const btnCloseModal = document.getElementById('btn-close-story-modal');
    const btnCancelModal = document.getElementById('btn-cancel-story-modal');
    const btnDownload = document.getElementById('btn-download-story-png');
    const btnShare = document.getElementById('btn-share-story-native');
    const btnCopy = document.getElementById('btn-copy-story-clipboard');

    if (btnCloseModal) btnCloseModal.addEventListener('click', closeStoryModal);
    if (btnCancelModal) btnCancelModal.addEventListener('click', closeStoryModal);
    if (btnDownload) btnDownload.addEventListener('click', downloadStoryCanvas);
    if (btnShare) btnShare.addEventListener('click', shareStoryNative);
    if (btnCopy) btnCopy.addEventListener('click', copyStoryToClipboard);

    const modal = document.getElementById('modal-story-export');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeStoryModal();
        });
    }
}
