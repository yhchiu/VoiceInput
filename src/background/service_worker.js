// Service worker — routes recognition between popup, side panel, and content scripts.
// Normal mode runs SpeechRecognition in the content script. Side Panel mode runs
// SpeechRecognition in an extension page so mic permission belongs to the extension.

importScripts('/src/common/messages.js', '/src/common/settings.js');

const MSG = globalThis.VI_MSG;
const TARGETS = globalThis.VI_TARGETS;
const RECENT_RESULT_KEY = 'voiceInput.recentResult.v1';
const PAGE_TARGET_KEY = 'voiceInput.pageTarget.v1';
const POPUP_PATH = 'src/popup/popup.html';
const SIDE_PANEL_PATH = 'src/sidepanel/sidepanel.html';
const MIC_PERMISSION_PAGE_PATH = 'src/permission/permission.html';

// { mode: 'content' | 'sidepanel', tabId, frameId, windowId, sessionId? } | null
let currentSession = null;
let pendingSidePanelStart = null;
let recentResultMemory = null;
let pageTargetMemory = null;
let sidePanelPickerTarget = null;
let sidePanelPickerId = null;

function normalizeRecentResultText(text) {
  if (typeof text !== 'string') return '';
  const value = text.trim();
  return value.length > 4000 ? value.slice(0, 4000) : value;
}

async function setRecentResult(text) {
  const value = normalizeRecentResultText(text);
  if (!value) return null;
  const result = {
    text: value,
    updatedAt: Date.now(),
  };
  if (chrome.storage.session) {
    await chrome.storage.session.set({ [RECENT_RESULT_KEY]: result });
  } else {
    recentResultMemory = result;
  }
  return result;
}

async function getRecentResult() {
  const stored = chrome.storage.session
    ? await chrome.storage.session.get(RECENT_RESULT_KEY)
    : { [RECENT_RESULT_KEY]: recentResultMemory };
  const result = stored && stored[RECENT_RESULT_KEY];
  if (!result || typeof result.text !== 'string' || !result.text.trim()) return null;
  return {
    text: result.text,
    updatedAt: typeof result.updatedAt === 'number' ? result.updatedAt : null,
  };
}

function normalizePageTargetState(state) {
  if (!state || typeof state.tabId !== 'number' || typeof state.focusedAt !== 'number') return null;
  return {
    tabId: state.tabId,
    frameId: typeof state.frameId === 'number' ? state.frameId : 0,
    windowId: typeof state.windowId === 'number' ? state.windowId : null,
    focusedAt: state.focusedAt,
  };
}

async function setPageTargetState(state) {
  const normalized = normalizePageTargetState(state);
  pageTargetMemory = normalized;
  if (chrome.storage.session) {
    if (normalized) {
      await chrome.storage.session.set({ [PAGE_TARGET_KEY]: normalized });
    } else {
      await chrome.storage.session.remove(PAGE_TARGET_KEY);
    }
  }
  return normalized;
}

async function getStoredPageTargetState() {
  if (pageTargetMemory) return pageTargetMemory;
  if (!chrome.storage.session) return null;
  const stored = await chrome.storage.session.get(PAGE_TARGET_KEY);
  pageTargetMemory = normalizePageTargetState(stored && stored[PAGE_TARGET_KEY]);
  return pageTargetMemory;
}

async function getCurrentPageTargetState() {
  const state = await getStoredPageTargetState();
  if (!state) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || tab.id !== state.tabId) return null;
  } catch (_) {
    return null;
  }
  return state;
}

async function notifyRecentResultUpdated(result) {
  if (!result) return;
  await Promise.all([TARGETS.POPUP, TARGETS.SIDEPANEL].map(async (target) => {
    try {
      await chrome.runtime.sendMessage({
        target,
        action: MSG.RECENT_RESULT_UPDATED,
        result,
      });
    } catch (_) {}
  }));
}

async function getSidePanelModeEnabled() {
  const settings = await globalThis.viGetSettings();
  return !!settings.sidePanelMode && !!chrome.sidePanel;
}

async function ignoreFailure(promise) {
  try {
    await promise;
  } catch (error) {
    console.warn('[VoiceInput] Runtime mode update failed:', error);
  }
}

