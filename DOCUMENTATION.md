# Slingshot Extension Architecture & Documentation

This document explains the core logic, storage mechanics, and edge-case handling of the Slingshot Chrome Extension.

## 1. Core Architecture (The 5 Pillars)

The extension is split into distinct modules to keep concerns separated:

### A. The Storage & UI Layer (`popup.html/js`, `settings.html/js`, `storage.js`)
- **Purpose:** Handles user interaction and saves preferences to Chrome Sync & Local Storage.
- `storage.js` acts as a unified helper layer that both the UI and the background script use to read/write settings, parse custom shortcuts, and check trial limits.

### B. The Search Engine Interceptor (`scripts/search-interceptor.js`)
- **Purpose:** Runs *only* on supported Search Engine pages (Google, Bing, DuckDuckGo, etc.).
- **Logic:** It reads the search query from the URL. If it finds a word starting with the user's configured trigger character (default `!`), it instantly hides the page and sends a message to the background script to perform the redirect.

### C. The Background Resolver (`background.js`)
- **Purpose:** The invisible central hub of the extension.
- **Logic:**
  1. Listens for the `BANG_QUERY` message from the interceptor.
  2. Splits the query to identify the shortcut (`!yt`) and the search term (`cats`).
  3. Looks up the shortcut in the user's configured site lists (AI sites and search engines).
  4. Executes `chrome.tabs.update()` to redirect the browser tab to the final destination (e.g., `youtube.com/results?search_query=cats`).
- **Additional Duties:**
  - Runs alarms to fetch daily Search Engine config updates from Supabase.
  - Handles the omnibox (`bg` keyword) for address-bar shortcut searches.
  - Records `installDate` on first install for trial tracking.

### D. The AI Injectors (`scripts/ai-autosend.js` & `scripts/ai-native.js`)
Because different AI sites handle input differently, they require different injection scripts.
- **`ai-autosend.js`:** Runs on AI sites that *do not* read URL parameters automatically (Gemini, DeepSeek, Kimi, HuggingFace). It manually focuses the editor, pastes the text, and clicks the Send button.
- **`ai-native.js`:** Runs on AI sites that *do* read URL parameters automatically, but forget to hit the Send button (ChatGPT, Claude, Manus). It simply waits for the site to populate the input box, and then clicks Send.
- **No Script Required:** Sites like Perplexity, Grok, and You.com perfectly read URL parameters and execute searches natively. They require zero content scripts; the `background.js` redirect is enough.

### E. The Omnibox (`background.js`)
- **Purpose:** Lets users type shortcut commands directly in the Chrome address bar using the `bg` keyword.
- **Logic:** Type `bg !yt cats` in the address bar to search YouTube for "cats". Provides live suggestions showing active AI sites and meta-shortcuts (`!ai`, `!all`, `!gen`, `!dev`, `!des`, `!res`).
- If no shortcut is detected, falls back to a Google search.

---

## 2. Storage & Syncing

User settings are split across two Chrome storage areas to balance sync limits with data size.

### What is stored where:

**`chrome.storage.sync`** (100 KB limit, syncs across devices):
- `enabled`: The overall on/off toggle for the extension.
- `bangChar`: The trigger character (e.g., `!`, `@`, `#`).
- `installDate`: Timestamp of first install (trial tracking).
- `license`: Pro license key.
- `theme`: UI theme preference (`light`, `dark`, or `auto`).
- `installId`: Anonymous user ID for community request voting.
- `lastExport`: Timestamp of last backup export.
- `lastRequestTime`: Timestamp of last community request submission (rate limiting).

**`chrome.storage.local`** (5 MB limit, device-only):
- `aiSites`: The AI site list (hardcoded defaults + user toggles/customizations).
- `searchEngines`: The Search Engine list (minimal hardcoded fallback + locally cached Supabase list).

### The Problem with Default Lists & Server Syncing
To prevent the extension from being bloated with hardcoded domains, Search Engines are primarily defined in Supabase and merged into the user's locally cached list. AI sites are intentionally kept hardcoded.

**How it is handled (merge logic in `storage.js`, scheduler in `background.js`):**
1. **Fetching:** `background.js` fetches Search Engines from Supabase (`/rest/v1/search_engines`) on install, browser startup, and daily.
2. **Fresh Installs:** If the user has a completely empty local list (`isFresh`), the merge logic respects the server's default `active: true/false` statuses.
3. **Existing Users:** New engines discovered on the server are added but forced to `active: false` to avoid clutter.
4. **Updates:** If an engine still exists on the server, we update its URL/name while preserving the user's shortcut and `active` toggle.

---

## 3. Import / Export & Merging

When setting up a new device or restoring a backup, users can import a JSON file containing their settings.

### Conflict Resolution (Overlapping Shortcuts)
With custom shortcuts, remote configurations, and imports, it is possible for two sites to have the exact same shortcut (`!yt` for example). The system resolves these conflicts using a strict hierarchy of precedence.

