const assert = require('node:assert/strict');
const test = require('node:test');

const { createContext, loadClassicScript } = require('./helpers/load-classic-script');

const SETTINGS_KEY = 'voiceInput.settings.v1';

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.items = new Set();
  }

  add(name) {
    this.items.add(name);
  }

  remove(name) {
    this.items.delete(name);
  }

  contains(name) {
    return this.items.has(name) || String(this.element.className || '').split(/\s+/).includes(name);
  }

  toggle(name, force) {
    const enabled = typeof force === 'boolean' ? force : !this.contains(name);
    if (enabled) {
      this.items.add(name);
    } else {
      this.items.delete(name);
    }
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList(this);
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.href = '';
    this.download = '';
    this.rel = '';
    this.target = '';
    this.type = '';
    this.files = [];
    this.clicked = false;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  setAttribute(name, value) {
    const next = String(value);
    this.attributes.set(name, next);
    if (name.startsWith('data-')) {
      const key = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      this.dataset[key] = next;
    }
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type, event = {}) {
    const listeners = this.listeners.get(type) || [];
    const nextEvent = {
      target: this,
      preventDefault() {},
      stopPropagation() {},
      ...event,
    };
    for (const listener of listeners) {
      await listener(nextEvent);
    }
  }

  async click() {
    this.clicked = true;
    await this.dispatch('click');
  }

  querySelector() {
    return null;
  }
}

class FakeTextNode {
  constructor(text) {
    this.textContent = text;
    this.parentNode = null;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.created = [];
    this.listeners = new Map();
    this.body = new FakeElement('body');
  }

  getElementById(id) {
    if (!this.elements.has(id)) {
      this.elements.set(id, new FakeElement('div', id));
    }
    return this.elements.get(id);
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    this.created.push(element);
    return element;
  }

  createTextNode(text) {
    return new FakeTextNode(text);
  }

  createDocumentFragment() {
    return new FakeElement('fragment');
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatchDOMContentLoaded() {
    const listeners = this.listeners.get('DOMContentLoaded') || [];
    for (const listener of listeners) {
      await listener({ type: 'DOMContentLoaded', target: this });
    }
  }

  querySelectorAll(selector) {
    const all = [this.body, ...this.elements.values(), ...this.created];
    if (selector === '[data-i18n]') {
      return all.filter((element) => element.getAttribute && element.getAttribute('data-i18n'));
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return all.filter((element) => element.classList && element.classList.contains(className));
    }
    return [];
  }

  querySelector() {
    return null;
  }
}

class FakeBlob {
  constructor(parts, options = {}) {
    this.parts = parts;
    this.type = options.type || '';
  }

  async text() {
    return this.parts.join('');
  }
}

function makeChromeStorage(initialSettings = {}) {
  const syncData = { [SETTINGS_KEY]: { ...initialSettings } };
  const localData = {};

  function makeArea(data) {
    return {
      async get(key) {
        return { [key]: data[key] };
      },
      async set(value) {
        Object.assign(data, value);
      },
      async remove(key) {
        delete data[key];
      },
    };
  }

  const sync = makeArea(syncData);
  sync.QUOTA_BYTES_PER_ITEM = 8192;
  const local = makeArea(localData);
  local.QUOTA_BYTES = 10485760;

  return { syncData, localData, sync, local };
}

function primeOptionsDom(document) {
  [
    'about-version',
    'changelog',
    'changelog-empty',
    'replacements',
    'replacements-empty',
    'maxAlternatives',
    'lang',
    'autoInsertIfSingle',
    'sidePanelMode',
    'continuous',
    'interimResults',
    'add-replacement',
    'export-settings',
    'export-settings-status',
    'import-settings',
    'import-settings-file',
    'import-settings-status',
    'open-shortcuts',
    'reset',
    'saved',
  ].forEach((id) => document.getElementById(id));
}

async function flushAsync() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function bootOptionsPage(options = {}) {
  const {
    initialSettings = {},
    commands = [],
    includeCommandUpdate = true,
    updateShortcut,
  } = options;
  const document = new FakeDocument();
  primeOptionsDom(document);

  const storage = makeChromeStorage(initialSettings);
  const blobs = [];
  const createdUrls = [];
  const revokedUrls = [];
  const updatedCommands = [];
  const createdTabs = [];
  const timers = [];

  const commandsApi = {
    async getAll() {
      return commands;
    },
  };
  if (includeCommandUpdate) {
    commandsApi.update = async (command) => {
      updatedCommands.push(command);
      if (updateShortcut) {
        return updateShortcut(command);
      }
      return undefined;
    };
  }

  const chrome = {
    runtime: {
      getManifest() {
        return { version: '9.8.7' };
      },
      getURL(path) {
        return path;
      },
    },
    commands: commandsApi,
    tabs: {
      create(payload) {
        createdTabs.push(payload);
      },
    },
    storage: {
      sync: storage.sync,
      local: storage.local,
    },
  };

  const context = createContext({
    document,
    chrome,
    navigator: { language: 'en-US' },
    vt(key) {
      return key;
    },
    fetch: async () => ({
      ok: true,
      json: async () => [],
    }),
    Blob: FakeBlob,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        const url = `blob:test-${blobs.length}`;
        createdUrls.push(url);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      },
    },
    confirm: () => true,
    setTimeout(callback, delay) {
      const id = timers.length + 1;
      timers.push({ id, callback, delay });
      return id;
    },
    clearTimeout() {},
    viBuildLangOptions(select, currentLang) {
      select.value = currentLang;
    },
  });

  loadClassicScript('src/common/settings.js', context);
  loadClassicScript('src/options/options.js', context);
  await document.dispatchDOMContentLoaded();

  return {
    context,
    document,
    storage,
    blobs,
    createdUrls,
    revokedUrls,
    updatedCommands,
    createdTabs,
    timers,
  };
}

