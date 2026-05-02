// Shadow-DOM picker, toast, and listening indicator.
// Exposes globalThis.viMakePicker, globalThis.viMakeToast, globalThis.viMakeListening.
(function () {
  const SHADOW_CSS = `
    :host { all: initial; }
    .vi-picker {
      position: fixed;
      z-index: 2147483647;
      min-width: 280px;
      max-width: 480px;
      max-height: 360px;
      overflow-y: auto;
      background: #ffffff;
      color: #1a1a1a;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, "Microsoft JhengHei", "PingFang TC", "PingFang SC", sans-serif;
      padding: 6px 0 8px 0;
    }
    .vi-picker-header {
      padding: 4px 12px 8px 12px;
      font-size: 11px;
      color: #666;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(0, 0, 0, 0.06);
      margin-bottom: 4px;
      gap: 8px;
    }
    .vi-picker-title { font-weight: 600; color: #334; }
    .vi-picker-hint { font-size: 10px; color: #999; }
    .vi-picker-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .vi-picker-item {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 8px 12px;
      background: transparent;
      border: 0;
      outline: 0;
      text-align: left;
      cursor: pointer;
      color: inherit;
      font: inherit;
      gap: 10px;
    }
    .vi-picker-item:hover, .vi-picker-item.vi-active { background: #f5f0ff; }
    .vi-picker-rank {
      flex: 0 0 18px;
      height: 18px;
      width: 18px;
      border-radius: 50%;
      background: #ece4fb;
      color: #5b21b6;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .vi-picker-item.vi-active .vi-picker-rank { background: #7c3aed; color: #fff; }
    .vi-picker-text {
      flex: 1 1 auto;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .vi-picker-conf {
      flex: 0 0 56px;
      height: 4px;
      background: #eee;
      border-radius: 2px;
      overflow: hidden;
      position: relative;
    }
    .vi-picker-conf-bar {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      background: linear-gradient(90deg, #a78bfa 0%, #7c3aed 100%);
    }
    .vi-picker-empty {
      padding: 16px 12px;
      color: #888;
      text-align: center;
    }
    .vi-toast {
      position: fixed;
      z-index: 2147483647;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(20, 20, 20, 0.92);
      color: #fff;
      padding: 10px 16px;
      border-radius: 8px;
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft JhengHei", "PingFang TC", sans-serif;
      max-width: min(80vw, 480px);
      word-break: break-word;
      white-space: pre-line;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    }
    .vi-listening {
      position: fixed;
      z-index: 2147483647;
      top: 16px;
      right: 16px;
      background: #ef4444;
      color: #fff;
      padding: 8px 12px;
      border-radius: 12px;
      font: 11px/1.25 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      max-width: min(420px, calc(100vw - 32px));
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
    }
    .vi-listening-status {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .vi-listening-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #fff;
      animation: vi-pulse 1.2s ease-in-out infinite;
    }
    .vi-listening-interim {
      color: rgba(255, 255, 255, 0.92);
      font-size: 12px;
      font-weight: 500;
      line-height: 1.35;
      max-width: 360px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .vi-listening-interim[hidden] { display: none; }
    @keyframes vi-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.75); }
    }
  `;

  function makeShadowHost() {
    const host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; pointer-events: none;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);
    return { host, shadow };
  }

  function makePicker({ anchor, alternatives, t, onPick, onCancel }) {
    const { host, shadow } = makeShadowHost();

    const panel = document.createElement('div');
    panel.className = 'vi-picker';
    panel.setAttribute('role', 'listbox');
    panel.style.pointerEvents = 'auto';
    shadow.appendChild(panel);

    const header = document.createElement('div');
    header.className = 'vi-picker-header';
    const title = document.createElement('span');
    title.className = 'vi-picker-title';
    title.textContent = t('pickerTitle');
    header.appendChild(title);
    const hint = document.createElement('span');
    hint.className = 'vi-picker-hint';
    hint.textContent = `${t('pickerHintEnter')} · ${t('pickerHintEsc')}`;
    header.appendChild(hint);
    panel.appendChild(header);

    let activeIdx = 0;
    let done = false;
    const items = [];

    if (!alternatives || alternatives.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vi-picker-empty';
      empty.textContent = t('pickerEmpty');
      panel.appendChild(empty);
    } else {
      const list = document.createElement('ul');
      list.className = 'vi-picker-list';
      panel.appendChild(list);

      alternatives.forEach((alt, idx) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.className = 'vi-picker-item';
        btn.setAttribute('role', 'option');
        btn.dataset.idx = String(idx);
        btn.tabIndex = -1;

        const rank = document.createElement('span');
        rank.className = 'vi-picker-rank';
        rank.textContent = idx < 9 ? String(idx + 1) : '·';
        btn.appendChild(rank);

        const text = document.createElement('span');
        text.className = 'vi-picker-text';
        text.textContent = alt.transcript;
        btn.appendChild(text);

        const conf = document.createElement('span');
        conf.className = 'vi-picker-conf';
        const bar = document.createElement('span');
        bar.className = 'vi-picker-conf-bar';
        const c = Math.max(0, Math.min(1, alt.confidence || 0));
        bar.style.width = (c * 100).toFixed(0) + '%';
        conf.appendChild(bar);
        btn.appendChild(conf);

        // Prevent the picker from stealing focus from the source field on click.
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          pick(idx);
        });
        btn.addEventListener('mouseenter', () => setActive(idx));

        li.appendChild(btn);
        list.appendChild(li);
        items.push(btn);
      });
    }

    function setActive(i) {
      activeIdx = i;
      items.forEach((b, j) => b.classList.toggle('vi-active', j === i));
      const a = items[i];
      if (a && typeof a.scrollIntoView === 'function') {
        try { a.scrollIntoView({ block: 'nearest' }); } catch (_) {}
      }
    }

    function pick(i) {
      if (done) return;
      done = true;
      cleanup();
      try { onPick(i); } catch (_) {}
    }

    function cancel() {
      if (done) return;
      done = true;
      cleanup();
      try { onCancel && onCancel(); } catch (_) {}
    }

    function onKey(e) {
      if (done) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      if (items.length === 0) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        pick(activeIdx);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActive((activeIdx + 1) % items.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActive((activeIdx - 1 + items.length) % items.length);
        return;
      }
      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < items.length) {
          e.preventDefault();
          e.stopPropagation();
          pick(idx);
        }
      }
    }

    function onOutsidePointer(e) {
      if (done) return;
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (path.includes(host)) return;
      cancel();
    }

    function position() {
      let x = 16, y = 16;
      if (anchor && document.contains(anchor)) {
        const rect = anchor.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const ph = panelRect.height || 200;
        const pw = panelRect.width || 320;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        x = rect.left;
        y = rect.bottom + 6;
        if (y + ph > vh - 8 && rect.top - ph - 6 > 0) y = rect.top - ph - 6;
        if (x + pw > vw - 8) x = Math.max(8, vw - pw - 8);
        if (x < 8) x = 8;
        if (y < 8) y = 8;
        if (y + ph > vh - 8) y = Math.max(8, vh - ph - 8);
      } else {
        x = Math.max(8, (window.innerWidth - 320) / 2);
        y = 64;
      }
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    }

    function cleanup() {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onOutsidePointer, true);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      try { host.remove(); } catch (_) {}
    }

    if (items.length > 0) setActive(0);

    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onOutsidePointer, true);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);

    panel.style.position = 'fixed';
    panel.style.left = '-9999px';
    panel.style.top = '-9999px';
    document.body.appendChild(host);
    requestAnimationFrame(position);

    return { dispose: cancel };
  }

  function makeToast(message, ttl = 2200) {
    const { host, shadow } = makeShadowHost();
    const div = document.createElement('div');
    div.className = 'vi-toast';
    div.textContent = message;
    shadow.appendChild(div);
    document.body.appendChild(host);
    const timer = setTimeout(() => { try { host.remove(); } catch (_) {} }, ttl);
    return {
      dispose() { clearTimeout(timer); try { host.remove(); } catch (_) {} }
    };
  }

  function makeListening(label) {
    const { host, shadow } = makeShadowHost();
    const wrap = document.createElement('div');
    wrap.className = 'vi-listening';
    const status = document.createElement('div');
    status.className = 'vi-listening-status';
    const dot = document.createElement('span');
    dot.className = 'vi-listening-dot';
    status.appendChild(dot);
    const text = document.createElement('span');
    text.textContent = label;
    status.appendChild(text);
    wrap.appendChild(status);
    const interim = document.createElement('div');
    interim.className = 'vi-listening-interim';
    interim.setAttribute('aria-live', 'polite');
    interim.hidden = true;
    wrap.appendChild(interim);
    shadow.appendChild(wrap);
    document.body.appendChild(host);
    return {
      updateInterim(value) {
        const next = typeof value === 'string' ? value.trim() : '';
        interim.textContent = next;
        interim.hidden = next.length === 0;
      },
      dispose() { try { host.remove(); } catch (_) {} }
    };
  }

  globalThis.viMakePicker = makePicker;
  globalThis.viMakeToast = makeToast;
  globalThis.viMakeListening = makeListening;
})();
