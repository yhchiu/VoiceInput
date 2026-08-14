const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { createContext, loadClassicScript, repoRoot } = require('./helpers/load-classic-script');

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));

// Loads the service worker the way Chrome does, with just enough of the
// extension APIs to drive its message handler.
function loadServiceWorker({ tabReplies = [], injectSucceeds = true } = {}) {
  let messageListener = null;
  const sentToTabs = [];
  const injections = [];
  let replyIndex = 0;

  const context = createContext({
    crypto: { randomUUID: () => 'test-session-id' },
    chrome: {
      runtime: {
        id: 'test-extension-id',
        getManifest: () => manifest,
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          },
        },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        sendMessage: () => Promise.resolve({ ok: true }),
      },
      tabs: {
        async sendMessage(tabId, message, options) {
          sentToTabs.push({ tabId, message, options });
          const reply = tabReplies[replyIndex];
          replyIndex += 1;
          if (!reply || reply === 'unavailable') {
            throw new Error('Could not establish connection. Receiving end does not exist.');
          }
          return reply;
        },
        query: async () => [{ id: 7, windowId: 1 }],
        get: async (id) => ({ id, windowId: 1 }),
        onRemoved: { addListener() {} },
      },
      scripting: {
        async executeScript(details) {
          injections.push(details);
          if (!injectSucceeds) throw new Error('Cannot access contents of the page.');
          return [{ result: null }];
        },
      },
      action: {
        setPopup: async () => {},
        setBadgeText: async () => {},
        setTitle: async () => {},
      },
      commands: { onCommand: { addListener() {} } },
      storage: {
        sync: { get: async () => ({}), set: async () => {} },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        onChanged: { addListener() {} },
      },
    },
  });

  // The service worker pulls its shared modules in with importScripts.
  context.importScripts = (...files) => {
    files.forEach((file) => loadClassicScript(file.replace(/^\//, ''), context));
  };

  loadClassicScript('src/background/service_worker.js', context);

  return {
    context,
    sentToTabs,
    injections,
    send(message) {
      return new Promise((resolve) => {
        messageListener(message, {}, resolve);
      });
    },
  };
}

function insertText(harness) {
  return harness.send({
    target: harness.context.VI_TARGETS.BACKGROUND,
    action: harness.context.VI_MSG.INSERT_TEXT,
    text: 'phrase',
  });
}

test('a live content script is messaged once, with no injection', async () => {
  const harness = loadServiceWorker({ tabReplies: [{ ok: true }] });

  const response = await insertText(harness);

  assert.equal(response.ok, true);
  assert.equal(harness.sentToTabs.length, 1);
  assert.equal(harness.injections.length, 0);
});

test('an orphaned content script is re-injected and the message retried', async () => {
  // The first send fails the way an orphaned tab does, then the fresh script answers.
  const harness = loadServiceWorker({ tabReplies: ['unavailable', { ok: true }] });

  const response = await insertText(harness);

  assert.equal(response.ok, true);
  assert.equal(harness.sentToTabs.length, 2);
  assert.equal(harness.injections.length, 1);
  assert.deepEqual(harness.injections[0].files, manifest.content_scripts[0].js);
  assert.equal(harness.injections[0].target.tabId, 7);
});

test('a page that cannot be injected still reports content-unavailable', async () => {
  const harness = loadServiceWorker({ tabReplies: ['unavailable'], injectSucceeds: false });

  const response = await insertText(harness);

  assert.equal(response.ok, false);
  assert.equal(response.error, 'content-unavailable');
  assert.equal(harness.injections.length, 1);
  // No retry once injection failed: there is nothing new to answer.
  assert.equal(harness.sentToTabs.length, 1);
});

test('injection is attempted only once when the retry also fails', async () => {
  const harness = loadServiceWorker({ tabReplies: ['unavailable', 'unavailable'] });

  const response = await insertText(harness);

  assert.equal(response.ok, false);
  assert.equal(response.error, 'content-unavailable');
  assert.equal(harness.sentToTabs.length, 2);
  assert.equal(harness.injections.length, 1);
});

test('a content script answering with a failure is not treated as missing', async () => {
  const harness = loadServiceWorker({ tabReplies: [{ ok: false, error: 'no-target' }] });

  const response = await insertText(harness);

  assert.equal(response.ok, false);
  assert.equal(response.error, 'no-target');
  // The script replied, so there is nothing to recover and nothing to inject.
  assert.equal(harness.injections.length, 0);
});

test('the manifest grants the scripting permission the recovery needs', () => {
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('activeTab'));
});