async function applyRuntimeMode() {
  const settings = await globalThis.viGetSettings();
  const enabled = !!settings.sidePanelMode && !!chrome.sidePanel;

  if (!enabled && currentSession && currentSession.mode === 'sidepanel') {
    await stopRecognitionFlow();
  }
  if (!enabled) {
    sidePanelPickerTarget = null;
    sidePanelPickerId = null;
  }

  if (enabled) {
    await ignoreFailure(chrome.action.setPopup({ popup: '' }));
    await ignoreFailure(chrome.sidePanel.setOptions({ enabled: true, path: SIDE_PANEL_PATH }));
    await ignoreFailure(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
    return;
  }

  await ignoreFailure(chrome.action.setPopup({ popup: POPUP_PATH }));
  if (chrome.sidePanel) {
    await ignoreFailure(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }));
    await ignoreFailure(chrome.sidePanel.setOptions({ enabled: false, path: SIDE_PANEL_PATH }));
  }
}

// The keyboard shortcut has no surface of its own, so a failed start would
// otherwise be completely silent. Mark the toolbar icon instead, and put the
// reason in its tooltip.
//
// Every call here passes a tabId. That keeps the mark off other tabs, and it is
// also what retires it: Chrome drops a tab-scoped badge when that tab navigates,
// so reloading the page clears the flag without this file watching for it. A
// global badge would neither be scoped nor self-clearing, and watching
// tabs.onUpdated to do it by hand would wake the service worker on every tab
// load in the browser.
const FAILURE_BADGE_TEXT = '!';
const FAILURE_BADGE_COLOR = '#b91c1c';

function localizedMessage(key) {
  try {
    return chrome.i18n.getMessage(key) || '';
  } catch (_) {
    return '';
  }
}

function startFailureMessage(error) {
  if (error === 'no-target') return localizedMessage('pickerNoTarget');
  if (error === 'content-unavailable' || error === 'no-active-tab') return localizedMessage('pageUnavailable');
  if (error === 'side-panel-disabled') return localizedMessage('sidePanelModeDisabled');
  if (error === 'side-panel-unavailable') return localizedMessage('sidePanelOpenFailed');
  return localizedMessage('errUnknown');
}

// Scope every mark to a tab when there is one. Failing with no active tab is the
// one case there is no tab to scope to, and it still deserves to be reported.
function actionScope(tabId) {
  return typeof tabId === 'number' ? { tabId } : {};
}

async function clearStartFailure(tabId) {
  const scope = actionScope(tabId);
  await ignoreFailure(chrome.action.setBadgeText({ ...scope, text: '' }));
  await ignoreFailure(chrome.action.setTitle({ ...scope, title: localizedMessage('extName') }));
  // An unscoped mark shows on every tab and survives navigation, so clear that
  // too whenever a start succeeds.
  if (scope.tabId !== undefined) {
    await ignoreFailure(chrome.action.setBadgeText({ text: '' }));
  }
}

async function reportCommandResult(tabId, result) {
  if (result && result.ok) {
    await clearStartFailure(tabId);
    return;
  }
  const scope = actionScope(tabId);
  await ignoreFailure(chrome.action.setBadgeText({ ...scope, text: FAILURE_BADGE_TEXT }));
  await ignoreFailure(chrome.action.setBadgeBackgroundColor({ ...scope, color: FAILURE_BADGE_COLOR }));
  await ignoreFailure(chrome.action.setTitle({
    ...scope,
    title: startFailureMessage(result && result.error),
  }));
}

async function getActiveTabFrame(originTabId) {
  try {
    if (typeof originTabId === 'number' && originTabId >= 0) {
      const tab = await chrome.tabs.get(originTabId);
      if (tab && typeof tab.id === 'number') {
        return { tabId: tab.id, frameId: 0, windowId: tab.windowId };
      }
    }

    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && typeof tab.id === 'number' && tab.id >= 0) {
      return { tabId: tab.id, frameId: 0, windowId: tab.windowId };
    }
  } catch (_) {}
  return null;
}

