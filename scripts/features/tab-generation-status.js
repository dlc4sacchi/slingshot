(function () {
  'use strict';

  const HOST = 'gemini.google.com';
  const TICK_MS = 450;
  const DONE_HOLD_MS = 2800;
  const TITLE_MAX = 96;

  if (!location.hostname.includes(HOST)) return;

  /** Content scripts cannot rely on chrome.tabs.getCurrent(); use the background + sender.tab.id. */
  function setTabTitle(title) {
    const t = typeof title === 'string' ? title : '';
    chrome.runtime.sendMessage({ type: 'SLINGSHOT_SET_TAB_TITLE', title: t }, () => {
      void chrome.runtime.lastError;
    });
  }

  function clipTitle(s) {
    if (!s) return '';
    if (s.length <= TITLE_MAX) return s;
    return s.slice(0, TITLE_MAX - 1) + '…';
  }

  /** Walk open shadow roots (one level deep per node) to match Gemini’s embedded controls. */
  function forEachDeepButton(callback, root) {
    const roots = root === document ? [document] : [root];
    const visit = (r) => {
      if (!r || !r.querySelectorAll) return;
      r.querySelectorAll('button, [role="button"]').forEach((el) => callback(el));
      r.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) visit(el.shadowRoot);
      });
    };
    roots.forEach(visit);
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function labelMatchesStop(el) {
    const a = (el.getAttribute && el.getAttribute('aria-label')) || '';
    const al = a.toLowerCase();
    if (/\bstop\b/.test(al)) return true;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/^stop\b/i.test(t) && t.length < 64) return true;
    return false;
  }

  /** Gemini: visible Stop while streaming; optional Thinking before Stop appears. */
  function geminiIsGenerating() {
    let hit = false;
    forEachDeepButton((el) => {
      if (hit || !isVisible(el)) return;
      if (labelMatchesStop(el)) hit = true;
    });
    if (hit) return true;

    // “Thinking…” before Stop appears: short visible status chip/line only
    const shortEls = document.querySelectorAll('span, div, p');
    for (let i = shortEls.length - 1; i >= 0 && i > shortEls.length - 80; i--) {
      const el = shortEls[i];
      if (!isVisible(el)) continue;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 2 && t.length < 56 && /^thinking[.…]*$/i.test(t)) return true;
    }

    return false;
  }

  // ── Child frames: only report generating state to top (tab title runs in top frame only) ──
  if (window !== window.top) {
    let iframeReporterOn = false;
    let iframeTick = null;
    function applyIframeReporter() {
      if (iframeTick) {
        clearInterval(iframeTick);
        iframeTick = null;
      }
      chrome.storage.sync.get(['enabled', 'aiFeatures'], (sync) => {
        if (sync.enabled === false || !((sync.aiFeatures || {}).tabGenerationStatus)) {
          iframeReporterOn = false;
          return;
        }
        iframeReporterOn = true;
        iframeTick = setInterval(() => {
          if (!iframeReporterOn) return;
          try {
            window.top.postMessage(
              { type: 'SLINGSHOT_GEMINI_GEN', generating: geminiIsGenerating() },
              'https://gemini.google.com'
            );
          } catch (_) {}
        }, TICK_MS);
      });
    }
    applyIframeReporter();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && (changes.enabled || changes.aiFeatures)) applyIframeReporter();
    });
    return;
  }

  // ── Top frame ─────────────────────────────────────────────────────────────
  let remoteFrameGenerating = false;
  window.addEventListener(
    'message',
    (e) => {
      if (e.origin !== 'https://gemini.google.com') return;
      if (!e.data || e.data.type !== 'SLINGSHOT_GEMINI_GEN') return;
      remoteFrameGenerating = !!e.data.generating;
    },
    false
  );

  let baselineTitle = '';
  let dotFrame = 0;
  let wasGenerating = false;
  let showingDone = false;
  let tickId = null;
  let doneId = null;
  let running = false;

  function syncBaseline() {
    baselineTitle = document.title || 'Gemini';
  }

  function clearTimers() {
    if (tickId) {
      clearInterval(tickId);
      tickId = null;
    }
    if (doneId) {
      clearTimeout(doneId);
      doneId = null;
    }
  }

  function applyVisibleTitle() {
    syncBaseline();
    setTabTitle(document.title);
    dotFrame = 0;
    showingDone = false;
  }

  function tick() {
    if (document.visibilityState === 'visible') {
      applyVisibleTitle();
      return;
    }
    syncBaseline();
    const base = clipTitle(baselineTitle);
    const gen = geminiIsGenerating() || remoteFrameGenerating;

    if (gen) {
      if (doneId) {
        clearTimeout(doneId);
        doneId = null;
      }
      showingDone = false;
      wasGenerating = true;
      dotFrame = (dotFrame + 1) % 4;
      const dots = '.'.repeat(dotFrame);
      setTabTitle(`Working${dots} · ${base}`);
      return;
    }

    if (wasGenerating) {
      wasGenerating = false;
      showingDone = true;
      setTabTitle(`✓ Done · ${base}`);
      doneId = setTimeout(() => {
        doneId = null;
        showingDone = false;
        if (document.visibilityState === 'hidden') {
          syncBaseline();
          setTabTitle(clipTitle(document.title));
        }
      }, DONE_HOLD_MS);
      return;
    }

    if (!showingDone) {
      setTabTitle(base);
    }
  }

  function onVisibility() {
    clearTimers();
    if (document.visibilityState === 'visible') {
      applyVisibleTitle();
      return;
    }
    syncBaseline();
    tickId = setInterval(tick, TICK_MS);
    tick();
  }

  function start() {
    if (running) return;
    running = true;
    syncBaseline();
    document.addEventListener('visibilitychange', onVisibility, true);
    window.addEventListener('pageshow', syncBaseline, true);
    const mo = new MutationObserver(() => {
      if (document.visibilityState === 'visible') syncBaseline();
    });
    const titleEl = document.querySelector('title');
    if (titleEl) mo.observe(titleEl, { childList: true, characterData: true, subtree: true });
    onVisibility();
  }

  function stop() {
    if (!running) return;
    running = false;
    clearTimers();
    document.removeEventListener('visibilitychange', onVisibility, true);
    window.removeEventListener('pageshow', syncBaseline, true);
    syncBaseline();
    setTabTitle(document.title);
  }

  function applySettings() {
    chrome.storage.sync.get(['enabled', 'aiFeatures'], (sync) => {
      if (sync.enabled === false) {
        stop();
        return;
      }
      const f = sync.aiFeatures && typeof sync.aiFeatures === 'object' ? sync.aiFeatures : {};
      if (!f.tabGenerationStatus) {
        stop();
        return;
      }
      start();
    });
  }

  applySettings();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.enabled || changes.aiFeatures)) applySettings();
  });
})();
