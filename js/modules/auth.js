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
            if (p1.length < 6) {
                showToast('Şifreniz en az 6 karakter olmalıdır.', 'warning');
                return;
            }

            btnSaveNewPassword.disabled = true;
            btnSaveNewPassword.textContent = 'Güncelleniyor...';

            try {
                await db.updateUserPassword(p1);
                showToast('Şifreniz başarıyla güncellendi! Giriş yapılıyor...', 'success');
                if (modalResetPassword) modalResetPassword.classList.add('hidden');
                resetForm.reset();
                window.location.hash = '#dashboard';
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
            showToast('Çıkış yapıldı', 'info');
            window.location.hash = '#auth';
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
export function checkResetPasswordMode() {
    const hash = window.location.hash;
    const modalResetPassword = document.getElementById('modal-reset-password');
    if (!modalResetPassword) return;

    if (hash.startsWith('#reset-password') || hash.includes('type=recovery')) {
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
