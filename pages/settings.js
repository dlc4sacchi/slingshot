// ── State ─────────────────────────────────────────────────────────────────────
let bc = '!';
let isPro = false;
let isTrial = false;
let installDate = null;
let editingSiteId = null;
const SLINGSHOT_DEV_MODE = false;
const PREFERS_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pendingRowEnter = { ai: null, search: null };

function hasFullAccess() {
  if (!MONETIZATION_ENABLED) return true;
  return isPro || isTrial;
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag] || tag));
}

// ── Favicon helper ────────────────────────────────────────────────────────────
function faviconUrl(domain, size) {
  // gstatic only serves these exact sizes; snap to nearest valid one
  const valid = [16, 32, 64, 128, 256];
  const s = size || 64;
  const snapped = valid.reduce((a, b) => Math.abs(b - s) < Math.abs(a - s) ? b : a);
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=${snapped}`;
}

function domainFromSite(s) {
  if (s.match) return s.match;
  try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch(e) { return s.id; }
}

/** Rejects single-label junk like "feef" that still parses as a URL but is not a real web host. */
function hostnameLooksLikeWebAddress(hostname) {
  if (!hostname) return false;
  const h = hostname.toLowerCase();
  if (h === 'localhost') return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(h)) return true;
  return h.includes('.');
}

/** Accepts absolute or scheme-less URLs; returns normalized href or null. Only http/https. */
function parseHttpUrl(raw) {
  const t = (raw || '').trim();
  if (!t) return null;
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : 'https://' + t;
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    return u.href;
  } catch (_) {
    return null;
  }
}

/** Site or API URL for requests (no template placeholder required). */
function validateRequestSiteUrl(raw) {
  const href = parseHttpUrl(raw);
  if (!href) return { ok: false, message: 'Enter a valid website URL starting with https:// (or http://).' };
  try {
    const u = new URL(href);
    if (!hostnameLooksLikeWebAddress(u.hostname)) {
      return { ok: false, message: 'Use a real domain (e.g. https://example.com). Random words are not valid URLs.' };
    }
  } catch (_) {
    return { ok: false, message: 'Enter a valid website URL starting with https:// (or http://).' };
  }
  return { ok: true, href };
}

/** Search template or custom engine URL must include %s for the query. Preserves exact %s in returned value. */
function validateTemplateUrl(raw) {
  const t = (raw || '').trim();
  if (!t.includes('%s')) {
    return { ok: false, message: 'URL must include %s where the search query goes (e.g. …?q=%s).' };
  }
  const probe = t.split('%s').join('slingshotqsplaceholder');
  const probeHref = parseHttpUrl(probe);
  if (!probeHref) {
    return { ok: false, message: 'Enter a valid URL starting with https:// (or http://).' };
  }
  try {
    if (!hostnameLooksLikeWebAddress(new URL(probeHref).hostname)) {
      return { ok: false, message: 'Use a real domain in the URL (e.g. https://google.com/search?q=%s).' };
    }
  } catch (_) {
    return { ok: false, message: 'Enter a valid URL starting with https:// (or http://).' };
  }
  return { ok: true, value: t };
}

// ── URL inference helpers (non-AI) ─────────────────────────────────────────────
function inferTemplateUrl(rawUrl, exampleQuery) {
  if (!rawUrl) return null;
  let u;
  try {
    const toParse = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
    u = new URL(toParse);
  } catch (_) {
    return null;
  }

  const term = (exampleQuery || '').trim();
  const params = u.searchParams;
  let searchKey = null;

  if (term) {
    const normTerm = term.toLowerCase();
    for (const [key, val] of params.entries()) {
      const normVal = val.toLowerCase();
      if (normVal === normTerm || decodeURIComponent(val).toLowerCase() === normTerm) {
        searchKey = key;
        break;
      }
    }
  }

  const commonKeys = ['q', 'query', 'search', 'search_query'];
  if (!searchKey) {
    for (const key of commonKeys) {
      if (params.has(key)) {
        searchKey = key;
        break;
      }
    }
  }

  // 1) Standard query-param based search
  if (searchKey) {
    params.set(searchKey, '%s');

    const keep = new Set([searchKey, 'q', 'query', 'search', 'search_query', 't', 'sort', 'type', 'restrict_sr', 'src', 'hl']);
    const toDelete = [];
    for (const [key] of params.entries()) {
      if (!keep.has(key)) toDelete.push(key);
    }
    toDelete.forEach(k => params.delete(k));

    const path = u.pathname || '/';
    let search = params.toString();
    const encPctS = encodeURIComponent('%s'); // "%25s"
    if (search.includes(encPctS)) {
      search = search.replace(encPctS, '%s');
    }
    const base = u.origin + path.replace(/\/+$/, path === '/' ? '/' : '');
    return search ? `${base}?${search}` : base;
  }

  // 2) Hash-based search (e.g. Gmail: #search/term or #search=term)
  if (u.hash && u.hash.startsWith('#search')) {
    const after = u.hash.slice('#search'.length);
    let newHash = '#search/%s';
    if (after.startsWith('/')) {
      newHash = '#search/%s';
    } else if (after.startsWith('=')) {
      newHash = '#search=%s';
    }
    const path = u.pathname || '/';
    const base = u.origin + path.replace(/\/+$/, path === '/' ? '/' : '');
    return base + newHash;
  }

  // 3) Path-based search (e.g. Chrome Web Store: /search/term)
  const pathTokens = u.pathname.split('/').filter(Boolean);
  const searchIdx = pathTokens.indexOf('search');
  if (searchIdx !== -1 && pathTokens.length > searchIdx + 1) {
    pathTokens[searchIdx + 1] = '%s';
    const newPath = '/' + pathTokens.join('/');

    const keep = new Set(['q', 'query', 'search', 'search_query', 't', 'sort', 'type', 'restrict_sr', 'src', 'hl']);
    const toDelete = [];
    for (const [key] of params.entries()) {
      if (!keep.has(key)) toDelete.push(key);
    }
    toDelete.forEach(k => params.delete(k));

    let search = params.toString();
    const base = u.origin + newPath.replace(/\/+$/, newPath === '/' ? '/' : '');
    return search ? `${base}?${search}` : base;
  }

  // Could not infer
  return null;
}

function inferSiteName(u) {
  let host = u.hostname.replace(/^www\./, '');
  const parts = host.split('.');
  const baseRaw = parts[0] || host;
  const base = baseRaw.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const pathTokens = u.pathname.split('/').filter(Boolean);
  if (pathTokens[0] === 'r' && pathTokens[1]) {
    // Reddit-style paths: show subreddit name only, omit "search"
    return `${base} r/${pathTokens[1]}`;
  }
  // For all other sites, keep the site name only — "search" is implied
  return base;
}

function generateBangCandidates(u) {
  let host = u.hostname.replace(/^www\./, '');
  const hostKey = host.split('.')[0] || host;
  const site = hostKey.replace(/[^a-zA-Z]/g, '').toLowerCase();
  const pathTokens = u.pathname.split('/').filter(Boolean).map(p => p.toLowerCase());

  const cands = new Set();
  if (site) {
    if (site[0]) cands.add(site[0]);
    if (site.length >= 2) cands.add(site.slice(0, 2));
    cands.add(site);
  }

  if (pathTokens[0] === 'r' && pathTokens[1]) {
    const sub = pathTokens[1];
    if (sub.length >= 2) cands.add(sub.slice(0, 2));
    cands.add('r' + sub[0]);
    if (sub.length >= 2) cands.add('r' + sub.slice(0, 2));
  } else if (pathTokens.length) {
    const first = pathTokens[0].replace(/[^a-z0-9]/g, '');
    if (first) {
      if (first.length >= 2) cands.add(first.slice(0, 2));
      cands.add(first);
    }
  }

  const arr = Array.from(cands).filter(Boolean).map(v => v.toLowerCase());
  arr.sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
  return arr.slice(0, 5);
}

function inferFromUrl(rawUrl, exampleQuery) {
  const template = inferTemplateUrl(rawUrl, exampleQuery);
  if (!template) return { ok: false, error: 'We couldn\'t find which part of the URL is your search term. Try entering the exact term you searched for, or paste a different example URL.' };

  let u;
  try {
    const toParse = /^https?:\/\//i.test(template) ? template : 'https://' + template;
    u = new URL(toParse);
  } catch (_) {
    return { ok: false, error: 'Could not parse template URL.' };
  }

  const name = inferSiteName(u);
  const candidates = generateBangCandidates(u);
  const allSites = [...aiSites, ...searchEngines];
  const existing = new Set(allSites.map(s => s.bang));

  const available = [];
  const used = [];
  candidates.forEach(b => {
    if (existing.has(b)) used.push(b);
    else available.push(b);
  });

  const chosenBang = available[0] || '';
  return {
    ok: true,
    templateUrl: template,
    name,
    candidates,
    available,
    used,
    chosenBang,
  };
}

// Sites whose favicon has a dark background — give them a white pill so they
// show up properly in dark UI. Add any new dark-icon site id here.
const DARK_BG_SITES = new Set([
  'chatgpt','grok','deepseek','kimi','x','tiktok','dockerhub','wayback','aur','npm'
]);

// Gradient sets for custom / unknown sites
const CUSTOM_GRADIENTS = [
  ['#6c63ff','#9d97ff'], ['#059669','#34d399'], ['#dc2626','#f87171'],
  ['#d97706','#fbbf24'], ['#0078d4','#60a5fa'], ['#7c3aed','#a78bfa'],
];
let customGradIdx = 0;

function makeIconEl(s, size) {
  size = size || 30;
  const radius = size <= 18 ? '4px' : '8px';
  const wrap = document.createElement('div');
  const needsWhiteBg = DARK_BG_SITES.has(s.id);
  const pad = needsWhiteBg ? 3 : 0;
  const innerSize = size - pad * 2;
  const innerRadius = needsWhiteBg ? Math.max(parseInt(radius) - 2, 2) + 'px' : radius;
  wrap.style.cssText = `width:${size}px;height:${size}px;border-radius:${radius};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;background:${needsWhiteBg ? '#fff' : 'transparent'};box-shadow:inset 0 0 0 1px rgba(127,119,221,0.13)`;

  // Always try favicon first — works for both built-in and custom sites.
  const domain = domainFromSite(s);
  const img = document.createElement('img');
  // Request 128px for all sizes — sharp on retina, correct for 30px display
  img.style.cssText = `width:${innerSize}px;height:${innerSize}px;object-fit:cover;display:block;image-rendering:crisp-edges;border-radius:${innerRadius}`;
  img.src = faviconUrl(domain, 128);
  img.onerror = () => {
    img.remove();
    if (s.custom) {
      const g = CUSTOM_GRADIENTS[customGradIdx % CUSTOM_GRADIENTS.length];
      wrap.style.cssText = `width:${size}px;height:${size}px;border-radius:${radius};display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;background:linear-gradient(135deg,${g[0]},${g[1]})`;
      const letter = document.createElement('span');
      letter.style.cssText = `font-size:${Math.round(size*.44)}px;font-weight:700;color:#fff;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;line-height:1`;
      letter.textContent = s.name[0].toUpperCase();
      wrap.appendChild(letter);
    } else {
      wrap.style.background = 'var(--s3)';
      const letter = document.createElement('span');
      letter.style.cssText = `font-size:${Math.round(size*.44)}px;font-weight:700;color:var(--text2);font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;line-height:1`;
      letter.textContent = s.name[0].toUpperCase();
      wrap.appendChild(letter);
    }
  };
  wrap.appendChild(img);
  return wrap;
}

// Default site arrays (same as storage.js defaults — kept in sync)
let aiSites = [];
const expandedState = { ai: false, sr: false };
let searchEngines = [];
let currentSearchCategory = 'all';

