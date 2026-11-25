// js/modules/auth.js

import { state } from '../state.js';
import * as db from '../../db.js';
import { showToast } from '../utils.js';
import { identifyVisitor, trackEvent } from './analytics.js';
import { clearAdminViewState } from './admin.js';
import { setAiLauncherVisible } from './ai_assistant.js';

let authMode = 'login'; // 'login' or 'register'

export function setAuthMode(mode = 'login') {
    const normalized = mode === 'register' ? 'register' : 'login';
    authMode = normalized;
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const submitBtn = document.getElementById('btn-auth-submit');
    const mainBox = document.getElementById('auth-main-box');
    const forgotBox = document.getElementById('auth-forgot-box');

    if (mainBox) mainBox.classList.remove('hidden');
    if (forgotBox) forgotBox.classList.add('hidden');
    if (tabLogin) tabLogin.classList.toggle('active', normalized === 'login');
    if (tabRegister) tabRegister.classList.toggle('active', normalized === 'register');
    if (submitBtn) {
        submitBtn.textContent = normalized === 'register' ? 'Kayıt Ol' : 'Giriş Yap';
    }
}

export function syncAuthTabFromHash(hashStr = window.location.hash) {
    const queryIdx = (hashStr || '').indexOf('?');
    if (queryIdx === -1) {
        setAuthMode('login');
        return;
    }
    const params = new URLSearchParams(hashStr.slice(queryIdx + 1));
    setAuthMode(params.get('tab') === 'register' ? 'register' : 'login');
}

export function syncAuthNetworkUI() {
    const offlineBanner = document.getElementById('auth-offline-banner');
    const submitBtn = document.getElementById('btn-auth-submit');
    const forgotBtn = document.getElementById('btn-send-reset-link');
    const online = db.hasInternet();

    if (offlineBanner) {
        offlineBanner.classList.toggle('hidden', online);
    }
    if (submitBtn && submitBtn.textContent !== 'İşleniyor...') {
        submitBtn.classList.toggle('is-offline-guarded', !online);
    }
    if (forgotBtn && forgotBtn.textContent !== 'Gönderiliyor...') {
        forgotBtn.classList.toggle('is-offline-guarded', !online);
    }
    if (window.lucide) window.lucide.createIcons();
}

