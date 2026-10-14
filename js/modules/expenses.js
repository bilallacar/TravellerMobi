// js/modules/expenses.js

import { state } from '../state.js';
import { config } from '../../config.js';
import * as db from '../../db.js';
import { showToast, convertCurrency } from '../utils.js';
import { renderBalanceSheet } from './balance.js';

export async function loadExpensesData() {
    state.tripsList = await db.getTrips();
    state.categoriesList = await db.getCategories();

    if (!state.activeTripId && state.tripsList.length > 0) {
        state.activeTripId = state.tripsList[0].id;
    }
    
    const filterSelect = document.getElementById('expense-trip-filter');
    const modalSelect = document.getElementById('expense-trip-id');
    const categoryFilterSelect = document.getElementById('expense-category-filter');
    const expenseCategorySelect = document.getElementById('expense-category-id');

    const tripOptions = state.tripsList.map(t => `<option value="${t.id}" ${t.id === state.activeTripId ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('');
    
    if (filterSelect) filterSelect.innerHTML = '<option value="">Seyahat Seçin...</option>' + tripOptions;
    if (modalSelect) modalSelect.innerHTML = tripOptions;

    // Fill dynamic categories filter
    if (categoryFilterSelect) {
        categoryFilterSelect.innerHTML = '<option value="">Tüm Kategoriler</option>' + 
            state.categoriesList.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
    }

    // Fill dynamic categories input in form
    if (expenseCategorySelect) {
        expenseCategorySelect.innerHTML = state.categoriesList.map(c => 
            `<option value="${c.id}">${escapeHTML(c.name)}</option>`
        ).join('');
    }

    if (state.activeTripId) {
        state.expensesList = await db.getExpenses(state.activeTripId);
    } else {
        state.expensesList = [];
    }
    
    renderExpenses();
}

export function updateExpenseFormParticipants(tripId, selectedPaidBy = null, selectedSplitWith = null) {
    const trip = state.tripsList.find(t => t.id === tripId);
    const userEmail = state.activeUser ? state.activeUser.email : 'Oturum Sahibi';
    const participants = (trip && trip.participants && Array.isArray(trip.participants) && trip.participants.length > 0) 
        ? trip.participants 
        : [userEmail];

    const paidBySelect = document.getElementById('expense-paid-by');
    const splitContainer = document.getElementById('expense-split-container');
    const splitTypeSelect = document.getElementById('expense-split-type');

    if (paidBySelect) {
        paidBySelect.innerHTML = participants.map(p => `
            <option value="${escapeHTML(p)}" ${selectedPaidBy === p ? 'selected' : ''}>${escapeHTML(p)}</option>
        `).join('');
    }

    // Determine if custom split is loaded based on selectedSplitWith contents
    let isCustom = false;
    const customAmounts = {};
    if (selectedSplitWith && Array.isArray(selectedSplitWith)) {
        selectedSplitWith.forEach(item => {
            if (item.includes(':')) {
                isCustom = true;
                const [name, amt] = item.split(':');
                customAmounts[name] = parseFloat(amt) || 0;
            }
        });
    }

    if (splitTypeSelect) {
        splitTypeSelect.value = isCustom ? 'custom' : 'equal';
    }

    const renderSplitMembers = () => {
        const type = splitTypeSelect ? splitTypeSelect.value : 'equal';
        if (splitContainer) {
            splitContainer.innerHTML = participants.map(p => {
                let isChecked = true;
                let val = '';
                
                if (isCustom) {
                    isChecked = customAmounts[p] !== undefined;
                    val = isChecked ? customAmounts[p] : '';
                } else if (selectedSplitWith && Array.isArray(selectedSplitWith)) {
                    isChecked = selectedSplitWith.includes(p);
                }

                if (type === 'custom') {
                    return `
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; padding: 4px 0;">
                            <label style="display:flex; align-items:center; gap:8px; color:var(--text-color); cursor:pointer;">
                                <input type="checkbox" class="expense-split-member" value="${escapeHTML(p)}" ${isChecked ? 'checked' : ''} style="width:16px; height:16px;">
                                <span>${escapeHTML(p)}</span>
                            </label>
                            <input type="number" step="0.01" class="text-input expense-split-amount" data-member="${escapeHTML(p)}" placeholder="Tutar" value="${val}" style="width:100px; padding: 4px 8px; margin:0;" ${isChecked ? '' : 'disabled'}>
                        </div>
                    `;
                } else {
                    return `
                        <label style="display:flex; align-items:center; gap:8px; color:var(--text-color); cursor:pointer; padding: 4px 0;">
                            <input type="checkbox" class="expense-split-member" value="${escapeHTML(p)}" ${isChecked ? 'checked' : ''} style="width:16px; height:16px;">
                            <span>${escapeHTML(p)}</span>
                        </label>
                    `;
                }
            }).join('');

            // Bind checkbox toggles to enable/disable custom amount inputs
            if (type === 'custom') {
                splitContainer.querySelectorAll('.expense-split-member').forEach(cb => {
                    cb.addEventListener('change', () => {
                        const amtInput = splitContainer.querySelector(`.expense-split-amount[data-member="${cb.value}"]`);
                        if (amtInput) {
                            amtInput.disabled = !cb.checked;
                            if (!cb.checked) amtInput.value = '';
                        }
                    });
                });
            }
        }
    };

    renderSplitMembers();

    // Rebind split type change event once to update UI rendering
    if (splitTypeSelect) {
        splitTypeSelect.onchange = () => {
            renderSplitMembers();
        };
    }
}

export function renderExpenses() {
    const listEl = document.getElementById('expenses-list');
    if (!listEl) return;

    if (!state.activeTripId) {
        listEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Lütfen listelemek için üst kısımdan bir seyahat seçin.</td></tr>`;
        return;
    }

    const categoryFilter = document.getElementById('expense-category-filter').value;
    let filtered = state.expensesList;

    if (categoryFilter) {
        filtered = state.expensesList.filter(e => e.category_id === categoryFilter);
    }

    if (filtered.length === 0) {
        listEl.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Kayıtlı harcama bulunamadı.</td></tr>`;
        renderExpenseChart([]);
        return;
    }

    const baseCur = config.defaultCurrency;

    listEl.innerHTML = filtered.map(exp => {
        const amtInBase = convertCurrency(exp.amount, exp.currency, baseCur);
        const cat = state.categoriesList.find(c => c.id === exp.category_id);
        const catName = cat ? cat.name : (exp.category || 'Diğer');
        const catColor = cat ? cat.color : '#6366f1';
        
        // Handle long category names or subcategories
        const parts = catName.split('/').map(s => s.trim());
        const mainCat = parts[0];
        let catBadgeHtml = '';
        if (parts.length > 1) {
            const subDetail = parts.slice(1).join(' / ');
            catBadgeHtml = `
                <span class="badge badge-category-pill" style="background: ${catColor}20; color: ${catColor}; border: 1px solid ${catColor}40;" title="${escapeHTML(catName)}">
                    ${escapeHTML(mainCat)} <span class="badge-sub-info" title="${escapeHTML(subDetail)}">ℹ️</span>
                </span>
            `;
        } else {
            catBadgeHtml = `
                <span class="badge badge-category-pill" style="background: ${catColor}20; color: ${catColor}; border: 1px solid ${catColor}40;" title="${escapeHTML(catName)}">
                    ${escapeHTML(mainCat)}
                </span>
            `;
        }
        
        return `
            <tr>
                <td>${formatDate(exp.date)}</td>
                <td><strong>${escapeHTML(exp.title)}</strong></td>
                <td>${catBadgeHtml}</td>
                <td>${exp.amount.toFixed(2)} ${exp.currency}</td>
                <td>${amtInBase.toFixed(2)} ${baseCur}</td>
                <td>
                    <div class="table-actions" style="display: flex; gap: 6px; align-items: center;">
                        <button class="btn-icon-sm btn-edit-expense" data-id="${exp.id}" title="Düzenle">
                             <i data-lucide="edit-2"></i>
                        </button>
                        <button class="btn-icon-sm btn-delete-expense" data-id="${exp.id}" title="Sil">
                             <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // Attach listeners
    document.querySelectorAll('.btn-edit-expense').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const exp = state.expensesList.find(x => x.id === id);
            if (exp) {
                document.getElementById('expense-id').value = exp.id;
                document.getElementById('expense-trip-id').value = exp.trip_id;
                document.getElementById('expense-title').value = exp.title;
                document.getElementById('expense-amount').value = exp.amount;
                document.getElementById('expense-currency').value = exp.currency;
                
                const selectCat = document.getElementById('expense-category-id');
                if (selectCat) selectCat.value = exp.category_id || '';
                
                document.getElementById('expense-date').value = exp.date;
                
                updateExpenseFormParticipants(exp.trip_id, exp.paid_by, exp.split_with);
                
                document.getElementById('expense-modal-title').textContent = 'Masrafı Düzenle';
                document.getElementById('expense-modal').classList.remove('hidden');
            }
        });
    });

    document.querySelectorAll('.btn-delete-expense').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-id');
            if (confirm('Bu harcamayı silmek istediğinize emin misiniz?')) {
                try {
                    await db.deleteExpense(id);
                    showToast('Harcama silindi', 'success');
                    await loadExpensesData();
                } catch (err) {
                    showToast('Silme hatası: ' + err.message, 'danger');
                }
            }
        });
    });

    renderExpenseChart(state.expensesList);
    renderBalanceSheet();
    renderExpenseAnalysis();

    if (window.lucide) window.lucide.createIcons();
}

