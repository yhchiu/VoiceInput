// Settings storage helpers. Reads/writes chrome.storage.sync.
// Exposes settings accessors plus text replacement helpers on globalThis.
(function () {
  const KEY = 'voiceInput.settings.v1';

  const DEFAULTS = Object.freeze({
    maxAlternatives: 3,
    lang: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    continuous: false,
    interimResults: false,
    autoInsertIfSingle: true,
    sidePanelMode: false,
    replacements: [],
  });

  function normalizeReplacementEntry(item) {
    if (!item || typeof item !== 'object') return null;
    const from = typeof item.from === 'string' ? item.from : '';
    const to = typeof item.to === 'string' ? item.to : '';
    if (from.length === 0) return null;
    return {
      from: from.slice(0, 200),
      to: to.slice(0, 500),
    };
  }

  function normalizeReplacements(value) {
    if (!Array.isArray(value)) return [];
    const out = [];
    value.forEach((item) => {
      const normalized = normalizeReplacementEntry(item);
      if (normalized) out.push(normalized);
    });
    return out.slice(0, 50);
  }

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
    if ('sidePanelMode' in out) out.sidePanelMode = !!out.sidePanelMode;
    if ('lang' in out && typeof out.lang !== 'string') delete out.lang;
    if ('replacements' in out) out.replacements = normalizeReplacements(out.replacements);
    return out;
  }

  function viApplyReplacements(text, replacements) {
    if (typeof text !== 'string' || !Array.isArray(replacements) || replacements.length === 0) {
      return text;
    }
    let next = text;
    normalizeReplacements(replacements).forEach(({ from, to }) => {
      next = next.split(from).join(to);
    });
    return next;
  }

  async function viGetSettings() {
    try {
      const stored = await chrome.storage.sync.get(KEY);
      const value = stored && stored[KEY] ? stored[KEY] : {};
      return { ...DEFAULTS, ...normalize(value) };
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

  async function viReplaceSettings(value) {
    const next = { ...DEFAULTS, ...normalize(value || {}) };
    await chrome.storage.sync.set({ [KEY]: next });
    return next;
  }

  async function viResetSettings() {
    await chrome.storage.sync.remove(KEY);
    return { ...DEFAULTS };
  }

  globalThis.VI_SETTINGS_KEY = KEY;
  globalThis.VI_DEFAULT_SETTINGS = DEFAULTS;
  globalThis.viNormalizeReplacements = normalizeReplacements;
  globalThis.viApplyReplacements = viApplyReplacements;
  globalThis.viGetSettings = viGetSettings;
  globalThis.viSetSettings = viSetSettings;
  globalThis.viReplaceSettings = viReplaceSettings;
  globalThis.viResetSettings = viResetSettings;
})();
