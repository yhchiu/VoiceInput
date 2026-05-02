// Web Speech API driver running in the content script.
// Exposes globalThis.viCreateRecognizer({ lang, maxAlternatives, continuous, interimResults, on… }).
//
// SR runs here (rather than in an offscreen document) because Chrome's
// offscreen documents reliably reject SpeechRecognition with `not-allowed`.
// Trade-off: microphone permission is granted per host, not per extension.
(function () {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  function viCreateRecognizer(opts) {
    if (!SR) {
      return {
        ok: false,
        reason: 'unsupported',
        message: 'SpeechRecognition not supported in this browser.',
      };
    }
    if (!window.isSecureContext) {
      return {
        ok: false,
        reason: 'insecure-context',
        message: 'SpeechRecognition requires HTTPS or localhost.',
      };
    }

    const r = new SR();
    r.lang = opts.lang || 'en-US';
    r.maxAlternatives = Math.max(1, Math.min(10, Number(opts.maxAlternatives) || 1));
    r.continuous = !!opts.continuous;
    r.interimResults = !!opts.interimResults;

    let resultSent = false;
    let aborted = false;

    r.onstart = () => { try { opts.onStart && opts.onStart(); } catch (_) {} };

    r.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      if (!last || !last.isFinal) return;
      if (resultSent) return;
      const alternatives = [];
      for (let i = 0; i < last.length; i++) {
        alternatives.push({
          transcript: last[i].transcript,
          confidence: typeof last[i].confidence === 'number' ? last[i].confidence : 0,
        });
      }
      resultSent = true;
      try { opts.onResult && opts.onResult(alternatives); } catch (_) {}
    };

    r.onerror = (event) => {
      console.warn('[VoiceInput] SR error:', event && event.error, event && event.message);
      try { opts.onError && opts.onError(event && event.error, event && event.message); } catch (_) {}
    };

    r.onend = () => {
      try { opts.onEnd && opts.onEnd({ aborted, resultSent }); } catch (_) {}
    };

    try {
      r.start();
    } catch (e) {
      console.warn('[VoiceInput] SR start threw:', e);
      try { opts.onError && opts.onError('start-failed', (e && e.message) || String(e)); } catch (_) {}
      return { ok: false, reason: 'start-failed' };
    }

    return {
      ok: true,
      abort() {
        aborted = true;
        try {
          r.onresult = null;
          r.onerror = null;
          r.abort();
        } catch (_) {}
      },
    };
  }

  globalThis.viCreateRecognizer = viCreateRecognizer;
})();
