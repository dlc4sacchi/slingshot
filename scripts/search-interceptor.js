(function () {
  'use strict';

  // ── BANG INTERCEPTION on search engine pages ───────────────────────────
  // This script ONLY runs on Search Engine pages defined in manifest.json

  const hostname = window.location.hostname;
  const SEARCH_ENGINE_HOSTS = ['www.google.com', 'www.bing.com', 'duckduckgo.com'];

  if (SEARCH_ENGINE_HOSTS.includes(hostname)) {
    const query = extractSearchQuery();
    if (query) {
      chrome.storage.sync.get(['bangChar', 'enabled'], (data) => {
        if (data.enabled === false) return;
        const bc = data.bangChar || '!';
        const words = query.split(/\s+/);
        const hasBang = words.some(w => w.length > bc.length && w.startsWith(bc));
        
        if (hasBang) {
          document.documentElement.style.display = 'none';
          chrome.runtime.sendMessage({ type: 'BANG_QUERY', query }, (response) => {
            if (!response || !response.handled) {
              document.documentElement.style.display = '';
            }
          });
        }
      });
    }
  }

  function extractSearchQuery() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('q') || params.get('query') || params.get('p') || '';
      return decodeURIComponent(raw).trim();
    } catch (e) { return ''; }
  }

})();
