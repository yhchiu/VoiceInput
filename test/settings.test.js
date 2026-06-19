const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

function makeChromeStorage(initial = {}) {
  const syncData = { ...initial };
  const localData = {};
  function makeArea(data) {
    return {
      async get(key) {
        return { [key]: data[key] };
      },
      async set(value) {
        Object.assign(data, value);
      },
      async remove(key) {
        delete data[key];
      },
    };
  }

  const sync = makeArea(syncData);
  sync.QUOTA_BYTES_PER_ITEM = 8192;
  const local = makeArea(localData);
  local.QUOTA_BYTES = 10485760;

  return {
    data: syncData,
    syncData,
    localData,
    chrome: {
      storage: {
        sync,
        local,
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
  assert.equal(settings.scratchpadStorageMode, 'none');
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
    scratchpadStorageMode: 'sync',
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
  assert.equal(next.scratchpadStorageMode, 'sync');
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

test('scratchpad storage mode normalizes invalid values', async () => {
  const storage = makeChromeStorage();
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'en-US' },
  });

  assert.equal(context.viNormalizeScratchpadStorageMode('local'), 'local');
  assert.equal(context.viNormalizeScratchpadStorageMode('sync'), 'sync');
  assert.equal(context.viNormalizeScratchpadStorageMode('invalid'), 'none');

  const settings = await context.viSetSettings({ scratchpadStorageMode: 'invalid' });
  assert.equal(settings.scratchpadStorageMode, 'none');
});

test('scratchpad text is stored in the selected chrome storage area', async () => {
  const storage = makeChromeStorage();
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'en-US' },
  });

  const localResult = await context.viSetScratchpadText('local', 'local text');
  assert.equal(localResult.ok, true);
  assert.equal(localResult.truncated, false);
  assert.equal(storage.localData[context.VI_SCRATCHPAD_STORAGE_KEY].text, 'local text');
  assert.equal(storage.syncData[context.VI_SCRATCHPAD_STORAGE_KEY], undefined);
  assert.equal((await context.viGetScratchpadText('local')).text, 'local text');

  const syncResult = await context.viSetScratchpadText('sync', 'sync text');
  assert.equal(syncResult.ok, true);
  assert.equal(storage.syncData[context.VI_SCRATCHPAD_STORAGE_KEY].text, 'sync text');
  assert.equal((await context.viGetScratchpadText('sync')).text, 'sync text');

  await context.viClearScratchpadStorage('local');
  assert.equal(storage.localData[context.VI_SCRATCHPAD_STORAGE_KEY], undefined);

  await context.viClearScratchpadStorage();
  assert.equal(storage.syncData[context.VI_SCRATCHPAD_STORAGE_KEY], undefined);
});

test('scratchpad sync storage truncates by UTF-8 bytes without splitting characters', async () => {
  const storage = makeChromeStorage();
  storage.chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 520;
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'en-US' },
  });

  const prepared = context.viPrepareScratchpadTextForStorage('abc你好🙂xyz', 'sync');
  assert.equal(prepared.maxBytes, 8);
  assert.equal(prepared.truncated, true);
  assert.equal(prepared.text, 'abc你');
  assert.equal(prepared.storedBytes, 6);
  assert.equal(context.viUtf8ByteLength(prepared.text), prepared.storedBytes);

  const result = await context.viSetScratchpadText('sync', 'abc你好🙂xyz');
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.equal(storage.syncData[context.VI_SCRATCHPAD_STORAGE_KEY].text, 'abc你');
});

test('scratchpad storage uses zero bytes when reported quota cannot fit the item overhead', () => {
  const storage = makeChromeStorage();
  storage.chrome.storage.sync.QUOTA_BYTES_PER_ITEM = 500;
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'en-US' },
  });

  const prepared = context.viPrepareScratchpadTextForStorage('abc', 'sync');

  assert.equal(prepared.maxBytes, 0);
  assert.equal(prepared.text, '');
  assert.equal(prepared.truncated, true);
});

test('empty scratchpad text removes the stored value', async () => {
  const storage = makeChromeStorage();
  const context = loadClassicScript('src/common/settings.js', {
    chrome: storage.chrome,
    navigator: { language: 'en-US' },
  });

  await context.viSetScratchpadText('local', 'temporary');
  assert.equal(storage.localData[context.VI_SCRATCHPAD_STORAGE_KEY].text, 'temporary');

  const result = await context.viSetScratchpadText('local', '');
  assert.equal(result.ok, true);
  assert.equal(storage.localData[context.VI_SCRATCHPAD_STORAGE_KEY], undefined);
});
