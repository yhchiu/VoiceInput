// Recognition language options shared by options and popup pages.
// Exposes VI_LANG_CODES, viFormatLangLabel, and viBuildLangOptions.
(function () {
  // Curated BCP-47 codes that Chrome's SpeechRecognition usually understands.
  const LANG_CODES = Object.freeze([
    'en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN',
    'zh-TW', 'zh-CN', 'zh-HK', 'yue-Hant-HK',
    'ja-JP', 'ko-KR',
    'fr-FR', 'fr-CA', 'de-DE', 'it-IT', 'es-ES', 'es-MX',
    'pt-BR', 'pt-PT', 'ru-RU', 'pl-PL', 'tr-TR', 'nl-NL',
    'sv-SE', 'da-DK', 'fi-FI', 'nb-NO', 'cs-CZ', 'el-GR',
    'ar-SA', 'he-IL', 'th-TH', 'vi-VN', 'id-ID', 'ms-MY', 'hi-IN',
  ]);

  const LANG_LABELS = Object.freeze({
    'en-US': 'English - United States',
    'en-GB': 'English - United Kingdom',
    'en-AU': 'English - Australia',
    'en-CA': 'English - Canada',
    'en-IN': 'English - India',
    'zh-TW': '繁體中文',
    'zh-CN': '简体中文',
    'zh-HK': '繁體中文 - 香港',
    'yue-Hant-HK': '粵語',
    'ja-JP': '日本語',
    'ko-KR': '한국어',
    'fr-FR': 'Français - France',
    'fr-CA': 'Français - Canada',
    'de-DE': 'Deutsch',
    'it-IT': 'Italiano',
    'es-ES': 'Español - España',
    'es-MX': 'Español - México',
    'pt-BR': 'Português - Brasil',
    'pt-PT': 'Português - Portugal',
    'ru-RU': 'Русский',
    'pl-PL': 'Polski',
    'tr-TR': 'Türkçe',
    'nl-NL': 'Nederlands',
    'sv-SE': 'Svenska',
    'da-DK': 'Dansk',
    'fi-FI': 'Suomi',
    'nb-NO': 'Norsk bokmål',
    'cs-CZ': 'Čeština',
    'el-GR': 'Ελληνικά',
    'ar-SA': 'العربية',
    'he-IL': 'עברית',
    'th-TH': 'ไทย',
    'vi-VN': 'Tiếng Việt',
    'id-ID': 'Bahasa Indonesia',
    'ms-MY': 'Bahasa Melayu',
    'hi-IN': 'हिन्दी',
  });

  function formatLangLabel(code) {
    const label = LANG_LABELS[code];
    return label ? `${code} (${label})` : code;
  }

  function buildLangOptions(select, currentLang, autoLabel = 'Auto') {
    select.innerHTML = '';
    const navLang = navigator.language || 'en-US';

    const auto = document.createElement('option');
    auto.value = navLang;
    auto.textContent = `${autoLabel} (${formatLangLabel(navLang)})`;
    select.appendChild(auto);

    const seen = new Set([navLang]);
    LANG_CODES.forEach((code) => {
      if (seen.has(code)) return;
      seen.add(code);
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = formatLangLabel(code);
      select.appendChild(opt);
    });

    if (!seen.has(currentLang)) {
      const opt = document.createElement('option');
      opt.value = currentLang;
      opt.textContent = formatLangLabel(currentLang);
      select.appendChild(opt);
    }
    select.value = currentLang;
  }

  globalThis.VI_LANG_CODES = LANG_CODES;
  globalThis.viFormatLangLabel = formatLangLabel;
  globalThis.viBuildLangOptions = buildLangOptions;
})();