// Reloading or updating the extension orphans the content scripts in tabs that
// were already open, and Chrome never re-injects them. Every message to such a
// tab fails until the user reloads it, with nothing to tell them why. Inject the
// scripts on demand instead, so the tab recovers on its own.
function contentScriptFiles() {
  try {
    const scripts = chrome.runtime.getManifest().content_scripts;
    return (scripts && scripts[0] && scripts[0].js) || [];
  } catch (_) {
    return [];
  }
}

async function injectContentScripts(tabId, frameId) {
  const files = contentScriptFiles();
  if (!files.length || !chrome.scripting) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files,
    });
    return true;
  } catch (_) {
    // A restricted page, or no host access for this tab. Nothing to recover.
    return false;
  }
}

// Delivers a message to a tab's content script, injecting it once and retrying
// if nothing answered. `delivered` says whether the content script replied at
// all, which is separate from whether it could carry out the request.
async function deliverToContent(tabId, frameId, message) {
  const options = { frameId: typeof frameId === 'number' ? frameId : 0 };

  try {
    return { delivered: true, response: await chrome.tabs.sendMessage(tabId, message, options) };
  } catch (_) {}

  if (!(await injectContentScripts(tabId, options.frameId))) {
    return { delivered: false, response: null };
  }

  try {
    return { delivered: true, response: await chrome.tabs.sendMessage(tabId, message, options) };
  } catch (_) {
    return { delivered: false, response: null };
  }
}

async function prepareRecognitionTarget(tabFrame) {
  const { delivered, response } = await deliverToContent(
    tabFrame.tabId,
    tabFrame.frameId,
    { target: TARGETS.CONTENT, action: MSG.PREPARE_RECOGNITION_TARGET }
  );
  if (!delivered) return { ok: false, error: 'content-unavailable' };
  return response && response.ok
    ? { ok: true }
    : { ok: false, error: (response && response.error) || 'no-target' };
}

async function sendToContentTarget(target, action, payload = {}) {
  if (!target) return { ok: false, error: 'no-session' };
  const { delivered, response } = await deliverToContent(
    target.tabId,
    target.frameId,
    { target: TARGETS.CONTENT, action, ...payload }
  );
  return delivered ? response : { ok: false, error: 'content-unavailable' };
}

async function sendToSessionContent(action, payload = {}) {
  return sendToContentTarget(currentSession, action, payload);
}

async function getTextInsertionTarget(originTabId) {
  const pageTarget = await getCurrentPageTargetState();
  if (pageTarget) return pageTarget;
  return getActiveTabFrame(originTabId);
}

async function insertTextFlow(originTabId, text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, error: 'empty-text' };
  }
  const target = await getTextInsertionTarget(originTabId);
  if (!target) return { ok: false, error: 'no-active-tab' };
  return sendToContentTarget(target, MSG.INSERT_TEXT, { text });
}

async function startContentRecognitionFlow(originTabId) {
  if (currentSession) await stopRecognitionFlow();
  sidePanelPickerTarget = null;
  sidePanelPickerId = null;

  const tabFrame = await getActiveTabFrame(originTabId);
  if (!tabFrame) return { ok: false, error: 'no-active-tab' };

  const sessionId = crypto.randomUUID();
  currentSession = {
    mode: 'content',
    tabId: tabFrame.tabId,
    frameId: tabFrame.frameId,
    windowId: tabFrame.windowId,
    sessionId,
  };

  const { delivered } = await deliverToContent(
    tabFrame.tabId,
    tabFrame.frameId,
    { target: TARGETS.CONTENT, action: MSG.START_RECOGNITION, sessionId }
  );
  if (!delivered) {
    currentSession = null;
    return { ok: false, error: 'content-unavailable' };
  }
  return { ok: true, mode: 'content', sessionId };
}

