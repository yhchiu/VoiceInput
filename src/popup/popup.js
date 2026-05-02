(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  async function refreshStatus() {
    const status = document.getElementById('status');
    try {
      const res = await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: MSG.GET_STATUS,
      });
      if (res && res.listening) {
        status.textContent = t('popupListening');
        status.style.color = '#dc2626';
      } else {
        status.textContent = t('popupIdle');
        status.style.color = '#64748b';
      }
    } catch (_) {
      status.textContent = t('popupIdle');
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    await refreshStatus();

    document.getElementById('start').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: MSG.START_RECOGNITION,
      });
      window.close();
    });

    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  });
})();