async function importSettingsFile(harness, value) {
  const file = {
    async text() {
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
  await harness.document.getElementById('import-settings-file').dispatch('change', {
    target: { files: [file] },
  });
  await flushAsync();
}

test('settings management helpers create and parse compatible payloads', () => {
  const context = loadClassicScript('src/common/settings.js', {
    navigator: { language: 'en-US' },
  });

  const payload = context.viCreateSettingsExportPayload(
    { maxAlternatives: 4, futureSetting: { enabled: true } },
    [
      { name: 'toggle-recognition', description: 42, shortcut: 'Ctrl+Shift+Y' },
      null,
    ],
    '2026-06-19T00:00:00.000Z'
  );

  assert.equal(payload.type, 'VoiceInputSettings');
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, '2026-06-19T00:00:00.000Z');
  assert.equal(payload.settings.maxAlternatives, 4);
  assert.equal(payload.settings.futureSetting.enabled, true);
  assert.equal(payload.shortcuts.length, 2);
  assert.equal(payload.shortcuts[0].name, 'toggle-recognition');
  assert.equal(payload.shortcuts[0].description, '');
  assert.equal(payload.shortcuts[0].shortcut, 'Ctrl+Shift+Y');
  assert.equal(payload.shortcuts[1].name, '');

  const wrapped = context.viParseSettingsImportPayload({
    type: 'VoiceInputSettings',
    version: 99,
    settings: { maxAlternatives: 2, unknownFutureKey: 'kept' },
    shortcuts: [{ name: 'cmd', description: 'Command', shortcut: 12 }],
  });
  assert.equal(wrapped.settings.maxAlternatives, 2);
  assert.equal(wrapped.settings.unknownFutureKey, 'kept');
  assert.equal(wrapped.shortcuts.length, 1);
  assert.equal(wrapped.shortcuts[0].name, 'cmd');
  assert.equal(wrapped.shortcuts[0].description, 'Command');
  assert.equal(wrapped.shortcuts[0].shortcut, '');

  const raw = context.viParseSettingsImportPayload({ maxAlternatives: 3 });
  assert.equal(raw.settings.maxAlternatives, 3);
  assert.equal(raw.shortcuts.length, 0);

  assert.throws(() => context.viParseSettingsImportPayload(null), /invalid-settings-file/);
  assert.throws(() => context.viParseSettingsImportPayload([]), /invalid-settings-file/);
  assert.throws(() => context.viParseSettingsImportPayload({ settings: [] }), /invalid-settings-file/);
  assert.throws(() => context.viParseSettingsImportPayload({ settings: 'bad' }), /invalid-settings-file/);
});

test('options export writes a versioned settings payload with normalized shortcuts', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      maxAlternatives: 5,
      lang: 'zh-TW',
      scratchpadStorageMode: 'local',
    },
    commands: [
      { name: 'toggle-recognition', description: 42, shortcut: 'Ctrl+Shift+Y' },
      { name: 'custom', description: 'Custom command', shortcut: 3 },
    ],
  });

  await harness.document.getElementById('export-settings').click();

  assert.equal(harness.blobs.length, 1);
  const payload = JSON.parse(await harness.blobs[0].text());
  assert.equal(payload.type, 'VoiceInputSettings');
  assert.equal(payload.version, 1);
  assert.equal(typeof payload.exportedAt, 'string');
  assert.equal(payload.settings.maxAlternatives, 5);
  assert.equal(payload.settings.lang, 'zh-TW');
  assert.equal(payload.settings.scratchpadStorageMode, 'local');
  assert.equal(payload.shortcuts.length, 2);
  assert.equal(payload.shortcuts[0].name, 'toggle-recognition');
  assert.equal(payload.shortcuts[0].description, '');
  assert.equal(payload.shortcuts[0].shortcut, 'Ctrl+Shift+Y');
  assert.equal(payload.shortcuts[1].description, 'Custom command');
  assert.equal(payload.shortcuts[1].shortcut, '');
  assert.match(harness.document.created.find((element) => element.tagName === 'A').download, /^VoiceInput-settings-\d{8}\.json$/);
  assert.equal(harness.document.getElementById('export-settings-status').textContent, 'optSettingsExported');
});