export function renderExpenseChart(expenses) {
    const chartEl = document.getElementById('category-chart');
    if (!chartEl) return;

    if (expenses.length === 0) {
        chartEl.innerHTML = `<p class="text-center text-muted pad-50">Grafik için harcama verisi yok.</p>`;
        return;
    }

    const baseCur = config.defaultCurrency;
    
    // Aggregation
    const totals = {};
    let grandTotal = 0;

    expenses.forEach(e => {
        const amountInBase = convertCurrency(e.amount, e.currency, baseCur);
        const cat = state.categoriesList.find(c => c.id === e.category_id);
        const catName = cat ? cat.name : (e.category || 'Diğer');
        totals[catName] = (totals[catName] || 0) + amountInBase;
        grandTotal += amountInBase;
    });

    chartEl.innerHTML = Object.keys(totals).map(catName => {
        const catVal = totals[catName];
        const percent = grandTotal > 0 ? (catVal / grandTotal) * 100 : 0;
        const catObj = state.categoriesList.find(c => c.name === catName);
        const barColor = catObj ? catObj.color : '#6366f1';
        
        return `
            <div class="chart-bar-row">
                <div class="chart-bar-label">
                    <span style="display:flex; align-items:center; gap:6px;">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background-color:${barColor};"></span>
                        ${escapeHTML(catName)}
                    </span>
                    <span>${catVal.toFixed(2)} ${baseCur} (${percent.toFixed(0)}%)</span>
                </div>
                <div class="chart-bar-bg">
                    <div class="chart-bar-fill" style="width: ${percent}%; background-color: ${barColor};"></div>
                </div>
            </div>
        `;
    }).join('');
}

