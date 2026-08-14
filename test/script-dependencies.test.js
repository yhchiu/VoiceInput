const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('./helpers/load-classic-script');

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));

// Every global a script reads but does not define itself.
function externalGlobals(scriptPath) {
  const source = fs.readFileSync(path.join(repoRoot, scriptPath), 'utf8');
  const used = new Set((source.match(/globalThis\.vi[A-Za-z0-9]+/g) || []));
  const defined = new Set((source.match(/globalThis\.vi[A-Za-z0-9]+(?=\s*=[^=])/g) || []));
  return [...used].filter((name) => !defined.has(name)).sort();
}

function definedGlobals(scriptPath) {
  const source = fs.readFileSync(path.join(repoRoot, scriptPath), 'utf8');
  return new Set((source.match(/globalThis\.vi[A-Za-z0-9]+(?=\s*=[^=])/g) || []));
}

// The scripts each surface loads, in load order.
function loadedScripts() {
  const surfaces = {
    'content script': manifest.content_scripts[0].js,
  };

  const pages = ['src/sidepanel/sidepanel.html', 'src/popup/popup.html', 'src/options/options.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(repoRoot, page), 'utf8');
    const dir = path.posix.dirname(page);
    surfaces[page] = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]
      .map((match) => path.posix.normalize(path.posix.join(dir, match[1])));
  }

  return surfaces;
}

test('every surface loads the scripts its own scripts depend on', () => {
  for (const [surface, scripts] of Object.entries(loadedScripts())) {
    const available = new Set();
    for (const script of scripts) {
      for (const missing of externalGlobals(script)) {
        assert.ok(
          available.has(missing),
          `${surface}: ${script} needs ${missing}, which no earlier script defines`
        );
      }
      for (const name of definedGlobals(script)) available.add(name);
    }
  }
});

test('picker.js dependencies are loaded wherever the picker is used', () => {
  const needed = externalGlobals('src/content/picker.js');

  // Guards against the dependency being dropped from picker.js by accident,
  // which would make this test pass for the wrong reason.
  assert.ok(needed.length > 0);
  assert.ok(needed.every((name) => definedGlobals('src/content/inserter.js').has(name)));

  for (const [surface, scripts] of Object.entries(loadedScripts())) {
    if (!scripts.includes('src/content/picker.js')) continue;
    assert.ok(
      scripts.indexOf('src/content/inserter.js') !== -1
        && scripts.indexOf('src/content/inserter.js') < scripts.indexOf('src/content/picker.js'),
      `${surface} loads picker.js without inserter.js before it`
    );
  }
});