test('options import accepts legacy raw settings and fills new defaults', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      maxAlternatives: 4,
      scratchpadStorageMode: 'sync',
    },
  });

  await importSettingsFile(harness, {
    maxAlternatives: 0,
    lang: 'fr-FR',
  });

  const saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.maxAlternatives, 1);
  assert.equal(saved.lang, 'fr-FR');
  assert.equal(saved.scratchpadStorageMode, 'none');
  assert.equal(saved.autoInsertIfSingle, true);
  assert.equal(harness.document.getElementById('import-settings-status').textContent, 'optSettingsImported');
});

test('options import accepts wrapped future settings and restores normalized shortcuts', async () => {
  const harness = await bootOptionsPage();

  await importSettingsFile(harness, {
    type: 'VoiceInputSettings',
    version: 99,
    settings: {
      maxAlternatives: 99,
      scratchpadStorageMode: 'sync',
      futureSetting: { enabled: true },
    },
    shortcuts: [
      { name: 'toggle-recognition', description: 12, shortcut: 'Ctrl+Shift+Y' },
      { name: 10, description: 'ignored', shortcut: 'Ctrl+X' },
    ],
  });

  const saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.maxAlternatives, 10);
  assert.equal(saved.scratchpadStorageMode, 'sync');
  assert.equal(saved.futureSetting.enabled, true);
  assert.equal(harness.updatedCommands.length, 1);
  assert.equal(harness.updatedCommands[0].name, 'toggle-recognition');
  assert.equal(harness.updatedCommands[0].shortcut, 'Ctrl+Shift+Y');
  assert.match(harness.document.getElementById('import-settings-status').textContent, /^optSettingsImported/);
});

test('options import reports invalid payloads without overwriting existing settings', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      maxAlternatives: 4,
      lang: 'en-US',
    },
  });

  await importSettingsFile(harness, { settings: [] });

  const saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.maxAlternatives, 4);
  assert.equal(saved.lang, 'en-US');
  const status = harness.document.getElementById('import-settings-status');
  assert.equal(status.textContent, 'optSettingsImportFailed');
  assert.equal(status.classList.contains('is-error'), true);

  await importSettingsFile(harness, '{not valid json');
  assert.equal(harness.storage.syncData[SETTINGS_KEY].maxAlternatives, 4);
  assert.equal(status.textContent, 'optSettingsImportFailed');
});

test('options import reports unsupported shortcut restore separately', async () => {
  const harness = await bootOptionsPage({
    includeCommandUpdate: false,
  });

  await importSettingsFile(harness, {
    settings: { maxAlternatives: 3 },
    shortcuts: [{ name: 'toggle-recognition', shortcut: 'Ctrl+Shift+Y' }],
  });

  assert.match(harness.document.getElementById('import-settings-status').textContent, /^optSettingsImportedShortcutUnsupported/);
});

test('options import reports partial shortcut restore failures', async () => {
  const harness = await bootOptionsPage({
    updateShortcut(command) {
      if (command.name === 'broken-command') {
        throw new Error('shortcut update failed');
      }
    },
  });

  await importSettingsFile(harness, {
    settings: { maxAlternatives: 3 },
    shortcuts: [
      { name: 'toggle-recognition', shortcut: 'Ctrl+Shift+Y' },
      { name: 'broken-command', shortcut: 'Ctrl+Shift+B' },
    ],
  });

  const status = harness.document.getElementById('import-settings-status');
  assert.match(status.textContent, /^optSettingsImportedShortcutPartial/);
  assert.equal(status.classList.contains('is-error'), true);
  assert.equal(harness.updatedCommands.length, 2);
});
