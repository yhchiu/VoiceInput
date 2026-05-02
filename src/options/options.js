(function () {
  const t = globalThis.vt;

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  function buildLangOptions(currentLang) {
    globalThis.viBuildLangOptions(document.getElementById('lang'), currentLang, t('optLangAuto'));
  }

  function createReplacementInput(labelKey, className, value) {
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
    wrap.appendChild(input);
    return { wrap, input };
  }

  function updateReplacementEmptyState() {
    const empty = document.getElementById('replacements-empty');
    empty.hidden = document.querySelectorAll('.replacement-row').length > 0;
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

  function appendReplacementRow(item = {}, focus = false) {
    const list = document.getElementById('replacements');
    const row = document.createElement('div');
    row.className = 'replacement-row';

    const from = createReplacementInput('optReplaceFrom', 'replacement-from', item.from);
    const to = createReplacementInput('optReplaceTo', 'replacement-to', item.to);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'ghost danger';
    remove.textContent = t('optRemoveReplacement');

    from.input.addEventListener('input', scheduleReplacementSave);
    to.input.addEventListener('input', scheduleReplacementSave);
    remove.addEventListener('click', () => {
      row.remove();
      updateReplacementEmptyState();
      saveReplacementsNow();
    });

    row.appendChild(from.wrap);
    row.appendChild(to.wrap);
    row.appendChild(remove);
    list.appendChild(row);
    updateReplacementEmptyState();
    if (focus) from.input.focus();
  }

  function renderReplacements(replacements) {
    if (replacementSaveTimer) {
      clearTimeout(replacementSaveTimer);
      replacementSaveTimer = null;
    }
    const list = document.getElementById('replacements');
    list.innerHTML = '';
    globalThis.viNormalizeReplacements(replacements).forEach((item) => appendReplacementRow(item));
    updateReplacementEmptyState();
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

  function normalizeShortcut(command) {
    return {
      name: typeof command.name === 'string' ? command.name : '',
      description: typeof command.description === 'string' ? command.description : '',
      shortcut: typeof command.shortcut === 'string' ? command.shortcut : '',
    };
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
    const shortcuts = (await getShortcuts()).map(normalizeShortcut);
    const payload = {
      type: 'VoiceInputSettings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      shortcuts,
    };
    downloadJson(`VoiceInput-settings-${formatDateStamp(new Date())}.json`, payload);
    setStatus('export-settings-status', t('optSettingsExported'));
  }

  function parseImportPayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid-settings-file');
    }
    const settings = value.settings && typeof value.settings === 'object'
      ? value.settings
      : value;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('invalid-settings-file');
    }
    return {
      settings,
      shortcuts: Array.isArray(value.shortcuts) ? value.shortcuts.map(normalizeShortcut) : [],
    };
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
      const payload = parseImportPayload(parsed);
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
    document.getElementById('continuous').checked = s.continuous;
    document.getElementById('interimResults').checked = s.interimResults;
    renderReplacements(s.replacements);
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
    document.getElementById('continuous').addEventListener('change', (e) => save({ continuous: e.target.checked }));
    document.getElementById('interimResults').addEventListener('change', (e) => save({ interimResults: e.target.checked }));
    document.getElementById('add-replacement').addEventListener('click', () => appendReplacementRow({}, true));
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
