const assert = require('node:assert/strict');
const test = require('node:test');

const { createContext, loadClassicScript } = require('./helpers/load-classic-script');

// Minimal fake DOM tailored to booting the popup page and driving the
// collapsible common-phrases menu (ARIA disclosure). The disclosure logic is
// shared verbatim with the side panel, so exercising it here covers both.
class FakeClassList {
  constructor() {
    this.items = new Set();
  }

  add(name) {
    this.items.add(name);
  }

  remove(name) {
    this.items.delete(name);
  }

  contains(name) {
    return this.items.has(name);
  }

  toggle(name, force) {
    const on = typeof force === 'boolean' ? force : !this.items.has(name);
    if (on) this.items.add(name);
    else this.items.delete(name);
    return on;
  }
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.type = '';
    this.title = '';
    this.focused = false;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML || '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  addEventListener(type, listener) {
    const arr = this.listeners.get(type) || [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  async dispatch(type, event = {}) {
    const arr = this.listeners.get(type) || [];
    const nextEvent = { target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const listener of arr) await listener(nextEvent);
  }

  focus() {
    this.focused = true;
  }

  matchesSelector(selector) {
    return selector.startsWith('.') && this.classList.contains(selector.slice(1));
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (current.matchesSelector(selector)) return current;
      current = current.parentNode;
    }
    return null;
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) return true;
      current = current.parentNode;
    }
    return false;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.created = [];
    this.listeners = new Map();
    this.body = new FakeElement('body');
  }

  register(element) {
    this.elements.set(element.id, element);
    return element;
  }

  getElementById(id) {
    if (!this.elements.has(id)) this.elements.set(id, new FakeElement('div', id));
    return this.elements.get(id);
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    this.created.push(element);
    return element;
  }

  addEventListener(type, listener) {
    const arr = this.listeners.get(type) || [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }

  async dispatch(type, event = {}) {
    const arr = this.listeners.get(type) || [];
    const nextEvent = { type, target: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const listener of arr) await listener(nextEvent);
  }

  async dispatchDOMContentLoaded() {
    await this.dispatch('DOMContentLoaded');
  }

  querySelectorAll() {
    return [];
  }

  querySelector() {
    return null;
  }
}

function buildPopupDom() {
  const document = new FakeDocument();

  // loadSettings() resolves continuous.closest('.toggle-row'), so the
  // checkbox needs a real parent chain.
  const toggleRow = new FakeElement('label');
  toggleRow.classList.add('toggle-row');
  const continuous = new FakeElement('input', 'continuous');
  continuous.type = 'checkbox';
  toggleRow.appendChild(continuous);
  document.register(continuous);

  // common-phrases-field disclosure structure (mirrors popup.html).
  const field = new FakeElement('div');
  field.classList.add('common-phrases-field');
  const toggle = new FakeElement('button', 'common-phrases-toggle');
  toggle.setAttribute('aria-expanded', 'false');
  const count = new FakeElement('span', 'common-phrases-count');
  count.hidden = true;
  toggle.appendChild(count);
  const panel = new FakeElement('div', 'common-phrases-panel');
  panel.hidden = true;
  const list = new FakeElement('div', 'common-phrases');
  const empty = new FakeElement('p', 'common-phrases-empty');
  panel.appendChild(list);
  panel.appendChild(empty);
  const phraseStatus = new FakeElement('p', 'phrase-status');
  phraseStatus.hidden = true;
  field.appendChild(toggle);
  field.appendChild(panel);
  field.appendChild(phraseStatus);
  [toggle, count, panel, list, empty, phraseStatus].forEach((el) => document.register(el));

  // Other ids the popup touches during boot.
  ['status', 'start', 'lang', 'copy-recent', 'recent-result-text', 'open-options'].forEach((id) =>
    document.register(new FakeElement('div', id))
  );

  document.body.appendChild(toggleRow);
  document.body.appendChild(field);

  return { document, els: { toggle, count, panel, list, empty, field } };
}

async function bootPopup(commonPhrases = []) {
  const { document, els } = buildPopupDom();
  const storedSettings = { commonPhrases };

  const chrome = {
    runtime: {
      async sendMessage() {
        return { listening: false, result: null, ok: true };
      },
      onMessage: { addListener() {} },
      openOptionsPage() {},
    },
    storage: {
      sync: {
        async get(key) {
          return { [key]: storedSettings };
        },
        async set() {},
        async remove() {},
      },
      local: {
        async get() {
          return {};
        },
        async set() {},
        async remove() {},
      },
    },
  };

  const context = createContext({
    document,
    chrome,
    navigator: { language: 'en-US' },
    window: { close() {} },
    vt: (key) => key,
    viBuildLangOptions() {},
  });

  loadClassicScript('src/common/messages.js', context);
  loadClassicScript('src/common/settings.js', context);
  loadClassicScript('src/popup/popup.js', context);
  await document.dispatchDOMContentLoaded();

  return { document, els };
}

test('common phrases menu starts collapsed', async () => {
  const { els } = await bootPopup([{ title: 'Hi', text: 'Hello' }]);
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.panel.hidden, true);
});

test('phrase count badge reflects the number of phrases', async () => {
  const { els } = await bootPopup([
    { title: 'Hi', text: 'Hello' },
    { title: 'Bye', text: 'Goodbye' },
  ]);
  assert.equal(els.count.textContent, '2');
  assert.equal(els.count.hidden, false);
});

test('phrase count badge is hidden and empty state shows when there are no phrases', async () => {
  const { els } = await bootPopup([]);
  assert.equal(els.count.textContent, '0');
  assert.equal(els.count.hidden, true);
  assert.equal(els.empty.hidden, false);
});

test('clicking the toggle opens and then closes the menu', async () => {
  const { els } = await bootPopup([{ title: 'Hi', text: 'Hello' }]);

  await els.toggle.dispatch('click');
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(els.panel.hidden, false);

  await els.toggle.dispatch('click');
  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.panel.hidden, true);
});

test('Escape closes the menu and returns focus to the toggle', async () => {
  const { document, els } = await bootPopup([{ title: 'Hi', text: 'Hello' }]);

  await els.toggle.dispatch('click');
  await document.dispatch('keydown', { key: 'Escape' });

  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.panel.hidden, true);
  assert.equal(els.toggle.focused, true);
});

test('clicking outside the field closes the menu', async () => {
  const { document, els } = await bootPopup([{ title: 'Hi', text: 'Hello' }]);

  await els.toggle.dispatch('click');
  await document.dispatch('click', { target: document.body });

  assert.equal(els.toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(els.panel.hidden, true);
});

test('clicking inside the menu keeps it open', async () => {
  const { document, els } = await bootPopup([{ title: 'Hi', text: 'Hello' }]);

  await els.toggle.dispatch('click');
  await document.dispatch('click', { target: els.list });

  assert.equal(els.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(els.panel.hidden, false);
});