// Chrome only allows sidePanel.open() while the user gesture that triggered it
// is still live, and awaiting anything ends that. So this must be called
// synchronously from the event listener, never after an await. It returns a
// promise for the outcome, which the caller can await later.
//
// It does not check whether Side Panel Mode is on, because that answer only
// comes from storage, and reading it would cost the very await this avoids. It
// does not need to: applyRuntimeMode disables the panel whenever the mode is
// off, so the call simply fails there, and only the Side Panel path looks at
// the result.
function openSidePanelNow(tab) {
  const windowId = tab && typeof tab.windowId === 'number' ? tab.windowId : null;
  if (!chrome.sidePanel || typeof chrome.sidePanel.open !== 'function' || windowId === null) {
    return Promise.resolve(false);
  }
  try {
    return Promise.resolve(chrome.sidePanel.open({ windowId })).then(() => true, () => false);
  } catch (_) {
    return Promise.resolve(false);
  }
}

async function sendStartToSidePanel(sessionId) {
  try {
    const res = await chrome.runtime.sendMessage({
      target: TARGETS.SIDEPANEL,
      action: MSG.START_RECOGNITION,
      sessionId,
    });
    return !!(res && res.ok);
  } catch (_) {
    return false;
  }
}

async function startSidePanelRecognitionFlow(originTabId, options = {}) {
  if (currentSession) await stopRecognitionFlow();

  const tabFrame = await getActiveTabFrame(originTabId);
  if (!tabFrame) return { ok: false, error: 'no-active-tab' };

  // The caller opens the panel before its first await, so all that reaches here
  // is the outcome. Without the panel there is nowhere for recognition to run,
  // so stop rather than building a session nothing will ever pick up.
  if (options.panelOpened === false) {
    return { ok: false, error: 'side-panel-unavailable' };
  }

  const prepared = await prepareRecognitionTarget(tabFrame);
  if (!prepared.ok) return prepared;

  const sessionId = crypto.randomUUID();
  currentSession = {
    mode: 'sidepanel',
    tabId: tabFrame.tabId,
    frameId: tabFrame.frameId,
    windowId: tabFrame.windowId,
    sessionId,
  };
  sidePanelPickerTarget = {
    tabId: tabFrame.tabId,
    frameId: tabFrame.frameId,
    windowId: tabFrame.windowId,
  };
  sidePanelPickerId = null;

  if (options.panelOpened) {
    pendingSidePanelStart = { sessionId, tabId: tabFrame.tabId, frameId: tabFrame.frameId, windowId: tabFrame.windowId };
    if (await sendStartToSidePanel(sessionId)) {
      pendingSidePanelStart = null;
    }
  }

  return { ok: true, mode: 'sidepanel', sessionId };
}

async function startRecognitionFlow(originTabId, options = {}) {
  if (await getSidePanelModeEnabled()) {
    return startSidePanelRecognitionFlow(originTabId, options);
  }
  return startContentRecognitionFlow(originTabId);
}

// Returns whether a session was actually running. Nothing clears currentSession
// when a tab navigates away mid-session, so it can outlive the recognition it
// describes, and a stop aimed at a session that has already gone must not be
// mistaken for a real one.
async function stopRecognitionFlow() {
  const sess = currentSession;
  currentSession = null;
  pendingSidePanelStart = null;
  if (!sess) return false;

  if (sess.mode === 'sidepanel') {
    let stopped = false;
    try {
      const res = await chrome.runtime.sendMessage({
        target: TARGETS.SIDEPANEL,
        action: MSG.STOP_RECOGNITION,
        sessionId: sess.sessionId,
      });
      stopped = !!(res && res.stopped);
    } catch (_) {
      // The panel is closed, so nothing was running in it.
    }
    try {
      await chrome.tabs.sendMessage(
        sess.tabId,
        { target: TARGETS.CONTENT, action: MSG.RECOGNITION_ENDED },
        { frameId: sess.frameId ?? 0 }
      );
    } catch (_) {}
    return stopped;
  }

  try {
    const res = await chrome.tabs.sendMessage(
      sess.tabId,
      { target: TARGETS.CONTENT, action: MSG.STOP_RECOGNITION },
      { frameId: sess.frameId ?? 0 }
    );
    return !!(res && res.stopped);
  } catch (_) {
    // The tab is gone or its script was replaced, so nothing was running.
    return false;
  }
}

