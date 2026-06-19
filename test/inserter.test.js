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

class FakeInputElement {
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

class FakeTextAreaElement extends FakeInputElement {}

function makeContext() {
  const attached = new Set();
  const context = loadClassicScript('src/content/inserter.js', {
    HTMLInputElement: FakeInputElement,
    HTMLTextAreaElement: FakeTextAreaElement,
    InputEvent: FakeInputEvent,
    document: {
      contains(element) {
        return attached.has(element);
      },
    },
  });

  return { attached, context };
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
