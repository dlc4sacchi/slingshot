(function () {
  'use strict';

  const hostname = window.location.hostname;
  let remapping = 0;
  let attached = false;
  let boundKeydown = null;
  let boundKeyup = null;

  /** When local aiSites not yet written, align with storage.js DEFAULT_AI_SITES `match` values */
  const DEFAULT_MATCH_HINTS = [
    'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
    'deepseek.com',
    'perplexity.ai',
    'grok.com',
    'kimi.com',
    'manus.im',
    'mistral.ai',
    'you.com',
    'huggingface.co',
  ];

  function hostnameMatchesSite(sites) {
    if (!sites || !sites.length) {
      return DEFAULT_MATCH_HINTS.some((m) => hostname.includes(m));
    }
    return sites.some((s) => {
      const m = String(s.match || s.id || '').trim();
      if (m && hostname.includes(m)) return true;
      try {
        const h = new URL(s.url).hostname;
        return hostname === h || hostname.endsWith('.' + h.replace(/^www\./, ''));
      } catch (_) {
        return false;
      }
    });
  }

  function shouldRun(sync, localSites) {
    if (sync.enabled === false) return false;
    const f = sync.aiFeatures || {};
    if (!f.swapEnterShiftEnter) return false;
    return hostnameMatchesSite(localSites);
  }

  function swapHandler(e) {
    if (remapping) return;
    if (e.key !== 'Enter' || e.isComposing) return;

    remapping++;
    try {
      e.preventDefault();
      e.stopImmediatePropagation();

      const wantShift = !e.shiftKey;
      const Ev = e.type === 'keyup' ? KeyboardEvent : KeyboardEvent;
      const ev = new Ev(e.type, {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        shiftKey: wantShift,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        repeat: e.repeat,
        bubbles: true,
        cancelable: true,
        composed: e.composed,
      });
      e.target.dispatchEvent(ev);
    } finally {
      remapping--;
    }
  }

  function attach() {
    if (attached) return;
    boundKeydown = swapHandler;
    boundKeyup = swapHandler;
    document.addEventListener('keydown', boundKeydown, true);
    document.addEventListener('keyup', boundKeyup, true);
    attached = true;
  }

  function detach() {
    if (!attached) return;
    if (boundKeydown) document.removeEventListener('keydown', boundKeydown, true);
    if (boundKeyup) document.removeEventListener('keyup', boundKeyup, true);
    boundKeydown = null;
    boundKeyup = null;
    attached = false;
  }

  function apply() {
    chrome.storage.sync.get(['enabled', 'aiFeatures'], (sync) => {
      chrome.storage.local.get(['aiSites'], (local) => {
        const sites = local.aiSites;
        const payload = {
          enabled: sync.enabled !== false,
          aiFeatures: sync.aiFeatures && typeof sync.aiFeatures === 'object' ? sync.aiFeatures : {},
        };
        if (shouldRun(payload, sites)) attach();
        else detach();
      });
    });
  }

  apply();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.enabled || changes.aiFeatures)) apply();
    if (area === 'local' && changes.aiSites) apply();
  });
})();
