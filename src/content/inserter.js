// Text insertion strategies for <input>, <textarea>, and contenteditable.
// A target can live in the top document, inside a shadow root, or inside a
// same-origin iframe (Google Docs, TinyMCE, and CKEditor all keep the real
// editable there), so every DOM lookup resolves through the target's own
// document rather than the top-level one.
// Exposes globalThis.viInsertText and globalThis.viIsEditable.
(function () {
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

  function documentFor(node) {
    return (node && node.ownerDocument) || document;
  }

  function windowFor(node) {
    const doc = documentFor(node);
    return (doc && doc.defaultView) || globalThis;
  }

  function selectionFor(node) {
    const doc = documentFor(node);
    if (doc && typeof doc.getSelection === 'function') return doc.getSelection();
    const win = windowFor(node);
    return win && typeof win.getSelection === 'function' ? win.getSelection() : null;
  }

  function isAttached(node) {
    if (!node) return false;
    const doc = documentFor(node);
    return !!(doc && typeof doc.contains === 'function' && doc.contains(node));
  }

  function isFrameElement(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    return tag === 'IFRAME' || tag === 'FRAME';
  }

  // Elements inside an iframe belong to that frame's realm, so `instanceof`
  // against the top frame's constructors is always false. Resolve the
  // constructors from the element's own window instead.
  function nativeInputCtors(el) {
    const win = windowFor(el);
    return {
      Input: (win && win.HTMLInputElement) || HTMLInputElement,
      TextArea: (win && win.HTMLTextAreaElement) || HTMLTextAreaElement,
    };
  }

  function isNativeTextInput(el) {
    if (!el) return false;
    const { Input, TextArea } = nativeInputCtors(el);
    if (TextArea && el instanceof TextArea) return true;
    if (Input && el instanceof Input) {
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

  // Walks the focus chain down through shadow roots and same-origin frames.
  // On a canvas-rendered editor such as Google Docs the top document only ever
  // reports the hidden host iframe as focused; the caret lives one level down.
  function deepActiveElement(root) {
    const startDoc = root || document;
    let el = startDoc && startDoc.activeElement;
    const seen = new Set();

    while (el && !seen.has(el)) {
      seen.add(el);

      const shadowActive = el.shadowRoot && el.shadowRoot.activeElement;
      if (shadowActive) {
        el = shadowActive;
        continue;
      }

      if (isFrameElement(el)) {
        let innerActive = null;
        try {
          const innerDoc = el.contentDocument;
          innerActive = innerDoc && innerDoc.activeElement;
        } catch (_) {
          innerActive = null; // cross-origin frame, nothing we can reach
        }
        if (innerActive) {
          el = innerActive;
          continue;
        }
      }

      break;
    }

    return el || null;
  }

  function insertIntoNativeInput(target, text, saved) {
    const { Input, TextArea } = nativeInputCtors(target);
    const proto = TextArea && target instanceof TextArea
      ? TextArea.prototype
      : Input.prototype;
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

    const InputEventCtor = windowFor(target).InputEvent || InputEvent;
    target.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text }));
    return { ok: true };
  }

  function insertIntoContentEditable(target, text, saved) {
    target.focus();
    const doc = documentFor(target);
    const sel = selectionFor(target);
    if (sel && saved && saved.range) {
      try {
        sel.removeAllRanges();
        sel.addRange(saved.range);
      } catch (_) {}
    }

    let ok = false;
    try {
      ok = doc.execCommand && doc.execCommand('insertText', false, text);
    } catch (_) {
      ok = false;
    }

    if (!ok) {
      const range = sel && sel.rangeCount ? sel.getRangeAt(0) : (saved && saved.range) || null;
      if (!range) return { ok: false, reason: 'no-range' };
      range.deleteContents();
      const node = doc.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      const InputEventCtor = windowFor(target).InputEvent || InputEvent;
      target.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: text }));
    }

    return { ok: true };
  }

  function viInsertText(target, text, saved) {
    if (!target) return { ok: false, reason: 'no-target' };
    if (!isAttached(target)) return { ok: false, reason: 'detached' };
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
  globalThis.viDeepActiveElement = deepActiveElement;
  globalThis.viDocumentFor = documentFor;
  globalThis.viSelectionFor = selectionFor;
  globalThis.viIsAttached = isAttached;
  globalThis.viIsFrameElement = isFrameElement;
})();
