const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

class FakeInputEvent {
  constructor(type, options) {
    this.type = type;
    this.bubbles = options.bubbles;
    this.inputType = options.inputType;
    this.data = options.data;
  }
}

// Each realm (the top frame, an iframe) has its own element constructors, so
// build a fresh, unrelated pair per realm rather than sharing one class.
function defineInputClasses() {
  class InputElement {
    constructor(type = 'text', value = '') {
      this.type = type;
      this.value = value;
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.events = [];
      this.focused = false;
    }

    focus() {
      this.focused = true;
    }

    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }

    dispatchEvent(event) {
      this.events.push(event);
      return true;
    }
  }

  class TextAreaElement extends InputElement {}

  return { InputElement, TextAreaElement };
}

const { InputElement: FakeInputElement, TextAreaElement: FakeTextAreaElement } = defineInputClasses();

class FakeDataTransfer {
  constructor() {
    this.data = new Map();
  }

  setData(type, value) {
    this.data.set(type, value);
  }

  getData(type) {
    return this.data.get(type);
  }
}

class FakeClipboardEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = options.bubbles;
    this.cancelable = options.cancelable;
    this.clipboardData = options.clipboardData;
  }
}

function makeContext() {
  const attached = new Set();
  const context = loadClassicScript('src/content/inserter.js', {
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    InputEvent: FakeInputEvent,
    document: {
      activeElement: null,
      contains(element) {
        return attached.has(element);
      },
    },
  });

  return { attached, context };
}

// Mirrors the Google Docs / TinyMCE shape: the editable lives in a same-origin
// iframe with its own document, realm constructors, and selection.
function makeFrameContext() {
  const topAttached = new Set();
  const frameAttached = new Set();

  const { InputElement: FrameInputElement, TextAreaElement: FrameTextAreaElement } = defineInputClasses();

  const frameDocument = {
    activeElement: null,
    execCommandCalls: [],
    createdNodes: [],
    contains(element) {
      return frameAttached.has(element);
    },
    execCommand(command, ui, value) {
      this.execCommandCalls.push({ command, value });
      return true;
    },
    createTextNode(data) {
      const node = { nodeType: 3, data };
      this.createdNodes.push(node);
      return node;
    },
    getSelection() {
      return frameSelection;
    },
  };

  const frameWindow = {
    HTMLInputElement: FrameInputElement,
    HTMLTextAreaElement: FrameTextAreaElement,
    InputEvent: FakeInputEvent,
    DataTransfer: FakeDataTransfer,
    ClipboardEvent: FakeClipboardEvent,
    frameElement: null,
    getSelection() {
      return frameSelection;
    },
  };
  frameDocument.defaultView = frameWindow;

  let frameSelection = null;

  const topDocument = {
    activeElement: null,
    contains(element) {
      return topAttached.has(element);
    },
    execCommand() {
      throw new Error('the top document must not be used for a frame target');
    },
    createTextNode() {
      throw new Error('the top document must not be used for a frame target');
    },
    getSelection() {
      throw new Error('the top document must not be used for a frame target');
    },
  };

  const context = loadClassicScript('src/content/inserter.js', {
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    InputEvent: FakeInputEvent,
    document: topDocument,
    // inserter.js treats globalThis as the top frame's window, which it is in a
    // content script.
    innerWidth: 1280,
    innerHeight: 800,
  });
  // topDocument deliberately has no defaultView: in the page, the top
  // document's defaultView is the same object inserter.js sees as globalThis.
  const isTopWindow = (win) => !!win && win.innerWidth === 1280;

  function addToFrame(element) {
    element.ownerDocument = frameDocument;
    frameAttached.add(element);
    return element;
  }

  function makeIframe(contentDocument, className = '') {
    const iframe = {
      tagName: 'IFRAME',
      className,
      isContentEditable: false,
      ownerDocument: topDocument,
      contentDocument,
    };
    topAttached.add(iframe);
    return iframe;
  }

  return {
    context,
    topDocument,
    frameDocument,
    frameWindow,
    isTopWindow,
    topAttached,
    addToFrame,
    makeIframe,
    FrameInputElement,
    FrameTextAreaElement,
    setFrameSelection(selection) {
      frameSelection = selection;
    },
    // Reproduces the Google Docs editing surface: an always-empty
    // contenteditable inside the hidden text-event-target frame.
    makeDocsTextEventTarget() {
      const events = [];
      const textbox = addToFrame({
        tagName: 'DIV',
        isContentEditable: true,
        role: 'textbox',
        innerHTML: '',
        focused: false,
        focus() {
          this.focused = true;
        },
        dispatchEvent(event) {
          events.push(event);
          return true;
        },
      });
      frameWindow.frameElement = makeIframe(
        frameDocument,
        'docs-texteventtarget-iframe docs-offscreen-z-index docs-texteventtarget-iframe-negative-top'
      );
      return { textbox, events };
    },
  };
}

