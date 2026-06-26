const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

function makeDocument() {
  return {
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        value: '',
        textContent: '',
      };
    },
  };
}

function makeSelect() {
  return {
    children: [],
    value: '',
    set innerHTML(value) {
      this._innerHTML = String(value);
      this.children = [];
    },
    get innerHTML() {
      return this._innerHTML || '';
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
  };
}

test('viBuildLangOptions uses auto sentinel while displaying navigator language', () => {
  const select = makeSelect();
  const context = loadClassicScript('src/common/languages.js', {
    document: makeDocument(),
    navigator: { language: 'en-US' },
  });

  context.viBuildLangOptions(select, context.VI_LANG_AUTO, 'Auto');

  assert.equal(select.value, 'auto');
  assert.equal(select.children[0].value, 'auto');
  assert.match(select.children[0].textContent, /^Auto \(en-US/);
  const explicitNavOptions = select.children.filter((option) => option.value === 'en-US');
  assert.equal(explicitNavOptions.length, 1);
  assert.notEqual(select.children[0], explicitNavOptions[0]);
});

test('viBuildLangOptions includes navigator language when it is not curated', () => {
  const select = makeSelect();
  const context = loadClassicScript('src/common/languages.js', {
    document: makeDocument(),
    navigator: { language: 'mi-NZ' },
  });

  context.viBuildLangOptions(select, context.VI_LANG_AUTO, 'Auto');

  const explicitNavOptions = select.children.filter((option) => option.value === 'mi-NZ');
  assert.equal(explicitNavOptions.length, 1);
  assert.equal(explicitNavOptions[0].textContent, 'mi-NZ');
});
