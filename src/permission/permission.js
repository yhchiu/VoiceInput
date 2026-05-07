(function () {
  const MSG = globalThis.VI_MSG;
  const TARGETS = globalThis.VI_TARGETS;
  const t = globalThis.vt;

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
  }

  function setStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.classList.toggle('success', type === 'success');
    status.classList.toggle('error', type === 'error');
  }

  function stopMediaStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch (_) {}
    });
  }

  async function notifyGranted() {
    try {
      await chrome.runtime.sendMessage({
        target: TARGETS.BACKGROUND,
        source: TARGETS.PERMISSION,
        action: MSG.MICROPHONE_PERMISSION_GRANTED,
      });
    } catch (_) {}
  }

  async function grantMicrophone() {
    const button = document.getElementById('grant');
    button.disabled = true;
    setStatus(t('sidePanelMicPermissionPrompt'), '');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stopMediaStream(stream);
      setStatus(t('permGranted'), 'success');
      await notifyGranted();
    } catch (_) {
      setStatus(t('permDenied'), 'error');
      button.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    applyI18n();
    document.getElementById('grant').addEventListener('click', grantMicrophone);
  });
})();
