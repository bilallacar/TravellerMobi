// js/modules/auth.js

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast } from '../utils.js';

let authMode = 'login'; // 'login' or 'register'

export function initAuthEvents() {
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authForm = document.getElementById('auth-form');
    const submitBtn = document.getElementById('btn-auth-submit');

    if (tabLogin && tabRegister && submitBtn) {
        tabLogin.addEventListener('click', () => {
            authMode = 'login';
            tabLogin.classList.add('active');
            tabRegister.classList.remove('active');
            submitBtn.textContent = 'Giriş Yap';
        });
        tabRegister.addEventListener('click', () => {
            authMode = 'register';
            tabRegister.classList.add('active');
            tabLogin.classList.remove('active');
            submitBtn.textContent = 'Kayıt Ol';
        });
    }

    if (authForm && submitBtn) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'İşleniyor...';

            try {
                if (authMode === 'login') {
                    await db.signIn(email, password);
                    showToast('Giriş başarılı!', 'success');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Giriş Yap';
                    window.location.hash = '#dashboard';
                } else {
                    const signUpUser = await db.signUp(email, password);
                    
                    if (signUpUser && signUpUser.identities && signUpUser.identities.length === 0) {
                        throw new Error("Bu e-posta adresi zaten kayıtlıdır. Lütfen giriş yapın.");
                    }
                    
                    const user = await db.getCurrentUser();
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Giriş Yap';

                    if (user) {
                        showToast('Kayıt ve giriş başarılı!', 'success');
                        window.location.hash = '#dashboard';
                    } else {
                        showToast('Kayıt başarılı! Lütfen giriş yapabilmek için e-postanıza gönderilen onay linkine tıklayın.', 'warning');
                        if (tabLogin) tabLogin.click();
                        authForm.reset();
                    }
                }
            } catch (error) {
                showToast(error.message || 'Yetkilendirme hatası', 'danger');
                submitBtn.disabled = false;
                submitBtn.textContent = authMode === 'login' ? 'Giriş Yap' : 'Kayıt Ol';
            }
        });
    }

    const logoutBtn = document.getElementById('btn-logout');
    const pendingLogoutBtn = document.getElementById('btn-pending-logout');
    
    const handleLogout = async () => {
        await db.signOut();
        showToast('Çıkış yapıldı', 'info');
        window.location.hash = '#auth';
    };

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (pendingLogoutBtn) pendingLogoutBtn.addEventListener('click', handleLogout);
}

export function renderApprovalPending() {
    if (!state.activeUser) return;
    
    document.getElementById('pending-email').textContent = state.activeUser.email;
    const pendingMsgEl = document.getElementById('pending-message');
    const pendingIconEl = document.getElementById('pending-status-icon');
    
    if (!state.userProfile) {
        if (pendingMsgEl) pendingMsgEl.textContent = 'Profil sorgulanıyor veya bağlantı kurulamadı. SQL şemasının kurulduğundan emin olun.';
        if (pendingIconEl) pendingIconEl.innerHTML = '<i data-lucide="loader" style="color:var(--color-warning); width:64px; height:64px; animation: spin 1.5s linear infinite;"></i>';
    } else if (state.userProfile.status === 'rejected') {
        if (pendingMsgEl) pendingMsgEl.textContent = 'Üyelik talebiniz yönetici tarafından reddedildi.';
        if (pendingIconEl) pendingIconEl.innerHTML = '<i data-lucide="x-circle" style="color:var(--color-danger); width:64px; height:64px;"></i>';
    } else {
        if (pendingMsgEl) pendingMsgEl.textContent = 'Üyeliğiniz onay sürecindedir. Yönetici onay verdiğinde uygulamaya erişebileceksiniz.';
        if (pendingIconEl) pendingIconEl.innerHTML = '<i data-lucide="clock" style="color:var(--color-warning); width:64px; height:64px;"></i>';
    }
    
    if (window.lucide) window.lucide.createIcons();
}