test('viIsEditable recognizes supported native inputs and contenteditable nodes', () => {
  const { context } = makeContext();

  assert.equal(context.viIsEditable(new FakeInputElement('text')), true);
  assert.equal(context.viIsEditable(new FakeInputElement('search')), true);
  assert.equal(context.viIsEditable(new FakeInputElement('checkbox')), false);
  assert.equal(context.viIsEditable({ isContentEditable: true }), true);
  assert.equal(context.viIsEditable(null), false);
});

test('viInsertText inserts into input selection and dispatches an input event', () => {
  const { attached, context } = makeContext();
  const input = new FakeInputElement('text', 'hello world');
  input.selectionStart = 6;
  input.selectionEnd = 11;
  attached.add(input);

  const result = context.viInsertText(input, 'Taiwan');

  assert.equal(result.ok, true);
  assert.equal(input.focused, true);
  assert.equal(input.value, 'hello Taiwan');
  assert.equal(input.selectionStart, 12);
  assert.equal(input.selectionEnd, 12);
  assert.equal(input.events.length, 1);
  assert.equal(input.events[0].type, 'input');
  assert.equal(input.events[0].bubbles, true);
  assert.equal(input.events[0].inputType, 'insertText');
  assert.equal(input.events[0].data, 'Taiwan');
});

test('viInsertText restores saved textarea selection before insertion', () => {
  const { attached, context } = makeContext();
  const textarea = new FakeTextAreaElement('', 'abcdef');
  textarea.selectionStart = 0;
  textarea.selectionEnd = 0;
  attached.add(textarea);

  const result = context.viInsertText(textarea, 'XX', { start: 2, end: 4 });

  assert.equal(result.ok, true);
  assert.equal(textarea.value, 'abXXef');
  assert.equal(textarea.selectionStart, 4);
  assert.equal(textarea.selectionEnd, 4);
});

test('viInsertText rejects invalid targets and empty text', () => {
  const { attached, context } = makeContext();
  const detached = new FakeInputElement('text', 'abc');
  const unsupported = new FakeInputElement('checkbox', 'abc');
  attached.add(unsupported);

  assert.equal(context.viInsertText(null, 'x').reason, 'no-target');
  assert.equal(context.viInsertText(detached, 'x').reason, 'detached');
  assert.equal(context.viInsertText(unsupported, 'x').reason, 'unsupported-target');
  assert.equal(context.viInsertText(unsupported, '').reason, 'empty-text');
});

test('viDeepActiveElement walks into a same-origin frame to find the real caret host', () => {
  const harness = makeFrameContext();
  const textbox = harness.addToFrame({ isContentEditable: true, role: 'textbox' });
  const iframe = harness.makeIframe(harness.frameDocument);

  harness.frameDocument.activeElement = textbox;
  harness.topDocument.activeElement = iframe;

  assert.equal(harness.context.viIsEditable(iframe), false);
  assert.equal(harness.context.viDeepActiveElement(), textbox);
  assert.equal(harness.context.viIsEditable(harness.context.viDeepActiveElement()), true);
});

test('viDeepActiveElement walks through shadow roots', () => {
  const harness = makeFrameContext();
  const inner = { isContentEditable: true };
  const host = { shadowRoot: { activeElement: inner } };

  harness.topDocument.activeElement = host;

  assert.equal(harness.context.viDeepActiveElement(), inner);
});

test('viDeepActiveElement stops at a cross-origin frame instead of throwing', () => {
  const harness = makeFrameContext();
  const iframe = {
    tagName: 'IFRAME',
    ownerDocument: harness.topDocument,
    get contentDocument() {
      throw new Error('blocked a frame with origin ...');
    },
  };

  harness.topDocument.activeElement = iframe;

  assert.equal(harness.context.viDeepActiveElement(), iframe);
});