When a user types a shortcut, `background.js` evaluates it in this exact order:
1. **Active AI Sites:** For each shortcut token, if it matches an active AI site (`!cl`), it triggers the AI redirect.
2. **Search Engines (including user custom engines):** If it does not match an AI site, it tries to match the shortcut against the `searchEngines` list.

**Meta-shortcuts:**
- `!ai` — fires all active AI sites simultaneously.
- `!all` — fires all active search engines simultaneously.
- `!gen` — fires active Search Engines in category `general`.
- `!dev` — fires active Search Engines in category `dev`.
- `!des` — fires active Search Engines in category `design`.
- `!res` — fires active Search Engines in category `research`.

Search category tabs in Settings are: `All`, `General`, `Dev`, `Design`, and `Research`.

**Importing & Default List Conflicts:**
If a user imports a JSON backup, or you push an update adding a new default site that shares a shortcut with an existing active site:
- **Blank Shortcut:** The new/imported conflicting site will be added to the user's list, but its shortcut will be intentionally left **blank** so it does not override the user's existing setup. The user must manually assign a new shortcut in settings.
- **Plan Preservation:** During an import, we **protect the `installDate` and `license` variables**. A user cannot import a "Pro" config JSON to cheat the system — these fields are stripped from any imported file before applying.

---

## 4. Subscription & Trial System (The 3 States)

The extension employs a rigid, user-friendly 3-state subscription model. Enforcement logic is completely isolated from the data layer — downgrading plans NEVER deletes a user's custom sites, it solely restricts their *active* capabilities.

### State 1: 30-Day Free Trial (All Features Unlocked)
- **Trigger:** First installation. `background.js` detects `onInstalled` and permanently saves `installDate` to Chrome Sync Storage.
- **Capabilities:** Identical to Pro. Users can enable infinite AI Sites and infinite Search Engines.

### State 2: Free State (Restricted Limits)
- **Trigger:** Exactly 30 days after `installDate` pass, or if a user imports a backup that is older than 30 days.
- **Capabilities:** Limited to **2 Active AI Sites** and **2 Active Search Engines**.
- **Enforcement (`enforceFreeLimits`):** When the trial formally expires, the next time the settings page opens, the extension evaluates their active sites. If a user has 5 active AIs, it retains the first 2 as `active: true` and gracefully downgrades the remaining 3 to `active: false`. It does not delete them.
- **UI Blocking:** The settings UI dynamically maps a padlock icon and opacity-fade over inactive toggles if the user has reached their 2-site cap, physically preventing them from clicking until they deactivate a different site.
- **Important:** Enforcement happens in the settings UI only. The background resolver trusts whatever sites are currently marked `active` in storage — it does not re-check the trial on every query.

### State 3: Pro
- **Trigger:** User enters a license key > 6 characters into the UI.
- **Capabilities:** Infinite AI & Search Engines unlocks forever. The UI perfectly re-enables all toggles.

### What happens if I change the default list?
If you push an update adding "NewCoolAI.com" to the default list:
- It will be added to everyone's list but will be **inactive by default**. To use it, users must explicitly toggle it on (and if they are Free, toggle something else off first).

If you push an update REMOVING an AI site or Search Engine from the default list:
- **If the user had it ACTIVE:** The site stays in their `chrome.storage.local` and is demoted to a "custom" site just for them.
- **If the user had it INACTIVE:** The site is dropped from their local storage so their list isn't cluttered with dead, unused defaults.

---

## 5. Theme System

The extension supports three theme modes: **Light**, **Dark**, and **Auto** (follows OS preference).

- The setting is stored in `chrome.storage.sync` as `theme` and syncs across devices.
- Both `popup.js` and `settings.js` apply the theme on load and listen for changes in real-time.
- A `theme-ready` class is added after initial application to prevent FOUC (flash of unstyled content) during page open.

---

## 6. Community Features

### News / Announcements
- Staff announcements are fetched from the Supabase `announcements` table and displayed on the News page in settings.
- Each announcement can have a title, description, version pill, and optional link.

### Community Requests
- Users can submit site requests (AI or Search Engine) and feature requests.
- Voting uses an anonymous `installId` stored in sync — no login required.
- Votes are toggled via a Supabase RPC function (`toggle_vote`).
- Submissions are rate-limited to one per hour per user (tracked via `lastRequestTime` in sync storage).

---

## 7. Admin / Debug Panel

A hidden admin panel is available in the settings page for development and testing. It is revealed by **double-clicking the sidebar logo**.

Capabilities:
- **State switching:** Instantly simulate Trial, Free, or Pro states by manipulating `installDate` and `license` in storage.
- **Force sync:** Trigger an immediate Supabase config sync.
- **Enforce limits:** Manually run the free-tier limit enforcer.
- **Wipe all:** Clear all extension data to simulate a fresh install.
- **Dump storage:** Print the current contents of both sync and local storage.
