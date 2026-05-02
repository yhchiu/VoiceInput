(function () {
  const t = globalThis.vt;

  // Curated BCP-47 codes that Chrome's SpeechRecognition usually understands.
  const LANG_CODES = [
    'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN',
    'zh-TW', 'zh-CN', 'zh-HK', 'yue-Hant-HK',
    'ja-JP', 'ko-KR',
    'fr-FR', 'fr-CA', 'de-DE', 'it-IT', 'es-ES', 'es-MX',
    'pt-BR', 'pt-PT', 'ru-RU', 'pl-PL', 'tr-TR', 'nl-NL',
    'sv-SE', 'da-DK', 'fi-FI', 'nb-NO', 'cs-CZ', 'el-GR',
    'ar-SA', 'he-IL', 'th-TH', 'vi-VN', 'id-ID', 'ms-MY', 'hi-IN',
  ];

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  function buildLangOptions(currentLang) {
    const sel = document.getElementById('lang');
    sel.innerHTML = '';
    const navLang = navigator.language || 'en-US';

    const auto = document.createElement('option');
    auto.value = navLang;
    auto.textContent = `Auto (${navLang})`;
    sel.appendChild(auto);

    const seen = new Set([navLang]);
    LANG_CODES.forEach((code) => {
      if (seen.has(code)) return;
      seen.add(code);
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code;
      sel.appendChild(opt);
    });

    if (!seen.has(currentLang)) {
      const opt = document.createElement('option');
      opt.value = currentLang;
      opt.textContent = currentLang;
      sel.appendChild(opt);
    }
    sel.value = currentLang;
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
