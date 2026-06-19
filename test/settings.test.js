const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

function makeChromeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    chrome: {
      storage: {
        sync: {
          async get(key) {
            return { [key]: data[key] };
          },
          async set(value) {
            Object.assign(data, value);
          },
          async remove(key) {
            delete data[key];
          },
        },
      },
    },
  };
}

test('viGetSettings returns normalized defaults from navigator language', async () => {
  const storage = makeChromeStorage();
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'zh-TW' },
  });

  const settings = await context.viGetSettings();

  assert.equal(settings.maxAlternatives, 3);
  assert.equal(settings.lang, 'zh-TW');
  assert.equal(settings.continuous, false);
  assert.equal(settings.interimResults, false);
  assert.equal(settings.autoInsertIfSingle, true);
  assert.equal(settings.sidePanelMode, false);
  assert.equal(Array.isArray(settings.replacements), true);
  assert.equal(settings.replacements.length, 0);
});

test('viSetSettings clamps and normalizes persisted settings', async () => {
  const storage = makeChromeStorage();
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'en-US' },
  });

  const next = await context.viSetSettings({
    maxAlternatives: 99,
    continuous: 1,
    interimResults: 0,
    autoInsertIfSingle: '',
    sidePanelMode: 'yes',
    lang: 12,
    replacements: [
      { from: 'foo', to: 'bar' },
      { from: '', to: 'ignored' },
      null,
      { from: 'x'.repeat(250), to: 'y'.repeat(600) },
    ],
  });

  assert.equal(next.maxAlternatives, 10);
  assert.equal(next.continuous, true);
  assert.equal(next.interimResults, false);
  assert.equal(next.autoInsertIfSingle, false);
  assert.equal(next.sidePanelMode, true);
  assert.equal(next.lang, 'en-US');
  assert.equal(next.replacements.length, 2);
  assert.equal(next.replacements[0].from, 'foo');
  assert.equal(next.replacements[0].to, 'bar');
  assert.equal(next.replacements[1].from.length, 200);
  assert.equal(next.replacements[1].to.length, 500);
  assert.equal(storage.data[context.VI_SETTINGS_KEY].maxAlternatives, 10);
});

test('replacement helpers ignore invalid rules and apply valid ones in order', () => {
  const context = loadClassicScript('src/common/settings.js', {
    chrome: makeChromeStorage().chrome,
    navigator: { language: 'en-US' },
  });

  const normalized = context.viNormalizeReplacements([
    { from: 'foo', to: 'bar' },
    { from: '', to: 'ignored' },
    { from: 'bar', to: 'baz' },
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(context.viApplyReplacements('foo foo', normalized), 'baz baz');
  assert.equal(context.viApplyReplacements(123, normalized), 123);
});

test('viGetSettings falls back to defaults when storage fails', async () => {
  const context = loadClassicScript('src/common/settings.js', {
    chrome: {
      storage: {
        sync: {
          async get() {
            throw new Error('storage unavailable');
          },
        },
      },
    },
    navigator: { language: 'ja-JP' },
  });

  const settings = await context.viGetSettings();

  assert.equal(settings.lang, 'ja-JP');
  assert.equal(settings.maxAlternatives, 3);
});
