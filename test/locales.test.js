const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { repoRoot } = require('./helpers/load-classic-script');

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
const localesDir = path.join(repoRoot, '_locales');
const locales = fs.readdirSync(localesDir);

function messagesFor(locale) {
  return JSON.parse(fs.readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8'));
}

test('every locale defines the same message keys as the default locale', () => {
  const defaultLocale = manifest.default_locale;
  assert.ok(locales.includes(defaultLocale));

  const expected = Object.keys(messagesFor(defaultLocale)).sort();

  for (const locale of locales) {
    if (locale === defaultLocale) continue;
    const actual = Object.keys(messagesFor(locale)).sort();
    const missing = expected.filter((key) => !actual.includes(key));
    const extra = actual.filter((key) => !expected.includes(key));
    assert.deepEqual(missing, [], `${locale} is missing: ${missing.join(', ')}`);
    assert.deepEqual(extra, [], `${locale} has keys the default locale lacks: ${extra.join(', ')}`);
  }
});

test('every locale gives each message a non-empty string', () => {
  for (const locale of locales) {
    for (const [key, entry] of Object.entries(messagesFor(locale))) {
      assert.equal(typeof entry.message, 'string', `${locale}/${key} has no message string`);
      assert.ok(entry.message.trim().length > 0, `${locale}/${key} is empty`);
    }
  }
});

test('message keys used in code exist in the default locale', () => {
  const defined = new Set(Object.keys(messagesFor(manifest.default_locale)));
  const sources = [
    'src/popup/popup.js',
    'src/sidepanel/sidepanel.js',
    'src/content/content.js',
  ];

  for (const source of sources) {
    const text = fs.readFileSync(path.join(repoRoot, source), 'utf8');
    // Only literal t('key') calls; keys built at runtime are checked elsewhere.
    for (const match of text.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)) {
      assert.ok(defined.has(match[1]), `${source} uses t('${match[1]}'), which no locale defines`);
    }
  }
});
