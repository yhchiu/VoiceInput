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

const topDocument = 'top-document';

function loadContent(initialActiveElement) {
  let messageListener = null;
  let activeElement = initialActiveElement;
  const sentMessages = [];
  const inserted = [];
  const toasts = [];
  const listeners = new Map();
  const context = createContext({
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    window: {
      getSelection() {
        return null;
      },
    },
    document: {
      get activeElement() {
        return activeElement;
      },
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
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
    viIsNativeTextInput(element) {
      return element instanceof FakeInputElement;
    },
    viDeepActiveElement() {
      return activeElement;
    },
    viIsAttached(element) {
      return !!element && element !== 'detached';
    },
    viSelectionFor() {
      return null;
    },
    viIsFrameElement(element) {
      return !!(element && element.frame);
    },
    viDocumentFor(element) {
      return (element && element.ownerDocument) || topDocument;
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
    // Drive the listeners content.js registered, so the harness can move focus
    // the same way the browser would.
    focus(element) {
      activeElement = element;
      const focusin = listeners.get('focusin');
      if (focusin) focusin({ target: element });
    },
    blurToPage(element) {
      activeElement = element;
    },
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

function insertText(harness) {
  let response;
  harness.messageListener({
    target: harness.context.VI_TARGETS.CONTENT,
    action: harness.context.VI_MSG.INSERT_TEXT,
    text: 'phrase',
  }, {}, (value) => {
    response = value;
  });
  return response;
}

test('content INSERT_TEXT reuses the remembered field while page focus is idle', () => {
  const input = new FakeInputElement('hello');
  const harness = loadContent(null);
  harness.focus(input);
  // Opening the popup or side panel drops page focus back to the body.
  harness.blurToPage(null);

  const response = insertText(harness);

  assert.equal(response.ok, true);
  assert.equal(harness.inserted.length, 1);
  assert.equal(harness.inserted[0].target, input);
});

test('content INSERT_TEXT reuses the remembered field when focus moves within the same document', () => {
  const input = new FakeInputElement('hello');
  const harness = loadContent(null);
  harness.focus(input);
  harness.blurToPage({ editable: false });

  const response = insertText(harness);

  assert.equal(response.ok, true);
  assert.equal(harness.inserted[0].target, input);
});

test('content INSERT_TEXT refuses the remembered field when focus is in an unreachable frame', () => {
  const titleInput = new FakeInputElement('My document');
  const harness = loadContent(null);
  harness.focus(titleInput);
  // The caret is now in the editor body, which lives behind a frame we could
  // not enter. Writing to the remembered title input would be silent damage.
  harness.blurToPage({ frame: true, editable: false });

  const response = insertText(harness);

  assert.equal(response.ok, false);
  assert.equal(response.error, 'no-target');
  assert.equal(harness.inserted.length, 0);
  assert.deepEqual(harness.toasts, ['pickerNoTarget']);
});

test('content INSERT_TEXT refuses the remembered field when focus is in another document', () => {
  const input = new FakeInputElement('hello');
  const harness = loadContent(null);
  harness.focus(input);
  harness.blurToPage({ editable: false, ownerDocument: 'frame-document' });

  const response = insertText(harness);

  assert.equal(response.ok, false);
  assert.equal(response.error, 'no-target');
  assert.equal(harness.inserted.length, 0);
});

// End-to-end over the real inserter, on the shape Google Docs actually uses:
// the top document only ever sees the hidden host iframe as focused, while the
// caret lives in a contenteditable inside that frame's own document.
function loadContentOnFrameHostedEditor() {
  let messageListener = null;
  const toasts = [];

  const frameDocument = {
    activeElement: null,
    execCommandCalls: [],
    contains(element) {
      return element === textbox;
    },
    execCommand(command, ui, value) {
      this.execCommandCalls.push({ command, value });
      return true;
    },
    getSelection() {
      return null;
    },
  };

  const textbox = {
    isContentEditable: true,
    ownerDocument: frameDocument,
    focused: false,
    focus() {
      this.focused = true;
    },
    dispatchEvent() {
      return true;
    },
  };
  frameDocument.activeElement = textbox;

  const topDocument = {
    activeElement: null,
    addEventListener() {},
    contains(element) {
      return element === iframe;
    },
    execCommand() {
      throw new Error('the top document must not be used for a frame target');
    },
  };

  const iframe = {
    tagName: 'IFRAME',
    isContentEditable: false,
    ownerDocument: topDocument,
    contentDocument: frameDocument,
  };
  topDocument.activeElement = iframe;

  const context = createContext({
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    InputEvent: class {
      constructor(type, options) {
        Object.assign(this, { type }, options);
      }
    },
    window: {},
    document: topDocument,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        sendMessage() {
          return Promise.resolve({ ok: true });
        },
      },
    },
    vt(key) {
      return key;
    },
    viMakeToast(message) {
      toasts.push(message);
    },
  });

  loadClassicScript('src/common/messages.js', context);
  loadClassicScript('src/content/inserter.js', context);
  loadClassicScript('src/content/content.js', context);

  return {
    context,
    frameDocument,
    textbox,
    toasts,
    get messageListener() {
      return messageListener;
    },
  };
}

test('content INSERT_TEXT reaches a contenteditable hosted in a same-origin frame', () => {
  const harness = loadContentOnFrameHostedEditor();
  let response;

  harness.messageListener({
    target: harness.context.VI_TARGETS.CONTENT,
    action: harness.context.VI_MSG.INSERT_TEXT,
    text: 'phrase',
  }, {}, (value) => {
    response = value;
  });

  assert.equal(response.ok, true);
  assert.equal(harness.textbox.focused, true);
  assert.deepEqual(harness.frameDocument.execCommandCalls, [{ command: 'insertText', value: 'phrase' }]);
  assert.deepEqual(harness.toasts, ['toastInserted']);
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