export function initExpensesEvents() {
    const expenseTripFilter = document.getElementById('expense-trip-filter');
    if (expenseTripFilter) {
        expenseTripFilter.addEventListener('change', async (e) => {
            state.activeTripId = e.target.value;
            await loadExpensesData();
        });
    }

    const modalExpTripSelect = document.getElementById('expense-trip-id');
    if (modalExpTripSelect) {
        modalExpTripSelect.addEventListener('change', (e) => {
            updateExpenseFormParticipants(e.target.value);
        });
    }

    const expenseForm = document.getElementById('expense-form');
    if (expenseForm) {
        expenseForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const expenseId = document.getElementById('expense-id').value;
            const tripId = document.getElementById('expense-trip-id').value;
            const title = document.getElementById('expense-title').value;
            const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
            const currency = document.getElementById('expense-currency').value;
            const category_id = document.getElementById('expense-category-id').value;
            const date = document.getElementById('expense-date').value;
            
            const paid_by = document.getElementById('expense-paid-by').value || null;
            const splitType = document.getElementById('expense-split-type').value;

            let split_with = [];
            if (splitType === 'custom') {
                const membersChecked = Array.from(document.querySelectorAll('.expense-split-member:checked'));
                let totalCustom = 0;
                
                membersChecked.forEach(cb => {
                    const amtInput = document.querySelector(`.expense-split-amount[data-member="${cb.value}"]`);
                    const val = parseFloat(amtInput ? amtInput.value : 0) || 0;
                    totalCustom += val;
                    split_with.push(`${cb.value}:${val.toFixed(2)}`);
                });

                // Soft check - warn if amounts do not match total amount, but do not prevent save
                if (Math.abs(totalCustom - amount) > 0.05) {
                    showToast(`Uyarı: Girdiğiniz paylar toplamı (${totalCustom.toFixed(2)}), harcama tutarı (${amount.toFixed(2)}) ile tam uyuşmuyor!`, 'warning');
                }
            } else {
                split_with = Array.from(document.querySelectorAll('.expense-split-member:checked')).map(cb => cb.value);
            }

            const cat = state.categoriesList.find(c => c.id === category_id);
            const category = cat ? cat.name : 'Diğer';

            try {
                if (expenseId) {
                    await db.updateExpense(expenseId, { trip_id: tripId, title, amount, currency, category, category_id, date, paid_by, split_with });
                    showToast('Harcama güncellendi', 'success');
                } else {
                    await db.createExpense({ trip_id: tripId, title, amount, currency, category, category_id, date, paid_by, split_with });
                    showToast('Harcama kaydedildi', 'success');
                }
                
                document.getElementById('expense-modal').classList.add('hidden');
                expenseForm.reset();
                document.getElementById('expense-id').value = '';
                
                state.activeTripId = tripId;
                await loadExpensesData();
            } catch (err) {
                showToast('Hata oluştu: ' + err.message, 'danger');
            }
        });
    }

    const categoryFilter = document.getElementById('expense-category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => {
            renderExpenses();
        });
    }

    const tabExpList = document.getElementById('tab-expense-list');
    const tabExpBalance = document.getElementById('tab-expense-balance');
    const tabExpAnalysis = document.getElementById('tab-expense-analysis');
    const expListCont = document.getElementById('expenses-list-container');
    const expBalanceCont = document.getElementById('expenses-balance-container');
    const expAnalysisCont = document.getElementById('expenses-analysis-container');

    if (tabExpList && tabExpBalance && tabExpAnalysis && expListCont && expBalanceCont && expAnalysisCont) {
        tabExpList.addEventListener('click', () => {
            tabExpList.classList.add('active');
            tabExpBalance.classList.remove('active');
            tabExpAnalysis.classList.remove('active');
            expListCont.classList.remove('hidden');
            expBalanceCont.classList.add('hidden');
            expAnalysisCont.classList.add('hidden');
        });
        tabExpBalance.addEventListener('click', () => {
            tabExpBalance.classList.add('active');
            tabExpList.classList.remove('active');
            tabExpAnalysis.classList.remove('active');
            expBalanceCont.classList.remove('hidden');
            expListCont.classList.add('hidden');
            expAnalysisCont.classList.add('hidden');
            renderBalanceSheet();
        });
        tabExpAnalysis.addEventListener('click', () => {
            tabExpAnalysis.classList.add('active');
            tabExpList.classList.remove('active');
            tabExpBalance.classList.remove('active');
            expAnalysisCont.classList.remove('hidden');
            expListCont.classList.add('hidden');
            expBalanceCont.classList.add('hidden');
            renderExpenseAnalysis();
        });
    }
}

