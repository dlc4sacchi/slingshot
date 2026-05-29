// ── Storage strategy ──────────────────────────────────────────────────────────
// chrome.storage.sync  → small settings: bangChar, enabled, license, installDate,
//                        theme, installId, lastExport, aiFeatures
// chrome.storage.local → full site arrays (aiSites, searchEngines) including
//                        custom entries with potentially long URLs.
//                        5 MB limit vs 100 KB for sync.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_AI_SITES = [
  { id: 'chatgpt',    name: 'ChatGPT',     bang: 'c',   match: 'chatgpt.com',           url: 'https://chatgpt.com/?q=%s',               active: false, custom: false },
  { id: 'claude',     name: 'Claude',      bang: 'cl',  match: 'claude.ai',             url: 'https://claude.ai/new?q=%s',              active: true,  custom: false },
  { id: 'gemini',     name: 'Gemini',      bang: 'g',   match: 'gemini.google.com',     url: 'https://gemini.google.com/app?q=%s',      active: true,  custom: false },
  { id: 'deepseek',   name: 'DeepSeek',    bang: 'd',   match: 'deepseek.com',          url: 'https://chat.deepseek.com/?q=%s',         active: false, custom: false },
  { id: 'perplexity', name: 'Perplexity',  bang: 'px',  match: 'perplexity.ai',         url: 'https://www.perplexity.ai/?q=%s',         active: true,  custom: false },
  { id: 'grok',       name: 'Grok',        bang: 'gr',  match: 'grok.com',              url: 'https://grok.com/?q=%s',                  active: false, custom: false },
  { id: 'kimi',       name: 'Kimi',        bang: 'ki',  match: 'kimi.com',              url: 'https://www.kimi.com/?q=%s',              active: false, custom: false },
  { id: 'manus',      name: 'Manus',       bang: 'mn',  match: 'manus.im',              url: 'https://manus.im/?q=%s',                  active: false, custom: false },
  { id: 'mistral',    name: 'Mistral',     bang: 'mi',  match: 'mistral.ai',            url: 'https://chat.mistral.ai/chat?q=%s',       active: false, custom: false },
  { id: 'you',        name: 'You.com',     bang: 'yo',  match: 'you.com',               url: 'https://you.com/search?q=%s',             active: false, custom: false },
  { id: 'hf',         name: 'HuggingChat', bang: 'hf',  match: 'huggingface.co',        url: 'https://huggingface.co/chat/?q=%s',       active: false, custom: false },
];

const DEFAULT_SEARCH_ENGINES = [
  { id: 'google',      name: 'Google',         bang: 'gg',  url: 'https://www.google.com/search?q=%s',                     active: true,  custom: false },
  { id: 'youtube',     name: 'YouTube',        bang: 'yt',  url: 'https://www.youtube.com/results?search_query=%s',        active: true,  custom: false },
  { id: 'reddit',      name: 'Reddit',         bang: 'r',   url: 'https://www.reddit.com/search/?q=%s',                    active: true,  custom: false },
  { id: 'wikipedia',   name: 'Wikipedia',      bang: 'w',   url: 'https://en.wikipedia.org/wiki/Special:Search?search=%s', active: true,  custom: false },
];

const FREE_LIMIT = 2;
const TRIAL_DAYS = 30;

/** When false, trial / Pro UI and active-site limits are off (shipping build). Set true to re-enable monetization. */
var MONETIZATION_ENABLED = false;

const DEFAULT_AI_FEATURES = {
  swapEnterShiftEnter: false,
};

// ── Supabase Configuration ──────────────────────────────────────────────────────
const SUPABASE_CONFIG = {
  URL: 'https://pfqeztlfqewxeidtulik.supabase.co',
  ANON_KEY: 'sb_publishable_nCOYegypInRBTqh4oR3JZQ_Xr16RxIa'
};

// Read both storage areas and merge results
function getAllData(cb) {
  chrome.storage.sync.get(['license', 'enabled', 'bangChar', 'installDate', 'aiFeatures'], (syncData) => {
    chrome.storage.local.get(['aiSites', 'searchEngines'], (localData) => {
      const rawFeatures = syncData.aiFeatures && typeof syncData.aiFeatures === 'object'
        ? syncData.aiFeatures
        : {};
      cb({
        aiSites:       localData.aiSites?.length > 0 ? localData.aiSites : mergeSites([], DEFAULT_AI_SITES),
        searchEngines: localData.searchEngines?.length > 0 ? localData.searchEngines : mergeSites([], DEFAULT_SEARCH_ENGINES),
        license:       syncData.license        || null,
        enabled:       syncData.enabled        !== false,
        bangChar:      syncData.bangChar       || '!',
        installDate:   syncData.installDate    || null,
        aiFeatures:    { ...DEFAULT_AI_FEATURES, ...rawFeatures },
      });
    });
  });
}

function getSites(cb) {
  getAllData(d => cb(d.aiSites, d.license));
}

// Site arrays go to local (large data, no sync quota issues)
function saveAiSites(sites, cb)     { chrome.storage.local.set({ aiSites: sites }, cb); }
function saveSearchEngines(eng, cb) { chrome.storage.local.set({ searchEngines: eng }, cb); }

