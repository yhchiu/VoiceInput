// Settings storage helpers. Reads/writes chrome.storage.sync.
// Functions exposed on globalThis: viGetSettings, viSetSettings, viResetSettings.
(function () {
  const KEY = 'voiceInput.settings.v1';

  const DEFAULTS = Object.freeze({
    maxAlternatives: 3,
    lang: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    continuous: false,
    interimResults: false,
    autoInsertIfSingle: true,
  });

  function clampMaxAlternatives(v) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = DEFAULTS.maxAlternatives;
    n = Math.round(n);
    if (n < 1) n = 1;
    if (n > 10) n = 10;
    return n;
  }

  function normalize(partial) {
    const out = { ...partial };
    if ('maxAlternatives' in out) out.maxAlternatives = clampMaxAlternatives(out.maxAlternatives);
    if ('continuous' in out) out.continuous = !!out.continuous;
    if ('interimResults' in out) out.interimResults = !!out.interimResults;
    if ('autoInsertIfSingle' in out) out.autoInsertIfSingle = !!out.autoInsertIfSingle;
    if ('lang' in out && typeof out.lang !== 'string') delete out.lang;
    return out;
  }

  async function viGetSettings() {
    try {
      const stored = await chrome.storage.sync.get(KEY);
      const value = stored && stored[KEY] ? stored[KEY] : {};
      return { ...DEFAULTS, ...value };
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  async function viSetSettings(partial) {
    const current = await viGetSettings();
    const next = { ...current, ...normalize(partial || {}) };
    await chrome.storage.sync.set({ [KEY]: next });
    return next;
  }

  async function viResetSettings() {
    await chrome.storage.sync.remove(KEY);
    return { ...DEFAULTS };
  }

  globalThis.VI_DEFAULT_SETTINGS = DEFAULTS;
  globalThis.viGetSettings = viGetSettings;
  globalThis.viSetSettings = viSetSettings;
  globalThis.viResetSettings = viResetSettings;
})();
