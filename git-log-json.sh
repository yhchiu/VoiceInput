#!/bin/sh
set -eu

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/voiceinput-changelog.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM

git_log_file="$tmp_dir/git-log.txt"
committed_changelog_file="$tmp_dir/committed-changelog.json"

git log --no-merges --format='%H%x1f%s%x1f%ad' --date=short > "$git_log_file"
if ! git show HEAD:CHANGELOG.json > "$committed_changelog_file" 2>/dev/null; then
  printf '[]\n' > "$committed_changelog_file"
fi

node - "$git_log_file" "$committed_changelog_file" <<'NODE'
const fs = require('fs');

const CHANGELOG_FILE = 'CHANGELOG.json';
const MANIFEST_FILE = 'manifest.json';
const gitLogFile = process.argv[2];
const committedChangelogFile = process.argv[3];

function readJsonFile(fileName, fallback) {
  try {
    return JSON.parse(fs.readFileSync(fileName, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function normalizeReleases(value) {
  return Array.isArray(value)
    ? value.filter((release) => release && typeof release === 'object' && release.version)
    : [];
}

function mergePriorReleases(version, currentReleases, committedReleases) {
  const byVersion = new Map();
  [...committedReleases, ...currentReleases].forEach((release) => {
    if (!release || release.version === version) return;
    byVersion.set(release.version, release);
  });
  return [...byVersion.values()];
}

function commitType(subject) {
  const match = String(subject || '').match(/^([a-z][a-z0-9-]*)(\([^)]+\))?!?:/i);
  return match ? match[1].toLowerCase() : 'other';
}

function isReleaseNoise(subject) {
  return /^chore: update version to /.test(subject) || subject === 'chore: initial commit';
}

function readGitItems(fileName, releasedCommits) {
  const output = fs.readFileSync(fileName, 'utf8').trim();
  if (!output) return [];

  return output
    .split('\n')
    .map((line) => {
      const [commit, subject, date] = line.split('\x1f');
      return { commit, subject, date };
    })
    .filter((item) => item.commit && item.subject)
    .filter((item) => !isReleaseNoise(item.subject))
    .filter((item) => !releasedCommits.has(item.commit))
    .map((item) => ({
      commit: item.commit,
      type: commitType(item.subject),
      subject: item.subject,
      date: item.date,
    }));
}

function releaseDate(items, currentRelease) {
  if (items.length && items[0].date) return items[0].date;
  if (currentRelease && currentRelease.date) return currentRelease.date;
  return new Date().toISOString().slice(0, 10);
}

const manifest = readJsonFile(MANIFEST_FILE, {});
const version = manifest.version;
if (!version) {
  throw new Error(`Cannot read version from ${MANIFEST_FILE}`);
}

const currentReleases = normalizeReleases(readJsonFile(CHANGELOG_FILE, []));
const committedReleases = normalizeReleases(readJsonFile(committedChangelogFile, []));
const currentRelease = currentReleases.find((release) => release.version === version);
const priorReleases = mergePriorReleases(version, currentReleases, committedReleases);
const releasedCommits = new Set();

priorReleases.forEach((release) => {
  (Array.isArray(release.items) ? release.items : []).forEach((item) => {
    if (item && item.commit) releasedCommits.add(item.commit);
  });
});

const releaseItemsWithDates = readGitItems(gitLogFile, releasedCommits);
const items = releaseItemsWithDates.map(({ date, ...item }) => item);
const releases = [
  {
    version,
    date: releaseDate(releaseItemsWithDates, currentRelease),
    items,
  },
  ...priorReleases,
];

fs.writeFileSync(CHANGELOG_FILE, `${JSON.stringify(releases, null, 2)}\n`);
NODE