// ── Supabase fetch helper (deduplicates auth headers) ────────────────────────
function supaFetch(path, opts = {}) {
  const headers = {
    'apikey': SUPABASE_CONFIG.ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_CONFIG.ANON_KEY}`,
    ...opts.headers,
  };
  return fetch(`${SUPABASE_CONFIG.URL}/rest/v1/${path}`, { ...opts, headers });
}

function dom(url){ try{return new URL(url).hostname.replace('www.','')}catch(e){return url} }
function activeAi(){ return aiSites.filter(s=>s.active).length }
function activeSr(){ return searchEngines.filter(s=>s.active).length }

// ── UI Helpers ────────────────────────────────────────────────────────────────
function updateTogglePill(containerId, pillClass) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const pill = container.querySelector('.' + pillClass);
  const activeBtn = container.querySelector('.on');
  if (!pill || !activeBtn) return;
  const c = container.getBoundingClientRect();
  const b = activeBtn.getBoundingClientRect();
  // Hidden sections (display:none) report 0×0 rects — do not overwrite pill or it collapses until remeasured.
  if (b.width < 1 || b.height < 1 || c.width < 1 || c.height < 1) return;
  const cs = getComputedStyle(container);
  const bl = parseFloat(cs.borderLeftWidth) || 0;
  const bt = parseFloat(cs.borderTopWidth) || 0;
  pill.style.width = b.width + 'px';
  pill.style.height = b.height + 'px';
  pill.style.left = b.left - c.left - bl + 'px';
  pill.style.top = b.top - c.top - bt + 'px';
}

function refreshAllSegmentPills() {
  updateTogglePill('themeSeg', 'type-pill');
  updateTogglePill('srCatSeg', 'type-pill');
  updateTogglePill('typeSeg', 'type-pill');
}

function markRowEnter(type, id) {
  pendingRowEnter[type] = id;
}

function takeRowEnter(type, id) {
  if (pendingRowEnter[type] !== id) return false;
  pendingRowEnter[type] = null;
  return true;
}

function getActiveRowsContainer(type) {
  return document.getElementById(type === 'ai' ? 'aiRows' : 'srRows');
}

function animateRowExit(type, id, done) {
  if (PREFERS_REDUCED_MOTION) {
    done();
    return;
  }
  const container = getActiveRowsContainer(type);
  const row = container?.querySelector(`.site-row[data-id="${id}"]`);
  if (!row) {
    done();
    return;
  }
  row.classList.add('exit');
  setTimeout(done, 170);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(id){
  if (id === 'pro' && !MONETIZATION_ENABLED) {
    id = 'search';
  }
  document.querySelectorAll('.page-section').forEach(p=>p.classList.remove('active'));
  const target = document.getElementById('page-'+id);
  if (target) {
    target.classList.add('active');
    target.classList.remove('section-enter');
    if (!PREFERS_REDUCED_MOTION) {
      requestAnimationFrame(() => target.classList.add('section-enter'));
    }
  }
  document.querySelectorAll('.nav-item').forEach(n=>{
    n.classList.toggle('active', n.dataset.page===id);
  });
  if(id==='how') startSlides();
  // Remeasure segmented pills after the new page is visible (avoids stale layout; complements updateTogglePill skip when hidden).
  setTimeout(() => refreshAllSegmentPills(), 10);
}
document.querySelectorAll('.nav-item[data-page]').forEach(item=>{
  item.addEventListener('click', ()=>showPage(item.dataset.page));
});

// ── Sync buttons (Search Engines, News, Requests) ────────────────────────────
function spinSync(btn, action) {
  if (!btn || btn.classList.contains('syncing')) return;
  btn.classList.add('syncing');
  const minSpin = new Promise(r => setTimeout(r, 600));
  Promise.all([action(), minSpin]).finally(() => btn.classList.remove('syncing'));
}

document.getElementById('syncBtn')?.addEventListener('click', function() {
  spinSync(this, () => new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, (res) => {
      if (res && res.success) {
        showBangConflictToast('Synced with server', '');
        getAllData(data => { searchEngines = data.searchEngines || []; renderAll(); });
      } else {
        showBangConflictToast('Sync failed', '');
      }
      resolve();
    });
  }));
});

document.getElementById('newsSyncBtn')?.addEventListener('click', function() {
  spinSync(this, () => loadNews().then(
    () => showBangConflictToast('News refreshed', ''),
    () => showBangConflictToast('Refresh failed', '')
  ));
});

document.getElementById('reqSyncBtn')?.addEventListener('click', function() {
  spinSync(this, () => loadRequests().then(
    () => showBangConflictToast('Requests refreshed', ''),
    () => showBangConflictToast('Refresh failed', '')
  ));
});

// Dev/Admin panel: hidden by default. Reveal by double-clicking the logo.
// (Prevents exposing the panel in production UI while keeping it available for debugging.)
(function setupAdminReveal() {
  if (!SLINGSHOT_DEV_MODE) return;
  const logo = document.querySelector('.sb-logo');
  const adminNav = document.querySelector('.admin-nav-item');
  const adminPage = document.getElementById('page-admin');
  if (!logo || !adminNav || !adminPage) return;

  function revealAdmin() {
    adminNav.style.display = '';
    adminPage.style.display = '';
    showPage('admin');
  }

  logo.addEventListener('dblclick', (e) => {
    // Avoid selecting text / other click handlers.
    e.preventDefault();
    e.stopPropagation();
    revealAdmin();
  });
})();

// ── Render ────────────────────────────────────────────────────────────────────
function getSiteCategory(s) {
  const c = String(s.category || '').toLowerCase().trim();
  return (c === 'general' || c === 'dev' || c === 'design' || c === 'research') ? c : 'general';
}

function renderRows(list, activeEl, inactiveEl){
  let toRender = list;
  const listType = activeEl.id === 'aiRows' ? 'ai' : 'search';
  if (listType === 'search' && currentSearchCategory !== 'all') {
    toRender = list.filter(s => getSiteCategory(s) === currentSearchCategory);
  }

  const active = toRender.filter(s=>s.active);
  const _rows = [];

  if(active.length === 0){
    const _empty = document.createElement('div');
    _empty.className = 'empty-row';
    _empty.textContent = 'no active sites — click below to activate';
    _rows.push(_empty);
  } else {
    active.forEach(s=>{
      const row = document.createElement('div');
      row.className = 'site-row';
      row.dataset.id = s.id;
      if (!PREFERS_REDUCED_MOTION && takeRowEnter(listType, s.id)) {
        row.classList.add('enter');
      }

      const info = document.createElement('div');
      info.className = 'site-info';
      info.innerHTML = `
        <div class="site-top">
          <span class="site-name">${escapeHTML(s.name)}</span>
          ${(s.custom && activeEl.id !== 'aiRows') ? '<span class="inact-badge" style="background:transparent; padding:0; border:none; color:var(--text3); font-size:8px;">CUSTOM</span>' : ''}
        </div>
        <div class="site-url">${escapeHTML(dom(s.url))}</div>`;

      // Bang pill as its own centered column
      const bangCol = document.createElement('div');
      bangCol.className = 'bang-col';
      bangCol.innerHTML = `
        <span class="bang-edit-wrap" title="Click to edit shortcut">
          <span class="bang-tag bang-display" data-id="${s.id}">${escapeHTML(bc)}${escapeHTML(s.bang)}</span>
          <input class="bang-edit-input" data-id="${s.id}" value="${escapeHTML(s.bang)}" style="display:none" maxlength="6" spellcheck="false" />
        </span>`;

      const actions = document.createElement('div');
      actions.className = 'site-actions';

      if(s.custom && activeEl.id !== 'aiRows'){
        const customAct = document.createElement('div');
        customAct.className = 'custom-actions';

        const edit = document.createElement('button');
        edit.className = 'edit-btn'; edit.dataset.edit = s.id; edit.title = 'Edit';
        edit.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        customAct.appendChild(edit);

        const del = document.createElement('button');
        del.className = 'del-btn'; del.dataset.del = s.id; del.title = 'Remove';
        del.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
        customAct.appendChild(del);

        row.appendChild(makeIconEl(s, 30));
        row.appendChild(info);
        row.appendChild(customAct);
        row.appendChild(bangCol);
      } else {
        row.appendChild(makeIconEl(s, 30));
        row.appendChild(info);
        row.appendChild(bangCol);
      }

      const tog = document.createElement('button');
      tog.className = 'tog on'; tog.dataset.tog = s.id;
      tog.innerHTML = '<div class="tog-k"></div>';
      actions.appendChild(tog);

      row.appendChild(actions);
      _rows.push(row);
    });
  }

  activeEl.replaceChildren(..._rows);
}

function updateInactiveExpansion(type) {
  const container = document.getElementById(type + 'InactiveContainer');
  const grid = document.getElementById(type + 'Inactive');
  if (!container || !grid) return;

  const isExpanded = expandedState[type];
  container.classList.toggle('expanded', isExpanded);

  const list = type === 'ai' ? aiSites : searchEngines;
  let source = list;
  if (type === 'sr' && currentSearchCategory !== 'all') {
    source = list.filter(s => getSiteCategory(s) === currentSearchCategory);
  }
  const inactive = source.filter(s => !s.active);

  // For Search category tabs:
  // - In non-All filters (general/dev/design/research), always show full list (no show more/less).
  // - In All, keep existing show more/less behavior.
  // Do NOT set expandedState.sr here — that would stick when switching back to All and wrongly
  // keep the inactive list expanded. Only toggle the container class for this view.
  if (type === 'sr' && currentSearchCategory !== 'all') {
    container.classList.add('expanded');
    renderInactiveGrid(grid, inactive, type);
    return;
  }

  renderInactiveGrid(grid, inactive, type);

  if (isExpanded) {
    const btn = document.createElement('button');
    btn.className = 'show-all-btn';
    btn.innerHTML = `Show less <svg viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>`;
    btn.onclick = () => { expandedState[type] = false; renderAll(); };
    grid.appendChild(btn);
    return;
  }

  if (grid.scrollHeight <= 105) return;

  // Batch-read all child positions in a single layout pass (avoids O(n) reflows)
  const children = Array.from(grid.children);
  const gridTop = grid.getBoundingClientRect().top;
  const bottoms = children.map(c => c.getBoundingClientRect().bottom - gridTop);

  // Find cutoff: leave ~30px headroom for the "N more" button
  let cutoff = 0;
  for (let i = 0; i < children.length; i++) {
    if (bottoms[i] <= 75) cutoff = i + 1;
  }
  if (cutoff < 1) cutoff = 1;

  let hiddenCount = children.length - cutoff;
  if (hiddenCount <= 0) return;

  const btn = document.createElement('button');
  btn.className = 'show-all-btn';
  btn.innerHTML = `${hiddenCount} more <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`;
  btn.onclick = () => { expandedState[type] = true; renderAll(); };

  grid.replaceChildren(...children.slice(0, cutoff), btn);

  // Single post-check: if button caused overflow, trim one more row
  if (grid.scrollHeight > 105 && cutoff > 1) {
    cutoff--;
    hiddenCount = children.length - cutoff;
    btn.innerHTML = `${hiddenCount} more <svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>`;
    grid.replaceChildren(...children.slice(0, cutoff), btn);
  }
}

function renderInactiveGrid(grid, inactive, type) {
  if (!inactive || inactive.length === 0) { grid.replaceChildren(); return; }
  const _gridW = grid.clientWidth || 612;
  const isAi = type === 'ai';
  const fullAccess = hasFullAccess();
  const activeCount = isAi ? activeAi() : activeSr();
  
  // Create and map nodes
  const items = inactive.map(s => {
    const btn = document.createElement('div');
    const atLimit = !fullAccess && activeCount >= FREE_LIMIT;
    btn.className = 'inact-btn' + (atLimit ? ' inact-locked' : '');
    btn.dataset.act = s.id;
    btn.appendChild(makeIconEl(s, 18));
    const lbl = document.createElement('span');
    lbl.className = 'inact-lbl'; lbl.textContent = s.name;
    btn.appendChild(lbl);
    if (s.custom && !isAi) {
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn'; editBtn.dataset.edit = s.id; editBtn.title = 'Edit'; editBtn.style.opacity = '1';
      editBtn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      btn.appendChild(editBtn);
    }
    if (atLimit) {
      const lock = document.createElement('span');
      lock.className = 'inact-lock';
      lock.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
      btn.appendChild(lock);
    }
    return { data: s, node: btn, width: 0, custom: !!s.custom };
  });

  // Measure widths off-screen to avoid visible DOM thrashing
  const _m = document.createElement('div');
  _m.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;display:flex;flex-wrap:wrap;gap:5px;width:'+_gridW+'px';
  document.body.appendChild(_m);
  items.forEach(v => _m.appendChild(v.node));
  items.forEach(v => v.width = v.node.offsetWidth + 5);
  document.body.removeChild(_m);

  const maxLineW = _gridW + 5;
  const customItems = items.filter(x => x.custom);
  const stdItems = items.filter(x => !x.custom);
  const packed = [];
  
  let currentRemaining = maxLineW;
  
  function packList(list) {
    while (list.length > 0) {
      if (currentRemaining === maxLineW || list[0].width <= currentRemaining) {
        const item = list.shift();
        packed.push(item);
        currentRemaining -= item.width;
      } else {
        // Greedy Look-Ahead: Find the largest item that fits
        let bestIdx = -1, bestW = -1;
        for (let i = 1; i < list.length; i++) {
          if (list[i].width <= currentRemaining && list[i].width > bestW) {
            bestW = list[i].width;
            bestIdx = i;
          }
        }
        if (bestIdx !== -1) {
          packed.push(list.splice(bestIdx, 1)[0]);
          currentRemaining -= bestW;
        } else {
          currentRemaining = maxLineW; // Start tracking next row space
        }
      }
    }
  }
  
  packList(customItems);
  // Continue packing standard items into any remaining space on the last custom row
  packList(stdItems);
  
  grid.replaceChildren(...packed.map(v => v.node));
}

function renderAll(){
  renderRows(aiSites, document.getElementById('aiRows'), document.getElementById('aiInactive'));
  renderRows(searchEngines, document.getElementById('srRows'), document.getElementById('srInactive'));
  
  updateInactiveExpansion('ai');
  updateInactiveExpansion('sr');
  document.getElementById('aiCount').textContent = activeAi();
  document.getElementById('srCount').textContent = activeSr();
  const activeAiCount = activeAi();
  const aiFire = document.getElementById('aiFire');
  if (activeAiCount === 0) {
    aiFire.textContent = 'no active sites';
    aiFire.style.color = 'var(--red)';
    aiFire.style.background = 'var(--red-bg)';
    aiFire.style.borderColor = 'var(--red-bd)';
  } else {
    aiFire.textContent = bc+'ai fires all';
    aiFire.style.color = '';
    aiFire.style.background = '';
    aiFire.style.borderColor = '';
  }
  document.getElementById('srFire').textContent = bc+'all → fires all';
  document.getElementById('aiAllCode').textContent = bc+'ai';
  document.getElementById('srAllCode').textContent = bc+'all';
  if (document.getElementById('aiBangSym')) document.getElementById('aiBangSym').textContent = bc;
  document.getElementById('srBangSym').textContent = bc;
  document.getElementById('charExample').textContent = bc+'ai';
  const planChip = document.getElementById('planChip');
  const planTag = document.getElementById('planTag');
  const proHero = document.getElementById('proHero');
  const proKeySection = document.getElementById('proKeySection');
  const proKeyHeader = document.getElementById('proKeyHeader');
  const proUnlocked = document.getElementById('proUnlocked');
  const navProPlan = document.getElementById('navProPlan');
  const pageProSection = document.getElementById('page-pro');

  const showPro = d => { if (d) d.style.display = ''; };
  const hidePro = d => { if (d) d.style.display = 'none'; };

  if (!MONETIZATION_ENABLED) {
    hidePro(planChip); hidePro(proHero); hidePro(proKeySection); hidePro(proKeyHeader); hidePro(proUnlocked);
    hidePro(navProPlan); hidePro(pageProSection);
  } else if (isPro) {
    showPro(planChip); planTag.textContent = 'Pro ✦'; planTag.className = 'plan-tag pro';
    hidePro(proHero); hidePro(proKeySection); hidePro(proKeyHeader);
    showPro(navProPlan); showPro(pageProSection);
    if (proUnlocked) proUnlocked.style.display = 'flex';
  } else if (!isTrial) {
    // State 2: Trial expired — show Free UI and upgrade prompts
    showPro(planChip); planTag.textContent = 'Free'; planTag.className = 'plan-tag';
    showPro(proHero); showPro(proKeySection); showPro(proKeyHeader);
    showPro(navProPlan); showPro(pageProSection);
    if (proUnlocked) proUnlocked.style.display = 'none';
  } else {
    // State 1: 30-Day Trial — hide everything plan-related
    hidePro(planChip); hidePro(proHero);
    hidePro(proKeySection); hidePro(proKeyHeader); hidePro(proUnlocked);
    hidePro(navProPlan); hidePro(pageProSection);
  }
  document.querySelectorAll('.char-btn').forEach(b=>b.classList.toggle('on', b.dataset.char===bc));
  updateStorageBar();
  // Update keyboard shortcut pill on Shortcuts page
  if (chrome.commands) {
    chrome.commands.getAll(cmds => {
      const pill = document.getElementById('kbShortcutPill');
      if (!pill) return;
      const withShortcut = cmds.find(c => c.shortcut && c.shortcut.trim() !== '');
      pill.textContent = withShortcut ? withShortcut.shortcut : 'Alt+Shift+B';
    });
  }
  requestAnimationFrame(() => refreshAllSegmentPills());
}

function applyStorageBarUsed(used, fill, label, quota) {
  const pct = Math.min((used / quota) * 100, 100);
  fill.style.width = pct.toFixed(1) + '%';
  fill.className = 'storage-bar-fill' + (pct > 80 ? ' danger' : pct > 55 ? ' warn' : '');
  const usedKb = (used / 1024).toFixed(1);
  const totalKb = (quota / 1024).toFixed(0);
  label.textContent = usedKb + ' / ' + totalKb + ' KB';
}

function estimateLocalStorageBytes(data) {
  let n = 0;
  for (const k of Object.keys(data || {})) {
    n += k.length + JSON.stringify(data[k]).length;
  }
  return n;
}

function updateStorageBar() {
  const fill  = document.getElementById('storageBarFill');
  const label = document.getElementById('storageUsedLabel');
  if (!fill || !label) return;
  // chrome.storage.local quota is 5MB (5,242,880 bytes)
  const QUOTA = 5 * 1024 * 1024;
  const local = chrome.storage.local;
  function fallbackFromGetAll() {
    local.get(null, (data) => {
      if (chrome.runtime.lastError) return;
      applyStorageBarUsed(estimateLocalStorageBytes(data), fill, label, QUOTA);
    });
  }
  if (typeof local.getBytesInUse === 'function') {
    local.getBytesInUse(null, (used) => {
      if (chrome.runtime.lastError) {
        fallbackFromGetAll();
        return;
      }
      applyStorageBarUsed(used, fill, label, QUOTA);
    });
  } else {
    fallbackFromGetAll();
  }
}

// ── Interactions ──────────────────────────────────────────────────────────────
document.getElementById('aiRows').addEventListener('click', e=>{
  const tog = e.target.closest('[data-tog]');
  const del = e.target.closest('[data-del]');
  const edit = e.target.closest('[data-edit]');
  if(tog){ toggleSite('ai', tog.dataset.tog); }
  if(del){ aiSites=aiSites.filter(s=>s.id!==del.dataset.del); save(); renderAll(); }
  if(edit){ startEdit(edit.dataset.edit, 'ai'); }
});
document.getElementById('aiInactive').addEventListener('click', e=>{
  const edit = e.target.closest('[data-edit]');
  if(edit){ startEdit(edit.dataset.edit, 'ai'); return; }
  const btn = e.target.closest('[data-act]');
  if(!btn) return;
  const fullAccess = hasFullAccess();
  if(!fullAccess && activeAi()>=FREE_LIMIT){
    showBangConflictToast('Free plan · max 2 active AI sites', 'upgrade');
    return;
  }
  activateFromInactive('ai', btn.dataset.act);
});
document.getElementById('srRows').addEventListener('click', e=>{
  const tog = e.target.closest('[data-tog]');
  const del = e.target.closest('[data-del]');
  const edit = e.target.closest('[data-edit]');
  if(tog){ toggleSite('search', tog.dataset.tog); }
  if(del){ searchEngines=searchEngines.filter(s=>s.id!==del.dataset.del); save(); renderAll(); }
  if(edit){ startEdit(edit.dataset.edit, 'search'); }
});
document.getElementById('srInactive').addEventListener('click', e=>{
  const edit = e.target.closest('[data-edit]');
  if(edit){ startEdit(edit.dataset.edit, 'search'); return; }
  const btn = e.target.closest('[data-act]');
  if(!btn) return;
  const fullAccess = hasFullAccess();
  if(!fullAccess && activeSr()>=FREE_LIMIT){
    showBangConflictToast('Free plan · max 2 active search engines', 'upgrade');
    return;
  }
  activateFromInactive('search', btn.dataset.act);
});

function toggleSite(type, id){
  const fullAccess = hasFullAccess();
  if(type==='ai'){
    const site = aiSites.find(s=>s.id===id);
    if(site && !site.active && !fullAccess && activeAi()>=FREE_LIMIT){
      showBangConflictToast('Free plan · max 2 active AI sites', 'upgrade');
      return;
    }
    if (site && site.active) {
      animateRowExit(type, id, () => {
        aiSites = aiSites.map(s=>s.id===id?{...s,active:false}:s);
        save(); renderAll();
      });
      return;
    }
    markRowEnter(type, id);
    aiSites = aiSites.map(s=>s.id===id?{...s,active:true}:s);
  } else {
    const site = searchEngines.find(s=>s.id===id);
    if(site && !site.active && !fullAccess && activeSr()>=FREE_LIMIT){
      showBangConflictToast('Free plan · max 2 active search engines', 'upgrade');
      return;
    }
    if (site && site.active) {
      animateRowExit(type, id, () => {
        searchEngines = searchEngines.map(s=>s.id===id?{...s,active:false}:s);
        save(); renderAll();
      });
      return;
    }
    markRowEnter(type, id);
    searchEngines = searchEngines.map(s=>s.id===id?{...s,active:true}:s);
  }
  save(); renderAll();
}

function activateFromInactive(type, id) {
  markRowEnter(type, id);
  if (type === 'ai') {
    aiSites = aiSites.map(s=>s.id===id?{...s,active:true}:s);
  } else {
    searchEngines = searchEngines.map(s=>s.id===id?{...s,active:true}:s);
  }
  save();
  renderAll();
}

function startEdit(id, type) {
  const isAi = (type === 'ai');
  const list = isAi ? aiSites : searchEngines;
  const site = list.find(s => s.id === id);
  if (!site) return;

  editingSiteId = id;

  document.getElementById(isAi ? 'aiName' : 'srName').value = site.name;
  document.getElementById(isAi ? 'aiBang' : 'srBang').value = site.bang;
  document.getElementById(isAi ? 'aiUrl' : 'srUrl').value = site.url;

  const wrap = document.getElementById(isAi ? 'aiName' : 'srName').closest('.custom-wrap');
  const titleEl = wrap.querySelector('.custom-title');
  titleEl.innerHTML = `Editing <span>${escapeHTML(site.name)}</span>`;

  const addBtn = document.getElementById(isAi ? 'aiAddBtn' : 'srAddBtn');
  addBtn.textContent = 'Update';

  const cancelLink = document.createElement('button');
  cancelLink.className = 'cancel-edit-link';
  cancelLink.textContent = 'cancel';
  cancelLink.addEventListener('click', () => resetEditForm(isAi));
  titleEl.appendChild(cancelLink);

  const deleteLink = document.createElement('button');
  deleteLink.className = 'cancel-edit-link';
  deleteLink.textContent = 'delete';
  deleteLink.style.color = 'var(--red)';
  deleteLink.addEventListener('click', () => {
    if (isAi) aiSites = aiSites.filter(s => s.id !== id);
    else searchEngines = searchEngines.filter(s => s.id !== id);
    resetEditForm(isAi);
    save(); renderAll();
  });
  titleEl.appendChild(deleteLink);

  wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetEditForm(isAi) {
  editingSiteId = null;
  document.getElementById(isAi ? 'aiName' : 'srName').value = '';
  document.getElementById(isAi ? 'aiBang' : 'srBang').value = '';
  document.getElementById(isAi ? 'aiUrl' : 'srUrl').value = '';

  const wrap = document.getElementById(isAi ? 'aiName' : 'srName').closest('.custom-wrap');
  if (isAi) {
     wrap.querySelector('.custom-title').innerHTML = `Custom AI site <span class="warn-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span class="warn-tip">only works if the AI site accepts a search query via URL (use %s for the query)</span></span>`;
  } else {
     wrap.querySelector('.custom-title').innerHTML = `Custom search engine`;
  }

  const addBtn = document.getElementById(isAi ? 'aiAddBtn' : 'srAddBtn');
  addBtn.textContent = '+ Add';
}

