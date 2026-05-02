// Text insertion strategies for <input>, <textarea>, and contenteditable.
// Exposes globalThis.viInsertText and globalThis.viIsEditable.
(function () {
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

  function isNativeTextInput(el) {
    if (!el) return false;
    if (el instanceof HTMLTextAreaElement) return true;
    if (el instanceof HTMLInputElement) {
      return TEXT_INPUT_TYPES.has((el.type || '').toLowerCase());
    }
    return false;
  }

  function isEditable(el) {
    if (!el) return false;
    if (isNativeTextInput(el)) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function insertIntoNativeInput(target, text, saved) {
    const proto = target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setterDesc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = setterDesc && setterDesc.set;

    target.focus();

    let start = saved && typeof saved.start === 'number' ? saved.start : null;
    let end = saved && typeof saved.end === 'number' ? saved.end : null;
    if (start === null || end === null) {
      start = typeof target.selectionStart === 'number' ? target.selectionStart : target.value.length;
      end = typeof target.selectionEnd === 'number' ? target.selectionEnd : start;
    } else {
      try { target.setSelectionRange(start, end); } catch (_) {}
    }
    const value = target.value || '';
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = before + text + after;

    if (setter) {
      setter.call(target, next);
    } else {
      target.value = next;
    }
    const caret = start + text.length;
    try { target.setSelectionRange(caret, caret); } catch (_) {}

    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return { ok: true };
  }

  function insertIntoContentEditable(target, text, saved) {
    target.focus();
    const sel = window.getSelection();
    if (sel && saved && saved.range) {
      try {
        sel.removeAllRanges();
        sel.addRange(saved.range);
      } catch (_) {}
    }

    let ok = false;
    try {
      ok = document.execCommand && document.execCommand('insertText', false, text);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : (saved && saved.range) || null;
      if (!range) return { ok: false, reason: 'no-range' };
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    return { ok: true };
  }

  function viInsertText(target, text, saved) {
    if (!target) return { ok: false, reason: 'no-target' };
    if (!document.contains(target)) return { ok: false, reason: 'detached' };
    if (typeof text !== 'string' || text.length === 0) return { ok: false, reason: 'empty-text' };

    if (isNativeTextInput(target)) {
      return insertIntoNativeInput(target, text, saved);
    }
    if (target.isContentEditable) {
      return insertIntoContentEditable(target, text, saved);
    }
    return { ok: false, reason: 'unsupported-target' };
  }

  globalThis.viInsertText = viInsertText;
  globalThis.viIsEditable = isEditable;
  globalThis.viIsNativeTextInput = isNativeTextInput;
})();
