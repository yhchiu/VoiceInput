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
  return localizedMessage('errUnknown');
}

async function clearStartFailure(tabId) {
  if (typeof tabId !== 'number') return;
  await ignoreFailure(chrome.action.setBadgeText({ text: '', tabId }));
  await ignoreFailure(chrome.action.setTitle({ title: localizedMessage('extName'), tabId }));
}

async function reportCommandResult(tabId, result) {
  if (typeof tabId !== 'number') return;
  if (result && result.ok) {
    await clearStartFailure(tabId);
    return;
  }
  await ignoreFailure(chrome.action.setBadgeText({ text: FAILURE_BADGE_TEXT, tabId }));
  await ignoreFailure(chrome.action.setBadgeBackgroundColor({ color: FAILURE_BADGE_COLOR, tabId }));
  await ignoreFailure(chrome.action.setTitle({
    title: startFailureMessage(result && result.error),
    tabId,
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

async function openSidePanel(tabFrame) {
  if (!chrome.sidePanel || typeof chrome.sidePanel.open !== 'function' || typeof tabFrame.windowId !== 'number') {
    return false;
  }
  try {
    await chrome.sidePanel.open({ windowId: tabFrame.windowId });
    return true;
  } catch (error) {
    console.warn('[VoiceInput] Failed to open side panel:', error);
    return false;
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

  if (options.openPanel) {
    await openSidePanel(tabFrame);
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

  if (options.openPanel) {
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

async function stopRecognitionFlow() {
  const sess = currentSession;
  currentSession = null;
  pendingSidePanelStart = null;
  if (!sess) return;

  if (sess.mode === 'sidepanel') {
    try {
      await chrome.runtime.sendMessage({
        target: TARGETS.SIDEPANEL,
        action: MSG.STOP_RECOGNITION,
        sessionId: sess.sessionId,
      });
    } catch (_) {}
    try {
      await chrome.tabs.sendMessage(
        sess.tabId,
        { target: TARGETS.CONTENT, action: MSG.RECOGNITION_ENDED },
        { frameId: sess.frameId ?? 0 }
      );
    } catch (_) {}
    return;
  }

  try {
    await chrome.tabs.sendMessage(
      sess.tabId,
      {
        target: TARGETS.CONTENT,
        action: MSG.STOP_RECOGNITION,
      },
      { frameId: sess.frameId ?? 0 }
    );
  } catch (_) {}
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

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-recognition') return;
  if (currentSession) {
    await stopRecognitionFlow();
    return;
  }

  const tabFrame = await getActiveTabFrame();
  const result = (await getSidePanelModeEnabled())
    ? await startSidePanelRecognitionFlow(undefined, { openPanel: true })
    : await startContentRecognitionFlow();

  await reportCommandResult(tabFrame && tabFrame.tabId, result);
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
