// Service worker — thin router.
// All recognition runs inside the content script (per-host mic permission).
// SW responsibilities: receive hotkey, ask the active tab's content script
// to start/stop, and report status to popup.

importScripts('/src/common/messages.js');

const MSG = globalThis.VI_MSG;
const TARGETS = globalThis.VI_TARGETS;

// Tracks the tab currently believed to be running a session. The content
// script tells us via RECOGNITION_ENDED when it actually stops.
let currentSession = null; // { tabId, frameId } | null

async function getActiveTabFrame() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && typeof tab.id === 'number' && tab.id >= 0) {
      return { tabId: tab.id, frameId: 0 };
    }
  } catch (_) {}
  return null;
}

async function startRecognitionFlow(originTabId) {
  // Abort any existing session in another tab before opening a new one.
  if (currentSession && (typeof originTabId !== 'number' || currentSession.tabId !== originTabId)) {
    await stopRecognitionFlow();
  }

  let tabFrame;
  if (typeof originTabId === 'number' && originTabId >= 0) {
    tabFrame = { tabId: originTabId, frameId: 0 };
  } else {
    tabFrame = await getActiveTabFrame();
  }
  if (!tabFrame) return;

  const sessionId = crypto.randomUUID();
  currentSession = { tabId: tabFrame.tabId, frameId: tabFrame.frameId };

  try {
    await chrome.tabs.sendMessage(
      tabFrame.tabId,
      {
        target: TARGETS.CONTENT,
        action: MSG.START_RECOGNITION,
        sessionId,
      },
      { frameId: tabFrame.frameId }
    );
  } catch (_) {
    // Content script not loaded (chrome:// page or restricted) — silently abort.
    currentSession = null;
  }
}

async function stopRecognitionFlow() {
  const sess = currentSession;
  currentSession = null;
  if (!sess) return;
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== TARGETS.BACKGROUND) return false;

  (async () => {
    switch (msg.action) {
      case MSG.START_RECOGNITION: {
        const tabId = sender && sender.tab && sender.tab.id;
        await startRecognitionFlow(typeof tabId === 'number' ? tabId : undefined);
        sendResponse({ ok: true });
        return;
      }

      case MSG.STOP_RECOGNITION: {
        await stopRecognitionFlow();
        sendResponse({ ok: true });
        return;
      }

      case MSG.GET_STATUS: {
        sendResponse({ ok: true, listening: !!currentSession });
        return;
      }

      case MSG.RECOGNITION_ENDED: {
        // Content script reports it has finished (success, error, or abort).
        const tabId = sender && sender.tab && sender.tab.id;
        if (currentSession && currentSession.tabId === tabId) {
          currentSession = null;
        }
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
  } else {
    await startRecognitionFlow();
  }
});

// If the tab tracked in currentSession closes, clear our tracker.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentSession && currentSession.tabId === tabId) {
    currentSession = null;
  }
});
