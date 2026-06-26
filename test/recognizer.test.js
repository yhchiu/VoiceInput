const assert = require('node:assert/strict');
const test = require('node:test');

const { loadClassicScript } = require('./helpers/load-classic-script');

function finalResult(...alternatives) {
  const result = alternatives.map((alt) => alt);
  result.isFinal = true;
  return result;
}

function interimResult(transcript) {
  const result = [{ transcript }];
  result.isFinal = false;
  return result;
}

test('viCreateRecognizer reports unsupported browsers', () => {
  const context = loadClassicScript('src/common/recognizer.js');

  const handle = context.viCreateRecognizer({});

  assert.equal(handle.ok, false);
  assert.equal(handle.reason, 'unsupported');
});

test('viCreateRecognizer reports insecure contexts before starting', () => {
  class FakeSpeechRecognition {}

  const context = loadClassicScript('src/common/recognizer.js', {
    SpeechRecognition: FakeSpeechRecognition,
    isSecureContext: false,
  });

  const handle = context.viCreateRecognizer({});

  assert.equal(handle.ok, false);
  assert.equal(handle.reason, 'insecure-context');
});

test('viCreateRecognizer configures SpeechRecognition and emits callbacks', () => {
  class FakeSpeechRecognition {
    constructor() {
      FakeSpeechRecognition.instances.push(this);
    }

    start() {
      this.started = true;
    }

    abort() {
      this.aborted = true;
    }
  }
  FakeSpeechRecognition.instances = [];

  let started = false;
  const interim = [];
  const results = [];
  const ended = [];

  const context = loadClassicScript('src/common/recognizer.js', {
    SpeechRecognition: FakeSpeechRecognition,
    isSecureContext: true,
  });

  const handle = context.viCreateRecognizer({
    lang: 'ja-JP',
    maxAlternatives: 99,
    continuous: false,
    interimResults: true,
    onStart: () => {
      started = true;
    },
    onInterim: (text) => {
      interim.push(text);
    },
    onResult: (alternatives) => {
      results.push(alternatives);
    },
    onEnd: (state) => {
      ended.push(state);
    },
  });
  const recognition = FakeSpeechRecognition.instances[0];

  assert.equal(handle.ok, true);
  assert.equal(recognition.started, true);
  assert.equal(recognition.lang, 'ja-JP');
  assert.equal(recognition.maxAlternatives, 10);
  assert.equal(recognition.continuous, false);
  assert.equal(recognition.interimResults, true);

  recognition.onstart();
  assert.equal(started, true);

  recognition.onresult({
    resultIndex: 0,
    results: [interimResult('draft text')],
  });
  assert.deepEqual(interim, ['draft text']);

  recognition.onresult({
    resultIndex: 0,
    results: [
      finalResult(
        { transcript: 'first', confidence: 0.75 },
        { transcript: 'second' }
      ),
    ],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].length, 2);
  assert.equal(results[0][0].transcript, 'first');
  assert.equal(results[0][0].confidence, 0.75);
  assert.equal(results[0][1].transcript, 'second');
  assert.equal(results[0][1].confidence, 0);

  recognition.onresult({
    resultIndex: 0,
    results: [finalResult({ transcript: 'ignored', confidence: 1 })],
  });
  assert.equal(results.length, 1);

  recognition.onend();
  assert.equal(ended.length, 1);
  assert.equal(ended[0].aborted, false);
  assert.equal(ended[0].resultSent, true);
});

test('viCreateRecognizer resolves auto language before configuring SpeechRecognition', () => {
  class FakeSpeechRecognition {
    constructor() {
      FakeSpeechRecognition.instances.push(this);
    }

    start() {
      this.started = true;
    }
  }
  FakeSpeechRecognition.instances = [];

  const context = loadClassicScript('src/common/settings.js', {
    SpeechRecognition: FakeSpeechRecognition,
    isSecureContext: true,
    navigator: { language: 'zh-TW' },
  });
  loadClassicScript('src/common/recognizer.js', context);

  const handle = context.viCreateRecognizer({
    lang: context.VI_LANG_AUTO,
  });
  const recognition = FakeSpeechRecognition.instances[0];

  assert.equal(handle.ok, true);
  assert.equal(recognition.started, true);
  assert.equal(recognition.lang, 'zh-TW');
});

test('viCreateRecognizer handles start failures', () => {
  class ThrowingSpeechRecognition {
    start() {
      throw new Error('boom');
    }
  }

  const errors = [];
  const context = loadClassicScript('src/common/recognizer.js', {
    SpeechRecognition: ThrowingSpeechRecognition,
    isSecureContext: true,
  });

  const handle = context.viCreateRecognizer({
    onError: (error, message) => {
      errors.push({ error, message });
    },
  });

  assert.equal(handle.ok, false);
  assert.equal(handle.reason, 'start-failed');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, 'start-failed');
  assert.match(errors[0].message, /boom/);
});

test('abort cancels recognition events and reports aborted end state', () => {
  class FakeSpeechRecognition {
    constructor() {
      FakeSpeechRecognition.instance = this;
    }

    start() {}

    abort() {
      this.aborted = true;
    }
  }

  const ended = [];
  const context = loadClassicScript('src/common/recognizer.js', {
    SpeechRecognition: FakeSpeechRecognition,
    isSecureContext: true,
  });

  const handle = context.viCreateRecognizer({
    onEnd: (state) => {
      ended.push(state);
    },
  });
  const recognition = FakeSpeechRecognition.instance;

  handle.abort();

  assert.equal(recognition.aborted, true);
  assert.equal(recognition.onresult, null);
  assert.equal(recognition.onerror, null);

  recognition.onend();
  assert.equal(ended.length, 1);
  assert.equal(ended[0].aborted, true);
  assert.equal(ended[0].resultSent, false);
});