document.getElementById('srAddBtn').addEventListener('click', ()=>addCustom('search'));
function addCustom(type){
  const isAi = type==='ai';
  const name = document.getElementById(isAi?'aiName':'srName').value.trim();
  const rawBang = document.getElementById(isAi?'aiBang':'srBang').value.trim().replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
  const url  = document.getElementById(isAi?'aiUrl':'srUrl').value.trim();
  if(!name||!url) return;

  let urlToSave = url;
  if (!isAi) {
    const tv = validateTemplateUrl(url);
    if (!tv.ok) {
      showBangConflictToast(tv.message, '');
      return;
    }
    urlToSave = tv.value;
  } else {
    const aiEl = document.getElementById('aiUrl');
    if (aiEl) {
      const tv = validateTemplateUrl(url);
      if (!tv.ok) {
        showBangConflictToast(tv.message, '');
        return;
      }
      urlToSave = tv.value;
    }
  }

  const allSites = [...aiSites, ...searchEngines];

  // Check bang collision across both lists
  if(rawBang){
    const bangConflict = allSites.find(s => s.id !== editingSiteId && s.bang === rawBang);
    if(bangConflict){
      showBangConflictToast(bangConflict.name, bc + rawBang);
      return;
    }
  }

  if (editingSiteId) {
    const targetList = isAi ? aiSites : searchEngines;
    const idx = targetList.findIndex(s => s.id === editingSiteId);
    if (idx > -1) {
      targetList[idx] = { ...targetList[idx], name, bang: rawBang || editingSiteId.slice(-4), url: urlToSave };
    }
    resetEditForm(isAi);
  } else {
    const id = 'custom_'+Date.now();
    const assignedBang = rawBang || id.slice(-4);
    const fullAccess = hasFullAccess();
    const currentActive = isAi ? activeAi() : activeSr();
    const shouldBeActive = fullAccess || currentActive < FREE_LIMIT;
    const newSite = {id,name,bang:assignedBang,url:urlToSave,active:shouldBeActive,custom:true};
    if(isAi) aiSites.push(newSite); else searchEngines.push(newSite);
    if (!shouldBeActive) showBangConflictToast('Free plan · added as inactive (max 2 active)', 'upgrade');
    resetEditForm(isAi);
  }
  save(); renderAll();
}

