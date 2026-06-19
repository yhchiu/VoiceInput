const assert = require('node:assert/strict');
const test = require('node:test');

const { createContext, loadClassicScript } = require('./helpers/load-classic-script');

class FakeInputElement {
  constructor(value = '') {
    this.value = value;
    this.selectionStart = value.length;
    this.selectionEnd = value.length;
    this.editable = true;
  }
}

class FakeTextAreaElement extends FakeInputElement {}

function loadContent(activeElement) {
  let messageListener = null;
  const sentMessages = [];
  const inserted = [];
  const toasts = [];
  const context = createContext({
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    window: {
      getSelection() {
        return null;
      },
    },
    document: {
      activeElement,
      addEventListener() {},
      contains(element) {
        return !!element && element !== 'detached';
      },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage(message) {
          sentMessages.push(message);
          return Promise.resolve({ ok: true });
        },
      },
    },
    vt(key) {
      return key;
    },
    viIsEditable(element) {
      return !!(element && element.editable);
    },
    viInsertText(target, text, saved) {
      inserted.push({ target, text, saved });
      return { ok: true };
    },
    viMakeToast(message) {
      toasts.push(message);
    },
  });

  loadClassicScript('src/common/messages.js', context);
  loadClassicScript('src/content/content.js', context);

  return {
    context,
    get messageListener() {
      return messageListener;
    },
    sentMessages,
    inserted,
    toasts,
  };
}

test('content INSERT_TEXT inserts into the current editable target without saving a recent result', () => {
  const input = new FakeInputElement('hello');
  input.selectionStart = 2;
  input.selectionEnd = 4;
  const harness = loadContent(input);
  let response;

  const handledAsync = harness.messageListener({
    target: harness.context.VI_TARGETS.CONTENT,
    action: harness.context.VI_MSG.INSERT_TEXT,
    text: 'phrase',
  }, {}, (value) => {
    response = value;
  });

  assert.equal(handledAsync, false);
  assert.equal(response.ok, true);
  assert.equal(harness.inserted.length, 1);
  assert.equal(harness.inserted[0].target, input);
  assert.equal(harness.inserted[0].text, 'phrase');
  assert.equal(harness.inserted[0].saved.start, 2);
  assert.equal(harness.inserted[0].saved.end, 4);
  assert.equal(harness.sentMessages.length, 0);
});

test('content INSERT_TEXT reports no-target when there is no editable target', () => {
  const harness = loadContent(null);
  let response;

  const handledAsync = harness.messageListener({
    target: harness.context.VI_TARGETS.CONTENT,
    action: harness.context.VI_MSG.INSERT_TEXT,
    text: 'phrase',
  }, {}, (value) => {
    response = value;
  });

  assert.equal(handledAsync, false);
  assert.equal(response.ok, false);
  assert.equal(response.error, 'no-target');
  assert.equal(harness.inserted.length, 0);
  assert.deepEqual(harness.toasts, ['pickerNoTarget']);
});