test('viDeepActiveElement does not loop when a frame reports itself as focused', () => {
  const harness = makeFrameContext();
  const selfFocusingDocument = { activeElement: null };
  const iframe = harness.makeIframe(selfFocusingDocument);
  selfFocusingDocument.activeElement = iframe;

  harness.topDocument.activeElement = iframe;

  assert.equal(harness.context.viDeepActiveElement(), iframe);
});

test('viIsAttached checks the target own document, not the top-level one', () => {
  const harness = makeFrameContext();
  const textbox = harness.addToFrame({ isContentEditable: true });

  assert.equal(harness.topDocument.contains(textbox), false);
  assert.equal(harness.context.viIsAttached(textbox), true);
});

test('viInsertText runs execCommand on the frame document for a frame contenteditable', () => {
  const harness = makeFrameContext();
  const textbox = harness.addToFrame({
    isContentEditable: true,
    focus() { this.focused = true; },
    dispatchEvent() { return true; },
  });

  const result = harness.context.viInsertText(textbox, 'hello', null);

  assert.equal(result.ok, true);
  assert.equal(textbox.focused, true);
  assert.deepEqual(harness.frameDocument.execCommandCalls, [{ command: 'insertText', value: 'hello' }]);
});

test('viInsertText falls back to a range built from the frame document', () => {
  const harness = makeFrameContext();
  const events = [];
  const textbox = harness.addToFrame({
    isContentEditable: true,
    focus() {},
    dispatchEvent(event) { events.push(event); return true; },
  });

  const inserted = [];
  const range = {
    deleteContents() {},
    insertNode(node) { inserted.push(node); },
    setStartAfter() {},
    setEndAfter() {},
  };
  harness.setFrameSelection({
    rangeCount: 1,
    getRangeAt() { return range; },
    removeAllRanges() {},
    addRange() {},
  });
  harness.frameDocument.execCommand = () => false;

  const result = harness.context.viInsertText(textbox, 'hello', null);

  assert.equal(result.ok, true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].data, 'hello');
  assert.equal(harness.frameDocument.createdNodes.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].inputType, 'insertText');
});

test('viInsertText pastes into the Google Docs text event target', () => {
  const harness = makeFrameContext();
  const { textbox, events } = harness.makeDocsTextEventTarget();

  const result = harness.context.viInsertText(textbox, '語音輸入', null);

  assert.equal(result.ok, true);
  assert.equal(textbox.focused, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'paste');
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].cancelable, true);
  assert.equal(events[0].clipboardData.getData('text/plain'), '語音輸入');
});

test('viInsertText does not touch execCommand on the Google Docs surface', () => {
  const harness = makeFrameContext();
  const { textbox } = harness.makeDocsTextEventTarget();
  // The empty contenteditable makes execCommand report false, and the range
  // fallback would insert into a node Google Docs never reads.
  harness.frameDocument.execCommand = () => {
    throw new Error('execCommand must not be used on the Google Docs surface');
  };

  assert.equal(harness.context.viInsertText(textbox, 'hello', null).ok, true);
  assert.equal(harness.frameDocument.createdNodes.length, 0);
});

test('viInsertText keeps using execCommand for an ordinary frame editor', () => {
  const harness = makeFrameContext();
  const { textbox, events } = harness.makeDocsTextEventTarget();
  // Same frame shape, but not the Google Docs input catcher.
  harness.frameWindow.frameElement.className = 'tinymce-editor';

  const result = harness.context.viInsertText(textbox, 'hello', null);

  assert.equal(result.ok, true);
  assert.deepEqual(harness.frameDocument.execCommandCalls, [{ command: 'insertText', value: 'hello' }]);
  assert.equal(events.length, 0);
});

test('viInsertText falls through when the frame cannot build a clipboard event', () => {
  const harness = makeFrameContext();
  const { textbox, events } = harness.makeDocsTextEventTarget();
  harness.frameWindow.DataTransfer = undefined;
  harness.frameWindow.ClipboardEvent = undefined;

  const result = harness.context.viInsertText(textbox, 'hello', null);

  // No paste was dispatched, so the ordinary path runs and cannot double up.
  assert.equal(result.ok, true);
  assert.equal(events.length, 0);
  assert.deepEqual(harness.frameDocument.execCommandCalls, [{ command: 'insertText', value: 'hello' }]);
});