function isCurrentSidePanelSession(sessionId) {
  return !!(
    currentSession &&
    currentSession.mode === 'sidepanel' &&
    (!sessionId || currentSession.sessionId === sessionId)
  );
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== TARGETS.BACKGROUND) return false;

  (async () => {
    switch (msg.action) {
      case MSG.START_RECOGNITION: {
        if (msg.source === TARGETS.SIDEPANEL && !(await getSidePanelModeEnabled())) {
          sendResponse({ ok: false, error: 'side-panel-disabled' });
          return;
        }
        const tabId = sender && sender.tab && sender.tab.id;
        const result = await startRecognitionFlow(typeof tabId === 'number' ? tabId : undefined);
        sendResponse(result);
        return;
      }

      case MSG.STOP_RECOGNITION: {
        await stopRecognitionFlow();
        sendResponse({ ok: true });
        return;
      }

      case MSG.INSERT_TEXT: {
        const tabId = sender && sender.tab && sender.tab.id;
        const result = await insertTextFlow(typeof tabId === 'number' ? tabId : undefined, msg.text);
        sendResponse(result);
        return;
      }

      case MSG.GET_STATUS: {
        sendResponse({
          ok: true,
          listening: !!currentSession,
          mode: currentSession ? currentSession.mode : null,
        });
        return;
      }

      case MSG.SIDE_PANEL_READY: {
        if (pendingSidePanelStart && isCurrentSidePanelSession(pendingSidePanelStart.sessionId)) {
          const pending = pendingSidePanelStart;
          pendingSidePanelStart = null;
          sendResponse({ ok: true, start: true, sessionId: pending.sessionId });
        } else {
          sendResponse({ ok: true, start: false });
        }
        return;
      }

      case MSG.RECOGNITION_STARTED: {
        if (isCurrentSidePanelSession(msg.sessionId)) {
          await sendToSessionContent(MSG.RECOGNITION_STARTED);
        }
        sendResponse({ ok: true });
        return;
      }

      case MSG.RECOGNITION_RESULTS: {
        const result = isCurrentSidePanelSession(msg.sessionId)
          ? await sendToSessionContent(MSG.RECOGNITION_RESULTS, { alternatives: msg.alternatives || [] })
          : { ok: false, error: 'no-session' };
        sidePanelPickerId = result && result.ok && result.picker ? result.pickerId : null;
        sendResponse(result || { ok: true });
        return;
      }

      case MSG.RECOGNITION_INTERIM: {
        const result = isCurrentSidePanelSession(msg.sessionId)
          ? await sendToSessionContent(MSG.RECOGNITION_INTERIM, { text: msg.text || '' })
          : { ok: false, error: 'no-session' };
        sendResponse(result || { ok: true });
        return;
      }

      case MSG.PICKER_KEY: {
        const target = currentSession && currentSession.mode === 'sidepanel'
          ? currentSession
          : sidePanelPickerTarget;
        const result = msg.source === TARGETS.SIDEPANEL
          ? await sendToContentTarget(target, MSG.PICKER_KEY, { key: msg.key, pickerId: msg.pickerId })
          : { ok: false, error: 'invalid-source' };
        sendResponse(result || { ok: false });
        return;
      }

      case MSG.PICKER_CLOSED: {
        const tabId = sender && sender.tab && sender.tab.id;
        const sameTarget = !sidePanelPickerTarget || sidePanelPickerTarget.tabId === tabId;
        const samePicker = typeof msg.pickerId !== 'number' || sidePanelPickerId === null || msg.pickerId === sidePanelPickerId;
        if (sameTarget && samePicker) {
          sidePanelPickerTarget = null;
          sidePanelPickerId = null;
          try {
            await chrome.runtime.sendMessage({
              target: TARGETS.SIDEPANEL,
              action: MSG.PICKER_CLOSED,
              pickerId: msg.pickerId,
            });
          } catch (_) {}
        }
        sendResponse({ ok: true });
        return;
      }

      case MSG.PAGE_TARGET_FOCUSED: {
        const tabId = sender && sender.tab && sender.tab.id;
        const windowId = sender && sender.tab && sender.tab.windowId;
        const frameId = typeof sender.frameId === 'number' ? sender.frameId : 0;
        const focusedAt = typeof msg.focusedAt === 'number' ? msg.focusedAt : Date.now();
        const pageTarget = typeof tabId === 'number'
          ? await setPageTargetState({ tabId, frameId, windowId, focusedAt })
          : null;
        try {
          await chrome.runtime.sendMessage({
            target: TARGETS.SIDEPANEL,
            action: MSG.PAGE_TARGET_FOCUSED,
            pageTarget,
            focusedAt,
            tabId,
            frameId,
            windowId,
          });
        } catch (_) {}
        sendResponse({ ok: true });
        return;
      }

      case MSG.GET_PAGE_TARGET_STATE: {
        const pageTarget = await getCurrentPageTargetState();
        sendResponse({ ok: true, pageTarget });
        return;
      }

      case MSG.RECOGNITION_ERROR: {
        if (isCurrentSidePanelSession(msg.sessionId)) {
          await sendToSessionContent(MSG.RECOGNITION_ERROR);
        }
        sendResponse({ ok: true });
        return;
      }

      case MSG.RECOGNITION_ENDED: {
        if (msg.source === TARGETS.SIDEPANEL || msg.sessionId) {
          if (isCurrentSidePanelSession(msg.sessionId)) {
            await sendToSessionContent(MSG.RECOGNITION_ENDED);
            currentSession = null;
            pendingSidePanelStart = null;
          }
          sendResponse({ ok: true });
          return;
        }

        const tabId = sender && sender.tab && sender.tab.id;
        if (currentSession && currentSession.tabId === tabId) {
          currentSession = null;
        }
        sendResponse({ ok: true });
        return;
      }

      case MSG.SET_RECENT_RESULT: {
        const result = await setRecentResult(msg.text);
        await notifyRecentResultUpdated(result);
        sendResponse({ ok: true, result });
        return;
      }

      case MSG.GET_RECENT_RESULT: {
        const result = await getRecentResult();
        sendResponse({ ok: true, result });
        return;
      }

      case MSG.OPEN_MIC_PERMISSION_PAGE: {
        try {
          await chrome.tabs.create({
            url: chrome.runtime.getURL(MIC_PERMISSION_PAGE_PATH),
            active: true,
          });
          sendResponse({ ok: true });
        } catch (_) {
          sendResponse({ ok: false, error: 'open-failed' });
        }
        return;
      }

      case MSG.MICROPHONE_PERMISSION_GRANTED: {
        try {
          await chrome.runtime.sendMessage({
            target: TARGETS.SIDEPANEL,
            action: MSG.MICROPHONE_PERMISSION_GRANTED,
          });
        } catch (_) {}
        sendResponse({ ok: true });
        return;
      }

      default:
        sendResponse({ ok: false, error: 'unknown-action' });
    }
  })();

  return true;
});

