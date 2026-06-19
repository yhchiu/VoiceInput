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
    RECOGNITION_INTERIM: 'RECOGNITION_INTERIM',
    GET_STATUS:          'GET_STATUS',
    INSERT_TEXT:         'INSERT_TEXT',
    PREPARE_RECOGNITION_TARGET: 'PREPARE_RECOGNITION_TARGET',
    PAGE_TARGET_FOCUSED: 'PAGE_TARGET_FOCUSED',
    GET_PAGE_TARGET_STATE: 'GET_PAGE_TARGET_STATE',
    PICKER_KEY:          'PICKER_KEY',
    PICKER_CLOSED:       'PICKER_CLOSED',
    SIDE_PANEL_READY:    'SIDE_PANEL_READY',
    SET_RECENT_RESULT:   'SET_RECENT_RESULT',
    GET_RECENT_RESULT:   'GET_RECENT_RESULT',
    RECENT_RESULT_UPDATED: 'RECENT_RESULT_UPDATED',
    OPEN_MIC_PERMISSION_PAGE: 'OPEN_MIC_PERMISSION_PAGE',
    MICROPHONE_PERMISSION_GRANTED: 'MICROPHONE_PERMISSION_GRANTED',
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
    SIDEPANEL:  'sidepanel',
    OPTIONS:    'options',
    PERMISSION: 'permission',
  });

  globalThis.VI_MSG = MSG;
  globalThis.VI_OFFSCREEN_MSG = OFFSCREEN_MSG;
  globalThis.VI_TARGETS = TARGETS;
})();