export function initAuthEvents() {
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const authForm = document.getElementById('auth-form');
    const submitBtn = document.getElementById('btn-auth-submit');

    syncAuthNetworkUI();
    window.addEventListener('network-status-changed', () => {
        syncAuthNetworkUI();
    });

    const retryNetBtn = document.getElementById('btn-auth-retry-network');
    if (retryNetBtn) {
        retryNetBtn.addEventListener('click', async () => {
            syncAuthNetworkUI();
            if (db.hasInternet()) {
                await db.initSupabase();
                showToast('İnternet bağlantısı aktif! Giriş yapabilirsiniz.', 'success');
            } else {
                showToast('Hâlâ internet bağlantısı algılanamadı. Wi-Fi veya mobil verinizi kontrol edin.', 'warning');
            }
        });
    }

    if (tabLogin && tabRegister && submitBtn) {
        tabLogin.addEventListener('click', () => setAuthMode('login'));
        tabRegister.addEventListener('click', () => setAuthMode('register'));
    }

    if (authForm && submitBtn) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!db.hasInternet()) {
                syncAuthNetworkUI();
                showToast('İnternet bağlantısı yok. Giriş veya kayıt işlemi için internet erişimi gereklidir.', 'warning');
                return;
            }
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'İşleniyor...';

            try {
                if (authMode === 'login') {
                    const loggedInUser = await db.signIn(email, password);
                    if (loggedInUser) {
                        identifyVisitor(loggedInUser.id, loggedInUser.email);
                        trackEvent('auth_login', { page_path: '#auth' });
                    }
                    showToast('Giriş başarılı!', 'success');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Giriş Yap';
                    window.location.hash = '#dashboard';
                } else {
                    const signUpUser = await db.signUp(email, password);
                    const isExistingAccount = !!(signUpUser && signUpUser.identities && signUpUser.identities.length === 0);

                    if (signUpUser && !isExistingAccount) {
                        identifyVisitor(signUpUser.id, signUpUser.email || email);
                        trackEvent('auth_signup', { page_path: '#auth' });
                    }
                    
                    const user = await db.getCurrentUser();
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Giriş Yap';

                    if (user && !isExistingAccount) {
                        showToast('Kayıt ve giriş başarılı!', 'success');
                        window.location.hash = '#dashboard';
                    } else {
                        showToast('Kayıt talebiniz alındı. E-postanızı kontrol edin; hesabınız zaten mevcutsa giriş yapabilir veya şifrenizi sıfırlayabilirsiniz.', 'info');
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

    // Forgot Password and Reset Password Form Wireup
    const btnShowForgot = document.getElementById('btn-show-forgot');
    const btnBackToLogin = document.getElementById('btn-back-to-login');
    const authMainBox = document.getElementById('auth-main-box');
    const authForgotBox = document.getElementById('auth-forgot-box');
    const forgotForm = document.getElementById('forgot-password-form');
    const btnSendReset = document.getElementById('btn-send-reset-link');

    if (btnShowForgot && authMainBox && authForgotBox) {
        btnShowForgot.addEventListener('click', () => {
            authMainBox.classList.add('hidden');
            authForgotBox.classList.remove('hidden');
        });
    }

    if (btnBackToLogin && authMainBox && authForgotBox) {
        btnBackToLogin.addEventListener('click', () => {
            authForgotBox.classList.add('hidden');
            authMainBox.classList.remove('hidden');
        });
    }

    if (forgotForm && btnSendReset) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!db.hasInternet()) {
                syncAuthNetworkUI();
                showToast('İnternet bağlantısı yok. Şifre sıfırlama bağlantısı gönderilemez.', 'warning');
                return;
            }
            const email = document.getElementById('forgot-email').value;
            if (!email) return;

            btnSendReset.disabled = true;
            btnSendReset.textContent = 'Gönderiliyor...';

            try {
                await db.resetPassword(email);
                showToast('Şifre sıfırlama bağlantısı e-postanıza gönderildi! Lütfen gelen kutunuzu kontrol edin.', 'success');
                forgotForm.reset();
                if (authForgotBox && authMainBox) {
                    authForgotBox.classList.add('hidden');
                    authMainBox.classList.remove('hidden');
                }
            } catch (err) {
                console.error("Forgot password error:", err);
                showToast(err.message || 'Şifre sıfırlama bağlantısı gönderilemedi', 'danger');
            } finally {
                btnSendReset.disabled = false;
                btnSendReset.textContent = 'Sıfırlama Bağlantısı Gönder';
            }
        });
    }

    // New Password Modal Submit
    const resetForm = document.getElementById('reset-password-form');
    const btnSaveNewPassword = document.getElementById('btn-save-new-password');
    const modalResetPassword = document.getElementById('modal-reset-password');

    if (resetForm && btnSaveNewPassword) {
        resetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const p1 = document.getElementById('reset-new-password').value;
            const p2 = document.getElementById('reset-new-password-confirm').value;

            if (p1 !== p2) {
                showToast('Girdiğiniz şifreler birbiriyle eşleşmiyor!', 'danger');
                return;
            }
            if (p1.length < 8) {
                showToast('Şifreniz en az 8 karakter olmalıdır.', 'warning');
                return;
            }

            btnSaveNewPassword.disabled = true;
            btnSaveNewPassword.textContent = 'Güncelleniyor...';

            try {
                await db.updateUserPassword(p1);
                showToast('Şifreniz başarıyla güncellendi! Yönlendiriliyorsunuz...', 'success');
                if (modalResetPassword) modalResetPassword.classList.add('hidden');
                resetForm.reset();
                // Strip ?auth_flow=recovery from query string BEFORE routing so modal never re-opens
                window.history.replaceState({}, document.title, window.location.pathname + '#dashboard');
                window.dispatchEvent(new Event('hashchange'));
            } catch (err) {
                console.error("Password update error:", err);
                showToast(err.message || 'Şifre güncellenemedi', 'danger');
            } finally {
                btnSaveNewPassword.disabled = false;
                btnSaveNewPassword.textContent = 'Şifremi Güncelle & Devam Et';
            }
        });
    }

    const logoutBtn = document.getElementById('btn-logout');
    const mobileLogoutBtn = document.getElementById('btn-mobile-logout');
    const pendingLogoutBtn = document.getElementById('btn-pending-logout');
    
    const handleLogout = async (e) => {
        if (e) e.preventDefault();
        try {
            await db.signOut();
            state.activeUser = null;
            state.userProfile = null;
            state.isAdmin = false;
            setAiLauncherVisible(false);
            clearAdminViewState();
            showToast('Çıkış yapıldı', 'info');
            window.location.hash = '#explore';
        } catch (err) {
            console.error("Logout failed:", err);
            showToast('Çıkış yapılamadı: ' + err.message, 'danger');
        }
    };

    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);
    if (pendingLogoutBtn) pendingLogoutBtn.addEventListener('click', handleLogout);

    // Check if user arrived via recovery link
    checkResetPasswordMode();
}

/**
 * Check if current URL contains recovery token or hash
 */
export function checkResetPasswordMode(forceOpen = false) {
    const hash = window.location.hash || '';
    const params = new URLSearchParams(window.location.search || '');
    const modalResetPassword = document.getElementById('modal-reset-password');
    if (!modalResetPassword) return;

    if (forceOpen || hash.startsWith('#reset-password') || hash.includes('type=recovery') || params.get('auth_flow') === 'recovery') {
        modalResetPassword.classList.remove('hidden');
    }
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
