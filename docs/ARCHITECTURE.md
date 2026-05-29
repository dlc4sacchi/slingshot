# Slingshot Architecture

Slingshot is a Manifest V3 browser extension. Runtime code is intentionally small and split by browser-extension responsibility.

## Runtime Pieces

- `manifest.json` declares extension permissions, popup/options pages, omnibox keyword, background service worker, and content scripts.
- `background-entry.js` loads shared scripts into the MV3 service worker in order: storage helpers, telemetry heartbeat, then the background resolver.
- `storage.js` owns defaults, storage reads/writes, feature flags, Supabase config, and merge logic for remote search engine updates.
- `background.js` resolves shortcut tokens, handles omnibox input, receives content-script requests, syncs remote search engines, and schedules daily sync/heartbeat work.
- `scripts/search-interceptor.js` runs on supported search engines and forwards queries that contain a configured bang trigger.
- `scripts/ai-autosend.js` and `scripts/ai-native.js` fill/send prompts on supported AI sites when URL query parameters are not enough.
- `scripts/features/*` contains optional AI-site behavior enhancements.
- `pages/popup.*` renders the quick active-shortcut cheatsheet.
- `pages/settings.*` renders configuration, import/export, news, requests, and feature controls.

## Storage

Slingshot uses two browser storage areas:

- `chrome.storage.sync` for small settings that should follow the user: `enabled`, `bangChar`, `theme`, `installId`, `installDate`, `license`, `aiFeatures`, and export/request metadata.
- `chrome.storage.local` for larger per-device data: AI site lists, search engine lists, telemetry buffer, and related local caches.

## Shortcut Resolution

Shortcut queries are split into bang tokens and query text. For example, `!yt lo-fi beats` becomes bang `yt` and query `lo-fi beats`.

Resolution order:

1. Meta shortcuts: `!ai`, `!all`, `!gen`, `!dev`, `!des`, `!res`.
2. Active AI site shortcuts.
3. Active search engine shortcuts.

Matched URL templates replace `%s` with `encodeURIComponent(query)`. Multiple matches open multiple tabs with duplicates removed.

## Hosted Backend

Official builds use Supabase for remote search engines, announcements, community requests, voting, and anonymous telemetry. The client-side anon key is public by design; all trust boundaries must be enforced by Supabase policies, RPC validation, and Edge Functions.

Self-hosting notes and SQL setup files live in [docs/supabase](supabase).

## Release Builds

Release zips are produced by [scripts/package-extension.sh](../scripts/package-extension.sh). The package should include only extension runtime files and exclude public docs, SQL setup files, screenshot tooling, and local artifacts.