// ── Search engine category filter (All / General / Dev / Design / Research) ─────
const srCatSeg = document.getElementById('srCatSeg');
if (srCatSeg) {
  srCatSeg.addEventListener('click', e => {
    const btn = e.target.closest('.type-seg-btn');
    if (!btn) return;
    srCatSeg.querySelectorAll('.type-seg-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    currentSearchCategory = btn.dataset.val || 'all';
    updateTogglePill('srCatSeg', 'type-pill');
    renderAll();
  });
}

document.getElementById('charGrid').addEventListener('click', e=>{
  const btn = e.target.closest('.char-btn');
  if(!btn) return;
  bc = btn.dataset.char;
  saveBangChar(bc, ()=>{});
  renderAll();
});

const activateBtn = document.getElementById('activateBtn');
if (activateBtn && MONETIZATION_ENABLED) {
  activateBtn.addEventListener('click', ()=>{
    const key = document.getElementById('licenseInput').value.trim();
    if(key.length>6){
      isPro=true;
      chrome.storage.sync.set({ license: key });
      document.getElementById('proKeySection').style.display='none';
      document.getElementById('proKeyHeader').style.display='none';
      document.getElementById('proUnlocked').style.display='flex';
      renderAll();
    }
  });
}

// ── Slides ────────────────────────────────────────────────────────────────────
// ── How it works animations ───────────────────────────────────────────────────
const HDelay = ms => new Promise(r => setTimeout(r, ms));

const HL = {
  claude:`<svg width="10" height="10" viewBox="0 0 24 24"><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-1.485-.097L.831 12.56l-.538-.782.317-.952 1.076-.488 1.418.049 1.905.121 2.218.17 1.565.097h.706l.024-.048-.073-.146-1.198-2.023-1.369-2.27-1.004-1.735-.426-.854-.194-.805.354-.926.633-.537.974.012.901.427 1.052 1.686 1.393 2.258 1.369 2.27.706 1.198.097.17.048.012.024-.036V7.434l.012-2.404-.024-1.906.12-1.564.306-1.224L13.495.28l.988-.28.902.61.34 1.016-.049 1.614-.194 2.37-.073 1.613v2.136l.012.11.048.012 1.15-1.444 1.686-2.002 1.174-1.297 1.004-.927.974-.61 1.078.22.633.756-.074 1.04-.706.829-1.393 1.468-1.515 1.784-1.15 1.467-.962 1.32.012.073.11.024h.17l2.146-.413 2.024-.243 1.491.097.877.756.146 1.066-.658.951-1.163.366-2.17-.012-1.906-.146h-.779l-.036.06.073.11 1.04 1.224 1.808 1.965.853 1.126.415.951-.12 1.004-.768.61-1.15-.146-.853-.634-1.637-1.93-1.223-1.467-.974-1.15-.085-.024-.024.06-.254 2.39-.267 1.76-.329 1.127-.706.78-.974.316-.877-.463-.487-.999.17-1.345.487-2.002.39-1.833.17-.938v-.17l-.048-.024-.098.073-1.685.986-2.732 1.589-1.906.975-1.54.523-1.004-.268z" fill="#cc785c"/></svg>`,
  google:`<svg width="10" height="10" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
  gemini:`<svg width="10" height="10" viewBox="0 0 24 24"><defs><linearGradient id="hgg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#4285F4"/><stop offset="50%" stop-color="#9B72CB"/><stop offset="100%" stop-color="#EA4335"/></linearGradient></defs><path d="M12 2C12 2 14.5 8.5 18 10c-3.5 1.5-6 8-6 8s-2.5-6.5-6-8c3.5-1.5 6-8 6-8z" fill="url(#hgg)"/></svg>`,
  youtube:`<svg width="10" height="10" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#FF0000"/><polygon points="7,5 14,9 7,13" fill="white"/></svg>`,
  reddit:`<svg width="10" height="10" viewBox="0 0 20 20"><circle cx="10" cy="10" r="10" fill="#FF4500"/><circle cx="10" cy="9.5" r="4.5" fill="none" stroke="white" stroke-width="1.4"/><circle cx="7.8" cy="8.5" r=".9" fill="white"/><circle cx="12.2" cy="8.5" r=".9" fill="white"/><path d="M7.5 11.5 Q10 13 12.5 11.5" stroke="white" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`,
  spotify:`<svg width="10" height="10" viewBox="0 0 18 18"><circle cx="9" cy="9" r="9" fill="#1DB954"/><path d="M5 7.2c2.5-1 5.8-.8 7.8.6M5.5 9c2.2-.8 5-.6 7 .8M6 10.8c1.8-.6 4-.5 5.5.6" stroke="black" stroke-width="1.2" stroke-linecap="round" fill="none"/></svg>`,
  amazon:`<svg width="10" height="10" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#FF9900"/><text x="4" y="13" font-size="10" font-weight="bold" fill="#000" font-family="sans-serif">a</text><path d="M3 13.5 Q9 16 15 13.5" stroke="#000" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`,
  github:`<svg width="10" height="10" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#24292e"/><path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" fill="white"/></svg>`,
  perplexity:`<svg width="10" height="10" viewBox="0 0 20 20"><rect width="20" height="20" rx="5" fill="#20b2aa"/><path d="M10 3v14M5 7l5-4 5 4M5 13l5 4 5-4" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  facebook:`<svg width="10" height="10" viewBox="0 0 24 24" fill="#1877f2"><path d="M24 12.073C24 5.404 18.627 0 12 0S0 5.404 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.791-4.697 4.533-4.697 1.313 0 2.686.235 2.686.235v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.271h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>`,
  drive:`<svg width="10" height="10" viewBox="0 0 87.3 78"><path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="M43.65 25L29.9 1.2C28.55.4 27 0 25.45 0c-1.55 0-3.1.4-4.5 1.2L6.6 25z" fill="#00ac47"/><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.1 9.65z" fill="#ea4335"/><path d="M43.65 25L57.4 1.2C56 .4 54.45 0 52.9 0H34.4c-1.55 0-3.1.4-4.5 1.2z" fill="#00832d"/><path d="M59.8 53H27.5L13.75 76.8c1.4.8 2.95 1.2 4.5 1.2h50.8c1.55 0 3.1-.4 4.5-1.2z" fill="#2684fc"/></svg>`,
};

function hSS(pre, n, tot){ for(let i=0;i<tot;i++) document.getElementById(pre+i).className='hw-step'+(i<=n?' on':''); }
function hGo(tid, i){ document.getElementById(tid).style.transform=`translateX(-${i*100}%)`; }
async function hType(el, txt, spd){ for(const c of txt){ el.textContent+=c; await HDelay(spd); } }
async function hStream(el, txt){
  if(!el) return;
  for(const c of txt){ el.textContent+=c; await HDelay(14); }
  el.innerHTML+='<span class="how-aicur"></span>';
}

function hChat(q,logo,title){
  const id='ha'+Math.random().toString(36).slice(2);
  return `<div class="how-shdr">${logo}<span class="how-stitle">${title}</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-chatp"><div class="how-bu">${q}</div><div class="how-ba" id="${id}"></div></div></div>`;
}
function hGoog(q,urls){
  return `<div class="how-shdr">${HL.google}<span class="how-stitle">Google</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-googp">${urls.map(u=>`<div class="how-gi"><div class="how-gurl">${u}</div><div class="how-gbar" style="width:${74+Math.random()*16|0}%"></div><div class="how-gsnip" style="width:${80+Math.random()*14|0}%"></div></div>`).join('')}</div></div>`;
}
function hYt(q){
  const bg=['135deg,var(--s3),var(--bg)','135deg,var(--bg),var(--s3)','135deg,var(--s2),var(--s3)','135deg,var(--s3),var(--s2)','135deg,var(--bg),var(--s2)','135deg,var(--s2),var(--bg)'];
  const dur=['3:24','6:17','1:58','9:03','4:45','11:32'];
  return `<div class="how-shdr">${HL.youtube}<span class="how-stitle">YouTube</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-ytp">${bg.map((b,i)=>`<div class="how-ytc"><div class="how-ytth" style="background:linear-gradient(${b})"><div class="how-ytpb"><svg viewBox="0 0 6 6" width="6" height="6"><polygon points="1,0 6,3 1,6" fill="rgba(255,255,255,0.5)"/></svg></div><div class="how-ytdur">${dur[i]}</div></div><div class="how-ytbl" style="width:${76+i*3}%"></div><div class="how-ytbl s"></div></div>`).join('')}</div></div>`;
}
function hRed(q){
  return `<div class="how-shdr">${HL.reddit}<span class="how-stitle">Reddit</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-redp">${['2.4k','891','3.1k'].map((c,i)=>`<div class="how-rpost"><div class="how-rv"><div class="how-aru"></div><div class="how-rvc">${c}</div><div class="how-ard"></div></div><div class="how-ri"><div class="how-rbar" style="width:${82+i*4}%"></div><div class="how-rbar s"></div><div class="how-rmeta">r/topic${i+1} · ${10+i*9}c</div></div></div>`).join('')}</div></div>`;
}
function hSp(q){
  const bg=['135deg,var(--s3),var(--bg)','135deg,var(--bg),var(--s3)','135deg,var(--s2),var(--s3)','135deg,var(--s3),var(--s2)','135deg,var(--bg),var(--s2)','135deg,var(--s2),var(--bg)','135deg,var(--s3),var(--s2)','135deg,var(--bg),var(--s3)'];
  return `<div class="how-shdr">${HL.spotify}<span class="how-stitle">Spotify</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-spp">${bg.map(b=>`<div class="how-spc"><div class="how-spco" style="background:linear-gradient(${b})"></div><div class="how-spbl"></div><div class="how-spbl s"></div></div>`).join('')}</div></div>`;
}
function hAz(q){
  const pr=['$24.99','$49.00','$18.50'];
  const st=[[1,1,1,1,0],[1,1,1,1,1],[1,1,1,0,0]];
  const bg=['135deg,var(--s3),var(--bg)','135deg,var(--bg),var(--s3)','135deg,var(--s2),var(--s3)'];
  return `<div class="how-shdr">${HL.amazon}<span class="how-stitle">Amazon</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-azp">${pr.map((p,i)=>`<div class="how-azc"><div class="how-azimg" style="background:linear-gradient(${bg[i]})"></div><div class="how-azin"><div class="how-azb" style="width:86%"></div><div class="how-azb s"></div><div class="how-azst">${st[i].map(s=>`<div class="how-st${s?'':' h'}"></div>`).join('')}</div><div class="how-azpr">${p}</div></div></div>`).join('')}</div></div>`;
}
function hGh(q){
  return `<div class="how-shdr">${HL.github}<span class="how-stitle">GitHub</span><div class="how-spill">${q}</div></div><div class="how-sbody"><div class="how-ghp">${['12.4k','8.9k','21k'].map((s,i)=>`<div class="how-rpost"><div class="how-rv"><div style="font-size:7px;color:var(--amber)">&#9733;${s}</div></div><div class="how-ri"><div class="how-rbar" style="width:${78+i*5}%"></div><div class="how-rbar s"></div><div class="how-rmeta">Updated ${i+1}d ago</div></div></div>`).join('')}</div></div>`;
}

// ── Scene 1 ────────────────────────────────────────────────────────────────
const HP1=[
  {q:'best pizza in warsaw',    bang:'!cl',url:'claude.ai/new?q=best+pizza',      logo:HL.claude,  title:'Claude',  reply:'Top spots in Warsaw: Biesiadowo on Nowy Swiat is legendary for sourdough crust. Gruby Benek in Praga is a local favourite...'},
  {q:'explain black holes',     bang:'!g', url:'gemini.google.com/app?q=explain+black+holes', logo:HL.gemini, title:'Gemini', reply:'A black hole is a region where gravity is so extreme nothing, not even light, can escape. They form when massive stars collapse...'},
  {q:'write a poem about rain', bang:'!cl',url:'claude.ai/new?q=write+a+poem',   logo:HL.claude,  title:'Claude',  reply:'The rain falls soft on cobblestone, a rhythm old as time alone. Each drop a word the sky has said to thirsty roots...'},
];
let h1i=0;
async function runH1(){
  while(true){
    const c=HP1[h1i%HP1.length]; h1i++;
    const u=document.getElementById('h1u'), cur=document.getElementById('h1cur');
    const blank=document.getElementById('h1blank'), chat=document.getElementById('h1chat');
    u.textContent=''; u.innerHTML='';
    cur.style.display='inline-block';
    blank.style.opacity='1'; blank.style.transition='none';
    chat.style.opacity='0'; chat.style.transition='none'; chat.innerHTML='';
    hSS('h1_',0,5);
    await HDelay(420);
    await hType(u, c.q, 43);
    await HDelay(500);
    hSS('h1_',1,5);
    for(const ch of ' '+c.bang){ u.textContent+=ch; await HDelay(75); }
    const full=u.textContent, bi=full.lastIndexOf(c.bang);
    u.innerHTML=`<span style="color:var(--text2)">${full.slice(0,bi)}</span><span style="color:var(--t);font-weight:700">${full.slice(bi)}</span>`;
    await HDelay(450);
    hSS('h1_',2,5);
    cur.style.display='none';
    u.innerHTML=`<span style="color:var(--text3)">loading</span><span class="how-spin"></span>`;
    await HDelay(880);
    hSS('h1_',3,5);
    u.innerHTML=`<span style="color:var(--text)">${c.url}</span>`;
    chat.innerHTML=hChat(c.q,c.logo,c.title);
    await HDelay(30);
    blank.style.transition='opacity .3s'; blank.style.opacity='0';
    chat.style.transition='opacity .3s'; chat.style.opacity='1';
    await HDelay(380);
    hSS('h1_',4,5);
    const air=chat.querySelector('[id^="ha"]');
    await hStream(air, c.reply);
    await HDelay(2000);
  }
}

// ── Scene 2 ────────────────────────────────────────────────────────────────
const HP2=[
  {q:'lofi hip hop mix',        bang:'!yt',url:'youtube.com/results?q=lofi+hip+hop', build:el=>{el.innerHTML=hYt('lofi hip hop mix');}},
  {q:'tame impala currents',    bang:'!sp',url:'open.spotify.com/search/tame+impala', build:el=>{el.innerHTML=hSp('tame impala currents');}},
  {q:'mechanical keyboard tkl', bang:'!az',url:'amazon.com/s?k=mechanical+keyboard', build:el=>{el.innerHTML=hAz('mechanical keyboard');}},
  {q:'sourdough starter tips',  bang:'!r', url:'reddit.com/search?q=sourdough+starter', build:el=>{el.innerHTML=hRed('sourdough starter');}},
];
let h2i=0;
async function runH2(){
  while(true){
    const c=HP2[h2i%HP2.length]; h2i++;
    const u=document.getElementById('h2u'), cur=document.getElementById('h2cur');
    const blank=document.getElementById('h2blank'), res=document.getElementById('h2res');
    u.textContent=''; u.innerHTML='';
    cur.style.display='inline-block';
    blank.style.opacity='1'; blank.style.transition='none';
    res.style.opacity='0'; res.style.transition='none'; res.innerHTML='';
    hSS('h2_',0,4);
    await HDelay(420);
    await hType(u, c.q, 43);
    await HDelay(500);
    hSS('h2_',1,4);
    for(const ch of ' '+c.bang){ u.textContent+=ch; await HDelay(75); }
    const full=u.textContent, bi=full.lastIndexOf(c.bang);
    u.innerHTML=`<span style="color:var(--text2)">${full.slice(0,bi)}</span><span style="color:var(--t);font-weight:700">${full.slice(bi)}</span>`;
    await HDelay(450);
    hSS('h2_',2,4);
    cur.style.display='none';
    u.innerHTML=`<span style="color:var(--text3)">loading</span><span class="how-spin"></span>`;
    await HDelay(880);
    hSS('h2_',3,4);
    u.innerHTML=`<span style="color:var(--text)">${c.url}</span>`;
    c.build(res);
    await HDelay(30);
    blank.style.transition='opacity .3s'; blank.style.opacity='0';
    res.style.transition='opacity .3s'; res.style.opacity='1';
    await HDelay(3000);
  }
}

// ── Scene 3 ────────────────────────────────────────────────────────────────
const HP3=[
  {
    q:'sourdough bread recipe',
    bangs:[
      {sym:'!cl',label:'Claude',    logo:HL.claude,     url:'claude.ai/new?q=sourdough',   build:el=>{el.innerHTML=hChat('sourdough bread recipe',HL.claude,'Claude');},   isChat:true, reply:'Start with 100g active starter, 400g bread flour, 300g water, 10g salt. Autolyse 30 min, fold every 30 min for 3h, cold proof overnight...'},
      {sym:'!gg',label:'Google',    logo:HL.google,     url:'google.com/search?q=sourdough', build:el=>{el.innerHTML=hGoog('sourdough bread recipe',['kingarthurbaking.com','theperfectloaf.com','seriouseats.com']);}},
      {sym:'!yt',label:'YouTube',   logo:HL.youtube,    url:'youtube.com/results?q=sourdough', build:el=>{el.innerHTML=hYt('sourdough bread recipe');}},
    ]
  },
  {
    q:'best mechanical keyboards',
    bangs:[
      {sym:'!az',label:'Amazon',    logo:HL.amazon,     url:'amazon.com/s?k=mechanical+kb', build:el=>{el.innerHTML=hAz('mechanical keyboard');}},
      {sym:'!r', label:'Reddit',    logo:HL.reddit,     url:'reddit.com/search?q=mech+kb', build:el=>{el.innerHTML=hRed('best mechanical keyboards');}},
      {sym:'!gg',label:'Google',    logo:HL.google,     url:'google.com/search?q=mech+kb', build:el=>{el.innerHTML=hGoog('best mechanical keyboards',['rtings.com','switchandclick.com','mechanicalkeyboards.com']);}},
    ]
  },
  {
    q:'rust programming language',
    bangs:[
      {sym:'!gh',label:'GitHub',    logo:HL.github,      url:'github.com/search?q=rust', build:el=>{el.innerHTML=hGh('rust programming language');}},
      {sym:'!px',label:'Perplexity',logo:HL.perplexity,  url:'perplexity.ai/?q=rust+lang', build:el=>{el.innerHTML=hChat('rust programming language',HL.perplexity,'Perplexity');}, isChat:true, reply:'Rust is a systems language focused on memory safety without garbage collection. Start with the Rust Book at doc.rust-lang.org...'},
      {sym:'!yt',label:'YouTube',   logo:HL.youtube,     url:'youtube.com/results?q=rust', build:el=>{el.innerHTML=hYt('rust programming tutorial');}},
    ]
  },
];
let h3i=0;
async function runH3(){
  while(true){
    const c=HP3[h3i%HP3.length]; h3i++;
    const u=document.getElementById('h3u'), cur=document.getElementById('h3cur');
    const trk=document.getElementById('h3track');
    u.textContent=''; u.innerHTML='';
    cur.style.display='inline-block';
    trk.style.transition='none'; hGo('h3track',0);
    for(let j=0;j<=3;j++){
      const t=document.getElementById('h3t'+j);
      t.className='hw-tab'+(j===0?' show active':'');
      document.getElementById('h3f'+j).innerHTML='';
      document.getElementById('h3l'+j).textContent=j===0?'New Tab':'';
    }
    for(let j=1;j<=3;j++) document.getElementById('h3s'+j).innerHTML='';
    hSS('h3_',0,4);
    await HDelay(420);
    await hType(u, c.q, 40);
    await HDelay(500);
    hSS('h3_',1,4);
    for(const b of c.bangs){ for(const ch of ' '+b.sym){ u.textContent+=ch; await HDelay(65); } }
    const full=u.textContent, qi=full.indexOf(c.bangs[0].sym);
    let html=`<span style="color:var(--text2)">${full.slice(0,qi)}</span>`;
    let rem=full.slice(qi);
    for(const b of c.bangs){
      const bi=rem.indexOf(b.sym);
      if(bi>0) html+=`<span style="color:var(--text2)">${rem.slice(0,bi)}</span>`;
      html+=`<span style="color:var(--t);font-weight:700">${b.sym}</span>`;
      rem=rem.slice(bi+b.sym.length);
    }
    u.innerHTML=html;
    await HDelay(420);
    hSS('h3_',2,4);
    cur.style.display='none';
    u.innerHTML=`<span style="color:var(--text3)">opening tabs</span><span class="how-spin"></span>`;
    for(let j=0;j<c.bangs.length;j++) c.bangs[j].build(document.getElementById('h3s'+(j+1)));
    for(let j=0;j<c.bangs.length;j++){
      document.getElementById('h3f'+(j+1)).innerHTML=c.bangs[j].logo;
      document.getElementById('h3l'+(j+1)).textContent=c.bangs[j].label;
      document.getElementById('h3t'+(j+1)).className='hw-tab show';
      await HDelay(110);
    }
    await HDelay(320);
    hSS('h3_',3,4);
    trk.style.transition='transform .45s cubic-bezier(.4,0,.2,1)';
    for(let j=0;j<c.bangs.length;j++){
      const b=c.bangs[j];
      for(let k=0;k<=3;k++) document.getElementById('h3t'+k).className='hw-tab show'+(k===j+1?' active':'');
      u.innerHTML=`<span style="color:var(--text)">${b.url}</span>`;
      hGo('h3track',j+1);
      await HDelay(600);
      if(b.isChat){
        const air=document.getElementById('h3s'+(j+1)).querySelector('[id^="ha"]');
        if(air && air.textContent==='') await hStream(air, b.reply);
        await HDelay(700);
      } else {
        await HDelay(1600);
      }
    }
    await HDelay(500);
  }
}

/* ══ Scene 5 — Custom bang ════════════════════════════════════════════════════ */
const HP5=[
  {
    name:'FB Cooking',
    shortcut:'fbcook',
    icon: HL.facebook,
    siteLabel:'Home Cooking · Group',
    searchQ:'pasta carbonara',
    searchUrl:'facebook.com/groups/homecooking/search/?q=pasta+carbonara',
    templateUrl:'facebook.com/groups/homecooking/search/?q=%s',
    queryToken:'pasta+carbonara',
    useQ:'risotto alla milanese',
    useBang:'!fbcook',
    useUrl:'facebook.com/groups/homecooking/search/?q=risotto+alla+milanese',
    buildA(el, typed){
      el.innerHTML =
        '<div class="how-shdr">'+HL.facebook+'<span class="how-stitle">Home Cooking · Group</span></div>'+
        '<div class="how-sbody">'+
          '<div class="how-googp">'+
            '<div style="display:flex;align-items:center;gap:5px;background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:4px 7px;font-size:9px;font-family:\'DM Mono\',monospace;color:var(--text3)">'+
              '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'+
              '<span id="h5sbar">'+typed+'</span>'+
            '</div>'+
            '<div class="how-gi"><div class="how-gbar" style="width:88%"></div><div class="how-gsnip" style="width:72%"></div></div>'+
            '<div class="how-gi"><div class="how-gbar" style="width:75%"></div><div class="how-gsnip" style="width:90%"></div></div>'+
          '</div>'+
        '</div>';
    },
    buildC(el){
      el.innerHTML =
        '<div class="how-shdr">'+HL.facebook+'<span class="how-stitle">Home Cooking · search</span><div class="how-spill">risotto alla milanese</div></div>'+
        '<div class="how-sbody"><div class="how-redp">'+
          ['2.1k','847','3.6k'].map((c,i)=>
            '<div class="how-rpost">'+
              '<div class="how-rv"><div class="how-aru"></div><div class="how-rvc">'+c+'</div><div class="how-ard"></div></div>'+
              '<div class="how-ri"><div class="how-rbar" style="width:'+(80+i*5)+'%"></div><div class="how-rbar s" style="width:'+(70+i*7)+'%"></div><div class="how-rmeta">homecooking · '+(12+i*8)+'c</div></div>'+
            '</div>'
          ).join('')+
        '</div></div>';
    },
  },
  {
    name:'Learn Code',
    shortcut:'lp',
    icon: HL.reddit,
    siteLabel:'r/learnprogramming',
    searchQ:'async await explained',
    searchUrl:'reddit.com/r/learnprogramming/search/?q=async+await',
    templateUrl:'reddit.com/r/learnprogramming/search/?q=%s',
    queryToken:'async+await',
    useQ:'react hooks tutorial',
    useBang:'!lp',
    useUrl:'reddit.com/r/learnprogramming/search/?q=react+hooks',
    buildA(el, typed){
      el.innerHTML =
        '<div class="how-shdr">'+HL.reddit+'<span class="how-stitle">r/learnprogramming</span></div>'+
        '<div class="how-sbody">'+
          '<div class="how-googp">'+
            '<div style="display:flex;align-items:center;gap:5px;background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:4px 7px;font-size:9px;font-family:\'DM Mono\',monospace;color:var(--text3)">'+
              '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'+
              '<span id="h5sbar">'+typed+'</span>'+
            '</div>'+
            '<div class="how-rpost" style="margin-top:3px"><div class="how-rv"><div class="how-aru"></div><div class="how-rvc">4.2k</div><div class="how-ard"></div></div><div class="how-ri"><div class="how-rbar" style="width:85%"></div><div class="how-rbar s"></div><div class="how-rmeta">r/learnprogramming · 234c</div></div></div>'+
            '<div class="how-rpost"><div class="how-rv"><div class="how-aru"></div><div class="how-rvc">1.8k</div><div class="how-ard"></div></div><div class="how-ri"><div class="how-rbar" style="width:76%"></div><div class="how-rbar s"></div><div class="how-rmeta">r/learnprogramming · 91c</div></div></div>'+
          '</div>'+
        '</div>';
    },
    buildC(el){
      el.innerHTML =
        '<div class="how-shdr">'+HL.reddit+'<span class="how-stitle">r/learnprogramming · search</span><div class="how-spill">react hooks tutorial</div></div>'+
        '<div class="how-sbody"><div class="how-redp">'+
          ['5.1k','2.3k','891'].map((c,i)=>
            '<div class="how-rpost">'+
              '<div class="how-rv"><div class="how-aru"></div><div class="how-rvc">'+c+'</div><div class="how-ard"></div></div>'+
              '<div class="how-ri"><div class="how-rbar" style="width:'+(82+i*4)+'%"></div><div class="how-rbar s"></div><div class="how-rmeta">r/learnprogramming · '+(34+i*20)+'c</div></div>'+
            '</div>'
          ).join('')+
        '</div></div>';
    },
  },
  {
    name:'My Drive',
    shortcut:'drive',
    icon: HL.drive,
    siteLabel:'Google Drive',
    searchQ:'q3 report',
    searchUrl:'drive.google.com/drive/search?q=q3+report',
    templateUrl:'drive.google.com/drive/search?q=%s',
    queryToken:'q3+report',
    useQ:'marketing deck',
    useBang:'!drive',
    useUrl:'drive.google.com/drive/search?q=marketing+deck',
    buildA(el, typed){
      el.innerHTML =
        '<div class="how-shdr">'+HL.drive+'<span class="how-stitle">Google Drive</span></div>'+
        '<div class="how-sbody">'+
          '<div class="how-googp">'+
            '<div style="display:flex;align-items:center;gap:5px;background:var(--s2);border:1px solid var(--border);border-radius:5px;padding:4px 7px;font-size:9px;font-family:\'DM Mono\',monospace;color:var(--text3)">'+
              '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>'+
              '<span id="h5sbar">'+typed+'</span>'+
            '</div>'+
            [['📄','Q3 Report Final.docx'],['📊','Budget 2024.xlsx'],['📋','Product Roadmap.pptx']].map(([ico,name])=>
              '<div class="how-gi" style="display:flex;align-items:center;gap:5px;padding:3px 0">'+
                '<span style="font-size:10px">'+ico+'</span>'+
                '<div style="flex:1"><div class="how-gbar" style="width:'+(50+name.length*1.5|0)+'px;max-width:140px"></div></div>'+
              '</div>'
            ).join('')+
          '</div>'+
        '</div>';
    },
    buildC(el){
      el.innerHTML =
        '<div class="how-shdr">'+HL.drive+'<span class="how-stitle">Google Drive · search</span><div class="how-spill">marketing deck</div></div>'+
        '<div class="how-sbody"><div class="how-googp">'+
          [['📊','Marketing Deck Q3.pptx','3 days ago'],['📄','Marketing Strategy.docx','1 week ago'],['🗂️','Campaign Assets folder','2 weeks ago']].map(([ico,name,date])=>
            '<div class="how-gi" style="display:flex;align-items:center;gap:6px;padding:3px 0">'+
              '<span style="font-size:10px">'+ico+'</span>'+
              '<div style="flex:1"><div class="how-gbar" style="width:'+(50+name.length*1.5|0)+'px;max-width:150px"></div><div class="how-gsnip" style="width:60px;margin-top:2px"></div></div>'+
              '<span style="font-size:7px;color:var(--text3);font-family:\'DM Mono\',monospace;flex-shrink:0">'+date+'</span>'+
            '</div>'
          ).join('')+
        '</div></div>';
    },
  },
];

let h5i=0;

async function runH5(){
  while(true){
    const sc=HP5[h5i%HP5.length]; h5i++;

    const u=document.getElementById('h5u'), cur=document.getElementById('h5cur');
    const blank=document.getElementById('h5blank');
    const slA=document.getElementById('h5slideA');
    const slB=document.getElementById('h5slideB');
    const slC=document.getElementById('h5slideC');

    // reset
    u.textContent=''; u.innerHTML='';
    cur.style.display='inline-block';
    blank.style.opacity='1'; blank.style.transition='none';
    slA.style.opacity='0'; slA.style.transition='none'; slA.innerHTML='';
    slB.style.opacity='0'; slB.style.transition='none'; slB.innerHTML='';
    slC.style.opacity='0'; slC.style.transition='none'; slC.innerHTML='';
    hSS('h5_',0,5);
    await HDelay(400);

    /* ── Step 1: navigate to platform and search ── */
    await hType(u, sc.searchUrl.split('?')[0], 38);
    cur.style.display='none';
    u.innerHTML='<span style="color:var(--text3)">loading</span><span class="how-spin"></span>';
    await HDelay(550);
    u.innerHTML='<span style="color:var(--text)">'+sc.searchUrl.split('?')[0]+'</span>';

    // show platform slide
    sc.buildA(slA, '');
    blank.style.transition='opacity .3s'; blank.style.opacity='0';
    slA.style.transition='opacity .3s'; slA.style.opacity='1';
    await HDelay(300);

    // type in platform search bar
    const sbar=slA.querySelector('#h5sbar');
    if(sbar){ for(const ch of sc.searchQ){ sbar.textContent+=ch; await HDelay(55); } }
    await HDelay(400);

    // URL in bar updates with query
    const qs=sc.queryToken;
    const rawUrl=sc.searchUrl;
    const splitIdx=rawUrl.indexOf(qs);
    const before=rawUrl.slice(0,splitIdx);
    const after=rawUrl.slice(splitIdx+qs.length);
    u.innerHTML='<span style="color:var(--text2)">'+before+'</span>'+'<span style="background:rgba(85,72,232,0.18);border-radius:2px;color:var(--p)">'+qs+'</span>'+'<span style="color:var(--text2)">'+after+'</span>';
    hSS('h5_',1,5);
    await HDelay(900);

    /* ── Step 2→3: open Slingshot settings, fill form ── */
    hSS('h5_',2,5);

    // build settings slide — 2-row form so URL is always fully visible
    slB.innerHTML =
      '<div class="how-shdr">'+
        '<svg width="10" height="10" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="var(--p)"/><text x="6" y="17" font-size="13" font-weight="800" fill="white" font-family="sans-serif">!</text></svg>'+
        '<span class="how-stitle">Slingshot · Custom search engine</span>'+
      '</div>'+
      '<div class="how-sbody">'+
        '<div class="custom-wrap">'+
          '<div class="custom-title">'+
            'Custom search engine '+
            '<span class="warn-icon"><svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>'+
          '</div>'+
          '<div class="custom-grid">'+
            '<div class="cf" id="h5fname" style="color:var(--text3)">Name</div>'+
            '<div class="bang-w" id="h5fbangw"><span class="bang-sym">!</span><div class="cf mono" id="h5fshort" style="color:var(--text3)">shortcut</div></div>'+
          '</div>'+
          '<div class="custom-url-row">'+
            '<div class="cf mono" id="h5furl" style="color:var(--text3);font-size:9px;word-break:break-all;white-space:normal;line-height:1.4;min-height:30px">https://example.com/search?q=%s</div>'+
            '<button class="add-btn" id="h5fadd">+ Add</button>'+
          '</div>'+
          '<div class="use-example" id="h5useex">'+
            '<span class="use-label">try now</span>'+
            '<div class="use-pill"><span class="use-q" id="h5useq">'+sc.useQ+' </span><span class="use-b">!'+sc.shortcut+'</span></div>'+
          '</div>'+
        '</div>'+
      '</div>';

    u.innerHTML='<span style="color:var(--text2)">slingshot://settings/custom</span>';
    slA.style.transition='opacity .25s'; slA.style.opacity='0';
    await HDelay(120);
    slB.style.transition='opacity .3s'; slB.style.opacity='1';
    await HDelay(400);

    // fill Name
    const fname=document.getElementById('h5fname');
    fname.style.color='var(--text)'; fname.textContent='';
    fname.classList.add('active');
    for(const ch of sc.name){ fname.textContent+=ch; await HDelay(80); }
    fname.classList.remove('active');
    await HDelay(180);

    // fill shortcut
    const fshort=document.getElementById('h5fshort'), fbangw=document.getElementById('h5fbangw');
    fshort.style.color='var(--text)'; fshort.textContent='';
    fbangw.classList.add('active');
    for(const ch of sc.shortcut){ fshort.textContent+=ch; await HDelay(85); }
    fbangw.classList.remove('active');
    await HDelay(180);

    // paste URL: show full search URL first (pasted), then highlight query token, then replace with %s
    const furl=document.getElementById('h5furl');
    furl.classList.add('active');
    furl.style.color='var(--text)';
    furl.textContent=sc.searchUrl;
    await HDelay(600);

    // highlight the query part
    furl.innerHTML=before+'<span class="sel-hl">'+qs+'</span>'+after;
    await HDelay(500);

    // replace with %s
    furl.innerHTML=before+'<span class="pcts">%s</span>'+after;
    furl.classList.remove('active');
    await HDelay(350);

    // flash Add button, show example
    const fadd=document.getElementById('h5fadd');
    fadd.style.background='var(--p)'; fadd.style.color='#fff';
    await HDelay(300);
    fadd.style.background=''; fadd.style.color='';
    const useex=document.getElementById('h5useex');
    useex.classList.add('visible');
    await HDelay(1200);

    /* ── Step 4: back to address bar, type + bang ── */
    hSS('h5_',3,5);
    slB.style.transition='opacity .25s'; slB.style.opacity='0';
    u.textContent=''; u.innerHTML='';
    cur.style.display='inline-block';
    await HDelay(150);

    await hType(u, sc.useQ, 42);
    await HDelay(350);
    for(const ch of ' !'+sc.shortcut){ u.textContent+=ch; await HDelay(72); }
    const fullU=u.textContent, bangIdx=fullU.lastIndexOf('!'+sc.shortcut);
    u.innerHTML='<span style="color:var(--text2)">'+fullU.slice(0,bangIdx)+'</span><span style="color:var(--t);font-weight:700">'+fullU.slice(bangIdx)+'</span>';
    await HDelay(420);

    /* ── Step 5: loading → results ── */
    cur.style.display='none';
    u.innerHTML='<span style="color:var(--text3)">loading</span><span class="how-spin"></span>';
    hSS('h5_',4,5);
    sc.buildC(slC);
    await HDelay(750);
    u.innerHTML='<span style="color:var(--text)">'+sc.useUrl+'</span>';
    slC.style.transition='opacity .3s'; slC.style.opacity='1';
    await HDelay(2800);

    // reset for next
    slC.style.transition='opacity .25s'; slC.style.opacity='0';
    await HDelay(280);
  }
}

function startSlides(){
  // start all three animations when How it works page is opened
  if(!window._howStarted){
    window._howStarted=true;
    runH1(); runH2(); runH3(); runH5();
  }
}


// ── Theme switch (same segmented control as Search / Requests) ─────────────────
(function(){
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'auto';
  const themeSeg = document.getElementById('themeSeg');

  chrome.storage.sync.get(['theme'], d => {
    applyTheme(d.theme || 'auto');
    // Only enable transitions after initial theme is applied — prevents flash on load
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.add('theme-ready');
        refreshAllSegmentPills();
      });
    });
  });

  function applyTheme(m) {
    mode = m;
    if (themeSeg) {
      themeSeg.querySelectorAll('.type-seg-btn').forEach(b => {
        b.classList.toggle('on', b.dataset.mode === m);
      });
      updateTogglePill('themeSeg', 'type-pill');
    }
    if (m === 'auto') {
      document.documentElement.classList.toggle('dark', prefersDark.matches);
    } else {
      document.documentElement.classList.toggle('dark', m === 'dark');
    }
  }

  if (themeSeg) {
    themeSeg.addEventListener('click', e => {
      const btn = e.target.closest('.type-seg-btn');
      if (!btn || !btn.dataset.mode) return;
      applyTheme(btn.dataset.mode);
      chrome.storage.sync.set({ theme: btn.dataset.mode });
    });
  }

  prefersDark.addEventListener('change', () => {
    if (mode === 'auto') applyTheme('auto');
  });
})();

