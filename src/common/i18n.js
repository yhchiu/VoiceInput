// Tiny chrome.i18n wrapper. Exposes globalThis.vt(key, ...substitutions).
(function () {
  function vt(key, ...substitutions) {
    if (typeof chrome !== 'undefined' && chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
      const msg = chrome.i18n.getMessage(key, substitutions.length ? substitutions : undefined);
      if (msg) return msg;
    }
    return key;
  }
  globalThis.vt = vt;
})();
