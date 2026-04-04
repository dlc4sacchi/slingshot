importScripts('storage.js');
importScripts('telemetry/heartbeat.js');

// ── Install / update handler ─────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.get(['installDate'], (data) => {
      if (!data.installDate) {
        chrome.storage.sync.set({ installDate: Date.now() });
      }
    });
  }
  syncRemoteConfig();
});

// ── Keyboard shortcut → open popup ───────────────────────────────────────────
// _execute_action suggested_key works after Web Store install.
// open_popup named command works immediately for unpacked/dev installs.
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open_popup') {
    chrome.action.openPopup().catch(() => {
      // openPopup() requires a focused window in some Chrome versions
      chrome.windows.getCurrent({ populate: false }, (win) => {
        if (win) chrome.action.openPopup({ windowId: win.id });
      });
    });
  }
});

// ── In-memory cache ───────────────────────────────────────────────────────────
let _cache = null;
function getCached(cb) {
  if (_cache) { cb(_cache); return; }
  getAllData((data) => { _cache = data; cb(_cache); });
}
// Invalidate cache when either storage area changes
chrome.storage.onChanged.addListener(() => { _cache = null; });

// ── Messages from content scripts & settings page ────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BANG_QUERY') {
    getCached(({ aiSites, searchEngines, bangChar, enabled }) => {
      if (!enabled) { sendResponse({ handled: false }); return; }
      const bc = bangChar || '!';
      const result = resolveBang(msg.query, bc, aiSites, searchEngines);
      sendResponse({ handled: result.handled });
      if (!result.handled) return;
      recordBangUsage(extractBangTokens(msg.query, bc), 'content_script');
      result.urls.forEach((url, i) => {
        if (i === 0) chrome.tabs.update(sender.tab.id, { url });
        else chrome.tabs.create({ url, active: false });
      });
    });
    return true;
  }
  if (msg.type === 'FORCE_SYNC') {
    syncRemoteConfig().then(() => sendResponse({ success: true }));
    return true;
  }
});

// ── Omnibox ───────────────────────────────────────────────────────────────────
chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  getCached(({ aiSites, searchEngines, bangChar, enabled }) => {
    if (!enabled) return;
    const bc = bangChar || '!';
    const trimmed = text.trim();
    const result = resolveBang(trimmed, bc, aiSites, searchEngines);
    if (!result.handled) {
      openUrl('https://www.google.com/search?q=' + encodeURIComponent(trimmed), disposition);
      return;
    }
    recordBangUsage(extractBangTokens(trimmed, bc), 'omnibox');
    result.urls.forEach((url, i) => {
      if (i === 0) openUrl(url, disposition);
      else chrome.tabs.create({ url, active: false });
    });
  });
});

// Omnibox suggestions — always fetched fresh so they reflect the current
// bangChar and active sites without needing an extension reload.
chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  // Always bust cache here so bangChar changes are reflected immediately
  _cache = null;
  getCached(({ bangChar, aiSites, searchEngines }) => {
    const bc = bangChar || '!';

    // Build suggestions from actual active sites (not hardcoded)
    const aiSuggestions = aiSites
      .filter(s => s.active)
      .map(s => ({ content: `${bc}${s.bang} `, description: `${bc}${s.bang} [query] — ${s.name}` }));

    const staticSuggestions = [
      { content: `${bc}ai `,  description: `${bc}ai [query] — all active AI sites` },
      { content: `${bc}all `, description: `${bc}all [query] — all search engines` },
      { content: `${bc}gen `, description: `${bc}gen [query] — general engines` },
      { content: `${bc}dev `, description: `${bc}dev [query] — dev engines` },
      { content: `${bc}des `, description: `${bc}des [query] — design engines` },
      { content: `${bc}res `, description: `${bc}res [query] — research engines` },
    ];

    const allSuggestions = [...staticSuggestions, ...aiSuggestions];
    const filtered = text
      ? allSuggestions.filter(s => s.content.startsWith(text))
      : allSuggestions;

    suggest(filtered.slice(0, 6));
  });
});

// ── Core resolver ─────────────────────────────────────────────────────────────
function resolveBang(input, bc, aiSites, searchEngines) {
  const tokens = input.split(/\s+/);
  const bangTokens = [];
  const queryTokens = [];

  for (const token of tokens) {
    if (token.startsWith(bc) && token.length > bc.length) {
      bangTokens.push(token.slice(bc.length));
    } else {
      queryTokens.push(token);
    }
  }

  if (bangTokens.length === 0) return { handled: false };

  const query = queryTokens.join(' ').trim();
  const enc = encodeURIComponent(query);
  const allUrls = [];
  const byCategoryAlias = {
    gen: 'general',
    dev: 'dev',
    des: 'design',
    res: 'research',
  };

  for (const bang of bangTokens) {
    if (bang === 'ai') {
      aiSites.filter(s => s.active).forEach(s => allUrls.push(s.url.replace('%s', enc)));
    } else if (bang === 'all') {
      searchEngines.filter(s => s.active).forEach(s => allUrls.push(s.url.replace('%s', enc)));
    } else if (byCategoryAlias[bang]) {
      const category = byCategoryAlias[bang];
      searchEngines
        .filter(s => s.active && (s.category || 'general') === category)
        .forEach(s => allUrls.push(s.url.replace('%s', enc)));
    } else {
      const aiMatch = aiSites.find(s => s.bang === bang);
      if (aiMatch) { allUrls.push(aiMatch.url.replace('%s', enc)); continue; }
      const srMatch = searchEngines.find(s => s.bang === bang);
      if (srMatch) { allUrls.push(srMatch.url.replace('%s', enc)); }
    }
  }

  const urls = [...new Set(allUrls)];
  return urls.length ? { handled: true, urls } : { handled: false };
}

function openUrl(url, disposition) {
  if (disposition === 'currentTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.update(tabs[0].id, { url });
      else chrome.tabs.create({ url });
    });
  } else {
    chrome.tabs.create({ url, active: disposition !== 'newBackgroundTab' });
  }
}

// ── Remote Sync Scheduler (Supabase) ────────────────────────────────────────
async function syncRemoteConfig() {
  try {
    const headers = { 'apikey': SUPABASE_CONFIG.ANON_KEY };
    const resSe = await fetch(`${SUPABASE_CONFIG.URL}/rest/v1/search_engines?order=id`, { headers });
    if (!resSe.ok) throw new Error('API error');

    const remoteSe = await resSe.json();

    chrome.storage.local.get(['searchEngines'], (local) => {
      // If a user never opened the settings page, `searchEngines` might not have been
      // persisted to local storage yet. In that case, merge against our minimal fallback
      // so "removed from backend" entries can still be preserved as `custom: true`.
      const localSe = local.searchEngines?.length > 0
        ? local.searchEngines
        : mergeSites([], DEFAULT_SEARCH_ENGINES);

      chrome.storage.local.set({
        searchEngines: mergeSites(localSe, remoteSe),
      });
      _cache = null;
      chrome.runtime.sendMessage({ type: 'SYNC_COMPLETE' }).catch(() => {});
    });
  } catch (_) {
    // Sync failed (network/API error) — will retry on next schedule
  }
}

// Sync on: browser startup and once a day (1440 mins). Install sync is in onInstalled above.
chrome.runtime.onStartup.addListener(() => {
  syncRemoteConfig();
  sendTelemetryHeartbeat();
});
chrome.alarms.create('remoteSync', { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'remoteSync') {
    syncRemoteConfig();
    sendTelemetryHeartbeat();
  }
});
