(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;
  let listening = false;
  let restarting = false;
  let recentResultText = '';
  let copyStatusTimer = null;

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

  async function loadSettings() {
    const settings = await globalThis.viGetSettings();
    globalThis.viBuildLangOptions(document.getElementById('lang'), settings.lang, t('optLangAuto'));
  }

  function copyTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position: fixed; left: -9999px; top: 0; opacity: 0;';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let ok = false;
    try {
      ok = document.execCommand && document.execCommand('copy');
    } finally {
      textarea.remove();
    }
    if (!ok) throw new Error('copy-failed');
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {}
    }
    copyTextFallback(text);
  }

  function setCopyStatus(message, isError = false) {
    const status = document.getElementById('copy-status');
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle('is-error', isError);
    if (copyStatusTimer) clearTimeout(copyStatusTimer);
    copyStatusTimer = setTimeout(() => {
      status.hidden = true;
      status.textContent = '';
      status.classList.remove('is-error');
    }, 1500);
  }

  async function refreshRecentResult() {
    try {
      const res = await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: MSG.GET_RECENT_RESULT,
      });
      applyRecentResult(res && res.result);
    } catch (_) {
      applyRecentResult(null);
    }
  }

  function applyRecentResult(result) {
    const text = document.getElementById('recent-result-text');
    const copy = document.getElementById('copy-recent');
    if (!text || !copy) return;
    recentResultText = result && typeof result.text === 'string' ? result.text : '';
    const hasResult = recentResultText.trim().length > 0;
    text.textContent = hasResult ? recentResultText : t('popupNoRecentResult');
    text.title = hasResult ? recentResultText : '';
    text.classList.toggle('is-empty', !hasResult);
    copy.disabled = !hasResult;
    copy.title = t('popupCopyRecent');
    copy.setAttribute('aria-label', t('popupCopyRecent'));
  }

  async function copyRecentResult() {
    if (!recentResultText.trim()) return;
    try {
      await copyTextToClipboard(recentResultText);
      setCopyStatus(t('popupCopied'));
    } catch (_) {
      setCopyStatus(t('popupCopyFailed'), true);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    await loadSettings();
    await refreshRecentResult();
    await refreshStatus();

    document.getElementById('start').addEventListener('click', async () => {
      await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: listening ? MSG.STOP_RECOGNITION : MSG.START_RECOGNITION,
      });
      window.close();
    });

    document.getElementById('lang').addEventListener('change', async (e) => {
      await globalThis.viSetSettings({ lang: e.target.value });
      if (!listening || restarting) return;

      restarting = true;
      try {
        await chrome.runtime.sendMessage({
          target: TARGETS.BACKGROUND,
          action: MSG.START_RECOGNITION,
        });
        await refreshStatus();
      } finally {
        restarting = false;
      }
    });

    document.getElementById('copy-recent').addEventListener('click', copyRecentResult);

    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== TARGETS.POPUP) return false;

    switch (msg.action) {
      case MSG.RECENT_RESULT_UPDATED:
        applyRecentResult(msg.result);
        sendResponse({ ok: true });
        return false;

      default:
        sendResponse({ ok: false, error: 'unknown-action' });
        return false;
    }
  });
})();
