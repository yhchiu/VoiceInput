const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { createContext, loadClassicScript, repoRoot } = require('./helpers/load-classic-script');

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));

// Loads the service worker the way Chrome does, with just enough of the
// extension APIs to drive its message handler.
function loadServiceWorker({
  tabReplies = [],
  injectSucceeds = true,
  sidePanelMode = false,
  sidePanelOpens = true,
  activeTab = { id: 7, windowId: 1 },
} = {}) {
  let messageListener = null;
  let commandListener = null;
  let tabUpdatedListener = null;
  let gestureAlive = false;
  const sentToTabs = [];
  const injections = [];
  const badges = [];
  const titles = [];
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
        query: async () => (activeTab ? [activeTab] : []),
        get: async (id) => ({ id, windowId: 1 }),
        onRemoved: { addListener() {} },
        onUpdated: {
          addListener(listener) {
            tabUpdatedListener = listener;
          },
        },
      },
      i18n: { getMessage: (key) => key },
      scripting: {
        async executeScript(details) {
          injections.push(details);
          if (!injectSucceeds) throw new Error('Cannot access contents of the page.');
          return [{ result: null }];
        },
      },
      action: {
        setPopup: async () => {},
        setBadgeText: async (details) => { badges.push(details); },
        setBadgeBackgroundColor: async () => {},
        setTitle: async (details) => { titles.push(details); },
      },
      sidePanel: {
        setOptions: async () => {},
        setPanelBehavior: async () => {},
        async open() {
          // Chrome allows this only while the triggering gesture is live, which
          // ends the moment the listener yields. See pressShortcut below.
          if (!gestureAlive) {
            throw new Error('sidePanel.open() may only be called in response to a user gesture.');
          }
          if (!sidePanelOpens) throw new Error('No active side panel for windowId.');
        },
      },
      commands: {
        onCommand: {
          addListener(listener) {
            commandListener = listener;
          },
        },
      },
      storage: {
        sync: {
          get: async (key) => ({ [key]: { sidePanelMode } }),
          set: async () => {},
        },
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
    badges,
    titles,
    send(message) {
      return new Promise((resolve) => {
        messageListener(message, {}, resolve);
      });
    },
    // The command listener is deliberately synchronous, so it hands back
    // nothing to await. Everything here settles on the microtask queue, so one
    // macrotask is enough to let the work it started finish.
    //
    // The gesture is modelled the way Chrome ends it: alive for the synchronous
    // body of the listener, gone as soon as it yields. Anything the listener
    // awaits before opening the panel therefore misses the window.
    async pressShortcut() {
      gestureAlive = true;
      Promise.resolve().then(() => { gestureAlive = false; });
      commandListener('toggle-recognition', activeTab ? { ...activeTab } : undefined);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    },
    watchesAllTabs() {
      return tabUpdatedListener !== null;
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

test('a shortcut start that fails marks the toolbar icon for that tab', async () => {
  const harness = loadServiceWorker({ tabReplies: ['unavailable'], injectSucceeds: false });

  await harness.pressShortcut();

  // The shortcut has no surface of its own, so this is the only feedback there is.
  const badge = harness.badges.at(-1);
  assert.equal(badge.text, '!');
  assert.equal(badge.tabId, 7);
  assert.equal(harness.titles.at(-1).title, 'pageUnavailable');
  assert.equal(harness.titles.at(-1).tabId, 7);
});

test('a shortcut start that succeeds leaves no mark', async () => {
  const harness = loadServiceWorker({ tabReplies: [{ ok: true }] });

  await harness.pressShortcut();

  assert.equal(harness.badges.every((badge) => badge.text === ''), true);
  // The tab's own mark is cleared, and so is any unscoped one, which would
  // otherwise sit on every tab.
  assert.ok(harness.badges.some((badge) => badge.tabId === 7));
  assert.ok(harness.badges.some((badge) => badge.tabId === undefined));
});

test('a start refused for having no field says so rather than blaming the page', async () => {
  // Only Side Panel mode surfaces no-target from the start call. In content mode
  // the content script answers ok and reports a missing field with its own toast.
  const harness = loadServiceWorker({
    sidePanelMode: true,
    tabReplies: [{ ok: false, error: 'no-target' }],
  });

  await harness.pressShortcut();

  assert.equal(harness.titles.at(-1).title, 'pickerNoTarget');
});

test('the shortcut opens the side panel while the gesture is still live', async () => {
  const harness = loadServiceWorker({ sidePanelMode: true, tabReplies: [{ ok: true }] });

  await harness.pressShortcut();

  // Chrome rejects sidePanel.open() once the listener has awaited anything, so
  // reaching a started session at all proves it was opened on the first line.
  assert.equal(harness.badges.every((badge) => badge.text === ''), true);
  assert.equal(harness.titles.every((title) => title.title === 'extName'), true);
});

test('a side panel that will not open is reported, not passed off as a start', async () => {
  const harness = loadServiceWorker({ sidePanelMode: true, sidePanelOpens: false });

  await harness.pressShortcut();

  // The panel is where recognition would have run, so there is nothing left to
  // start. This used to build a session anyway and answer ok.
  assert.equal(harness.badges.at(-1).text, '!');
  assert.equal(harness.titles.at(-1).title, 'sidePanelOpenFailed');
});

test('a shortcut press starts again when the remembered session had already ended', async () => {
  const harness = loadServiceWorker({
    tabReplies: [{ ok: true }, { ok: true, stopped: false }, { ok: true }],
  });

  await harness.pressShortcut();
  // Navigating away mid-session leaves currentSession set with nothing running.
  await harness.pressShortcut();

  assert.deepEqual(harness.sentToTabs.map((sent) => sent.message.action), [
    'START_RECOGNITION',
    'STOP_RECOGNITION',
    'START_RECOGNITION',
  ]);
});

test('a shortcut press still stops a session that is really running', async () => {
  const harness = loadServiceWorker({
    tabReplies: [{ ok: true }, { ok: true, stopped: true }],
  });

  await harness.pressShortcut();
  await harness.pressShortcut();

  assert.deepEqual(harness.sentToTabs.map((sent) => sent.message.action), [
    'START_RECOGNITION',
    'STOP_RECOGNITION',
  ]);
});

test('a failure with no active tab is still reported', async () => {
  const harness = loadServiceWorker({ activeTab: null });

  await harness.pressShortcut();

  // There is no tab to scope the mark to, which is no reason to say nothing.
  assert.equal(harness.badges.at(-1).text, '!');
  assert.equal(harness.badges.at(-1).tabId, undefined);
  assert.equal(harness.titles.at(-1).title, 'pageUnavailable');
});

test('a failure mark is scoped to its tab whenever there is one', async () => {
  // Scoping is what keeps the mark off other tabs, and it is also what retires
  // it: Chrome drops a tab-scoped badge when that tab navigates. An unscoped
  // failure mark would sit on every tab until something cleared it by hand.
  const harness = loadServiceWorker({ tabReplies: ['unavailable'], injectSucceeds: false });

  await harness.pressShortcut();

  const marks = [
    ...harness.badges.filter((badge) => badge.text !== ''),
    ...harness.titles.filter((title) => title.title !== 'extName'),
  ];
  assert.ok(marks.length > 0);
  for (const mark of marks) {
    assert.equal(mark.tabId, 7, `${JSON.stringify(mark)} is not scoped to a tab`);
  }
});

test('the service worker does not watch every tab in the browser', () => {
  // tabs.onUpdated fires for every tab load, and each one wakes the service
  // worker. Nothing here needs it.
  const harness = loadServiceWorker();

  assert.equal(harness.watchesAllTabs(), false);
});

test('the manifest grants the scripting permission the recovery needs', () => {
  assert.ok(manifest.permissions.includes('scripting'));
  assert.ok(manifest.permissions.includes('activeTab'));
});
