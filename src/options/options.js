(function () {
  const t = globalThis.vt;

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  function buildLangOptions(currentLang) {
    globalThis.viBuildLangOptions(document.getElementById('lang'), currentLang);
  }

  function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const panes = document.querySelectorAll('.tab-pane');
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
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