// Small settings stay in sync (so they follow the user across devices)
function saveBangChar(char, cb)     { chrome.storage.sync.set({ bangChar: char }, cb); }
function saveEnabled(val, cb)       { chrome.storage.sync.set({ enabled: val }, cb); }
function saveAiFeatures(partial, cb) {
  chrome.storage.sync.get(['aiFeatures'], (d) => {
    const prev = d.aiFeatures && typeof d.aiFeatures === 'object' ? d.aiFeatures : {};
    const merged = { ...DEFAULT_AI_FEATURES, ...prev, ...partial };
    chrome.storage.sync.set({ aiFeatures: merged }, cb);
  });
}

function isProUnlocked(license)     { return license && license.length > 6; }
function getActiveSiteCount(sites)  { return sites.filter(s => s.active).length; }

// Trial helpers
function isTrialActive(installDate) {
  if (!installDate) return false;
  return (Date.now() - installDate) < (TRIAL_DAYS * 24 * 60 * 60 * 1000);
}
function isPaidOrTrial(license, installDate) {
  return isProUnlocked(license) || isTrialActive(installDate);
}
function trialDaysRemaining(installDate) {
  if (!installDate) return 0;
  const elapsed = Math.floor((Date.now() - installDate) / (24 * 60 * 60 * 1000));
  return Math.max(0, TRIAL_DAYS - elapsed);
}

// ── Merge logic used by both defaults and remote Supabase sync ─────────────
//
// Priority order:
//   1. User-created custom sites → always kept untouched.
//   2. Built-in sites still on remote → URL/name updated, user's bang & active preserved.
//   3. Built-in sites removed from remote →
//        • if user had it ACTIVE  → kept as custom: true (prevents breakage).
//        • if user had it INACTIVE → dropped (reduces clutter).
//   4. Brand-new remote sites → added inactive (or with server's active flag on fresh install).
//
// IMPORTANT: For "removed from remote" preservation to work, localSites must be
// non-empty. If chrome.storage.local is empty (e.g. fresh install before first
// save), the caller should seed it with DEFAULT_SEARCH_ENGINES first.
function mergeSites(localSites, remoteSites) {
  const safeLocal = localSites || [];
  if (!remoteSites || !remoteSites.length) return safeLocal;

  const merged = [];
  const localMap = new Map(safeLocal.map(s => [s.id, s]));
  const claimedBangs = new Set();
  
  function getUniqueBang(baseBang) {
    if (!claimedBangs.has(baseBang)) {
      claimedBangs.add(baseBang);
      return baseBang;
    }
    // Conflict found! The user requested to leave new conflicting shortcuts blank
    // instead of appending numbers like yt2, yt3.
    return '';
  }

  // Helper: normalize category values from backend/user data.
  // Supports the canonical buckets used by the UI filters.
  function normalizeCategory(category) {
    const value = String(category || '').toLowerCase().trim();
    return (value === 'general' || value === 'dev' || value === 'design' || value === 'research')
      ? value
      : 'general';
  }
  const withCategory = s => ({ ...s, category: normalizeCategory(s.category) });

  // 1. Keep strictly custom, user-created sites untouched
  const pureCustom = safeLocal.filter(s => s.custom);
  for (const s of pureCustom) {
    merged.push(withCategory(s));
    claimedBangs.add(s.bang);
  }

  // 2. Process existing local built-in sites (both updated & soft-deleted)
  for (const ls of localMap.values()) {
    if (ls.custom) continue; // Already handled
    
    const rs = remoteSites.find(r => r.id === ls.id);
    if (rs) {
      // Still in remote config. Update URL/name/category from remote,
      // but keep user's bang & active state.
      const updatedSite = {
        ...rs,
        bang: ls.bang,
        active: ls.active,
        category: normalizeCategory(rs.category || ls.category),
      };
      merged.push(withCategory(updatedSite));
      claimedBangs.add(ls.bang);
    } else {
      // Removed from remote config.
      if (ls.active) {
        // User was using it. Save it as custom to prevent breakage.
        const keptSite = { ...ls, custom: true };
        merged.push(withCategory(keptSite));
        claimedBangs.add(ls.bang);
      }
    }
  }

  // Is this an empty slate? (fresh install or reset sync)
  const isFresh = (!localSites || localSites.length === 0);

  // 3. Process brand new remote sites that user doesn't have yet
  for (const rs of remoteSites) {
    if (!localMap.has(rs.id)) {
      // Brand new site! Resolve any bang collisions before adding as inactive
      const uniqueBang = getUniqueBang(rs.bang);
      // Wait, if it's a completely fresh install, we want to respect the server's default active toggles.
      // But if the user already has sites, new additions force false to prevent UI clutter.
      const fresh = {
        ...rs,
        bang: uniqueBang,
        active: isFresh ? !!rs.active : false,
        custom: false,
        category: normalizeCategory(rs.category),
      };
      merged.push(withCategory(fresh));
    }
  }

  return merged;
}
