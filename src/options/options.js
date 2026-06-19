(function () {
  const t = globalThis.vt;
  const LIMITS = {
    replacementFrom: globalThis.VI_REPLACEMENT_FROM_MAX_CHARS,
    replacementTo: globalThis.VI_REPLACEMENT_TO_MAX_CHARS,
    phraseTitle: globalThis.VI_COMMON_PHRASE_TITLE_MAX_CHARS,
    phraseText: globalThis.VI_COMMON_PHRASE_TEXT_MAX_CHARS,
    phraseBytes: globalThis.VI_COMMON_PHRASES_MAX_BYTES,
  };
  const TRASH_ICON_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';
  const CHANGELOG_FILE = 'CHANGELOG.json';
  const CHANGELOG_REPO_URL = 'https://github.com/yhchiu/VoiceInput';
  const RELEASE_TYPE_LABELS = {
    feat: 'Added',
    fix: 'Fixed',
    refactor: 'Changed',
    perf: 'Changed',
    style: 'Changed',
    docs: 'Documentation',
    test: 'Maintenance',
    build: 'Maintenance',
    ci: 'Maintenance',
    chore: 'Maintenance',
    revert: 'Reverted',
  };

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  function buildLangOptions(currentLang) {
    globalThis.viBuildLangOptions(document.getElementById('lang'), currentLang, t('optLangAuto'));
  }

  function attachFieldCounter(wrap, input, maxLength) {
    input.maxLength = maxLength;
    const counter = document.createElement('span');
    counter.className = 'field-counter';
    const update = () => {
      const len = input.value.length;
      counter.textContent = `${len}/${maxLength}`;
      counter.classList.toggle('is-warning', len >= Math.floor(maxLength * 0.9));
    };
    input.addEventListener('input', update);
    update();
    wrap.appendChild(counter);
  }

  function createReplacementInput(labelKey, className, value, maxLength, placeholderKey) {
    const wrap = document.createElement('div');
    wrap.className = 'replacement-input';
    const label = document.createElement('label');
    label.textContent = t(labelKey);
    wrap.appendChild(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = className;
    input.value = value || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', t(labelKey));
    if (placeholderKey) input.placeholder = t(placeholderKey);
    wrap.appendChild(input);
    attachFieldCounter(wrap, input, maxLength);
    return { wrap, input };
  }

  function setActionAriaLabels(row, context, removeKey) {
    const suffix = context ? `: ${context}` : '';
    const up = row.querySelector('.row-move-up');
    const down = row.querySelector('.row-move-down');
    const remove = row.querySelector('.row-remove');
    if (up) up.setAttribute('aria-label', t('optMoveUp') + suffix);
    if (down) down.setAttribute('aria-label', t('optMoveDown') + suffix);
    if (remove) remove.setAttribute('aria-label', t(removeKey) + suffix);
  }

  function setReplacementAriaLabels(row) {
    const from = row.querySelector('.replacement-from').value;
    const to = row.querySelector('.replacement-to').value;
    setActionAriaLabels(row, from ? `${from} → ${to}` : '', 'optRemoveReplacement');
  }

  function setCommonPhraseAriaLabels(row) {
    const context = row.querySelector('.common-phrase-title').value
      || row.querySelector('.common-phrase-text').value;
    setActionAriaLabels(row, context, 'optRemoveCommonPhrase');
  }

  function setRowWarning(row, warning) {
    let msg = row.querySelector('.row-warning');
    if (warning) {
      if (!msg) {
        msg = document.createElement('p');
        msg.className = 'row-warning';
        row.appendChild(msg);
      }
      msg.textContent = warning;
      msg.hidden = false;
      row.classList.add('row-invalid');
    } else if (msg) {
      msg.textContent = '';
      msg.hidden = true;
      row.classList.remove('row-invalid');
    } else {
      row.classList.remove('row-invalid');
    }
  }

  function validateReplacements() {
    const rows = Array.from(document.querySelectorAll('.replacement-row'));
    const seen = new Set();
    rows.forEach((row) => {
      const fromValue = row.querySelector('.replacement-from').value;
      const toValue = row.querySelector('.replacement-to').value;
      let warning = '';
      if (fromValue.length === 0) {
        warning = t('optReplaceEmptyFrom');
      } else if (seen.has(fromValue)) {
        warning = t('optReplaceDuplicate');
      } else if (fromValue === toValue) {
        warning = t('optReplaceNoop');
      }
      if (fromValue.length > 0) seen.add(fromValue);
      setRowWarning(row, warning);
    });
  }

  function filterRows(selector, query, getText, noMatchId) {
    const q = (query || '').trim().toLowerCase();
    const rows = Array.from(document.querySelectorAll(selector));
    let visible = 0;
    rows.forEach((row) => {
      const match = q === '' || getText(row).toLowerCase().includes(q);
      row.hidden = !match;
      if (match) visible += 1;
    });
    const noMatch = document.getElementById(noMatchId);
    if (noMatch) noMatch.hidden = !(q !== '' && rows.length > 0 && visible === 0);
  }

  function applyReplacementFilter() {
    const input = document.getElementById('replacements-filter');
    filterRows(
      '.replacement-row',
      input ? input.value : '',
      (row) => `${row.querySelector('.replacement-from').value} ${row.querySelector('.replacement-to').value}`,
      'replacements-no-match',
    );
  }

  function applyCommonPhraseFilter() {
    const input = document.getElementById('common-phrases-filter');
    filterRows(
      '.common-phrase-row',
      input ? input.value : '',
      (row) => `${row.querySelector('.common-phrase-title').value} ${row.querySelector('.common-phrase-text').value}`,
      'common-phrases-no-match',
    );
  }

  function updateReplacementEmptyState() {
    const empty = document.getElementById('replacements-empty');
    empty.hidden = document.querySelectorAll('.replacement-row').length > 0;
    updateMoveButtonStates('.replacement-row');
    validateReplacements();
    applyReplacementFilter();
  }

  let undoTimer = null;
  let pendingUndo = null;

  function hideUndoToast() {
    const toast = document.getElementById('undo-toast');
    if (toast) toast.hidden = true;
    pendingUndo = null;
  }

  function showUndoToast(restore) {
    pendingUndo = restore;
    const toast = document.getElementById('undo-toast');
    if (!toast) return;
    toast.hidden = false;
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndoToast, 6000);
  }

  function runPendingUndo() {
    if (!pendingUndo) return;
    const restore = pendingUndo;
    if (undoTimer) clearTimeout(undoTimer);
    hideUndoToast();
    restore();
  }

  function insertRowAt(list, row, selector, atIndex) {
    if (atIndex == null) {
      list.appendChild(row);
      return;
    }
    const rows = Array.from(document.querySelectorAll(selector));
    const ref = rows[atIndex] || null;
    if (ref) list.insertBefore(row, ref);
    else list.appendChild(row);
  }

  function moveRow(row, selector, delta) {
    const list = row.parentNode;
    if (!list) return false;
    const rows = Array.from(document.querySelectorAll(selector));
    const index = rows.indexOf(row);
    const target = index + delta;
    if (target < 0 || target >= rows.length) return false;
    if (delta < 0) {
      list.insertBefore(row, rows[target]);
    } else {
      const ref = rows[target + 1] || null;
      if (ref) list.insertBefore(row, ref);
      else list.appendChild(row);
    }
    return true;
  }

  function isLastRow(row, selector) {
    const rows = Array.from(document.querySelectorAll(selector));
    return rows.length > 0 && rows[rows.length - 1] === row;
  }

  function updateMoveButtonStates(selector) {
    const rows = Array.from(document.querySelectorAll(selector));
    rows.forEach((row, i) => {
      const up = row.querySelector('.row-move-up');
      const down = row.querySelector('.row-move-down');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === rows.length - 1;
    });
  }

  function createRowActions(row, selector, removeLabelKey, onRemove, afterOrderChange) {
    const actions = document.createElement('div');
    actions.className = 'row-actions';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'ghost icon-btn row-move-up';
    up.textContent = '↑';
    up.setAttribute('aria-label', t('optMoveUp'));
    up.addEventListener('click', () => { if (moveRow(row, selector, -1)) afterOrderChange(); });

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'ghost icon-btn row-move-down';
    down.textContent = '↓';
    down.setAttribute('aria-label', t('optMoveDown'));
    down.addEventListener('click', () => { if (moveRow(row, selector, 1)) afterOrderChange(); });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost danger icon-btn row-remove';
    remove.innerHTML = TRASH_ICON_SVG;
    remove.setAttribute('aria-label', t(removeLabelKey));
    remove.addEventListener('click', onRemove);

    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(remove);
    return actions;
  }

  function readReplacementRows() {
    const rows = Array.from(document.querySelectorAll('.replacement-row'));
    return globalThis.viNormalizeReplacements(rows.map((row) => ({
      from: row.querySelector('.replacement-from').value,
      to: row.querySelector('.replacement-to').value,
    })));
  }

  let replacementSaveTimer = null;
  async function saveReplacementsNow() {
    if (replacementSaveTimer) {
      clearTimeout(replacementSaveTimer);
      replacementSaveTimer = null;
    }
    await save({ replacements: readReplacementRows() });
  }

  function scheduleReplacementSave() {
    if (replacementSaveTimer) clearTimeout(replacementSaveTimer);
    replacementSaveTimer = setTimeout(saveReplacementsNow, 450);
  }

  function removeReplacementRow(row) {
    const rows = Array.from(document.querySelectorAll('.replacement-row'));
    const index = rows.indexOf(row);
    const item = {
      from: row.querySelector('.replacement-from').value,
      to: row.querySelector('.replacement-to').value,
    };
    row.remove();
    updateReplacementEmptyState();
    saveReplacementsNow();
    showUndoToast(() => {
      appendReplacementRow(item, false, index);
      saveReplacementsNow();
    });
  }

  function appendReplacementRow(item = {}, focus = false, atIndex = null) {
    const list = document.getElementById('replacements');
    const row = document.createElement('div');
    row.className = 'replacement-row';

    const from = createReplacementInput('optReplaceFrom', 'replacement-from', item.from, LIMITS.replacementFrom, 'optReplaceFromPlaceholder');
    const to = createReplacementInput('optReplaceTo', 'replacement-to', item.to, LIMITS.replacementTo, 'optReplaceToPlaceholder');
    const arrow = document.createElement('span');
    arrow.className = 'row-arrow';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    const actions = createRowActions(
      row,
      '.replacement-row',
      'optRemoveReplacement',
      () => removeReplacementRow(row),
      () => { updateReplacementEmptyState(); saveReplacementsNow(); },
    );

    const onReplacementInput = () => {
      scheduleReplacementSave();
      validateReplacements();
      setReplacementAriaLabels(row);
    };
    const onReplacementKeydown = (e) => {
      if (e.key === 'Enter' && isLastRow(row, '.replacement-row')) {
        e.preventDefault();
        addReplacementRow();
      }
    };
    from.input.addEventListener('input', onReplacementInput);
    to.input.addEventListener('input', onReplacementInput);
    from.input.addEventListener('keydown', onReplacementKeydown);
    to.input.addEventListener('keydown', onReplacementKeydown);

    row.setAttribute('role', 'listitem');
    row.appendChild(from.wrap);
    row.appendChild(arrow);
    row.appendChild(to.wrap);
    row.appendChild(actions);
    insertRowAt(list, row, '.replacement-row', atIndex);
    setReplacementAriaLabels(row);
    updateReplacementEmptyState();
    if (focus) from.input.focus();
    return row;
  }

  function addReplacementRow() {
    const filter = document.getElementById('replacements-filter');
    if (filter) filter.value = '';
    appendReplacementRow({}, true);
  }

  function renderReplacements(replacements) {
    if (replacementSaveTimer) {
      clearTimeout(replacementSaveTimer);
      replacementSaveTimer = null;
    }
    const list = document.getElementById('replacements');
    list.innerHTML = '';
    hideUndoToast();
    globalThis.viNormalizeReplacements(replacements).forEach((item) => appendReplacementRow(item));
    updateReplacementEmptyState();
  }

  function createCommonPhraseControl(labelKey, className, value, multiline = false, maxLength, placeholderKey) {
    const wrap = document.createElement('div');
    wrap.className = 'common-phrase-input';
    const label = document.createElement('label');
    label.textContent = t(labelKey);
    wrap.appendChild(label);
    const input = document.createElement(multiline ? 'textarea' : 'input');
    if (!multiline) input.type = 'text';
    input.className = className;
    input.value = value || '';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', t(labelKey));
    if (placeholderKey) input.placeholder = t(placeholderKey);
    wrap.appendChild(input);
    attachFieldCounter(wrap, input, maxLength);
    return { wrap, input };
  }

  function updateCommonPhraseEmptyState() {
    const empty = document.getElementById('common-phrases-empty');
    empty.hidden = document.querySelectorAll('.common-phrase-row').length > 0;
    updateMoveButtonStates('.common-phrase-row');
    applyCommonPhraseFilter();
  }

  function updateCommonPhraseBudget() {
    const el = document.getElementById('common-phrases-budget');
    if (!el) return;
    let used = 0;
    document.querySelectorAll('.common-phrase-row').forEach((row) => {
      const title = row.querySelector('.common-phrase-title').value || '';
      const text = row.querySelector('.common-phrase-text').value || '';
      used += globalThis.viUtf8ByteLength(title) + globalThis.viUtf8ByteLength(text);
    });
    const max = LIMITS.phraseBytes;
    el.textContent = `${t('optPhraseBudget')} ${used} / ${max} bytes`;
    el.classList.toggle('is-warning', used >= Math.floor(max * 0.9) && used <= max);
    el.classList.toggle('is-over', used > max);
  }

  function readCommonPhraseRows() {
    const rows = Array.from(document.querySelectorAll('.common-phrase-row'));
    return globalThis.viNormalizeCommonPhrases(rows.map((row) => ({
      title: row.querySelector('.common-phrase-title').value,
      text: row.querySelector('.common-phrase-text').value,
    })));
  }

  let commonPhraseSaveTimer = null;
  async function saveCommonPhrasesNow() {
    if (commonPhraseSaveTimer) {
      clearTimeout(commonPhraseSaveTimer);
      commonPhraseSaveTimer = null;
    }
    await save({ commonPhrases: readCommonPhraseRows() });
  }

  function scheduleCommonPhraseSave() {
    if (commonPhraseSaveTimer) clearTimeout(commonPhraseSaveTimer);
    commonPhraseSaveTimer = setTimeout(saveCommonPhrasesNow, 450);
  }

  function removeCommonPhraseRow(row) {
    const rows = Array.from(document.querySelectorAll('.common-phrase-row'));
    const index = rows.indexOf(row);
    const item = {
      title: row.querySelector('.common-phrase-title').value,
      text: row.querySelector('.common-phrase-text').value,
    };
    row.remove();
    updateCommonPhraseEmptyState();
    updateCommonPhraseBudget();
    saveCommonPhrasesNow();
    showUndoToast(() => {
      appendCommonPhraseRow(item, false, index);
      saveCommonPhrasesNow();
    });
  }

  function appendCommonPhraseRow(item = {}, focus = false, atIndex = null) {
    const list = document.getElementById('common-phrases');
    const row = document.createElement('div');
    row.className = 'common-phrase-row';

    const title = createCommonPhraseControl('optCommonPhraseTitle', 'common-phrase-title', item.title, false, LIMITS.phraseTitle, 'optCommonPhraseTitlePlaceholder');
    const text = createCommonPhraseControl('optCommonPhraseText', 'common-phrase-text', item.text, true, LIMITS.phraseText, 'optCommonPhraseTextPlaceholder');
    const actions = createRowActions(
      row,
      '.common-phrase-row',
      'optRemoveCommonPhrase',
      () => removeCommonPhraseRow(row),
      () => { updateCommonPhraseEmptyState(); saveCommonPhrasesNow(); },
    );

    const onPhraseInput = () => {
      scheduleCommonPhraseSave();
      updateCommonPhraseBudget();
      setCommonPhraseAriaLabels(row);
    };
    title.input.addEventListener('input', onPhraseInput);
    text.input.addEventListener('input', onPhraseInput);
    title.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && isLastRow(row, '.common-phrase-row')) {
        e.preventDefault();
        addCommonPhraseRow();
      }
    });

    row.setAttribute('role', 'listitem');
    row.appendChild(title.wrap);
    row.appendChild(text.wrap);
    row.appendChild(actions);
    insertRowAt(list, row, '.common-phrase-row', atIndex);
    setCommonPhraseAriaLabels(row);
    updateCommonPhraseEmptyState();
    updateCommonPhraseBudget();
    if (focus) title.input.focus();
    return row;
  }

  function addCommonPhraseRow() {
    const filter = document.getElementById('common-phrases-filter');
    if (filter) filter.value = '';
    appendCommonPhraseRow({}, true);
  }

  function renderCommonPhrases(commonPhrases) {
    if (commonPhraseSaveTimer) {
      clearTimeout(commonPhraseSaveTimer);
      commonPhraseSaveTimer = null;
    }
    const list = document.getElementById('common-phrases');
    list.innerHTML = '';
    hideUndoToast();
    globalThis.viNormalizeCommonPhrases(commonPhrases).forEach((item) => appendCommonPhraseRow(item));
    updateCommonPhraseEmptyState();
    updateCommonPhraseBudget();
  }

  function loadAboutInfo() {
    const version = chrome.runtime && typeof chrome.runtime.getManifest === 'function'
      ? chrome.runtime.getManifest().version
      : '';
    document.getElementById('about-version').textContent = version;
  }

  function getReleaseTypeLabel(type) {
    return RELEASE_TYPE_LABELS[String(type || '').toLowerCase()] || 'Changed';
  }

  function formatChangelogText(subject) {
    const text = String(subject || '')
      .split('\n')[0]
      .replace(/^[a-z][a-z0-9-]*(\([^)]+\))?!?:\s*/i, '')
      .trim();
    if (!text) return '';
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function getCommitUrl(item) {
    const commit = String(item.commit || '').trim();
    if (!commit) return '';
    return `${CHANGELOG_REPO_URL}/commit/${encodeURIComponent(commit)}`;
  }

  function renderChangelog(entries, isError = false) {
    const list = document.getElementById('changelog');
    const empty = document.getElementById('changelog-empty');
    if (!list || !empty) return;

    list.textContent = '';
    if (isError) {
      empty.textContent = t('optChangelogLoadFailed');
      empty.hidden = false;
      return;
    }

    const releases = Array.isArray(entries) ? entries : [];
    if (!releases.length) {
      empty.textContent = t('optChangelogEmpty');
      empty.hidden = false;
      return;
    }

    const fragment = document.createDocumentFragment();
    releases.forEach((release) => {
      const items = Array.isArray(release.items) ? release.items : [];
      const releaseSection = document.createElement('section');
      releaseSection.className = 'changelog-release';

      const header = document.createElement('div');
      header.className = 'changelog-release-header';

      const version = document.createElement('h2');
      version.className = 'changelog-release-version';
      version.textContent = release.version ? `v${release.version}` : '';
      header.appendChild(version);

      if (release.date) {
        const date = document.createElement('span');
        date.className = 'changelog-release-date';
        date.textContent = release.date;
        header.appendChild(date);
      }

      const itemList = document.createElement('div');
      itemList.className = 'changelog-items';

      items.forEach((item) => {
        const text = formatChangelogText(item.subject);
        if (!text) return;

        const url = getCommitUrl(item);
        const row = document.createElement(url ? 'a' : 'div');
        row.className = 'changelog-item';
        if (url) {
          row.href = url;
          row.target = '_blank';
          row.rel = 'noopener noreferrer';
        }

        const type = document.createElement('span');
        type.className = 'changelog-type';
        type.textContent = getReleaseTypeLabel(item.type);
        row.appendChild(type);

        const description = document.createElement('span');
        description.className = 'changelog-text';
        description.textContent = text;
        row.appendChild(description);

        if (item.commit) {
          const commit = document.createElement('span');
          commit.className = 'changelog-commit';
          commit.textContent = String(item.commit).slice(0, 7);
          row.appendChild(commit);
        }

        itemList.appendChild(row);
      });

      if (!itemList.childElementCount) return;
      releaseSection.appendChild(header);
      releaseSection.appendChild(itemList);
      fragment.appendChild(releaseSection);
    });

    list.appendChild(fragment);
    empty.textContent = t('optChangelogEmpty');
    empty.hidden = Boolean(list.childElementCount);
  }

  async function loadChangelog() {
    try {
      const response = await fetch(chrome.runtime.getURL(CHANGELOG_FILE));
      if (!response.ok) throw new Error('changelog-load-failed');
      renderChangelog(await response.json());
    } catch (_) {
      renderChangelog([], true);
    }
  }

  function formatDateStamp(date) {
    const y = String(date.getFullYear());
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  function setStatus(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('is-error', isError);
  }

  function setStatusWithShortcutLink(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    el.textContent = '';
    const linkLabel = t('optShortcutsPageLink');
    const index = message.indexOf(linkLabel);
    if (index < 0) {
      setStatus(elementId, message, isError);
      return;
    }

    el.appendChild(document.createTextNode(message.slice(0, index)));
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'inline-link';
    link.textContent = linkLabel;
    link.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
    el.appendChild(link);
    el.appendChild(document.createTextNode(message.slice(index + linkLabel.length)));
    el.hidden = false;
    el.classList.toggle('is-error', isError);
  }

  function clearSettingsManagementStatus() {
    ['export-settings-status', 'import-settings-status'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = '';
      el.hidden = true;
      el.classList.remove('is-error');
    });
  }

  function formatShortcutList(shortcuts) {
    const lines = shortcuts
      .filter((shortcut) => shortcut.name || shortcut.description || shortcut.shortcut)
      .map((shortcut) => {
        const label = shortcut.name === '_execute_action'
          ? t('optShortcutExecuteAction')
          : (shortcut.description || shortcut.name);
        const value = shortcut.shortcut || t('optShortcutUnset');
        return `- ${label}: ${value}`;
      });
    return lines.length ? `\n${lines.join('\n')}` : '';
  }

  async function getShortcuts() {
    try {
      if (chrome.commands && typeof chrome.commands.getAll === 'function') {
        return await chrome.commands.getAll();
      }
    } catch (_) {}
    return [];
  }

  function downloadJson(fileName, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportSettings() {
    const settings = await globalThis.viGetSettings();
    const payload = globalThis.viCreateSettingsExportPayload(settings, await getShortcuts());
    downloadJson(`VoiceInput-settings-${formatDateStamp(new Date())}.json`, payload);
    setStatus('export-settings-status', t('optSettingsExported'));
  }

  async function restoreShortcuts(shortcuts) {
    if (!shortcuts.length) return { ok: true, unsupported: false };
    if (!chrome.commands || typeof chrome.commands.update !== 'function') {
      return { ok: false, unsupported: true };
    }

    let failed = false;
    for (const shortcut of shortcuts) {
      if (!shortcut.name) continue;
      try {
        await chrome.commands.update({ name: shortcut.name, shortcut: shortcut.shortcut });
      } catch (_) {
        failed = true;
      }
    }
    return { ok: !failed, unsupported: false };
  }

  async function importSettingsFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = globalThis.viParseSettingsImportPayload(parsed);
      await globalThis.viReplaceSettings(payload.settings);
      const shortcutResult = await restoreShortcuts(payload.shortcuts);
      await load();
      showSaved();

      const shortcutList = formatShortcutList(payload.shortcuts);
      if (shortcutResult.unsupported) {
        setStatusWithShortcutLink('import-settings-status', t('optSettingsImportedShortcutUnsupported') + shortcutList);
      } else if (!shortcutResult.ok) {
        setStatusWithShortcutLink('import-settings-status', t('optSettingsImportedShortcutPartial') + shortcutList, true);
      } else {
        setStatus('import-settings-status', t('optSettingsImported') + shortcutList);
      }
    } catch (_) {
      setStatus('import-settings-status', t('optSettingsImportFailed'), true);
    }
  }

  function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const panes = document.querySelectorAll('.tab-pane');
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        clearSettingsManagementStatus();
        navItems.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        panes.forEach((p) => {
          const match = p.dataset.tab === target;
          p.classList.toggle('is-active', match);
          p.hidden = !match;
        });
      });
    });
  }

  async function load() {
    const s = await globalThis.viGetSettings();
    document.getElementById('maxAlternatives').value = s.maxAlternatives;
    buildLangOptions(s.lang);
    document.getElementById('autoInsertIfSingle').checked = s.autoInsertIfSingle;
    document.getElementById('sidePanelMode').checked = s.sidePanelMode;
    document.getElementById('continuous').checked = s.continuous;
    document.getElementById('interimResults').checked = s.interimResults;
    renderReplacements(s.replacements);
    renderCommonPhrases(s.commonPhrases);
  }

  let savedTimer = null;
  function showSaved() {
    const el = document.getElementById('saved');
    el.hidden = false;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.hidden = true; }, 1500);
  }

  async function save(partial) {
    await globalThis.viSetSettings(partial);
    showSaved();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    setupTabs();
    loadAboutInfo();
    loadChangelog();
    await load();

    const max = document.getElementById('maxAlternatives');
    max.addEventListener('change', () => {
      let v = parseInt(max.value, 10);
      if (!Number.isFinite(v)) v = 3;
      v = Math.max(1, Math.min(10, v));
      max.value = String(v);
      save({ maxAlternatives: v });
    });

    document.getElementById('lang').addEventListener('change', (e) => save({ lang: e.target.value }));
    document.getElementById('autoInsertIfSingle').addEventListener('change', (e) => save({ autoInsertIfSingle: e.target.checked }));
    document.getElementById('sidePanelMode').addEventListener('change', (e) => save({ sidePanelMode: e.target.checked }));
    document.getElementById('continuous').addEventListener('change', (e) => save({ continuous: e.target.checked }));
    document.getElementById('interimResults').addEventListener('change', (e) => save({ interimResults: e.target.checked }));
    const replacementsFilter = document.getElementById('replacements-filter');
    replacementsFilter.placeholder = t('optFilterPlaceholder');
    replacementsFilter.addEventListener('input', applyReplacementFilter);
    const commonPhrasesFilter = document.getElementById('common-phrases-filter');
    commonPhrasesFilter.placeholder = t('optFilterPlaceholder');
    commonPhrasesFilter.addEventListener('input', applyCommonPhraseFilter);

    document.getElementById('add-replacement').addEventListener('click', addReplacementRow);
    document.getElementById('add-common-phrase').addEventListener('click', addCommonPhraseRow);
    document.getElementById('undo-action').addEventListener('click', runPendingUndo);
    document.getElementById('export-settings').addEventListener('click', exportSettings);
    document.getElementById('import-settings').addEventListener('click', () => {
      const input = document.getElementById('import-settings-file');
      input.value = '';
      input.click();
    });
    document.getElementById('import-settings-file').addEventListener('change', (e) => {
      importSettingsFile(e.target.files && e.target.files[0]);
    });
    document.getElementById('open-shortcuts').addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });

    document.getElementById('reset').addEventListener('click', async () => {
      if (!confirm(t('optResetConfirm'))) return;
      await globalThis.viResetSettings();
      await load();
      showSaved();
    });
  });
})();
