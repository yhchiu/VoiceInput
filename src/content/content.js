// Content script — focus tracking, recognition driver wiring, picker, insertion.
// In normal mode SpeechRecognition runs here; in Side Panel mode this script
// receives recognition events from the extension page and handles page UI/input.
(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;

  // Focus + selection state
  let lastTarget = null;
  let lastSelection = null;

  // Active session state
  let activeSessionId = null;
  let activeRecognizer = null;
  let activePicker = null;
  let activePickerId = 0;
  let activeListening = null;
  let activeInterimPreview = null;

  // === focus tracking ===
  function captureSelection(el) {
    if (!el) return null;
    if (globalThis.viIsNativeTextInput(el)) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value || '').length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      return { start, end };
    }
    if (el.isContentEditable) {
      // Read the selection from the target's own document; a frame-hosted
      // editor keeps its caret outside the top-level selection.
      const sel = globalThis.viSelectionFor(el);
      if (sel && sel.rangeCount) {
        try { return { range: sel.getRangeAt(0).cloneRange() }; } catch (_) {}
      }
    }
    return null;
  }

  function notifyPageTargetFocused() {
    chrome.runtime
      .sendMessage({
        target: TARGETS.BACKGROUND,
        source: TARGETS.CONTENT,
        action: MSG.PAGE_TARGET_FOCUSED,
        focusedAt: Date.now(),
      })
      .catch(() => {});
  }

  function rememberEditableTarget(el, notify = true) {
    if (!globalThis.viIsEditable(el)) return false;
    lastTarget = el;
    lastSelection = captureSelection(el);
    if (notify) notifyPageTargetFocused();
    return true;
  }

  function rememberEditableTargetSoon(el) {
    const remembered = rememberEditableTarget(el);
    setTimeout(() => {
      // A click on a frame-hosted editor lands on the host element, not on the
      // editable itself, so re-read the real focus target once the browser has
      // settled focus. This is also when a plain field's caret becomes final.
      const active = globalThis.viDeepActiveElement();
      if (globalThis.viIsEditable(active)) {
        rememberEditableTarget(active, !remembered);
      } else if (remembered) {
        rememberEditableTarget(el, false);
      }
    }, 0);
  }

  document.addEventListener('focusin', (e) => {
    rememberEditableTarget(e.target);
  }, true);

  document.addEventListener('pointerdown', (e) => {
    rememberEditableTargetSoon(e.target);
  }, true);

  document.addEventListener('pointerup', (e) => {
    rememberEditableTargetSoon(e.target);
  }, true);

  document.addEventListener('selectionchange', () => {
    if (!lastTarget || !globalThis.viIsAttached(lastTarget)) return;
    if (lastTarget !== globalThis.viDeepActiveElement()) return;
    const next = captureSelection(lastTarget);
    if (next) lastSelection = next;
  });

  function captureForRecognition() {
    const active = globalThis.viDeepActiveElement();
    if (globalThis.viIsEditable(active)) {
      lastTarget = active;
      lastSelection = captureSelection(active);
      return true;
    }
    if (lastTarget && globalThis.viIsAttached(lastTarget) && globalThis.viIsEditable(lastTarget)) {
      return true;
    }
    return false;
  }

  // === UI helpers ===
  function disposePicker() {
    if (activePicker) { try { activePicker.dispose(); } catch (_) {} activePicker = null; }
  }
  function disposeListening() {
    if (activeListening) { try { activeListening.dispose(); } catch (_) {} activeListening = null; }
  }
  function disposeInterimPreview() {
    if (activeInterimPreview) { try { activeInterimPreview.dispose(); } catch (_) {} activeInterimPreview = null; }
  }

  function notifyPickerClosed(pickerId) {
    chrome.runtime
      .sendMessage({
        target: TARGETS.BACKGROUND,
        source: TARGETS.CONTENT,
        action: MSG.PICKER_CLOSED,
        pickerId,
      })
      .catch(() => {});
  }

  function showListeningIndicator() {
    disposeListening();
    activeListening = globalThis.viMakeListening(t('popupListening'));
  }

  function updateInterimPreview(text) {
    if (!activeInterimPreview && lastTarget && globalThis.viIsAttached(lastTarget)) {
      activeInterimPreview = globalThis.viMakeInterimPreview(lastTarget, t('interimPreviewTitle'));
    }
    if (activeInterimPreview) {
      activeInterimPreview.update(text);
    }
  }

  function rememberRecentResult(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    chrome.runtime
      .sendMessage({
        target: TARGETS.BACKGROUND,
        action: MSG.SET_RECENT_RESULT,
        text,
      })
      .catch(() => {});
  }

  function copyTextFallback(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position: fixed; left: -9999px; top: 0; opacity: 0;';
    document.documentElement.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    let ok = false;
    try {
      ok = document.execCommand && document.execCommand('copy');
    } finally {
      try { textarea.remove(); } catch (_) {}
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

  async function copyRecognitionText(text) {
    if (typeof text !== 'string' || !text.trim()) return;
    try {
      await copyTextToClipboard(text);
      rememberRecentResult(text);
      globalThis.viMakeToast(t('toastCopied'));
    } catch (_) {
      globalThis.viMakeToast(t('toastCopyFailed'), 2600);
    }
  }

  // === Insertion ===
  function performInsertion(text, options = {}) {
    if (options.rememberRecent !== false) rememberRecentResult(text);
    if (!lastTarget || !globalThis.viIsAttached(lastTarget)) {
      globalThis.viMakeToast(t('pickerTargetGone'));
      return { ok: false, error: 'no-target' };
    }
    const r = globalThis.viInsertText(lastTarget, text, lastSelection);
    if (!r.ok) {
      globalThis.viMakeToast(t('pickerTargetGone'));
      return r;
    }
    lastSelection = captureSelection(lastTarget) || lastSelection;
    const preview = text.length > 32 ? text.slice(0, 32) + '…' : text;
    globalThis.viMakeToast(t('toastInserted', preview));
    return { ok: true };
  }

  // === Result handling ===
  async function handleResults(alternatives) {
    if (!alternatives || alternatives.length === 0) {
      globalThis.viMakeToast(t('pickerEmpty'));
      return;
    }
    const settings = await globalThis.viGetSettings();
    const replacementRules = settings.replacements || [];
    const replacedAlternatives = alternatives.map((alt) => ({
      ...alt,
      transcript: globalThis.viApplyReplacements(alt.transcript, replacementRules),
    }));
    const single = alternatives.length === 1;
    const auto = single && (settings.maxAlternatives === 1 || settings.autoInsertIfSingle);
    if (auto) {
      performInsertion(replacedAlternatives[0].transcript);
    } else {
      showPicker(replacedAlternatives);
    }
  }

  function showPicker(alternatives) {
    disposePicker();
    const pickerId = activePickerId + 1;
    let pickerClosed = false;
    activePickerId = pickerId;
    const closePicker = () => {
      if (pickerClosed) return;
      pickerClosed = true;
      if (activePickerId === pickerId) activePicker = null;
      notifyPickerClosed(pickerId);
    };
    activePicker = globalThis.viMakePicker({
      anchor: lastTarget,
      alternatives,
      t,
      onPick: (idx) => {
        closePicker();
        performInsertion(alternatives[idx].transcript);
      },
      onCopy: (idx) => copyRecognitionText(alternatives[idx].transcript),
      onCancel: closePicker,
    });
  }

  function handlePickerKey(key, pickerId) {
    if (!activePicker || typeof activePicker.handleKey !== 'function') return false;
    if (typeof pickerId === 'number' && pickerId !== activePickerId) return false;
    return !!activePicker.handleKey(key);
  }

  // === Errors ===
  const ERR_TO_KEY = {
    'no-speech': 'errNoSpeech',
    'audio-capture': 'errAudioCapture',
    'not-allowed': 'errNotAllowed',
    'service-not-allowed': 'errNotAllowed',
    'network': 'errNetwork',
    'language-not-supported': 'errLangNotSupported',
    'insecure-context': 'errUnknown',
    'unsupported': 'errUnknown',
  };

  async function queryMicState() {
    try {
      const res = await navigator.permissions.query({ name: 'microphone' });
      return res.state; // 'granted' | 'denied' | 'prompt'
    } catch (_) {
      return 'prompt';
    }
  }

  async function showError(error, message) {
    if (error === 'aborted') return;
    const key = ERR_TO_KEY[error] || 'errUnknown';
    const base = t(key);
    const suffix = error ? ` (${error})` : '';
    const extraMsg = message && /[A-Za-z]/.test(message) ? `\n${message}` : '';

    let hint = '';
    if (error === 'not-allowed' || error === 'service-not-allowed') {
      const state = await queryMicState();
      const hintKey = state === 'denied' ? 'errMicHintDenied' : 'errMicHintPrompt';
      hint = `\n\n${t(hintKey)}`;
    }

    const ttl = hint ? 6000 : 2200;
    globalThis.viMakeToast(base + suffix + extraMsg + hint, ttl);
  }

  // === Session lifecycle ===
  function endSession() {
    disposeListening();
    disposeInterimPreview();
    if (activeRecognizer) {
      try { activeRecognizer.abort(); } catch (_) {}
      activeRecognizer = null;
    }
    activeSessionId = null;
    chrome.runtime
      .sendMessage({ target: TARGETS.BACKGROUND, action: MSG.RECOGNITION_ENDED })
      .catch(() => {});
  }

  async function startRecognition(sessionId) {
    if (activeRecognizer) endSession();

    if (!captureForRecognition()) {
      globalThis.viMakeToast(t('pickerNoTarget'));
      chrome.runtime
        .sendMessage({ target: TARGETS.BACKGROUND, action: MSG.RECOGNITION_ENDED })
        .catch(() => {});
      return;
    }

    activeSessionId = sessionId;

    const settings = await globalThis.viGetSettings();

    const handle = globalThis.viCreateRecognizer({
      lang: settings.lang,
      maxAlternatives: settings.maxAlternatives,
      continuous: settings.continuous,
      interimResults: settings.interimResults,
      onStart: () => {
        showListeningIndicator();
      },
      onResult: (alternatives) => {
        if (!settings.continuous) disposeListening();
        if (activeInterimPreview) activeInterimPreview.update('');
        handleResults(alternatives);
      },
      onInterim: (text) => {
        updateInterimPreview(text);
      },
      onError: (error, message) => {
        disposeListening();
        disposeInterimPreview();
        showError(error, message);
      },
      onEnd: () => {
        endSession();
      },
    });

    if (!handle.ok) {
      showError(handle.reason, handle.message);
      endSession();
      return;
    }
    activeRecognizer = handle;
  }

  // === Message handler ===
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.target !== TARGETS.CONTENT) return false;

    switch (msg.action) {
      case MSG.START_RECOGNITION:
        startRecognition(msg.sessionId);
        sendResponse({ ok: true });
        return false;

      case MSG.STOP_RECOGNITION:
        endSession();
        sendResponse({ ok: true });
        return false;

      case MSG.INSERT_TEXT: {
        if (!captureForRecognition()) {
          globalThis.viMakeToast(t('pickerNoTarget'));
          sendResponse({ ok: false, error: 'no-target' });
          return false;
        }
        sendResponse(performInsertion(msg.text || '', { rememberRecent: false }));
        return false;
      }

      case MSG.PREPARE_RECOGNITION_TARGET: {
        const ok = captureForRecognition();
        if (!ok) globalThis.viMakeToast(t('pickerNoTarget'));
        sendResponse({ ok, error: ok ? undefined : 'no-target' });
        return false;
      }

      case MSG.RECOGNITION_STARTED:
        showListeningIndicator();
        sendResponse({ ok: true });
        return false;

      case MSG.RECOGNITION_RESULTS:
        (async () => {
          const settings = await globalThis.viGetSettings();
          if (!settings.continuous) disposeListening();
          if (activeInterimPreview) activeInterimPreview.update('');
          await handleResults(msg.alternatives || []);
          sendResponse({
            ok: true,
            picker: !!activePicker,
            pickerId: activePicker ? activePickerId : null,
          });
        })();
        return true;

      case MSG.RECOGNITION_INTERIM:
        updateInterimPreview(msg.text || '');
        sendResponse({ ok: true });
        return false;

      case MSG.PICKER_KEY:
        sendResponse({ ok: handlePickerKey(msg.key, msg.pickerId) });
        return false;

      case MSG.RECOGNITION_ERROR:
      case MSG.RECOGNITION_ENDED:
        disposeListening();
        disposeInterimPreview();
        sendResponse({ ok: true });
        return false;

      default:
        sendResponse({ ok: false, error: 'unknown-action' });
        return false;
    }
  });
})();
