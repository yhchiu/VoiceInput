(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;
  let listening = false;
  let restarting = false;
  let recentResultText = '';
  let copyStatusTimer = null;
  let phraseStatusTimer = null;

  const PHRASE_COPY_ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  const PHRASE_CHECK_ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
  let flashButton = null;
  let flashButtonIcon = '';
  let flashButtonLabel = '';
  let flashButtonTimer = null;

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
    const continuous = document.getElementById('continuous');
    continuous.checked = !!settings.continuous;
    continuous.closest('.toggle-row').title = t('optContinuousHint');
    renderCommonPhrases(settings.commonPhrases);
  }

  async function restartRecognition() {
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

  function startErrorMessage(error) {
    if (error === 'no-target') return t('pickerNoTarget');
    if (error === 'content-unavailable' || error === 'no-active-tab') return t('pageUnavailable');
    if (error === 'side-panel-disabled') return t('sidePanelModeDisabled');
    return t('errUnknown');
  }

  function setStartStatus(message) {
    const status = document.getElementById('start-status');
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', !!message);
  }

  function setPhraseStatus(message, isError = false) {
    const status = document.getElementById('phrase-status');
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle('is-error', isError);
    if (phraseStatusTimer) clearTimeout(phraseStatusTimer);
    phraseStatusTimer = setTimeout(() => {
      status.hidden = true;
      status.textContent = '';
      status.classList.remove('is-error');
    }, 1500);
  }

  function phrasePreview(text) {
    const next = String(text || '').replace(/\s+/g, ' ').trim();
    return next.length > 48 ? next.slice(0, 48) + '…' : next;
  }

  function renderCommonPhrases(commonPhrases) {
    const list = document.getElementById('common-phrases');
    const empty = document.getElementById('common-phrases-empty');
    if (!list || !empty) return;
    const phrases = globalThis.viNormalizeCommonPhrases(commonPhrases);
    list.innerHTML = '';
    empty.hidden = phrases.length > 0;
    const count = document.getElementById('common-phrases-count');
    if (count) {
      count.textContent = String(phrases.length);
      count.hidden = phrases.length === 0;
    }

    phrases.forEach((phrase) => {
      const row = document.createElement('div');
      row.className = 'phrase-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'phrase-button';
      button.title = phrase.text;
      const title = document.createElement('span');
      title.className = 'phrase-title';
      title.textContent = phrase.title;
      button.appendChild(title);
      const preview = document.createElement('span');
      preview.className = 'phrase-preview';
      preview.textContent = phrasePreview(phrase.text);
      button.appendChild(preview);
      button.addEventListener('click', () => insertCommonPhrase(phrase.text));
      row.appendChild(button);

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'phrase-copy';
      copy.title = t('commonPhraseCopy');
      copy.setAttribute('aria-label', t('commonPhraseCopy'));
      copy.innerHTML = PHRASE_COPY_ICON;
      copy.addEventListener('click', () => copyCommonPhrase(phrase.text, copy));
      row.appendChild(copy);

      list.appendChild(row);
    });
  }

  // Flash a button's icon to a checkmark for a moment, then restore the given
  // icon and label. Shared by the common phrase copy buttons and the recent
  // result copy button, which use the same copy glyph.
  function resetButtonFlash() {
    if (flashButtonTimer) {
      clearTimeout(flashButtonTimer);
      flashButtonTimer = null;
    }
    if (flashButton) {
      flashButton.classList.remove('is-copied');
      flashButton.innerHTML = flashButtonIcon;
      flashButton.title = flashButtonLabel;
      flashButton.setAttribute('aria-label', flashButtonLabel);
      flashButton = null;
      flashButtonIcon = '';
      flashButtonLabel = '';
    }
  }

  function flashButtonDone(button, doneLabel, restoreIcon, restoreLabel) {
    if (!button) return;
    resetButtonFlash();
    flashButton = button;
    flashButtonIcon = restoreIcon;
    flashButtonLabel = restoreLabel;
    button.classList.add('is-copied');
    button.innerHTML = PHRASE_CHECK_ICON;
    button.title = doneLabel;
    button.setAttribute('aria-label', doneLabel);
    flashButtonTimer = setTimeout(resetButtonFlash, 1200);
  }

  async function copyCommonPhrase(text, button) {
    try {
      await copyTextToClipboard(text);
      flashButtonDone(button, t('popupCopied'), PHRASE_COPY_ICON, t('commonPhraseCopy'));
    } catch (_) {
      setPhraseStatus(t('popupCopyFailed'), true);
    }
  }

  async function insertCommonPhrase(text) {
    try {
      const res = await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        action: MSG.INSERT_TEXT,
        text,
      });
      if (res && res.ok) {
        window.close();
        return;
      }
      setPhraseStatus(t('commonPhraseInsertFailed'), true);
    } catch (_) {
      setPhraseStatus(t('commonPhraseInsertFailed'), true);
    }
  }

  function isPhraseMenuOpen() {
    const toggle = document.getElementById('common-phrases-toggle');
    return !!toggle && toggle.getAttribute('aria-expanded') === 'true';
  }

  function setPhraseMenuOpen(open) {
    const toggle = document.getElementById('common-phrases-toggle');
    const panel = document.getElementById('common-phrases-panel');
    if (!toggle || !panel) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    panel.hidden = !open;
  }

  function setupPhraseMenu() {
    const toggle = document.getElementById('common-phrases-toggle');
    const field = toggle && toggle.closest('.common-phrases-field');
    if (!toggle || !field) return;
    toggle.addEventListener('click', () => setPhraseMenuOpen(!isPhraseMenuOpen()));
    document.addEventListener('click', (e) => {
      if (isPhraseMenuOpen() && !field.contains(e.target)) setPhraseMenuOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isPhraseMenuOpen()) {
        setPhraseMenuOpen(false);
        toggle.focus();
      }
    });
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
      flashButtonDone(
        document.getElementById('copy-recent'),
        t('popupCopied'),
        PHRASE_COPY_ICON,
        t('popupCopyRecent')
      );
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
      const stopping = listening;
      setStartStatus('');

      let res = null;
      try {
        res = await chrome.runtime.sendMessage({
          target: TARGETS.BACKGROUND,
          action: stopping ? MSG.STOP_RECOGNITION : MSG.START_RECOGNITION,
        });
      } catch (_) {}

      // Closing on a failed start hid the reason and left the user waiting to
      // speak into a session that never began. Stopping is best effort, so it
      // still closes either way.
      if (stopping || (res && res.ok !== false)) {
        window.close();
        return;
      }

      setStartStatus(startErrorMessage(res && res.error));
      await refreshStatus();
    });

    document.getElementById('lang').addEventListener('change', async (e) => {
      await globalThis.viSetSettings({ lang: e.target.value });
      if (!listening || restarting) return;

      await restartRecognition();
    });

    document.getElementById('continuous').addEventListener('change', async (e) => {
      await globalThis.viSetSettings({ continuous: e.target.checked });
      if (!listening || restarting) return;

      await restartRecognition();
    });

    document.getElementById('copy-recent').addEventListener('click', copyRecentResult);

    setupPhraseMenu();

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
