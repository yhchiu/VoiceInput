// Action constants used across service worker, offscreen document,
// content scripts, popup, options, and permission page.
// Loaded as a classic script in every context (importScripts in SW,
// content_scripts entry, <script src> in HTML pages).
// All names are exposed on globalThis with a VI_ prefix so they don't
// collide with any host-page globals when injected as a content script.
(function () {
  const MSG = Object.freeze({
    START_RECOGNITION:   'START_RECOGNITION',
    STOP_RECOGNITION:    'STOP_RECOGNITION',
    RECOGNITION_STARTED: 'RECOGNITION_STARTED',
    RECOGNITION_RESULTS: 'RECOGNITION_RESULTS',
    RECOGNITION_ERROR:   'RECOGNITION_ERROR',
    RECOGNITION_ENDED:   'RECOGNITION_ENDED',
    GET_STATUS:          'GET_STATUS',
    SET_RECENT_RESULT:   'SET_RECENT_RESULT',
    GET_RECENT_RESULT:   'GET_RECENT_RESULT',
  });

  const OFFSCREEN_MSG = Object.freeze({
    START:  'OFFSCREEN_START',
    STOP:   'OFFSCREEN_STOP',
    RESULT: 'OFFSCREEN_RESULT',
    ERROR:  'OFFSCREEN_ERROR',
    ENDED:  'OFFSCREEN_ENDED',
    READY:  'OFFSCREEN_READY',
  });

  const TARGETS = Object.freeze({
    BACKGROUND: 'background',
    OFFSCREEN:  'offscreen',
    CONTENT:    'content',
    POPUP:      'popup',
    OPTIONS:    'options',
  });

  globalThis.VI_MSG = MSG;
  globalThis.VI_OFFSCREEN_MSG = OFFSCREEN_MSG;
  globalThis.VI_TARGETS = TARGETS;
})();