// ── Auto-fill from clipboard (Search Engines → Custom) ─────────────────────────
(function setupAutoFillFromClipboard() {
  const btn = document.getElementById('srAutoFillBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        showBangConflictToast('Clipboard API not available in this browser.', '');
        return;
      }
      const text = (await navigator.clipboard.readText() || '').trim();
      if (!text) {
        showBangConflictToast('Clipboard is empty. Copy a search URL first.', '');
        return;
      }

      const res = inferFromUrl(text, '');
      if (!res.ok) {
        showBangConflictToast(res.error || 'Could not infer a shortcut from this URL.', '');
        return;
      }

      const nm   = res.name || '';
      const tpl  = res.templateUrl || '';
      const bang = (res.chosenBang || '').trim();

      if (!tpl.includes('%s')) {
        showBangConflictToast('Could not find where the search term goes in that URL.', '');
        return;
      }

      const nameEl = document.getElementById('srName');
      const urlEl  = document.getElementById('srUrl');
      const bangEl = document.getElementById('srBang');
      if (!nameEl || !urlEl || !bangEl) return;

      nameEl.value = nm || nameEl.value;
      urlEl.value  = tpl || urlEl.value;
      if (bang) bangEl.value = bang;

      showBangConflictToast('Auto-filled from clipboard. Review and click + Add.', '');
    } catch (err) {
      console.error('[Slingshot] Auto fill failed:', err);
      showBangConflictToast('Failed to read from clipboard. Check permissions and try again.', '');
    }
  });
})();

