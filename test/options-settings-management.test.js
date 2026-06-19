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
    this.removed = false;
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
    child.removed = false;
    return child;
  }

  insertBefore(child, ref) {
    child.parentNode = this;
    child.removed = false;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx === -1) {
      this.children.push(child);
    } else {
      this.children.splice(idx, 0, child);
    }
    return child;
  }

  remove() {
    this.removed = true;
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

  focus() {
    this.focused = true;
  }

  querySelector(selector) {
    const matches = this.querySelectorAll(selector);
    return matches[0] || null;
  }

  querySelectorAll(selector) {
    const out = [];
    const visit = (element) => {
      if (!element || element.removed || !element.classList) return;
      if (selector.startsWith('.') && element.classList.contains(selector.slice(1))) {
        out.push(element);
      }
      (element.children || []).forEach(visit);
    };
    this.children.forEach(visit);
    return out;
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
    // Walk the element trees in DOM order so reordering (insertBefore) and
    // index-based queries behave like a real document.
    const matches = (element) => {
      if (selector === '[data-i18n]') {
        return Boolean(element.getAttribute && element.getAttribute('data-i18n'));
      }
      if (selector.startsWith('.')) {
        return Boolean(element.classList && element.classList.contains(selector.slice(1)));
      }
      return false;
    };
    const out = [];
    const seen = new Set();
    const visit = (element) => {
      if (!element || seen.has(element) || element.removed) return;
      seen.add(element);
      if (matches(element)) out.push(element);
      (element.children || []).forEach(visit);
    };
    [this.body, ...this.elements.values()].forEach(visit);
    return out;
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
    'common-phrases',
    'common-phrases-empty',
    'common-phrases-budget',
    'maxAlternatives',
    'lang',
    'autoInsertIfSingle',
    'sidePanelMode',
    'continuous',
    'interimResults',
    'add-replacement',
    'add-common-phrase',
    'undo-toast',
    'undo-action',
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
    {
      maxAlternatives: 4,
      futureSetting: { enabled: true },
      commonPhrases: [{ title: 'Greeting', text: 'Hello' }],
    },
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
  assert.equal(payload.settings.commonPhrases[0].title, 'Greeting');
  assert.equal(payload.shortcuts.length, 2);
  assert.equal(payload.shortcuts[0].name, 'toggle-recognition');
  assert.equal(payload.shortcuts[0].description, '');
  assert.equal(payload.shortcuts[0].shortcut, 'Ctrl+Shift+Y');
  assert.equal(payload.shortcuts[1].name, '');

  const wrapped = context.viParseSettingsImportPayload({
    type: 'VoiceInputSettings',
    version: 99,
    settings: {
      maxAlternatives: 2,
      unknownFutureKey: 'kept',
      commonPhrases: [{ title: '', text: 'Wrapped phrase' }],
    },
    shortcuts: [{ name: 'cmd', description: 'Command', shortcut: 12 }],
  });
  assert.equal(wrapped.settings.maxAlternatives, 2);
  assert.equal(wrapped.settings.unknownFutureKey, 'kept');
  assert.equal(wrapped.settings.commonPhrases[0].text, 'Wrapped phrase');
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
      commonPhrases: [{ title: 'Greeting', text: 'Hello' }],
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
  assert.equal(payload.settings.commonPhrases[0].title, 'Greeting');
  assert.equal(payload.settings.commonPhrases[0].text, 'Hello');
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
  assert.equal(saved.commonPhrases.length, 0);
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
      commonPhrases: [
        { title: '', text: 'Imported phrase' },
        { title: 'Ignored', text: '' },
      ],
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
  assert.equal(saved.commonPhrases.length, 1);
  assert.equal(saved.commonPhrases[0].title, 'Imported phrase');
  assert.equal(saved.commonPhrases[0].text, 'Imported phrase');
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

test('options common phrase rows load, edit, and remove saved phrases', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      commonPhrases: [{ title: 'Greeting', text: 'Hello' }],
    },
  });

  let rows = harness.document.querySelectorAll('.common-phrase-row');
  assert.equal(rows.length, 1);
  const title = rows[0].querySelector('.common-phrase-title');
  const text = rows[0].querySelector('.common-phrase-text');
  assert.equal(title.value, 'Greeting');
  assert.equal(text.value, 'Hello');

  title.value = 'Updated';
  text.value = 'Updated text';
  await text.dispatch('input');
  await harness.timers[harness.timers.length - 1].callback();

  let saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.commonPhrases.length, 1);
  assert.equal(saved.commonPhrases[0].title, 'Updated');
  assert.equal(saved.commonPhrases[0].text, 'Updated text');

  await rows[0].children[2].click();
  await flushAsync();
  saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.commonPhrases.length, 0);

  rows = harness.document.querySelectorAll('.common-phrase-row');
  assert.equal(rows.length, 0);
  assert.equal(harness.document.getElementById('common-phrases-empty').hidden, false);
});

test('options restores a removed phrase at its original position via undo', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      commonPhrases: [
        { title: 'First', text: 'one' },
        { title: 'Second', text: 'two' },
        { title: 'Third', text: 'three' },
      ],
    },
  });

  const rows = harness.document.querySelectorAll('.common-phrase-row');
  assert.equal(rows.length, 3);

  await rows[1].querySelector('.row-remove').click();
  await flushAsync();

  let saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.commonPhrases.length, 2);
  assert.equal(saved.commonPhrases[0].title, 'First');
  assert.equal(saved.commonPhrases[1].title, 'Third');
  assert.equal(harness.document.getElementById('undo-toast').hidden, false);

  await harness.document.getElementById('undo-action').click();
  await flushAsync();

  saved = harness.storage.syncData[SETTINGS_KEY];
  assert.equal(saved.commonPhrases.length, 3);
  assert.equal(saved.commonPhrases[0].title, 'First');
  assert.equal(saved.commonPhrases[1].title, 'Second');
  assert.equal(saved.commonPhrases[2].title, 'Third');
  assert.equal(harness.document.getElementById('undo-toast').hidden, true);
});

test('options surfaces character counters and a storage budget for phrases', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      commonPhrases: [{ title: 'Hi', text: 'Hello' }],
    },
  });

  const row = harness.document.querySelectorAll('.common-phrase-row')[0];
  const counters = row.querySelectorAll('.field-counter');
  assert.equal(counters[0].textContent, '2/80');
  assert.equal(counters[1].textContent, '5/1000');

  const budget = harness.document.getElementById('common-phrases-budget');
  assert.match(budget.textContent, /7 \/ 5000 bytes/);

  const text = row.querySelector('.common-phrase-text');
  text.value = 'Hello world';
  await text.dispatch('input');

  assert.equal(row.querySelectorAll('.field-counter')[1].textContent, '11/1000');
  assert.match(
    harness.document.getElementById('common-phrases-budget').textContent,
    /13 \/ 5000 bytes/,
  );
});

test('options applies replacement limits via maxlength and counters', async () => {
  const harness = await bootOptionsPage({
    initialSettings: {
      replacements: [{ from: 'a', to: 'b' }],
    },
  });

  const row = harness.document.querySelectorAll('.replacement-row')[0];
  const from = row.querySelector('.replacement-from');
  const to = row.querySelector('.replacement-to');
  assert.equal(from.maxLength, harness.context.VI_REPLACEMENT_FROM_MAX_CHARS);
  assert.equal(to.maxLength, harness.context.VI_REPLACEMENT_TO_MAX_CHARS);

  const counters = row.querySelectorAll('.field-counter');
  assert.equal(counters[0].textContent, '1/200');
  assert.equal(counters[1].textContent, '1/500');
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
