const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const scriptSource = path.join(projectRoot, 'git-log-json.sh');

function createFixture(t) {
  const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceinput-git-log-json-'));
  const fixtureRoot = path.join(fixtureParent, 'repo');
  fs.mkdirSync(fixtureRoot);
  t.after(() => fs.rmSync(fixtureParent, { recursive: true, force: true }));

  fs.copyFileSync(scriptSource, path.join(fixtureRoot, 'git-log-json.sh'));
  fs.writeFileSync(
    path.join(fixtureRoot, 'manifest.json'),
    [
      '{',
      '  "manifest_version": 3,',
      '  "version": "1.2.2",',
      '  "permissions": ["storage"]',
      '}',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(fixtureRoot, 'CHANGELOG.json'), '[]\n');

  execFileSync('git', ['init', '--quiet'], { cwd: fixtureRoot });
  execFileSync('git', ['add', '.'], { cwd: fixtureRoot });
  execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=VoiceInput Tests',
      '-c',
      'user.email=tests@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'feat: add fixture',
    ],
    { cwd: fixtureRoot },
  );

  return { fixtureParent, fixtureRoot };
}

function runScript(fixtureParent, args) {
  return spawnSync('sh', ['repo/git-log-json.sh', ...args], {
    cwd: fixtureParent,
    encoding: 'utf8',
  });
}

test('version argument updates the manifest and regenerates the changelog from any directory', (t) => {
  const { fixtureParent, fixtureRoot } = createFixture(t);

  const result = runScript(fixtureParent, ['1.2.3']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifest\.json: version set to 1\.2\.3/);

  const manifestText = fs.readFileSync(path.join(fixtureRoot, 'manifest.json'), 'utf8');
  assert.equal(JSON.parse(manifestText).version, '1.2.3');
  assert.match(manifestText, /"permissions": \["storage"\]/);

  const changelog = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'CHANGELOG.json'), 'utf8'));
  assert.equal(changelog[0].version, '1.2.3');
  assert.equal(changelog[0].items[0].subject, 'feat: add fixture');
});

test('invalid version is rejected without changing generated files', (t) => {
  const { fixtureParent, fixtureRoot } = createFixture(t);
  const manifestFile = path.join(fixtureRoot, 'manifest.json');
  const changelogFile = path.join(fixtureRoot, 'CHANGELOG.json');
  const manifestBefore = fs.readFileSync(manifestFile, 'utf8');
  const changelogBefore = fs.readFileSync(changelogFile, 'utf8');

  const result = runScript(fixtureParent, ['1']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /invalid version '1'/);
  assert.equal(fs.readFileSync(manifestFile, 'utf8'), manifestBefore);
  assert.equal(fs.readFileSync(changelogFile, 'utf8'), changelogBefore);
});
