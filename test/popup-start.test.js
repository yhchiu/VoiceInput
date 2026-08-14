const assert = require('node:assert/strict');
const test = require('node:test');

const { createContext, loadClassicScript } = require('./helpers/load-classic-script');
const { FakeElement, FakeDocument } = require('./helpers/fake-dom');

function buildPopupDom() {
  const document = new FakeDocument();

  const toggleRow = new FakeElement('label');
  toggleRow.classList.add('toggle-row');
  const continuous = new FakeElement('input', 'continuous');
  continuous.type = 'checkbox';
  toggleRow.appendChild(continuous);
  document.register(continuous);
  document.body.appendChild(toggleRow);

  const ids = [
    'status', 'start', 'start-status', 'lang', 'copy-recent', 'recent-result-text',
    'open-options', 'common-phrases-toggle', 'common-phrases-count',
    'common-phrases-panel', 'common-phrases', 'common-phrases-empty', 'phrase-status',
  ];
  ids.forEach((id) => document.register(new FakeElement('div', id)));
  document.getElementById('start-status').hidden = true;

  return document;
}

// `startResponse` is what the background answers a START_RECOGNITION with.
async function bootPopup({ startResponse = { ok: true }, startThrows = false, listening = false } = {}) {
  const document = buildPopupDom();
  const sent = [];
  let closed = false;

  const chrome = {
    runtime: {
      async sendMessage(message) {
        sent.push(message);
        if (message.action === 'GET_STATUS') return { listening, result: null, ok: true };
        if (message.action === 'START_RECOGNITION') {
          if (startThrows) throw new Error('Could not establish connection.');
          return startResponse;
        }
        return { ok: true };
      },
      onMessage: { addListener() {} },
      openOptionsPage() {},
    },
    storage: {
      sync: { async get(key) { return { [key]: { commonPhrases: [] } }; }, async set() {}, async remove() {} },
      local: { async get() { return {}; }, async set() {}, async remove() {} },
    },
  };

  const context = createContext({
    document,
    chrome,
    navigator: { language: 'en-US' },
    window: { close() { closed = true; } },
    vt: (key) => key,
    viBuildLangOptions() {},
  });

  loadClassicScript('src/common/messages.js', context);
  loadClassicScript('src/common/settings.js', context);
  loadClassicScript('src/popup/popup.js', context);
  await document.dispatchDOMContentLoaded();

  return {
    document,
    sent,
    isClosed: () => closed,
    startStatus: () => document.getElementById('start-status'),
    async clickStart() {
      await document.getElementById('start').dispatch('click');
    },
  };
}

test('a successful start closes the popup without showing an error', async () => {
  const harness = await bootPopup({ startResponse: { ok: true, mode: 'content' } });

  await harness.clickStart();

  assert.equal(harness.isClosed(), true);
  assert.equal(harness.startStatus().hidden, true);
});

test('a failed start keeps the popup open and names the reason', async () => {
  const harness = await bootPopup({ startResponse: { ok: false, error: 'content-unavailable' } });

  await harness.clickStart();

  // Closing here used to hide the reason and leave the user waiting to speak
  // into a session that never started.
  assert.equal(harness.isClosed(), false);
  assert.equal(harness.startStatus().hidden, false);
  assert.equal(harness.startStatus().textContent, 'pageUnavailable');
  assert.equal(harness.startStatus().classList.contains('is-error'), true);
});

test('a start with no focused field says so', async () => {
  const harness = await bootPopup({ startResponse: { ok: false, error: 'no-target' } });

  await harness.clickStart();

  assert.equal(harness.isClosed(), false);
  assert.equal(harness.startStatus().textContent, 'pickerNoTarget');
});

test('an unknown failure still reports something', async () => {
  const harness = await bootPopup({ startResponse: { ok: false, error: 'something-new' } });

  await harness.clickStart();

  assert.equal(harness.isClosed(), false);
  assert.equal(harness.startStatus().textContent, 'errUnknown');
});

test('a start whose message never reaches the background is reported too', async () => {
  const harness = await bootPopup({ startThrows: true });

  await harness.clickStart();

  assert.equal(harness.isClosed(), false);
  assert.equal(harness.startStatus().hidden, false);
});

test('stopping closes the popup even though it reports no result', async () => {
  const harness = await bootPopup({ listening: true });

  await harness.clickStart();

  const actions = harness.sent.map((message) => message.action);
  assert.ok(actions.includes('STOP_RECOGNITION'));
  assert.equal(harness.isClosed(), true);
});