async function runToggleCommand(tab, opening) {
  const originTabId = tab && typeof tab.id === 'number' ? tab.id : undefined;

  // A session that had already ended leaves currentSession set, and treating
  // that as a stop turned the press into a silent no-op: the user pressed to
  // start and had to press again. Fall through to starting instead.
  if (currentSession && (await stopRecognitionFlow())) return;

  const tabFrame = await getActiveTabFrame(originTabId);
  const result = (await getSidePanelModeEnabled())
    ? await startSidePanelRecognitionFlow(originTabId, { panelOpened: await opening })
    : await startContentRecognitionFlow(originTabId);

  await reportCommandResult(tabFrame && tabFrame.tabId, result);
}

// Deliberately not an async listener. In Side Panel Mode the panel is where
// recognition runs, so the shortcut has to open it, and sidePanel.open() is
// only allowed while the triggering gesture is live. Awaiting anything first
// ends the gesture and the call is rejected, which is why opening happens on
// the first line and the rest of the work is handed to an async function.
chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-recognition') return;
  runToggleCommand(tab, openSidePanelNow(tab));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentSession && currentSession.tabId === tabId) {
    stopRecognitionFlow();
  }
  if (pageTargetMemory && pageTargetMemory.tabId === tabId) {
    setPageTargetState(null).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  applyRuntimeMode();
});

chrome.runtime.onStartup.addListener(() => {
  applyRuntimeMode();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes[globalThis.VI_SETTINGS_KEY]) {
    applyRuntimeMode();
  }
});

applyRuntimeMode();
