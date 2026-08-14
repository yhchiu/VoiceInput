const assert = require('node:assert/strict');
const test = require('node:test');

const { createContext, loadClassicScript } = require('./helpers/load-classic-script');

const { FakeElement, FakeDocument } = require('./helpers/fake-dom');

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
