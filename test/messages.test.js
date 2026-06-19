const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

test('messages exposes frozen shared constants', () => {
  const context = loadClassicScript('src/common/messages.js');

  assert.equal(context.VI_MSG.START_RECOGNITION, 'START_RECOGNITION');
  assert.equal(context.VI_MSG.INSERT_TEXT, 'INSERT_TEXT');
  assert.equal(context.VI_MSG.RECOGNITION_RESULTS, 'RECOGNITION_RESULTS');
  assert.equal(context.VI_OFFSCREEN_MSG.START, 'OFFSCREEN_START');
  assert.equal(context.VI_TARGETS.BACKGROUND, 'background');
  assert.equal(context.VI_TARGETS.CONTENT, 'content');

  assert.equal(Object.isFrozen(context.VI_MSG), true);
  assert.equal(Object.isFrozen(context.VI_OFFSCREEN_MSG), true);
  assert.equal(Object.isFrozen(context.VI_TARGETS), true);
});
