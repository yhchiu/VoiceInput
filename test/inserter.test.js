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
  });

  function addToFrame(element) {
    element.ownerDocument = frameDocument;
    frameAttached.add(element);
    return element;
  }

  function makeIframe(contentDocument) {
    const iframe = {
      tagName: 'IFRAME',
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
    topAttached,
    addToFrame,
    makeIframe,
    FrameInputElement,
    FrameTextAreaElement,
    setFrameSelection(selection) {
      frameSelection = selection;
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