test('viFrameChainWindows lists the top window and every frame window above the target', () => {
  const harness = makeFrameContext();
  const { textbox } = harness.makeDocsTextEventTarget();

  const windows = harness.context.viFrameChainWindows(textbox);

  assert.equal(windows.length, 2);
  assert.equal(harness.isTopWindow(windows[0]), true);
  assert.equal(windows[1], harness.frameWindow);
});

test('viFrameChainWindows returns the top window only for a top-level target', () => {
  const harness = makeFrameContext();
  const input = new FakeInputElement('text', 'abc');

  const windows = harness.context.viFrameChainWindows(input);

  // Listing the top window twice would run every picker key handler twice.
  assert.equal(windows.length, 1);
  assert.equal(harness.isTopWindow(windows[0]), true);
});

test('viFrameChainWindows stops at a cross-origin parent without repeating a window', () => {
  const harness = makeFrameContext();
  const textbox = harness.addToFrame({ isContentEditable: true });
  Object.defineProperty(harness.frameWindow, 'frameElement', {
    get() {
      throw new Error('blocked a frame with origin ...');
    },
  });

  const windows = harness.context.viFrameChainWindows(textbox);

  assert.equal(windows.length, 2);
  assert.equal(harness.isTopWindow(windows[0]), true);
  assert.equal(windows[1], harness.frameWindow);
});

test('viAnchorRect translates a frame-local rect into top frame coordinates', () => {
  const harness = makeFrameContext();
  const textbox = harness.addToFrame({
    isContentEditable: true,
    getBoundingClientRect: () => ({ left: 10, top: 20, right: 110, bottom: 40, width: 100, height: 20 }),
  });
  harness.frameWindow.frameElement = harness.makeIframe(harness.frameDocument, 'editor-frame');
  harness.frameWindow.frameElement.getBoundingClientRect =
    () => ({ left: 200, top: 300, right: 700, bottom: 700, width: 500, height: 400 });

  const rect = harness.context.viAnchorRect(textbox);

  assert.equal(rect.left, 210);
  assert.equal(rect.top, 320);
  assert.equal(rect.bottom, 340);
  assert.equal(rect.width, 100);
});

test('viAnchorRect returns null for an off-screen anchor such as the Google Docs frame', () => {
  const harness = makeFrameContext();
  const { textbox } = harness.makeDocsTextEventTarget();
  textbox.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 });
  // Google Docs parks the input catcher above the viewport.
  harness.frameWindow.frameElement.getBoundingClientRect =
    () => ({ left: 0, top: -10000, right: 1, bottom: -9999, width: 1, height: 1 });

  assert.equal(harness.context.viAnchorRect(textbox), null);
});

test('viAnchorRect returns null for a detached or rect-less anchor', () => {
  const harness = makeFrameContext();
  const detached = { isContentEditable: true, getBoundingClientRect: () => ({}) };
  const rectless = harness.addToFrame({ isContentEditable: true });

  assert.equal(harness.context.viAnchorRect(detached), null);
  assert.equal(harness.context.viAnchorRect(rectless), null);
});

test('viIsNativeTextInput recognizes inputs built by another frame realm', () => {
  const harness = makeFrameContext();
  const frameInput = harness.addToFrame(new harness.FrameInputElement('text', 'abc'));
  const frameTextArea = harness.addToFrame(new harness.FrameTextAreaElement('', 'abc'));

  // The top frame's constructors do not recognize them at all.
  assert.equal(frameInput instanceof FakeInputElement, false);

  assert.equal(harness.context.viIsNativeTextInput(frameInput), true);
  assert.equal(harness.context.viIsNativeTextInput(frameTextArea), true);
  assert.equal(harness.context.viIsEditable(frameInput), true);
});

test('viInsertText writes into a native input hosted by a frame', () => {
  const harness = makeFrameContext();
  const input = harness.addToFrame(new harness.FrameInputElement('text', 'hello world'));
  input.selectionStart = 6;
  input.selectionEnd = 11;

  const result = harness.context.viInsertText(input, 'Taiwan');

  assert.equal(result.ok, true);
  assert.equal(input.value, 'hello Taiwan');
  assert.equal(input.events.length, 1);
  assert.equal(input.events[0].data, 'Taiwan');
});
