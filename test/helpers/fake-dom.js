// Minimal fake DOM shared by the extension page tests: enough of Element and
// Document to boot a page script and dispatch events at it.

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

module.exports = { FakeClassList, FakeElement, FakeDocument };