// ── Requests page ─────────────────────────────────────────────────────────────
(function(){


  // ── Feature request submit ──────────────────────────────────────────────────
  const featBtn = document.getElementById('featSubmitBtn');
  if (featBtn) {
    featBtn.addEventListener('click', () => {
      const name = document.getElementById('featName').value.trim();
      if (!name) return;
      const desc = document.getElementById('featDesc').value.trim();
      const list = document.getElementById('featList');
      // Remove empty state if present
      const empty = list.querySelector('div[style*="No requests"]') || list.querySelector('div[style*="padding:20px"]');
      if (empty) empty.remove();
      // Build item
      const item = document.createElement('div');
      item.className = 'req-item';
      item.innerHTML = `<div class="req-info"><div class="req-name">${name}</div>${desc ? '<div class="req-meta">'+desc+'</div>' : ''}</div><div class="req-right"><button class="vote-btn" data-count="1"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span class="vote-count">1</span></button></div>`;
      list.appendChild(item);
      document.getElementById('featName').value = '';
      document.getElementById('featDesc').value = '';
    });
  }

  document.getElementById('reqList').addEventListener('click', e => {
    const btn = e.target.closest('.vote-btn');
    if (!btn) return;
    const voted = btn.classList.toggle('voted');
    const count = parseInt(btn.dataset.count);
    const newCount = voted ? count + 1 : count - 1;
    btn.dataset.count = newCount;
    btn.querySelector('.vote-count').textContent = newCount;
  });

})();

// ── Backup page ───────────────────────────────────────────────────────────────
(function(){
  // ⚠ license and installDate are intentionally excluded from export/import
  // Sharing a backup must NEVER transfer a Pro license or reset a trial.
  const EXPORT_SYNC_KEYS = ['bangChar'];
  const LOCAL_KEYS = ['aiSites','searchEngines'];

  function backupDownloadFilename() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `slingshot_backup_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.json`;
  }

  document.getElementById('exportBtn').addEventListener('click', () => {
    chrome.storage.sync.get(EXPORT_SYNC_KEYS, syncData => {
      chrome.storage.local.get(LOCAL_KEYS, localData => {
        const blob = new Blob([JSON.stringify({...syncData, ...localData}, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = backupDownloadFilename();
        a.click();
        const now = new Date().toLocaleString();
        document.getElementById('lastExport').textContent = now;
        chrome.storage.sync.set({ lastExport: now });
      });
    });
  });

  chrome.storage.sync.get(['lastExport'], d => {
    if (d.lastExport) document.getElementById('lastExport').textContent = d.lastExport;
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = JSON.parse(evt.target.result);
        // ⚠ Security: always strip license and installDate from any imported file
        // so backups can never be used to transfer a Pro license or bypass the trial.
        delete data.license;
        delete data.installDate;

        const toSync = {};
        const toLocal = {};
        EXPORT_SYNC_KEYS.forEach(k  => { if (data[k] !== undefined) toSync[k]  = data[k]; });
        LOCAL_KEYS.forEach(k => { if (data[k] !== undefined) toLocal[k] = data[k]; });
        chrome.storage.sync.set(toSync, () => {
          chrome.storage.local.set(toLocal, () => {
            showBangConflictToast('Backup restored! Reloading…', '');
            setTimeout(() => location.reload(), 800);
          });
        });
      } catch(err) {
        showBangConflictToast('Invalid backup file', '');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if (!confirm('Reset everything to defaults? This cannot be undone.')) return;
    chrome.storage.sync.remove(['bangChar', 'enabled'], () => {
      chrome.storage.local.remove(['aiSites', 'searchEngines'], () => {
        showBangConflictToast('Reset complete. Reloading…', '');
        setTimeout(() => location.reload(), 800);
      });
    });
  });
})();

// ── Inline bang editing ───────────────────────────────────────────────────────
document.querySelector('.main').addEventListener('click', e => {
  const tag = e.target.closest('.bang-display');
  if (!tag) return;
  const wrap = tag.closest('.bang-edit-wrap');
  const input = wrap.querySelector('.bang-edit-input');
  tag.style.display = 'none';
  input.style.display = 'inline-block';
  input.focus();
  input.select();
});

document.querySelector('.main').addEventListener('focusout', e => {
  const input = e.target.closest('.bang-edit-input');
  if (!input) return;
  commitBangEdit(input);
});

document.querySelector('.main').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const input = e.target.closest('.bang-edit-input');
    if (!input) return;
    commitBangEdit(input);
    input.blur();
  }
  if (e.key === 'Escape') {
    const input = e.target.closest('.bang-edit-input');
    if (!input) return;
    const id = input.dataset.id;
    const site = [...aiSites, ...searchEngines].find(s => s.id === id);
    if (site) input.value = site.bang;
    const tag = input.closest('.bang-edit-wrap').querySelector('.bang-display');
    input.style.display = 'none';
    tag.style.display = '';
  }
});

