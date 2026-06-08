// js/modules/balance.js

import { state } from '../state.js';
import { convertCurrency } from '../utils.js';

export function renderBalanceSheet() {
    const membersListEl = document.getElementById('balance-members-list');
    const settlementsListEl = document.getElementById('balance-settlements-list');
    if (!membersListEl || !settlementsListEl) return;

    if (!state.activeTripId) {
        membersListEl.innerHTML = '<div class="text-center text-muted col-span-full">Lütfen bir seyahat seçin.</div>';
        settlementsListEl.innerHTML = '<div class="text-center text-muted">Lütfen bir seyahat seçin.</div>';
        return;
    }

    const trip = state.tripsList.find(t => t.id === state.activeTripId);
    if (!trip) return;

    const userEmail = state.activeUser ? state.activeUser.email : 'Oturum Sahibi';
    const participants = (trip.participants && Array.isArray(trip.participants) && trip.participants.length > 0)
        ? trip.participants
        : [userEmail];

    const tripCurrency = trip.currency || 'TRY';

    // Initialize trackers
    const totalPaid = {};
    const totalOwed = {};
    participants.forEach(p => {
        totalPaid[p] = 0;
        totalOwed[p] = 0;
    });

    // Process all expenses for the selected trip
    state.expensesList.forEach(exp => {
        const amountInTripCur = convertCurrency(exp.amount, exp.currency, tripCurrency);
        const payer = exp.paid_by || participants[0];

        // Ensure payer exists in trackers
        if (totalPaid[payer] === undefined) totalPaid[payer] = 0;
        totalPaid[payer] += amountInTripCur;

        const splitWith = (exp.split_with && Array.isArray(exp.split_with) && exp.split_with.length > 0)
            ? exp.split_with
            : participants;

        // Check if there are custom split values (contains ':')
        let hasCustomSplit = false;
        const customSplitValues = {};

        splitWith.forEach(item => {
            if (item.includes(':')) {
                hasCustomSplit = true;
                const [name, amtStr] = item.split(':');
                customSplitValues[name] = parseFloat(amtStr) || 0;
            }
        });

        if (hasCustomSplit) {
            // Distribute custom split amounts
            Object.keys(customSplitValues).forEach(member => {
                const memberAmountInTripCur = convertCurrency(customSplitValues[member], exp.currency, tripCurrency);
                if (totalOwed[member] === undefined) totalOwed[member] = 0;
                totalOwed[member] += memberAmountInTripCur;
            });
        } else {
            // Standard equal split
            const share = amountInTripCur / splitWith.length;
            splitWith.forEach(p => {
                if (totalOwed[p] === undefined) totalOwed[p] = 0;
                totalOwed[p] += share;
            });
        }
    });

    // Calculate Net Balances
    const netBalances = {};
    const allMembers = Array.from(new Set([...participants, ...Object.keys(totalPaid), ...Object.keys(totalOwed)]));
    
    allMembers.forEach(member => {
        const paid = totalPaid[member] || 0;
        const owed = totalOwed[member] || 0;
        netBalances[member] = paid - owed;
    });

    // Render Member Balance Breakdown Cards
    membersListEl.innerHTML = allMembers.map(member => {
        const paid = totalPaid[member] || 0;
        const net = netBalances[member];
        const statusClass = net > 0.01 ? 'text-success' : (net < -0.01 ? 'text-danger' : 'text-muted');
        const statusText = net > 0.01 
            ? `+${net.toFixed(2)} ${tripCurrency} (Alacaklı)` 
            : (net < -0.01 ? `${net.toFixed(2)} ${tripCurrency} (Borçlu)` : `0.00 ${tripCurrency} (Dengede)`);

        return `
            <div class="card glass text-center" style="padding: 15px; border-radius: 12px; background: rgba(255, 255, 255, 0.03);">
                <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px; color: var(--text-color);">${escapeHTML(member)}</div>
                <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 5px;">Toplam Ödenen: ${paid.toFixed(2)} ${tripCurrency}</div>
                <div class="${statusClass}" style="font-weight: bold; font-size: 14px;">${statusText}</div>
            </div>
        `;
    }).join('');

    // Greedily Settle Debts
    const debtors = [];
    const creditors = [];

    allMembers.forEach(member => {
        const bal = netBalances[member];
        if (bal < -0.01) {
            debtors.push({ name: member, balance: bal });
        } else if (bal > 0.01) {
            creditors.push({ name: member, balance: bal });
        }
    });

    debtors.sort((a, b) => a.balance - b.balance);
    creditors.sort((a, b) => b.balance - a.balance);

    const transactions = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
        const debtor = debtors[dIdx];
        const creditor = creditors[cIdx];

        const oweAmount = Math.abs(debtor.balance);
        const creditAmount = creditor.balance;

        const settleAmount = Math.min(oweAmount, creditAmount);

        if (settleAmount > 0.01) {
            transactions.push({
                from: debtor.name,
                to: creditor.name,
                amount: settleAmount
            });
        }

        debtor.balance += settleAmount;
        creditor.balance -= settleAmount;

        if (Math.abs(debtor.balance) < 0.01) {
            dIdx++;
        }
        if (Math.abs(creditor.balance) < 0.01) {
            cIdx++;
        }
    }

    // Render suggested payments
    if (transactions.length === 0) {
        settlementsListEl.innerHTML = `
            <div class="info-alert text-center" style="padding: 15px; font-weight: 500; background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.2); color: var(--color-success);">
                🎉 Harika! Tüm hesaplar dengede, kimsenin kimseye borcu bulunmamaktadır.
            </div>
        `;
    } else {
        settlementsListEl.innerHTML = transactions.map(t => `
            <div class="settlement-row" style="display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border:1px solid rgba(255,255,255,0.05); border-radius:10px; background:rgba(255,255,255,0.02);">
                <div style="font-size:14px; color:var(--text-color);">
                    <strong>${escapeHTML(t.from)}</strong>, 
                    <strong>${escapeHTML(t.to)}</strong> kişisine ödeme yapmalı.
                </div>
                <div style="font-weight:bold; font-size:16px; color:var(--color-primary);">
                    ${t.amount.toFixed(2)} ${tripCurrency}
                </div>
            </div>
        `).join('');
    }
    
    if (window.lucide) window.lucide.createIcons();
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
