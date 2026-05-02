(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;
  let listening = false;

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  async function refreshStatus() {
    const status = document.getElementById('status');
    const button = document.getElementById('start');
    try {
      const res = await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: MSG.GET_STATUS,
      });
      listening = !!(res && res.listening);
      if (listening) {
        status.textContent = t('popupListening');
        status.style.color = '#dc2626';
      } else {
        status.textContent = t('popupIdle');
        status.style.color = '#64748b';
      }
    } catch (_) {
      listening = false;
      status.textContent = t('popupIdle');
      status.style.color = '#64748b';
    }
    button.textContent = listening ? t('popupStop') : t('popupStart');
    button.classList.toggle('warn', listening);
    button.classList.toggle('primary', !listening);
    button.setAttribute('aria-pressed', listening ? 'true' : 'false');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    await refreshStatus();

    document.getElementById('start').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: listening ? MSG.STOP_RECOGNITION : MSG.START_RECOGNITION,
      });
      window.close();
    });

    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  });
})();
