// ── Telemetry: daily heartbeat with local buffering ─────────────────────────
// Depends on storage.js being loaded first (SUPABASE_CONFIG, getAllData, etc.)
// ─────────────────────────────────────────────────────────────────────────────

const TELEMETRY = {
  STORAGE_KEY: 'telemetryBuffer',
  META_KEY: 'telemetryMeta',
  SCHEMA_VERSION: 1,
  MAX_BACKLOG_DAYS: 30,
  ENDPOINT: SUPABASE_CONFIG.URL + '/functions/v1/telemetry-heartbeat',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function _utcDay(ts) {
  return (ts ? new Date(ts) : new Date()).toISOString().slice(0, 10);
}

function _readBuffer() {
  return new Promise(resolve => {
    chrome.storage.local.get([TELEMETRY.STORAGE_KEY, TELEMETRY.META_KEY], d => {
      resolve({
        buffer: d[TELEMETRY.STORAGE_KEY] || {},
        meta:   d[TELEMETRY.META_KEY]    || {},
      });
    });
  });
}

function _writeBuffer(buffer, meta) {
  return new Promise(resolve => {
    chrome.storage.local.set({
      [TELEMETRY.STORAGE_KEY]: buffer,
      [TELEMETRY.META_KEY]:    meta,
    }, resolve);
  });
}

function _validateBuffer(buf) {
  if (!buf || typeof buf !== 'object' || Array.isArray(buf)) return {};
  const clean = {};
  for (const [day, entry] of Object.entries(buf)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !entry || typeof entry !== 'object') continue;
    clean[day] = entry;
  }
  return clean;
}

function _ensureInstallId() {
  return new Promise(resolve => {
    chrome.storage.sync.get(['installId'], res => {
      if (res.installId) return resolve(res.installId);
      const id = crypto.randomUUID();
      chrome.storage.sync.set({ installId: id }, () => resolve(id));
    });
  });
}

// ── Snapshot: build today's aggregate from current config ────────────────────

function _buildSnapshot(data) {
  const ai = data.aiSites       || [];
  const se = data.searchEngines || [];
  return {
    app_version:          chrome.runtime.getManifest().version,
    enabled:              data.enabled !== false,
    is_pro:               isProUnlocked(data.license),
    is_trial:             isTrialActive(data.installDate),
    active_ai_count:      ai.filter(s => s.active).length,
    active_search_count:  se.filter(s => s.active).length,
    custom_ai_count:      ai.filter(s => s.custom).length,
    custom_search_count:  se.filter(s => s.custom).length,
    active_ai_ids:        ai.filter(s => s.active).map(s => s.id),
    active_search_ids:    se.filter(s => s.active).map(s => s.id),
  };
}

// ── Buffer management ────────────────────────────────────────────────────────

async function _refreshTodayBucket() {
  const today = _utcDay();
  const { buffer, meta } = await _readBuffer();
  const clean = _validateBuffer(buffer);
  const data  = await new Promise(resolve => getAllData(resolve));
  const snap  = _buildSnapshot(data);

  const existing = clean[today] || {};
  clean[today] = { ...snap, bang_histogram: existing.bang_histogram || {} };

  // Enforce backlog cap — drop oldest days beyond limit
  const days = Object.keys(clean).sort();
  while (days.length > TELEMETRY.MAX_BACKLOG_DAYS) {
    delete clean[days.shift()];
    meta.dropped_days = (meta.dropped_days || 0) + 1;
  }

  await _writeBuffer(clean, meta);
}

// ── Bang usage tracking (called from background.js on successful resolve) ───

function extractBangTokens(query, bangChar) {
  const bc = bangChar || '!';
  return query.split(/\s+/)
    .filter(t => t.startsWith(bc) && t.length > bc.length)
    .map(t => t.slice(bc.length));
}

async function recordBangUsage(bangTokens, source) {
  const today = _utcDay();
  const { buffer, meta } = await _readBuffer();
  const clean = _validateBuffer(buffer);

  if (!clean[today]) clean[today] = {};
  const hist = clean[today].bang_histogram || {};

  for (const token of bangTokens) {
    hist[token] = (hist[token] || 0) + 1;
  }
  if (source) {
    const key = '_src_' + source;
    hist[key] = (hist[key] || 0) + 1;
  }

  clean[today].bang_histogram = hist;
  await _writeBuffer(clean, meta);
}

// ── Heartbeat sender ────────────────────────────────────────────────────────

async function sendTelemetryHeartbeat() {
  try {
    await _refreshTodayBucket();

    const installId      = await _ensureInstallId();
    const { buffer, meta } = await _readBuffer();
    const clean          = _validateBuffer(buffer);
    const pendingDays    = Object.keys(clean).sort();

    if (pendingDays.length === 0) return;

    const payload = {
      telemetry_schema_version: TELEMETRY.SCHEMA_VERSION,
      install_id: installId,
      days: pendingDays.map(day => ({ day, ...clean[day] })),
    };

    const res = await fetch(TELEMETRY.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_CONFIG.ANON_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      meta.last_heartbeat_error_code = res.status;
      meta.last_heartbeat_error_at   = Date.now();
      meta.fail_count = (meta.fail_count || 0) + 1;
      await _writeBuffer(clean, meta);
      return;
    }

    const result       = await res.json();
    const acceptedDays = result.accepted_days || pendingDays;

    for (const day of acceptedDays) delete clean[day];

    meta.last_heartbeat_ok_at      = Date.now();
    meta.last_heartbeat_error_code = null;
    meta.success_count = (meta.success_count || 0) + 1;

    await _writeBuffer(clean, meta);
  } catch (_) {
    try {
      const { buffer, meta } = await _readBuffer();
      meta.last_heartbeat_error_code = 'network';
      meta.last_heartbeat_error_at   = Date.now();
      meta.fail_count = (meta.fail_count || 0) + 1;
      await _writeBuffer(buffer, meta);
    } catch (__) { /* storage unavailable — give up silently */ }
  }
}
