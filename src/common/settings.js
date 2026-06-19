// Settings storage helpers. Reads/writes chrome.storage.sync.
// Exposes settings accessors plus text replacement helpers on globalThis.
(function () {
  const KEY = 'voiceInput.settings.v1';
  const SCRATCHPAD_STORAGE_KEY = 'voiceInput.scratchpad.v1';
  const SCRATCHPAD_STORAGE_MODES = Object.freeze({
    NONE: 'none',
    LOCAL: 'local',
    SYNC: 'sync',
  });
  const SCRATCHPAD_SYNC_MAX_BYTES = 7600;
  const SCRATCHPAD_LOCAL_MAX_BYTES = 512 * 1024;
  const SCRATCHPAD_STORAGE_OVERHEAD_BYTES = 512;

  const DEFAULTS = Object.freeze({
    maxAlternatives: 3,
    lang: (typeof navigator !== 'undefined' && navigator.language) || 'en-US',
    continuous: false,
    interimResults: false,
    autoInsertIfSingle: true,
    sidePanelMode: false,
    scratchpadStorageMode: SCRATCHPAD_STORAGE_MODES.NONE,
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

  function normalizeScratchpadStorageMode(value) {
    if (value === SCRATCHPAD_STORAGE_MODES.LOCAL) return SCRATCHPAD_STORAGE_MODES.LOCAL;
    if (value === SCRATCHPAD_STORAGE_MODES.SYNC) return SCRATCHPAD_STORAGE_MODES.SYNC;
    return SCRATCHPAD_STORAGE_MODES.NONE;
  }

  function normalize(partial) {
    const out = { ...partial };
    if ('maxAlternatives' in out) out.maxAlternatives = clampMaxAlternatives(out.maxAlternatives);
    if ('continuous' in out) out.continuous = !!out.continuous;
    if ('interimResults' in out) out.interimResults = !!out.interimResults;
    if ('autoInsertIfSingle' in out) out.autoInsertIfSingle = !!out.autoInsertIfSingle;
    if ('sidePanelMode' in out) out.sidePanelMode = !!out.sidePanelMode;
    if ('scratchpadStorageMode' in out) out.scratchpadStorageMode = normalizeScratchpadStorageMode(out.scratchpadStorageMode);
    if ('lang' in out && typeof out.lang !== 'string') delete out.lang;
    if ('replacements' in out) out.replacements = normalizeReplacements(out.replacements);
    return out;
  }

  function utf8BytesForCodePoint(codePoint) {
    if (codePoint <= 0x7f) return 1;
    if (codePoint <= 0x7ff) return 2;
    if (codePoint <= 0xffff) return 3;
    return 4;
  }

  function viUtf8ByteLength(value) {
    const text = typeof value === 'string' ? value : String(value ?? '');
    let bytes = 0;
    for (const char of text) {
      bytes += utf8BytesForCodePoint(char.codePointAt(0));
    }
    return bytes;
  }

  function truncateUtf8(text, maxBytes) {
    let next = '';
    let bytes = 0;
    for (const char of text) {
      const charBytes = utf8BytesForCodePoint(char.codePointAt(0));
      if (bytes + charBytes > maxBytes) break;
      next += char;
      bytes += charBytes;
    }
    return { text: next, bytes };
  }

  function getScratchpadStorageArea(mode) {
    if (typeof chrome === 'undefined' || !chrome.storage) return null;
    if (mode === SCRATCHPAD_STORAGE_MODES.LOCAL) return chrome.storage.local || null;
    if (mode === SCRATCHPAD_STORAGE_MODES.SYNC) return chrome.storage.sync || null;
    return null;
  }

  function viScratchpadStorageMaxBytes(mode) {
    const normalizedMode = normalizeScratchpadStorageMode(mode);
    if (normalizedMode === SCRATCHPAD_STORAGE_MODES.SYNC) {
      const quota = getScratchpadStorageArea(normalizedMode) && Number(getScratchpadStorageArea(normalizedMode).QUOTA_BYTES_PER_ITEM);
      if (Number.isFinite(quota)) {
        return Math.max(0, Math.min(SCRATCHPAD_SYNC_MAX_BYTES, quota - SCRATCHPAD_STORAGE_OVERHEAD_BYTES));
      }
      return SCRATCHPAD_SYNC_MAX_BYTES;
    }
    if (normalizedMode === SCRATCHPAD_STORAGE_MODES.LOCAL) {
      const quota = getScratchpadStorageArea(normalizedMode) && Number(getScratchpadStorageArea(normalizedMode).QUOTA_BYTES);
      if (Number.isFinite(quota)) {
        return Math.max(0, Math.min(SCRATCHPAD_LOCAL_MAX_BYTES, quota - SCRATCHPAD_STORAGE_OVERHEAD_BYTES));
      }
      return SCRATCHPAD_LOCAL_MAX_BYTES;
    }
    return 0;
  }

  function viPrepareScratchpadTextForStorage(text, mode) {
    const normalizedMode = normalizeScratchpadStorageMode(mode);
    const value = typeof text === 'string' ? text : String(text ?? '');
    const originalBytes = viUtf8ByteLength(value);
    const maxBytes = viScratchpadStorageMaxBytes(normalizedMode);
    if (normalizedMode === SCRATCHPAD_STORAGE_MODES.NONE) {
      return {
        mode: normalizedMode,
        text: '',
        originalBytes,
        storedBytes: 0,
        maxBytes,
        truncated: false,
      };
    }
    if (originalBytes <= maxBytes) {
      return {
        mode: normalizedMode,
        text: value,
        originalBytes,
        storedBytes: originalBytes,
        maxBytes,
        truncated: false,
      };
    }
    const truncated = truncateUtf8(value, maxBytes);
    return {
      mode: normalizedMode,
      text: truncated.text,
      originalBytes,
      storedBytes: truncated.bytes,
      maxBytes,
      truncated: true,
    };
  }

  async function viGetScratchpadText(mode) {
    const normalizedMode = normalizeScratchpadStorageMode(mode);
    const area = getScratchpadStorageArea(normalizedMode);
    if (!area) return null;
    try {
      const stored = await area.get(SCRATCHPAD_STORAGE_KEY);
      const value = stored && stored[SCRATCHPAD_STORAGE_KEY];
      if (!value || typeof value.text !== 'string') return null;
      return {
        mode: normalizedMode,
        text: value.text,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : null,
      };
    } catch (_) {
      return null;
    }
  }

  async function viSetScratchpadText(mode, text) {
    const normalizedMode = normalizeScratchpadStorageMode(mode);
    const area = getScratchpadStorageArea(normalizedMode);
    const prepared = viPrepareScratchpadTextForStorage(text, normalizedMode);
    if (normalizedMode === SCRATCHPAD_STORAGE_MODES.NONE) {
      return { ok: true, updatedAt: null, ...prepared };
    }
    if (!area) {
      return { ok: false, error: 'storage-unavailable', ...prepared };
    }

    const updatedAt = Date.now();
    try {
      if (prepared.text.length === 0) {
        await area.remove(SCRATCHPAD_STORAGE_KEY);
      } else {
        await area.set({
          [SCRATCHPAD_STORAGE_KEY]: {
            text: prepared.text,
            updatedAt,
          },
        });
      }
      return { ok: true, updatedAt, ...prepared };
    } catch (_) {
      return { ok: false, error: 'storage-write-failed', ...prepared };
    }
  }

  async function viClearScratchpadStorage(mode) {
    const normalizedMode = normalizeScratchpadStorageMode(mode);
    const modes = normalizedMode === SCRATCHPAD_STORAGE_MODES.NONE
      ? [SCRATCHPAD_STORAGE_MODES.LOCAL, SCRATCHPAD_STORAGE_MODES.SYNC]
      : [normalizedMode];
    const results = await Promise.all(modes.map(async (item) => {
      const area = getScratchpadStorageArea(item);
      if (!area) return true;
      try {
        await area.remove(SCRATCHPAD_STORAGE_KEY);
        return true;
      } catch (_) {
        return false;
      }
    }));
    return { ok: results.every(Boolean) };
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
  globalThis.VI_SCRATCHPAD_STORAGE_KEY = SCRATCHPAD_STORAGE_KEY;
  globalThis.VI_SCRATCHPAD_STORAGE_MODES = SCRATCHPAD_STORAGE_MODES;
  globalThis.VI_DEFAULT_SETTINGS = DEFAULTS;
  globalThis.viNormalizeReplacements = normalizeReplacements;
  globalThis.viNormalizeScratchpadStorageMode = normalizeScratchpadStorageMode;
  globalThis.viUtf8ByteLength = viUtf8ByteLength;
  globalThis.viScratchpadStorageMaxBytes = viScratchpadStorageMaxBytes;
  globalThis.viPrepareScratchpadTextForStorage = viPrepareScratchpadTextForStorage;
  globalThis.viGetScratchpadText = viGetScratchpadText;
  globalThis.viSetScratchpadText = viSetScratchpadText;
  globalThis.viClearScratchpadStorage = viClearScratchpadStorage;
  globalThis.viApplyReplacements = viApplyReplacements;
  globalThis.viGetSettings = viGetSettings;
  globalThis.viSetSettings = viSetSettings;
  globalThis.viReplaceSettings = viReplaceSettings;
  globalThis.viResetSettings = viResetSettings;
})();