let _toastTimer = null;
function showBangConflictToast(siteName, bangStr) {
  const toast = document.getElementById('bangToast');
  const msg   = document.getElementById('bangToastMsg');
  if (!toast || !msg) return;
  // bangStr is empty for free-tier limit messages; use siteName directly
  msg.textContent = bangStr
    ? `“${bangStr}” is already used by ${siteName}`
    : siteName;
  toast.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  // Keep the toast visible a bit longer so informational messages are readable
  _toastTimer = setTimeout(() => toast.classList.remove('show'), 4800);
}

function commitBangEdit(input) {
  const id = input.dataset.id;
  const newBang = input.value.trim().replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const wrap = input.closest('.bang-edit-wrap');
  const tag = wrap.querySelector('.bang-display');

  if (newBang) {
    // Check for duplicate — any other site (across both lists) already using this bang?
    const allSites = [...aiSites, ...searchEngines];
    const conflict = allSites.find(s => s.id !== id && s.bang === newBang);

    if (conflict) {
      // Show toast and shake the input, then revert
      input.classList.add('conflict');
      showBangConflictToast(conflict.name, bc + conflict.bang);
      setTimeout(() => {
        input.classList.remove('conflict');
        const site = allSites.find(s => s.id === id);
        if (site) { input.value = site.bang; tag.textContent = bc + site.bang; }
        input.style.display = 'none';
        tag.style.display = '';
      }, 1400);
      return; // do NOT save
    }

    const inAi = aiSites.some(s => s.id === id);
    if (inAi) {
      aiSites = aiSites.map(s => s.id === id ? {...s, bang: newBang} : s);
    } else {
      searchEngines = searchEngines.map(s => s.id === id ? {...s, bang: newBang} : s);
    }
    save();
  }

  const site = [...aiSites, ...searchEngines].find(s => s.id === id);
  if (site) tag.textContent = bc + site.bang;
  input.style.display = 'none';
  tag.style.display = '';
}

document.querySelectorAll('[data-goto]').forEach(el => {
  const id = el.dataset.goto;
  if (!id) return;
  el.addEventListener('click', () => showPage(id));
});

// ── Persist & Init ────────────────────────────────────────────────────────────
function save(){
  saveAiSites(aiSites, ()=>{});
  saveSearchEngines(searchEngines, ()=>{});
}

// Extract the primary domain from a URL string for dedup purposes
function urlDomain(url) {
  let toParse = url;
  if (!/^https?:\/\//i.test(url)) toParse = 'http://' + url;
  try { return new URL(toParse).hostname.replace(/^www\./, ''); } catch(e) { return url; }
}


// ── Warn icon tooltip positioning ─────────────────────────────────────────────
// Tooltips use position:fixed so they escape overflow:hidden card boundaries.
// We position them via JS on mouseenter so they always stay on screen.
document.querySelectorAll('.warn-icon').forEach(icon => {
  const tip = icon.querySelector('.warn-tip');
  if (!tip) return;
  icon.addEventListener('mouseenter', () => {
    const r = icon.getBoundingClientRect();
    // Default: above and centered
    let top = r.top - 8;
    let left = r.left + r.width / 2;
    tip.style.transform = 'translateX(-50%) translateY(-100%)';
    tip.style.top  = top + 'px';
    tip.style.left = left + 'px';
    // After render, check if it bleeds off screen and nudge left
    requestAnimationFrame(() => {
      const tr = tip.getBoundingClientRect();
      if (tr.right > window.innerWidth - 8) {
        tip.style.left = (window.innerWidth - 8 - tr.width / 2) + 'px';
      }
      if (tr.left < 8) {
        tip.style.left = (8 + tr.width / 2) + 'px';
      }
    });
  });
});

// Navigate to page from URL hash (e.g. options.html#shortcuts from popup; #requests-bug opens Requests with Bug report selected)
(function() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;

  const reqSeg = hash.match(/^requests-(ai|se|feature|bug)$/);
  if (reqSeg) {
    window.addEventListener('load', () => {
      showPage('requests');
      const type = reqSeg[1];
      const container = document.getElementById('typeSeg');
      const btn = container?.querySelector('.type-seg-btn[data-val="' + type + '"]');
      if (container && btn) {
        container.querySelectorAll('.type-seg-btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        updateTogglePill('typeSeg', 'type-pill');
        updateRequestFields(type);
      }
    }, { once: true });
    return;
  }

  const pageMap = { shortcuts: 'bang', ai: 'ai', search: 'search', features: 'features', backup: 'backup', requests: 'requests', news: 'news', ...(MONETIZATION_ENABLED ? { pro: 'pro' } : {}) };
  const page = pageMap[hash];
  if (page) {
    window.addEventListener('load', () => showPage(page), { once: true });
  }
})();

// Extension shortcut manager link (Chrome internal page vs Firefox help — about:addons is not openable from tabs.create)
const shortcutManagerLink = document.getElementById('shortcutManagerLink');
if (shortcutManagerLink) {
  const isFirefox = typeof browser !== 'undefined' && typeof browser.runtime?.getBrowserInfo === 'function';
  shortcutManagerLink.textContent = isFirefox
    ? 'How to change shortcuts in Firefox'
    : 'Manage in chrome://extensions/shortcuts';
  shortcutManagerLink.addEventListener('click', e => {
    e.preventDefault();
    const url = isFirefox
      ? 'https://support.mozilla.org/kb/manage-extension-shortcuts-firefox'
      : 'chrome://extensions/shortcuts';
    chrome.tabs.create({ url });
  });
}

// ── Trial enforcement helpers ──────────────────────────────────────────────
function enforceFreeLimits() {
  if (!MONETIZATION_ENABLED) return false;
  // Returns true if any changes were made (needs save)
  let changed = false;
  [aiSites, searchEngines].forEach(list => {
    let activeCount = 0;
    list.forEach(s => {
      if (s.active) {
        activeCount++;
        if (activeCount > FREE_LIMIT) {
          s.active = false;
          changed = true;
        }
      }
    });
  });
  return changed;
}

// ── Community News (Staff Billboard) ────────────────────────────────────────
let newsData = [];
async function loadNews() {
  const container = document.getElementById('newsList');
  if (!container) return;
  try {
    const res = await supaFetch('announcements?select=*&order=created_at.desc');
    if (!res.ok) throw new Error('Fetch failed');
    newsData = await res.json();
    renderNews();
  } catch (err) {
    console.error('[Slingshot] Failed to load news:', err);
    container.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;color:var(--red)">Failed to load news billboard.</div>`;
  }
}

function renderNews() {
  const container = document.getElementById('newsList');
  if (!container) return;
  if (!newsData.length) {
    container.innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace">No news yet. Check back soon!</div>`;
    return;
  }
  container.innerHTML = newsData.map(n => {
    const d = new Date(n.created_at);
    const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const versionPill = n.version
      ? `<span style="font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:10px;font-weight:700;color:var(--p);background:rgba(108,99,255,0.1);border:1px solid rgba(108,99,255,0.18);padding:2px 8px;border-radius:20px;margin-left:8px">${escapeHTML(n.version)}</span>`
      : '';
    const linkEl = n.link
      ? `<a href="${n.link}" target="_blank" style="font-size:12px;color:var(--p);text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px;margin-top:10px">View more <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>`
      : '';
    return `<div class="news-item">
      <div style="display:flex;align-items:center;margin-bottom:7px">
        <span style="font-size:11px;color:var(--text3);font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace">${dateStr}</span>${versionPill}
      </div>
      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px;letter-spacing:-0.2px">${escapeHTML(n.title)}</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.65">${escapeHTML(n.description || '')}</div>
      ${linkEl}
    </div>`;
  }).join('');
}

// ── Community Requests MVP ───────────────────────────────────────────────────
let requestsData = [];
let currentReqType = 'all';

/** Vote count as shown in UI (source of truth for sorting + display). */
function requestVoteCount(r) {
  return Array.isArray(r.voter_ids) ? r.voter_ids.length : 0;
}

/** Integer vote label — avoids NaN when RPC omits votes or DOM text is non-numeric. */
function parseDisplayedVoteCount(text) {
  const n = parseInt(String(text == null ? '' : text).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Stable sort: primary by votes desc, then name, then id — avoids tie-order flicker on re-fetch. */
function sortRequestsDataStable() {
  requestsData.sort((a, b) => {
    const va = requestVoteCount(a);
    const vb = requestVoteCount(b);
    if (vb !== va) return vb - va;
    const na = (a.name || '').toLowerCase();
    const nb = (b.name || '').toLowerCase();
    if (na < nb) return -1;
    if (na > nb) return 1;
    return String(a.id).localeCompare(String(b.id));
  });
}

function applyRequestsListHtml(html) {
  const container = document.getElementById('reqList');
  if (!container) return;
  const go = () => { container.innerHTML = html; };
  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(go);
  } else {
    go();
  }
}

// Generate or get a persistent anonymous ID for voting (single-flight cache avoids render delay + duplicate reads)
let installIdPromise = null;
async function getInstallId() {
  if (!installIdPromise) {
    installIdPromise = new Promise(resolve => {
      chrome.storage.sync.get(['installId'], res => {
        if (res.installId) return resolve(res.installId);
        const newId = 'usr_' + Date.now().toString(36) + Math.random().toString(36).substr(2);
        chrome.storage.sync.set({ installId: newId }, () => resolve(newId));
      });
    });
  }
  return installIdPromise;
}

function renderRequests() {
  const container = document.getElementById('reqList');
  if (!container) return;
  
  // Filter based on active tab
  const filtered = requestsData.filter(r => currentReqType === 'all' || r.type === currentReqType);
  
  if (filtered.length === 0) {
    applyRequestsListHtml(`<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace">No ${currentReqType !== 'all' ? currentReqType : ''} requests yet</div>`);
    return;
  }

  getInstallId().then(userId => {
    const html = filtered.map(r => {
      const isAi = r.type === 'ai';
      const isFeat = r.type === 'feature';
      const isBug = r.type === 'bug';
      const typeStr = isBug ? 'Bug' : isFeat ? 'Feature' : (isAi ? 'AI' : 'Search');
      const colorCls = isBug ? 'bug' : isFeat ? 'feature' : (isAi ? 'ai' : 'se');
      const voters = Array.isArray(r.voter_ids) ? r.voter_ids : [];
      const voteCount = requestVoteCount(r);
      const voted = voters.includes(userId);
      const btnState = voted ? ' voted' : '';
      
      let iconHtml = '';
      let metaSub = '';
      
      if (r.type === 'feature') {
        iconHtml = `<div style="width:36px;height:36px;background:rgba(108,99,255,0.12);color:var(--p);display:flex;align-items:center;justify-content:center;border-radius:9px;border:1px solid rgba(108,99,255,0.2)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.815 0c.85.493 1.509 1.333 1.509 2.316V18"/></svg></div>`;
        metaSub = 'Feature Request';
      } else if (r.type === 'bug') {
        iconHtml = `<div style="width:36px;height:36px;background:rgba(220,38,38,0.1);color:var(--red);display:flex;align-items:center;justify-content:center;border-radius:9px;border:1px solid rgba(220,38,38,0.22)"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M9.5 5.5L8.5 3.5M14.5 5.5l1-2"/><ellipse cx="12" cy="14" rx="6.5" ry="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="none" stroke="currentColor" stroke-width="1.5" d="M12 7v14"/><circle cx="9" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="9" cy="17.5" r="1.05" fill="currentColor" stroke="none"/><circle cx="15" cy="17.5" r="1.05" fill="currentColor" stroke="none"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M5.5 11H3M21 11h-2.5M5.5 15H3M21 15h-2.5M6.5 19l-1.5 2M17.5 19l1.5 2"/></svg></div>`;
        metaSub = 'Bug report';
      } else {
        const domain = urlDomain(r.url);
        const favicon = faviconUrl(domain, 128);
        const fallbackSrc = isAi ? "onerror=\"this.parentNode.innerHTML='" + escapeHTML(r.name).substring(0,2) + "';this.parentNode.style.background='#1565c0'\"" : 
                                   "onerror=\"this.parentNode.innerHTML='" + escapeHTML(r.name).substring(0,2) + "';this.parentNode.style.background='#e65100'\"";
        iconHtml = `<img src="${favicon}" style="width:36px;height:36px;object-fit:cover;display:block;border-radius:9px" ${fallbackSrc}>`;
        metaSub = domain;
      }

      return `
        <div class="req-item" data-type="${r.type}">
          <div class="req-ico" style="overflow:hidden;padding:0">
            ${iconHtml}
          </div>
          <div class="req-info">
            <div class="req-name">${escapeHTML(r.name)}</div>
            <div class="req-meta">${escapeHTML(metaSub)} · ${voteCount} user${voteCount !== 1 ? 's' : ''} requested</div>
          </div>
          <div class="req-right">
            <span class="req-type ${colorCls}">${typeStr}</span>
            <button class="vote-btn${btnState}" data-reqid="${r.id}" data-voted="${voted}">
              <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
              <span class="vote-count">${voteCount}</span>
            </button>
          </div>
        </div>
      `;
    }).join('');
    applyRequestsListHtml(html);
  });
}

async function loadRequests() {
  try {
    const res = await supaFetch('site_requests?status=eq.pending&select=*&order=votes.desc,id.asc');
    if (!res.ok) throw new Error('Fetch failed');
    requestsData = await res.json();
    sortRequestsDataStable();
    renderRequests();
  } catch (err) {
    console.error('[Slingshot] Failed to load requests:', err);
    document.getElementById('reqList').innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--text3);font-size:13px;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;color:var(--red)">Failed to load requests.<br>Please try again later.</div>`;
  }
}

async function upvoteRequest(reqId, btn) {
  if (btn.dataset.busy === 'true') return;
  btn.dataset.busy = 'true';

  const userId = await getInstallId();
  const alreadyVoted = btn.dataset.voted === 'true';
  const countSpan = btn.querySelector('.vote-count');
  const prevVotes = parseDisplayedVoteCount(countSpan && countSpan.textContent);
  const prevVoted = alreadyVoted;

  // Optimistic UI toggle
  const optimisticVotes = alreadyVoted ? Math.max(prevVotes - 1, 0) : prevVotes + 1;
  btn.classList.toggle('voted', !alreadyVoted);
  countSpan.textContent = String(optimisticVotes);
  btn.dataset.voted = String(!alreadyVoted);

  try {
    const res = await supaFetch('rpc/toggle_vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ req_id: reqId, voter: userId })
    });
    const result = await res.json();
    if (result && result.success) {
      const serverVotes = Number(result.votes);
      const useVotes = Number.isFinite(serverVotes) && serverVotes >= 0
        ? Math.floor(serverVotes)
        : optimisticVotes;
      countSpan.textContent = String(useVotes);
      btn.classList.toggle('voted', result.voted);
      btn.dataset.voted = String(result.voted);
      const row = requestsData.find(r => String(r.id) === String(reqId));
      if (row) {
        if (Number.isFinite(Number(result.votes))) row.votes = Math.floor(Number(result.votes));
        if (!Array.isArray(row.voter_ids)) row.voter_ids = [];
        if (result.voted) {
          if (!row.voter_ids.includes(userId)) row.voter_ids.push(userId);
        } else {
          row.voter_ids = row.voter_ids.filter(v => v !== userId);
        }
      }
      // Intentionally no renderRequests() here — full innerHTML would remount every row (favicon/hover flicker).
      // Stable sort runs on loadRequests (sync/submit/init). Reorder after vote: refresh list or revisit page.
    } else {
      throw new Error(result?.message || 'Toggle failed');
    }
  } catch (err) {
    console.error('[Slingshot] Vote toggle failed:', err);
    btn.classList.toggle('voted', prevVoted);
    countSpan.textContent = String(prevVotes);
    btn.dataset.voted = String(prevVoted);
  } finally {
    btn.dataset.busy = 'false';
  }
}

