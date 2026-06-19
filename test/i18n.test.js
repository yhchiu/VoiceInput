const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

test('vt falls back to the key when chrome i18n is unavailable', () => {
  const context = loadClassicScript('src/common/i18n.js');

  assert.equal(context.vt('missingKey'), 'missingKey');
});

test('vt returns chrome i18n messages and forwards substitutions', () => {
  let call;
  const context = loadClassicScript('src/common/i18n.js', {
    chrome: {
      i18n: {
        getMessage(key, substitutions) {
          call = { key, substitutions };
          return key === 'helloName' ? 'Hello, Alice' : '';
        },
      },
    },
  });

  assert.equal(context.vt('helloName', 'Alice'), 'Hello, Alice');
  assert.equal(call.key, 'helloName');
  assert.equal(Array.isArray(call.substitutions), true);
  assert.equal(call.substitutions[0], 'Alice');
  assert.equal(context.vt('unknownKey'), 'unknownKey');
});
