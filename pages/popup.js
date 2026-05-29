// Apply saved theme and keep in sync with settings page
(function() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  function applyTheme(mode) {
    const isDark = mode === 'dark' || ((mode === 'auto' || mode === 'system') && prefersDark);
    document.documentElement.classList.toggle('dark', isDark);
  }

  // Load on open — add theme-ready after first apply to prevent flash
  chrome.storage.sync.get(['theme'], d => {
    applyTheme(d.theme || 'auto');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.add('theme-ready');
      });
    });
  });

  // Stay in sync if user changes theme in settings while popup is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.theme) {
      applyTheme(changes.theme.newValue || 'auto');
    }
  });
})();

const DARK_BG_SITES = new Set([
  'chatgpt','grok','deepseek','kimi','x','tiktok','dockerhub','wayback','aur','npm'
]);

function faviconUrl(domain) {
  return `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=32`;
}

function domainFrom(s) {
  if (s.match) return s.match;
  try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch(e) { return s.id; }
}

function makeCheatItem(s, bc) {
  const darkBg = DARK_BG_SITES.has(s.id);
  const pad = darkBg ? 2 : 0;
  const inner = 14 - pad * 2;

  const el = document.createElement('div');
  el.className = 'cheat-item';

  const iconDiv = document.createElement('div');
  iconDiv.className = 'cheat-icon';
  iconDiv.style.background = darkBg ? '#fff' : 'transparent';

  const img = document.createElement('img');
  img.style.cssText = `width:${inner}px;height:${inner}px;object-fit:cover;display:block;border-radius:${darkBg?'1px':'3px'}`;
  img.src = faviconUrl(domainFrom(s));
  img.onerror = () => {
    img.remove();
    iconDiv.style.background = s.custom ? '#6c63ff' : '#444';
    iconDiv.style.fontSize = '7px';
    iconDiv.style.fontWeight = '700';
    iconDiv.style.color = '#fff';
    iconDiv.textContent = s.name[0].toUpperCase();
  };
  iconDiv.appendChild(img);

  const name = document.createElement('span');
  name.className = 'cheat-name';
  name.textContent = s.name;

  const bang = document.createElement('span');
  bang.className = 'cheat-bang';
  bang.textContent = bc + s.bang;

  el.appendChild(iconDiv);
  el.appendChild(name);
  el.appendChild(bang);
  return el;
}

getAllData(({ aiSites, searchEngines, bangChar }) => {
  const bc = bangChar || '!';

  function renderGrid(sites, gridId) {
    const grid = document.getElementById(gridId);
    const active = sites.filter(s => s.active);
    if (active.length === 0) {
      grid.innerHTML = '<div class="empty-msg">none active</div>';
      return;
    }
    active.forEach(s => grid.appendChild(makeCheatItem(s, bc)));
  }

  renderGrid(aiSites, 'aiGrid');
  renderGrid(searchEngines, 'srGrid');
});

// Show the keyboard shortcut — check all commands, use first one with a shortcut set
if (chrome.commands) {
  chrome.commands.getAll(cmds => {
    const el = document.getElementById('kbdShortcut');
    if (!el) return;
    // Find any command that has a non-empty shortcut string
    const withShortcut = cmds.find(c => c.shortcut && c.shortcut.trim() !== '');
    el.textContent = withShortcut ? withShortcut.shortcut : 'Alt+Shift+B';
  });
}

// Header Actions
document.getElementById('bugBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings.html') + '#requests-bug' });
});

document.getElementById('openBtn').addEventListener('click', () => {
  // Kick off a remote config sync while we open the settings page.
  // Settings page listens for SYNC_COMPLETE and will reload itself.
  chrome.runtime.sendMessage({ type: 'FORCE_SYNC' }).catch(() => {});
  chrome.runtime.openOptionsPage ? chrome.runtime.openOptionsPage() : window.open(chrome.runtime.getURL('pages/settings.html'));
});

// "edit" button → open Shortcuts page in settings
document.getElementById('shortcutBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/settings.html') + '#shortcuts' });
});