// Event Listeners for Requests Tab

function updateRequestFields(type) {
  const isFeatLike = type === 'feature' || type === 'bug';
  const nameInput = document.getElementById('reqName');
  const urlInput = document.getElementById('reqUrl');
  const descRow = document.getElementById('reqDescRow');
  const descInput = document.getElementById('reqDesc');

  if (nameInput) {
    if (type === 'ai') nameInput.placeholder = 'Name (e.g. Perplexity AI)';
    else if (type === 'se') nameInput.placeholder = 'Name (e.g. DuckDuckGo)';
    else if (type === 'feature') nameInput.placeholder = 'Feature name (e.g. Dark mode)';
    else if (type === 'bug') nameInput.placeholder = 'Short summary (e.g. Vote count stuck at 0)';
  }

  if (urlInput) {
    urlInput.style.display = isFeatLike ? 'none' : 'block';
    if (type === 'se') urlInput.placeholder = 'Search URL (https://.../q=%s)';
    else urlInput.placeholder = 'Website URL (https://...)';
  }
  
  if (descRow) descRow.style.display = isFeatLike ? 'block' : 'none';
  if (descInput) {
    if (type === 'feature') descInput.placeholder = 'Briefly describe the feature...';
    else if (type === 'bug') descInput.placeholder = 'Describe steps to reproduce...';
  }
}

document.getElementById('typeSeg').addEventListener('click', e => {
  const btn = e.target.closest('.type-seg-btn');
  if (!btn) return;
  
  const container = document.getElementById('typeSeg');
  container.querySelectorAll('.type-seg-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  
  updateTogglePill('typeSeg', 'type-pill');
  
  const type = btn.dataset.val;
  updateRequestFields(type);
});

window.addEventListener('resize', () => {
  refreshAllSegmentPills();
});

document.getElementById('reqList').addEventListener('click', e => {
  const btn = e.target.closest('.vote-btn');
  if (!btn) return;
  const reqId = btn.getAttribute('data-reqid');
  if (!reqId || reqId === 'undefined') return;
  upvoteRequest(reqId, btn);
});

document.getElementById('reqSubmitBtn').addEventListener('click', async () => {
  const btn = document.getElementById('reqSubmitBtn');

  const nameInput = document.getElementById('reqName');
  const urlInput = document.getElementById('reqUrl');
  const descInput = document.getElementById('reqDesc');
  const name = nameInput.value.trim();
  const typeEl = document.querySelector('#typeSeg .type-seg-btn.on');
  const type = typeEl ? typeEl.dataset.val : 'ai';
  
  // Use description field as the URL column for feature/bug requests (same pattern as feature)
  let url = (type === 'feature' || type === 'bug') ? descInput.value.trim() : urlInput.value.trim();

  if (!name || !url) {
    const needDesc = type === 'feature' || type === 'bug';
    const descMsg = type === 'feature' ? 'Please describe the feature' : type === 'bug' ? 'Please describe the bug' : 'Please provide a URL';
    showBangConflictToast(!name ? 'Please provide a name' : (needDesc ? descMsg : 'Please provide a URL'), '');
    return;
  }

  if (type === 'feature' || type === 'bug') {
    const TITLE_MIN = 8;
    const DESC_MIN = 15;
    if (name.length < TITLE_MIN) {
      showBangConflictToast(`Please enter a clearer title (at least ${TITLE_MIN} characters).`, '');
      return;
    }
    if (url.length < DESC_MIN) {
      showBangConflictToast(
        type === 'feature'
          ? `Please describe the feature in more detail (at least ${DESC_MIN} characters).`
          : `Please describe the bug with steps to reproduce (at least ${DESC_MIN} characters).`,
        ''
      );
      return;
    }
  }

  if (type === 'ai') {
    const v = validateRequestSiteUrl(url);
    if (!v.ok) {
      showBangConflictToast(v.message, '');
      return;
    }
    url = v.href;
  } else if (type === 'se') {
    const v = validateTemplateUrl(url);
    if (!v.ok) {
      showBangConflictToast(v.message, '');
      return;
    }
    url = v.value;
  }
  
  btn.classList.add('disabled');
  const originalText = btn.textContent;
  btn.textContent = '...';

  try {
    const userId = await getInstallId();
    const res = await supaFetch('rpc/submit_request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r_name: name, r_url: url, r_type: type, r_description: descInput?.value.trim() || '', r_creator: userId })
    });

    const result = await res.json();
    if (result.success) {
      nameInput.value = '';
      urlInput.value = '';
      if (descInput) descInput.value = '';
      showBangConflictToast('Request submitted!', '');
      await loadRequests();
    } else {
      showBangConflictToast(result.message || 'Submission failed', '');
    }
  } catch (err) {
    console.error('[Slingshot] Request failed:', err);
    showBangConflictToast('Network error, try again', '');
  } finally {
    btn.textContent = originalText;
    btn.classList.remove('disabled');
  }
});


function init(){
  // 1. Initial fast render using cached local storage data
  getAllData(data => {
    // Remove any legacy custom AI sites
    aiSites = (data.aiSites || []).filter(s => !s.custom);
    searchEngines = data.searchEngines || [];
    isPro       = isProUnlocked(data.license);
    isTrial     = isTrialActive(data.installDate);
    installDate = data.installDate;
    bc          = data.bangChar || '!';

    if (MONETIZATION_ENABLED && !isPaidOrTrial(data.license, data.installDate)) {
      if (enforceFreeLimits()) {
        saveAiSites(aiSites, () => {});
        saveSearchEngines(searchEngines, () => {});
      }
    }
    if (!MONETIZATION_ENABLED) {
      document.querySelectorAll('[data-monetization-only]').forEach(el => { el.style.display = 'none'; });
    }
    renderAll();
    updateFeatureSwapToggle(data.aiFeatures);
    
    // Load community updates
    loadNews();
    loadRequests();
  });
}

function updateFeatureSwapToggle(aiFeatures) {
  const btn = document.getElementById('featureSwapEnterTog');
  if (!btn) return;
  const on = !!(aiFeatures && aiFeatures.swapEnterShiftEnter);
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', String(on));
}

document.getElementById('featureSwapEnterTog')?.addEventListener('click', () => {
  const btn = document.getElementById('featureSwapEnterTog');
  const on = !btn.classList.contains('on');
  saveAiFeatures({ swapEnterShiftEnter: on }, () => {
    updateFeatureSwapToggle({ swapEnterShiftEnter: on });
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.aiFeatures) {
    updateFeatureSwapToggle(changes.aiFeatures.newValue || {});
  }
});

init();

// ── Admin Panel (hidden; revealed via double-click on logo) ──────────────────
(function setupAdminPanel() {
  if (!SLINGSHOT_DEV_MODE) return;

  function updateAdminPlanState() {
    const el = document.getElementById('admin-plan-state');
    if (!el) return;
    if (!MONETIZATION_ENABLED) {
      el.textContent = 'Monetization off (shipping build)';
      return;
    }
    chrome.storage.sync.get(['license', 'installDate'], d => {
      const pro = isProUnlocked(d.license);
      const trial = isTrialActive(d.installDate);
      const days = trialDaysRemaining(d.installDate);
      el.textContent = pro
        ? `PRO (license: ${d.license})`
        : trial
          ? `TRIAL (${days}d left, installDate: ${new Date(d.installDate).toLocaleDateString()})`
          : `FREE (trial expired or no installDate)`;
    });
  }

  function reloadWithAdmin() {
    init();
    updateAdminPlanState();
  }

  // Wipe EVERYTHING — emulate completely fresh install
  const wipeAllBtn = document.getElementById('admin-wipe-all');
  if (wipeAllBtn) wipeAllBtn.addEventListener('click', () => {
    if (!confirm('Wipe ALL extension data to emulate a fresh install?')) return;
    chrome.storage.sync.clear(() => {
      chrome.storage.local.clear(() => {
        // Since we aren't physically reinstalling the extension, `onInstalled` in background.js won't fire.
        // We must manually inject the fresh installDate to accurately simulate State 1 Trial setup.
        chrome.storage.sync.set({ installDate: Date.now() }, () => {
          location.reload();
        });
      });
    });
  });

  const forceSyncBtn = document.getElementById('admin-force-sync');
  if (forceSyncBtn) forceSyncBtn.addEventListener('click', () => {
    forceSyncBtn.textContent = '☁️ Syncing...';
    forceSyncBtn.disabled = true;
    chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }, (res) => {
      if (res && res.success) {
        location.reload();
      } else {
        forceSyncBtn.textContent = '☁️ Force Daily Sync';
        forceSyncBtn.disabled = false;
        showBangConflictToast('Sync failed — check console', '');
      }
    });
  });

  // State 1: Trial Active (1 day ago) + Remove Pro
  const s1Btn = document.getElementById('admin-state1');
  if (s1Btn) s1Btn.addEventListener('click', () => {
    const d = Date.now() - (1 * 24 * 60 * 60 * 1000);
    chrome.storage.sync.remove('license', () => {
      chrome.storage.sync.set({ installDate: d }, () => {
        reloadWithAdmin();
      });
    });
  });

  // State 2: Trial Expired (31 days ago) + Remove Pro
  const s2Btn = document.getElementById('admin-state2');
  if (s2Btn) s2Btn.addEventListener('click', () => {
    const d = Date.now() - (31 * 24 * 60 * 60 * 1000);
    chrome.storage.sync.remove('license', () => {
      chrome.storage.sync.set({ installDate: d }, () => {
        reloadWithAdmin();
      });
    });
  });

  // State 3: Pro Activated
  const s3Btn = document.getElementById('admin-state3');
  if (s3Btn) s3Btn.addEventListener('click', () => {
    chrome.storage.sync.set({ license: 'ADMIN_PRO_OVERRIDE' }, () => {
      reloadWithAdmin();
    });
  });

  // Force enforce limits + re-render
  const enforceBtn = document.getElementById('admin-enforce');
  if (enforceBtn) enforceBtn.addEventListener('click', () => {
    const changed = enforceFreeLimits();
    if (changed) {
      saveAiSites(aiSites, () => {});
      saveSearchEngines(searchEngines, () => {});
    }
    renderAll();
    updateAdminPlanState();
  });

  // Reload page
  const reloadBtn = document.getElementById('admin-reload');
  if (reloadBtn) reloadBtn.addEventListener('click', () => location.reload());

  // Dump all storage
  const dumpBtn = document.getElementById('admin-dump');
  const dumpOut = document.getElementById('admin-storage-out');
  if (dumpBtn && dumpOut) dumpBtn.addEventListener('click', () => {
    chrome.storage.sync.get(null, syncData => {
      chrome.storage.local.get(null, localData => {
        const out = { sync: syncData, local: { ...localData, aiSites: localData.aiSites?.length + ' sites', searchEngines: localData.searchEngines?.length + ' engines' } };
        dumpOut.textContent = JSON.stringify(out, null, 2);
        dumpOut.style.display = 'block';
      });
    });
  });

  // Update plan state whenever admin page is shown
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.page === 'admin') updateAdminPlanState();
    });
  });

  updateAdminPlanState();
})();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SYNC_COMPLETE') {
    init();
  }
});
