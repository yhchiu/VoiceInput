(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;

  let activeRecognizer = null;
  let currentSessionId = null;
  let listening = false;
  let starting = false;
  let restarting = false;
  let recentResultText = '';
  let copyStatusTimer = null;
  let lastErrorText = '';
  let pendingResultDelivery = Promise.resolve();
  let pickerKeyForwarding = false;
  let pickerKeyForwardingId = null;
  let microphoneAccessGranted = false;
  let inputTarget = 'page';
  let pageTargetAt = 0;
  let scratchpadTargetAt = 0;
  let scratchpadSelection = { start: 0, end: 0 };
  let suppressScratchpadTargetChange = false;
  let suppressScratchpadTargetTimer = null;
  let currentRecognitionTarget = 'page';
  let scratchpadStatusTimer = null;
  let activeScratchpadPicker = null;
  let activeScratchpadInterimPreview = null;

  const PICKER_NAV_KEYS = new Set(['Escape', 'Enter', 'ArrowDown', 'ArrowUp']);

  const ERR_TO_KEY = {
    'no-speech': 'errNoSpeech',
    'audio-capture': 'errAudioCapture',
    'not-allowed': 'errNotAllowed',
    'service-not-allowed': 'errNotAllowed',
    'network': 'errNetwork',
    'language-not-supported': 'errLangNotSupported',
    'insecure-context': 'errUnknown',
    'unsupported': 'errUnknown',
    'start-failed': 'errUnknown',
  };

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  function sendBackground(action, payload = {}) {
    return chrome.runtime.sendMessage({
      target: TARGETS.BACKGROUND,
      source: TARGETS.SIDEPANEL,
      action,
      ...payload,
    });
  }

  function isPickerKey(key) {
    return PICKER_NAV_KEYS.has(key) || /^[1-9]$/.test(key);
  }

  function isEditableControl(el) {
    if (!el) return false;
    const tag = el.tagName;
    return !!(
      el.isContentEditable ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT'
    );
  }

  function shouldClosePickerKeyForwarding(key) {
    return key === 'Escape' || key === 'Enter' || /^[1-9]$/.test(key);
  }

  function forwardPickerKey(e) {
    if (!pickerKeyForwarding || !isPickerKey(e.key) || isEditableControl(e.target)) return;
    e.preventDefault();
    e.stopPropagation();

    sendBackground(MSG.PICKER_KEY, { key: e.key, pickerId: pickerKeyForwardingId })
      .then((res) => {
        if (!res || !res.ok || shouldClosePickerKeyForwarding(e.key)) {
          pickerKeyForwarding = false;
          pickerKeyForwardingId = null;
        }
      })
      .catch(() => {
        pickerKeyForwarding = false;
        pickerKeyForwardingId = null;
      });
  }

  function setStatus(text, color) {
    const status = document.getElementById('status');
    status.textContent = text;
    status.style.color = color;
  }

  function updateButton() {
    const button = document.getElementById('start');
    button.textContent = listening ? t('popupStop') : t('popupStart');
    button.classList.toggle('warn', listening);
    button.classList.toggle('primary', !listening);
    button.disabled = starting && !listening;
    button.setAttribute('aria-pressed', listening ? 'true' : 'false');
  }

  function renderListeningState() {
    if (listening) {
      setStatus(t('popupListening'), '#dc2626');
    } else if (!lastErrorText) {
      setStatus(t('popupIdle'), '#64748b');
    }
    updateButton();
  }

  async function loadSettings() {
    const settings = await globalThis.viGetSettings();
    globalThis.viBuildLangOptions(document.getElementById('lang'), settings.lang, t('optLangAuto'));
    const continuous = document.getElementById('continuous');
    continuous.checked = !!settings.continuous;
    continuous.closest('.toggle-row').title = t('optContinuousHint');
  }

  function getScratchpad() {
    return document.getElementById('scratchpad');
  }

  function captureScratchpadSelection() {
    const scratchpad = getScratchpad();
    if (!scratchpad) return;
    scratchpadSelection = {
      start: typeof scratchpad.selectionStart === 'number' ? scratchpad.selectionStart : scratchpad.value.length,
      end: typeof scratchpad.selectionEnd === 'number' ? scratchpad.selectionEnd : scratchpad.value.length,
    };
  }

  function renderInputTarget() {
    const field = document.querySelector('.scratchpad-field');
    if (field) field.classList.toggle('is-target', inputTarget === 'scratchpad');
  }

  function selectScratchpadTarget() {
    if (suppressScratchpadTargetChange) {
      captureScratchpadSelection();
      return;
    }
    inputTarget = 'scratchpad';
    scratchpadTargetAt = Date.now();
    captureScratchpadSelection();
    renderInputTarget();
  }

  function runWithoutScratchpadTargetChange(callback) {
    suppressScratchpadTargetChange = true;
    if (suppressScratchpadTargetTimer) clearTimeout(suppressScratchpadTargetTimer);
    try {
      callback();
    } finally {
      suppressScratchpadTargetTimer = setTimeout(() => {
        suppressScratchpadTargetChange = false;
        suppressScratchpadTargetTimer = null;
      }, 0);
    }
  }

  function placeScratchpadCursor(scratchpad, start, end, shouldFocus) {
    if (!scratchpad) return;
    runWithoutScratchpadTargetChange(() => {
      if (shouldFocus && document.activeElement !== scratchpad) scratchpad.focus();
      try { scratchpad.setSelectionRange(start, end); } catch (_) {}
      captureScratchpadSelection();
    });
  }

  function selectPageTarget(focusedAt) {
    const nextFocusedAt = typeof focusedAt === 'number' ? focusedAt : Date.now();
    pageTargetAt = Math.max(pageTargetAt, nextFocusedAt);
    if (pageTargetAt > scratchpadTargetAt) {
      inputTarget = 'page';
      disposeScratchpadPicker();
      renderInputTarget();
    }
  }

  async function resolveStartTargetMode() {
    try {
      const res = await sendBackground(MSG.GET_PAGE_TARGET_STATE);
      const focusedAt = res && res.pageTarget && typeof res.pageTarget.focusedAt === 'number'
        ? res.pageTarget.focusedAt
        : 0;
      if (focusedAt) selectPageTarget(focusedAt);
    } catch (_) {}

    if (pageTargetAt > scratchpadTargetAt) return 'page';
    return inputTarget === 'scratchpad' ? 'scratchpad' : 'page';
  }

  function disposeScratchpadPicker() {
    if (activeScratchpadPicker) {
      try { activeScratchpadPicker.dispose(); } catch (_) {}
      activeScratchpadPicker = null;
    }
  }

  function disposeScratchpadInterimPreview() {
    if (activeScratchpadInterimPreview) {
      try { activeScratchpadInterimPreview.dispose(); } catch (_) {}
      activeScratchpadInterimPreview = null;
    }
  }

  function updateScratchpadInterimPreview(text) {
    const next = typeof text === 'string' ? text : '';
    const scratchpad = getScratchpad();
    if (!next.trim() && !activeScratchpadInterimPreview) return;
    if (!activeScratchpadInterimPreview && scratchpad && typeof globalThis.viMakeInterimPreview === 'function') {
      activeScratchpadInterimPreview = globalThis.viMakeInterimPreview(scratchpad, t('interimPreviewTitle'));
    }
    if (activeScratchpadInterimPreview) {
      activeScratchpadInterimPreview.update(next);
    }
  }

  function updateScratchpadActions() {
    const scratchpad = getScratchpad();
    const copy = document.getElementById('copy-scratchpad');
    const clear = document.getElementById('clear-scratchpad');
    if (!scratchpad || !copy || !clear) return;
    const hasText = scratchpad.value.length > 0;
    copy.disabled = !hasText;
    clear.disabled = !hasText;
  }

  function setScratchpadStatus(message, isError = false) {
    const status = document.getElementById('scratchpad-status');
    status.textContent = message;
    status.hidden = false;
    status.classList.toggle('is-error', isError);
    if (scratchpadStatusTimer) clearTimeout(scratchpadStatusTimer);
    scratchpadStatusTimer = setTimeout(() => {
      status.hidden = true;
      status.textContent = '';
      status.classList.remove('is-error');
    }, 1500);
  }

  function insertScratchpadText(text) {
    disposeScratchpadPicker();
    const scratchpad = getScratchpad();
    if (!scratchpad || typeof text !== 'string') return;
    const start = Math.max(0, Math.min(scratchpad.value.length, scratchpadSelection.start));
    const end = Math.max(start, Math.min(scratchpad.value.length, scratchpadSelection.end));
    scratchpad.value = scratchpad.value.slice(0, start) + text + scratchpad.value.slice(end);
    const next = start + text.length;
    placeScratchpadCursor(scratchpad, next, next, inputTarget === 'scratchpad');
    updateScratchpadActions();
  }

  async function copyScratchpad() {
    const scratchpad = getScratchpad();
    if (!scratchpad || !scratchpad.value) return;
    try {
      await copyTextToClipboard(scratchpad.value);
      setScratchpadStatus(t('popupCopied'));
    } catch (_) {
      setScratchpadStatus(t('popupCopyFailed'), true);
    }
  }

  async function copyScratchpadAlternative(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    try {
      await copyTextToClipboard(text);
      rememberRecentResult(text);
      setScratchpadStatus(t('popupCopied'));
    } catch (_) {
      setScratchpadStatus(t('popupCopyFailed'), true);
    }
  }

  function clearScratchpad() {
    const scratchpad = getScratchpad();
    if (!scratchpad) return;
    scratchpad.value = '';
    placeScratchpadCursor(scratchpad, 0, 0, inputTarget === 'scratchpad');
    updateScratchpadActions();
  }

  function setupScratchpad() {
    const scratchpad = getScratchpad();
    const copy = document.getElementById('copy-scratchpad');
    const clear = document.getElementById('clear-scratchpad');
    if (!scratchpad || !copy || !clear) return;

    scratchpad.placeholder = t('sidePanelScratchpadPlaceholder');
    copy.title = t('sidePanelCopyScratchpad');
    copy.setAttribute('aria-label', t('sidePanelCopyScratchpad'));
    clear.title = t('sidePanelClearScratchpad');
    clear.setAttribute('aria-label', t('sidePanelClearScratchpad'));

    scratchpad.addEventListener('pointerdown', selectScratchpadTarget);
    scratchpad.addEventListener('click', selectScratchpadTarget);
    scratchpad.addEventListener('keyup', selectScratchpadTarget);
    scratchpad.addEventListener('mouseup', selectScratchpadTarget);
    scratchpad.addEventListener('input', () => {
      selectScratchpadTarget();
      updateScratchpadActions();
    });
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    clear.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', copyScratchpad);
    clear.addEventListener('click', clearScratchpad);
    updateScratchpadActions();
    renderInputTarget();
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
      const res = await sendBackground(MSG.GET_RECENT_RESULT);
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

  function rememberRecentResult(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    sendBackground(MSG.SET_RECENT_RESULT, { text }).catch(() => {});
  }

  async function handleScratchpadResults(alternatives) {
    if (!alternatives || alternatives.length === 0) {
      setStatus(t('pickerEmpty'), '#b91c1c');
      return;
    }
    const settings = await globalThis.viGetSettings();
    const replacementRules = settings.replacements || [];
    const replacedAlternatives = alternatives.map((alt) => ({
      ...alt,
      transcript: globalThis.viApplyReplacements(alt.transcript || '', replacementRules),
    })).filter((alt) => alt.transcript.trim());
    if (replacedAlternatives.length === 0) {
      setStatus(t('pickerEmpty'), '#b91c1c');
      return;
    }

    const single = replacedAlternatives.length === 1;
    const auto = single && (settings.maxAlternatives === 1 || settings.autoInsertIfSingle);
    if (auto || typeof globalThis.viMakePicker !== 'function') {
      insertScratchpadText(replacedAlternatives[0].transcript);
      rememberRecentResult(replacedAlternatives[0].transcript);
      return;
    }

    showScratchpadPicker(replacedAlternatives);
  }

  function showScratchpadPicker(alternatives) {
    const scratchpad = getScratchpad();
    if (!scratchpad) return;
    disposeScratchpadPicker();
    activeScratchpadPicker = globalThis.viMakePicker({
      anchor: scratchpad,
      alternatives,
      t,
      onPick: (idx) => {
        const text = alternatives[idx].transcript;
        activeScratchpadPicker = null;
        insertScratchpadText(text);
        rememberRecentResult(text);
      },
      onCopy: (idx) => copyScratchpadAlternative(alternatives[idx].transcript),
      onCancel: () => { activeScratchpadPicker = null; },
    });
  }

  function startErrorMessage(error) {
    if (error === 'side-panel-disabled') return t('sidePanelModeDisabled');
    if (error === 'no-target') return t('pickerNoTarget');
    if (error === 'content-unavailable' || error === 'no-active-tab') return t('sidePanelPageUnavailable');
    return t('errUnknown');
  }

  function recognizerErrorMessage(error, message) {
    const key = ERR_TO_KEY[error] || 'errUnknown';
    const suffix = error ? ` (${error})` : '';
    const extraMsg = message && /[A-Za-z]/.test(message) ? `\n${message}` : '';
    return t(key) + suffix + extraMsg;
  }

  async function queryMicrophoneState() {
    try {
      const res = await navigator.permissions.query({ name: 'microphone' });
      return res && res.state;
    } catch (_) {
      return null;
    }
  }

  function stopMediaStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch (_) {}
    });
  }

  function microphoneAccessError(error) {
    const name = error && error.name;
    const message = (error && error.message) || name || '';
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return { ok: false, error: 'not-allowed', message };
    }
    return { ok: false, error: 'audio-capture', message };
  }

  async function openMicrophonePermissionPage() {
    try {
      const res = await sendBackground(MSG.OPEN_MIC_PERMISSION_PAGE);
      return !!(res && res.ok);
    } catch (_) {
      return false;
    }
  }

  async function ensureMicrophoneAccess() {
    if (microphoneAccessGranted) return { ok: true };
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      return { ok: false, error: 'audio-capture', message: 'getUserMedia is not available.' };
    }

    try {
      setStatus(t('sidePanelMicPermissionPrompt'), '#64748b');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stopMediaStream(stream);
      microphoneAccessGranted = true;
      return { ok: true };
    } catch (error) {
      const mapped = microphoneAccessError(error);
      const state = await queryMicrophoneState();
      const dismissed = /dismiss/i.test(mapped.message || '');
      if (mapped.error === 'not-allowed' && (dismissed || state !== 'denied') && await openMicrophonePermissionPage()) {
        return { ok: false, error: 'permission-page-opened' };
      }
      return mapped;
    }
  }

  function showMicrophoneAccessError(result) {
    if (result && result.error === 'permission-page-opened') {
      lastErrorText = t('sidePanelMicPermissionOpened');
    } else {
      lastErrorText = recognizerErrorMessage(result && result.error, result && result.message);
    }
    setStatus(lastErrorText, '#b91c1c');
  }

  async function finishSession(sessionId) {
    const targetMode = currentRecognitionTarget;
    await pendingResultDelivery.catch(() => {});
    if (targetMode === 'scratchpad') {
      disposeScratchpadInterimPreview();
    }
    activeRecognizer = null;
    currentSessionId = null;
    currentRecognitionTarget = 'page';
    listening = false;
    starting = false;
    if (!lastErrorText) renderListeningState();
    updateButton();
    await refreshRecentResult();
    if (sessionId && targetMode !== 'scratchpad') {
      sendBackground(MSG.RECOGNITION_ENDED, { sessionId }).catch(() => {});
    }
  }

  async function startRecognition(preparedSessionId, targetMode = 'page') {
    if (listening || starting) return;

    lastErrorText = '';
    pickerKeyForwarding = false;
    pickerKeyForwardingId = null;
    starting = true;
    updateButton();
    setStatus(t('popupListening'), '#dc2626');

    const micAccess = await ensureMicrophoneAccess();
    if (!micAccess.ok) {
      starting = false;
      showMicrophoneAccessError(micAccess);
      updateButton();
      if (preparedSessionId && targetMode !== 'scratchpad') {
        sendBackground(MSG.RECOGNITION_ENDED, { sessionId: preparedSessionId }).catch(() => {});
      }
      return;
    }

    let sessionId = preparedSessionId;
    if (targetMode === 'scratchpad') {
      sessionId = `scratchpad-${crypto.randomUUID()}`;
    } else if (!sessionId) {
      let response;
      try {
        response = await sendBackground(MSG.START_RECOGNITION);
      } catch (_) {
        response = { ok: false, error: 'content-unavailable' };
      }
      if (!response || !response.ok || response.mode !== 'sidepanel' || !response.sessionId) {
        starting = false;
        lastErrorText = startErrorMessage(response && response.error);
        setStatus(lastErrorText, '#b91c1c');
        updateButton();
        return;
      }
      sessionId = response.sessionId;
    }

    currentSessionId = sessionId;
    currentRecognitionTarget = targetMode;
    const settings = await globalThis.viGetSettings();
    const handle = globalThis.viCreateRecognizer({
      lang: settings.lang,
      maxAlternatives: settings.maxAlternatives,
      continuous: settings.continuous,
      interimResults: settings.interimResults,
      onStart: () => {
        starting = false;
        listening = true;
        renderListeningState();
        if (currentRecognitionTarget !== 'scratchpad') {
          sendBackground(MSG.RECOGNITION_STARTED, { sessionId }).catch(() => {});
        }
      },
      onResult: (alternatives) => {
        if (currentRecognitionTarget === 'scratchpad') {
          updateScratchpadInterimPreview('');
          pendingResultDelivery = pendingResultDelivery
            .catch(() => {})
            .then(() => handleScratchpadResults(alternatives))
            .catch(() => {});
        } else {
          pendingResultDelivery = pendingResultDelivery
            .catch(() => {})
            .then(() => sendBackground(MSG.RECOGNITION_RESULTS, { sessionId, alternatives }))
            .then((res) => {
              pickerKeyForwarding = !!(res && res.ok && res.picker);
              pickerKeyForwardingId = pickerKeyForwarding ? res.pickerId : null;
              if (res && res.ok === false) {
                lastErrorText = startErrorMessage(res.error);
                setStatus(lastErrorText, '#b91c1c');
              }
            }).catch(() => {});
        }
        setTimeout(refreshRecentResult, 300);
      },
      onInterim: (text) => {
        if (currentRecognitionTarget === 'scratchpad') {
          updateScratchpadInterimPreview(text);
        } else {
          sendBackground(MSG.RECOGNITION_INTERIM, { sessionId, text }).catch(() => {});
        }
      },
      onError: (error, message) => {
        lastErrorText = recognizerErrorMessage(error, message);
        setStatus(lastErrorText, '#b91c1c');
        if (currentRecognitionTarget === 'scratchpad') {
          disposeScratchpadInterimPreview();
        }
        if (currentRecognitionTarget !== 'scratchpad') {
          sendBackground(MSG.RECOGNITION_ERROR, { sessionId }).catch(() => {});
        }
      },
      onEnd: () => {
        finishSession(sessionId);
      },
    });

    if (!handle.ok) {
      const failedTargetMode = currentRecognitionTarget;
      starting = false;
      currentSessionId = null;
      currentRecognitionTarget = 'page';
      if (failedTargetMode === 'scratchpad') {
        disposeScratchpadInterimPreview();
      }
      lastErrorText = recognizerErrorMessage(handle.reason, handle.message);
      setStatus(lastErrorText, '#b91c1c');
      updateButton();
      if (failedTargetMode !== 'scratchpad') {
        sendBackground(MSG.RECOGNITION_ENDED, { sessionId }).catch(() => {});
      }
      return;
    }

    activeRecognizer = handle;
  }

  function stopRecognition() {
    const sessionId = currentSessionId;
    if (activeRecognizer) {
      try { activeRecognizer.abort(); } catch (_) {}
      return;
    }
    if (sessionId) {
      finishSession(sessionId);
    }
  }

  function restartRecognition() {
    if (restarting) return;
    const targetMode = currentRecognitionTarget === 'scratchpad' ? 'scratchpad' : 'page';
    restarting = true;
    stopRecognition();
    setTimeout(() => {
      restarting = false;
      startRecognition(undefined, targetMode);
    }, 250);
  }

  async function refreshStatus() {
    try {
      const res = await sendBackground(MSG.GET_STATUS);
      const remoteListening = !!(res && res.listening && res.mode === 'sidepanel');
      listening = !!(activeRecognizer && remoteListening);
    } catch (_) {
      listening = false;
    }
    renderListeningState();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    await loadSettings();
    setupScratchpad();
    await refreshRecentResult();

    const startButton = document.getElementById('start');
    startButton.addEventListener('click', async () => {
      if (listening || activeRecognizer || starting) {
        stopRecognition();
      } else {
        const targetMode = await resolveStartTargetMode();
        if (listening || activeRecognizer || starting) return;
        startRecognition(undefined, targetMode);
      }
    });

    const lang = document.getElementById('lang');
    lang.addEventListener('change', async (e) => {
      await globalThis.viSetSettings({ lang: e.target.value });
      if ((!listening && !activeRecognizer) || restarting) return;

      restartRecognition();
    });

    const continuous = document.getElementById('continuous');
    continuous.addEventListener('change', async (e) => {
      await globalThis.viSetSettings({ continuous: e.target.checked });
      if ((!listening && !activeRecognizer) || restarting) return;

      restartRecognition();
    });

    document.getElementById('copy-recent').addEventListener('click', copyRecentResult);
    document.addEventListener('keydown', forwardPickerKey, true);

    document.getElementById('open-options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    let startedFromPending = false;
    try {
      const ready = await sendBackground(MSG.SIDE_PANEL_READY);
      if (ready && ready.start && ready.sessionId) {
        startedFromPending = true;
        startRecognition(ready.sessionId, 'page');
      }
    } catch (_) {}

    if (!startedFromPending) {
      await refreshStatus();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== TARGETS.SIDEPANEL) return false;

    switch (msg.action) {
      case MSG.START_RECOGNITION:
        startRecognition(msg.sessionId);
        sendResponse({ ok: true });
        return false;

      case MSG.STOP_RECOGNITION:
        stopRecognition();
        sendResponse({ ok: true });
        return false;

      case MSG.PICKER_CLOSED:
        if (pickerKeyForwardingId === null || msg.pickerId === pickerKeyForwardingId) {
          pickerKeyForwarding = false;
          pickerKeyForwardingId = null;
        }
        sendResponse({ ok: true });
        return false;

      case MSG.RECENT_RESULT_UPDATED:
        applyRecentResult(msg.result);
        sendResponse({ ok: true });
        return false;

      case MSG.PAGE_TARGET_FOCUSED:
        selectPageTarget(
          msg && msg.pageTarget && typeof msg.pageTarget.focusedAt === 'number'
            ? msg.pageTarget.focusedAt
            : msg.focusedAt
        );
        sendResponse({ ok: true });
        return false;

      case MSG.MICROPHONE_PERMISSION_GRANTED:
        microphoneAccessGranted = true;
        if (!listening && !starting) {
          lastErrorText = '';
          setStatus(t('permGranted'), '#16a34a');
          updateButton();
        }
        sendResponse({ ok: true });
        return false;

      default:
        sendResponse({ ok: false, error: 'unknown-action' });
        return false;
    }
  });
})();
