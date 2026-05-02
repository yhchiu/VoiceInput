// Content script — focus tracking, recognition driver wiring, picker, insertion.
// SpeechRecognition runs here (in the host page's document) because Chrome
// offscreen documents do not reliably allow SR. Mic permission is granted
// per host the first time the user triggers recognition on that origin.
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
  let activeListening = null;

  // === focus tracking ===
  function captureSelection(el) {
    if (!el) return null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value || '').length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      return { start, end };
    }
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        try { return { range: sel.getRangeAt(0).cloneRange() }; } catch (_) {}
      }
    }
    return null;
  }

  document.addEventListener('focusin', (e) => {
    if (globalThis.viIsEditable(e.target)) {
      lastTarget = e.target;
      lastSelection = captureSelection(e.target);
    }
  }, true);

  document.addEventListener('selectionchange', () => {
    if (!lastTarget || !document.contains(lastTarget)) return;
    if (lastTarget !== document.activeElement) return;
    const next = captureSelection(lastTarget);
    if (next) lastSelection = next;
  });

  function captureForRecognition() {
    const active = document.activeElement;
    if (globalThis.viIsEditable(active)) {
      lastTarget = active;
      lastSelection = captureSelection(active);
      return true;
    }
    if (lastTarget && document.contains(lastTarget) && globalThis.viIsEditable(lastTarget)) {
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

  // === Insertion ===
  function performInsertion(text) {
    if (!lastTarget || !document.contains(lastTarget)) {
      globalThis.viMakeToast(t('pickerTargetGone'));
      return;
    }
    const r = globalThis.viInsertText(lastTarget, text, lastSelection);
    if (!r.ok) {
      globalThis.viMakeToast(t('pickerTargetGone'));
      return;
    }
    lastSelection = captureSelection(lastTarget) || lastSelection;
    const preview = text.length > 32 ? text.slice(0, 32) + '…' : text;
    globalThis.viMakeToast(t('toastInserted', preview));
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
    activePicker = globalThis.viMakePicker({
      anchor: lastTarget,
      alternatives,
      t,
      onPick: (idx) => {
        activePicker = null;
        performInsertion(alternatives[idx].transcript);
      },
      onCancel: () => { activePicker = null; },
    });
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
        disposeListening();
        activeListening = globalThis.viMakeListening(t('popupListening'));
      },
      onResult: (alternatives) => {
        if (!settings.continuous) disposeListening();
        if (activeListening && activeListening.updateInterim) activeListening.updateInterim('');
        handleResults(alternatives);
      },
      onInterim: (text) => {
        if (activeListening && activeListening.updateInterim) {
          activeListening.updateInterim(text);
        }
      },
      onError: (error, message) => {
        disposeListening();
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

      default:
        sendResponse({ ok: false, error: 'unknown-action' });
        return false;
    }
  });
})();
