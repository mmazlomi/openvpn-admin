'use strict';

const form = document.getElementById('login-form');
const errEl = document.getElementById('login-error');
const btn = document.getElementById('login-btn');
const themeToggle = document.getElementById('theme-toggle');
const langToggle = document.getElementById('lang-toggle');

// Initialize i18n & Theme
applyI18nToDom();
applyTheme();

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    toggleTheme();
  });
}

if (langToggle) {
  langToggle.addEventListener('click', () => {
    toggleLanguage();
    applyTheme();
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = t('loginProgress');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: form.username.value,
        password: form.password.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || t('loginFailed'));
    }
    window.location.href = '/';
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = t('loginSubmit');
  }
});