export function renderExpenseAnalysis() {
    const summaryGrid = document.getElementById('analysis-summary-grid');
    const participantsList = document.getElementById('analysis-participants-list');
    const categoriesList = document.getElementById('analysis-categories-list');
    const insightsContent = document.getElementById('analysis-insights-content');

    if (!summaryGrid || !participantsList || !categoriesList || !insightsContent) return;

    if (!state.activeTripId || state.expensesList.length === 0) {
        summaryGrid.innerHTML = '';
        participantsList.innerHTML = '<p class="text-muted text-center pad-50">Analiz için harcama verisi bulunmamaktadır.</p>';
        categoriesList.innerHTML = '<p class="text-muted text-center pad-50">Analiz için harcama verisi bulunmamaktadır.</p>';
        insightsContent.innerHTML = '<p class="text-muted text-center pad-50">Analiz için seyahat ve harcama kaydı ekleyin.</p>';
        return;
    }

    const trip = state.tripsList.find(t => t.id === state.activeTripId);
    const baseCur = config.defaultCurrency;

    // 1. Calculate overall sums
    let totalSpent = 0;
    const catTotals = {};
    const catCounts = {};
    const memberPaid = {};
    const memberCatSpent = {}; // { member: { category: amount } }

    state.expensesList.forEach(e => {
        const amountInBase = convertCurrency(e.amount, e.currency, baseCur);
        totalSpent += amountInBase;

        const cat = state.categoriesList.find(c => c.id === e.category_id);
        const catName = cat ? cat.name : (e.category || 'Diğer');
        catTotals[catName] = (catTotals[catName] || 0) + amountInBase;
        catCounts[catName] = (catCounts[catName] || 0) + 1;

        // Paid by tracker
        const payer = e.paid_by || 'Ortak';
        memberPaid[payer] = (memberPaid[payer] || 0) + amountInBase;

        // Payer category spend tracker
        if (!memberCatSpent[payer]) memberCatSpent[payer] = {};
        memberCatSpent[payer][catName] = (memberCatSpent[payer][catName] || 0) + amountInBase;
    });

    // Determine Top Category
    let topCatName = '-';
    let topCatVal = 0;
    Object.keys(catTotals).forEach(cat => {
        if (catTotals[cat] > topCatVal) {
            topCatVal = catTotals[cat];
            topCatName = cat;
        }
    });

    // Calculate Trip Duration & Daily Average
    let dailyAvgStr = '-';
    if (trip && trip.start_date && trip.end_date) {
        const start = new Date(trip.start_date);
        const end = new Date(trip.end_date);
        const days = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
        const dailyAvg = totalSpent / days;
        dailyAvgStr = `${dailyAvg.toFixed(2)} ${baseCur}`;
    }

    // Render Summary Cards
    summaryGrid.innerHTML = `
        <div class="metric-card glass">
            <div class="metric-icon expense" style="background: linear-gradient(135deg, #a5b4fc, #6366f1);"><i data-lucide="wallet"></i></div>
            <div class="metric-info">
                <h3>Toplam Harcanan</h3>
                <p class="metric-value">${totalSpent.toFixed(2)} ${baseCur}</p>
                <span class="metric-sub">Tüm katılımcı ödemeleri</span>
            </div>
        </div>
        <div class="metric-card glass">
            <div class="metric-icon trip" style="background: linear-gradient(135deg, #10b981, #059669);"><i data-lucide="calendar"></i></div>
            <div class="metric-info">
                <h3>Günlük Ortalama</h3>
                <p class="metric-value">${dailyAvgStr}</p>
                <span class="metric-sub">Seyahat süresine göre</span>
            </div>
        </div>
        <div class="metric-card glass">
            <div class="metric-icon memory" style="background: linear-gradient(135deg, #f59e0b, #e11d48);"><i data-lucide="award"></i></div>
            <div class="metric-info">
                <h3>En Çok Harcanan</h3>
                <p class="metric-value">${escapeHTML(topCatName)}</p>
                <span class="metric-sub">${topCatVal.toFixed(2)} ${baseCur} (%${totalSpent > 0 ? ((topCatVal/totalSpent)*100).toFixed(0) : 0})</span>
            </div>
        </div>
    `;

    // Render Participant Shares & Habits
    const participants = (trip && trip.participants && Array.isArray(trip.participants) && trip.participants.length > 0)
        ? trip.participants
        : [state.activeUser ? state.activeUser.email : 'Ortak'];

    participantsList.innerHTML = participants.map(p => {
        const paidVal = memberPaid[p] || 0;
        const sharePercent = totalSpent > 0 ? (paidVal / totalSpent) * 100 : 0;
        
        // Find member's top category habit
        let pTopCat = 'Yok';
        let pTopCatVal = 0;
        if (memberCatSpent[p]) {
            Object.keys(memberCatSpent[p]).forEach(cat => {
                if (memberCatSpent[p][cat] > pTopCatVal) {
                    pTopCatVal = memberCatSpent[p][cat];
                    pTopCat = cat;
                }
            });
        }

        return `
            <div class="chart-bar-row" style="margin-bottom: 5px;">
                <div class="chart-bar-label" style="font-weight:600;">
                    <span>👤 ${escapeHTML(p)}</span>
                    <span>${paidVal.toFixed(2)} ${baseCur} (%${sharePercent.toFixed(0)})</span>
                </div>
                <div class="progress-bar-bg" style="height: 12px; border-radius:6px; margin: 4px 0 6px 0;">
                    <div class="progress-bar" style="width: ${sharePercent}%; height:100%; border-radius:6px;"></div>
                </div>
                <span style="font-size:11px; color:var(--text-secondary);">
                    💡 En çok harcadığı kategori: <strong>${escapeHTML(pTopCat)}</strong> (${pTopCatVal.toFixed(2)} ${baseCur})
                </span>
            </div>
        `;
    }).join('');

    // Render Category Habits
    categoriesList.innerHTML = Object.keys(catTotals).map(catName => {
        const catVal = catTotals[catName];
        const count = catCounts[catName] || 0;
        const percent = totalSpent > 0 ? (catVal / totalSpent) * 100 : 0;
        const catObj = state.categoriesList.find(c => c.name === catName);
        const catColor = catObj ? catObj.color : '#6366f1';

        return `
            <div class="chart-bar-row">
                <div class="chart-bar-label">
                    <span><strong>${escapeHTML(catName)}</strong> (${count} İşlem)</span>
                    <span>${catVal.toFixed(2)} ${baseCur} (${percent.toFixed(0)}%)</span>
                </div>
                <div class="progress-bar-bg" style="height: 10px; border-radius:5px; margin-top:4px;">
                    <div class="progress-bar" style="width: ${percent}%; height:100%; background-color: ${catColor}; border-radius:5px;"></div>
                </div>
            </div>
        `;
    }).join('');

    // Generate Smart AI Insights Text
    const insights = [];

    // Insight 1: Budget utilization if budget is defined
    if (trip && trip.budget > 0) {
        const budgetInBase = convertCurrency(trip.budget, trip.currency, baseCur);
        const utilization = (totalSpent / budgetInBase) * 100;
        let alertClass = 'info-alert';
        let alertText = '';

        if (utilization > 100) {
            alertClass = 'info-alert danger';
            alertText = `⚠️ <strong>Bütçe Aşımı!</strong> Seyahat bütçenizi <strong>%${(utilization - 100).toFixed(0)}</strong> oranında aştınız. Harcamaları acilen azaltmanız veya bütçeyi revize etmeniz önerilir.`;
        } else if (utilization > 80) {
            alertClass = 'info-alert warning';
            alertText = `⚠️ <strong>Dikkat!</strong> Belirlediğiniz bütçenin <strong>%${utilization.toFixed(0)}</strong> kadarı tüketildi. Limite çok yakınsınız.`;
        } else {
            alertText = `✅ <strong>Bütçe Dengeli:</strong> Bütçenizin <strong>%${utilization.toFixed(0)}</strong> kadarı kullanıldı. Kalan bütçeniz: <strong>${(budgetInBase - totalSpent).toFixed(2)} ${baseCur}</strong>.`;
        }
        insights.push(`<div class="${alertClass}" style="margin: 0; padding:12px; border-radius:8px; width: 100%; box-sizing: border-box;">${alertText}</div>`);
    }

    // Insight 2: Category distribution insights
    if (topCatName !== '-') {
        const topCatPercent = totalSpent > 0 ? (topCatVal / totalSpent) * 100 : 0;
        let suggestion = '';
        if (topCatName === 'Yemek') {
            suggestion = "Yemek harcamalarınız toplam seyahat masraflarının büyük bir kısmını oluşturuyor. Daha uygun fiyatlı lokal mekanları veya süpermarket alternatiflerini tercih ederek günlük masraflarınızı optimize edebilirsiniz.";
        } else if (topCatName === 'Konaklama') {
            suggestion = "Konaklama seyahatinizin en büyük kalemi. Bir sonraki seyahatinizde erken rezervasyon yaparak veya hostel/daire kiralama opsiyonlarını değerlendirerek ciddi tasarruf sağlayabilirsiniz.";
        } else if (topCatName === 'Ulaşım') {
            suggestion = "Ulaşım harcamalarınız yoğunlukta. Şehir içi ulaşımlarda taksi yerine toplu taşıma kartlarını veya bisiklet/yürüyüş alternatiflerini tercih etmek bütçenizi rahatlatacaktır.";
        } else {
            suggestion = `${escapeHTML(topCatName)} kategorisi en büyük gider kaleminiz durumunda. Bu harcamaların seyahat planınızdaki önceliğini tekrar değerlendirebilirsiniz.`;
        }
        
        insights.push(`
            <div style="display:flex; align-items:flex-start; gap:12px; padding: 12px; border-radius:8px; background: rgba(255,255,255,0.02); border:1px solid var(--border-color); width: 100%; box-sizing: border-box;">
                <span style="font-size:20px; flex-shrink: 0;">💡</span>
                <div>
                    <strong style="display:block; margin-bottom:4px; color:var(--text-primary); font-size: 14px;">En Büyük Gider Kalemi: ${escapeHTML(topCatName)} (%${topCatPercent.toFixed(0)})</strong>
                    <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin: 0;">${suggestion}</p>
                </div>
            </div>
        `);
    }

    // Insight 3: Participant equality insight
    if (participants.length > 1) {
        let maxPayer = '';
        let maxPayVal = 0;
        let minPayer = '';
        let minPayVal = Infinity;

        participants.forEach(p => {
            const val = memberPaid[p] || 0;
            if (val > maxPayVal) {
                maxPayVal = val;
                maxPayer = p;
            }
            if (val < minPayVal) {
                minPayVal = val;
                minPayer = p;
            }
        });

        if (maxPayVal - minPayVal > totalSpent * 0.15) {
            insights.push(`
                <div style="display:flex; align-items:flex-start; gap:12px; padding: 12px; border-radius:8px; background: rgba(255,255,255,0.02); border:1px solid var(--border-color); width: 100%; box-sizing: border-box;">
                    <span style="font-size:20px; flex-shrink: 0;">👥</span>
                    <div>
                        <strong style="display:block; margin-bottom:4px; color:var(--text-primary); font-size: 14px;">Harcama Paylaşım Dengesizliği</strong>
                        <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin: 0;">
                            Seyahatteki harcamaların çoğunu <strong>${escapeHTML(maxPayer)}</strong> yaptı (${maxPayVal.toFixed(2)} ${baseCur}), en az ödemeyi ise <strong>${escapeHTML(minPayer)}</strong> yaptı (${minPayVal.toFixed(2)} ${baseCur}). 
                            Grup içi dengenin sağlanması adına seyahat sonrasında Rota Bilançosu sekmesindeki ödeme planını uygulayabilirsiniz.
                        </p>
                    </div>
                </div>
            `);
        }
    }

    insightsContent.innerHTML = insights.join('');
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

function getCategoryBadgeClass(category) {
    switch (category) {
        case 'Yemek': return 'badge-food';
        case 'Konaklama': return 'badge-lodge';
        case 'Ulaşım': return 'badge-transport';
        case 'Aktivite': return 'badge-activity';
        case 'Alışveriş': return 'badge-shopping';
        default: return 'badge-other';
    }
}
