(function () {
  'use strict';

  // ── AI PROMPTER: NATIVE WAIT-AND-SEND ─────────────────────────────────────
  // This script ONLY runs on AI sites that natively fill the prompt from
  // the URL parameter (e.g. ChatGPT, Claude, Manus) but DO NOT hit send automatically.

  const hostname = window.location.hostname;
  const promptText = new URLSearchParams(window.location.search).get('q');
  if (!promptText) return;

  chrome.storage.sync.get(['enabled'], (syncData) => {
    if (syncData.enabled === false) return;
    chrome.storage.local.get(['aiSites'], (localData) => {
      const sites = localData.aiSites && localData.aiSites.length > 0
        ? localData.aiSites
        : getDefaultAiSites();
      const matched = sites.find(s => s.active && hostname.includes(s.match || s.id));
      if (!matched) return;

      waitForNativeFillAndSendEngine(hostname);
    });
  });

  function waitForNativeFillAndSendEngine(host) {
    const siteConfigs = {
      'chatgpt.com': {
        input: '#prompt-textarea, div[contenteditable="true"]',
        button: 'button[data-testid="send-button"], #composer-submit-button'
      },
      'claude.ai': {
        input: 'textarea[placeholder*="Claude" i], div[contenteditable="true"]',
        button: 'button[aria-label="Send Message"], button:has(svg[viewBox*="24 24"])'
      },
      'manus.im': {
        input: 'textarea, div[contenteditable="true"]',
        button: 'button[type="submit"], button[aria-label*="send" i]'
      }
    };

    const config = Object.entries(siteConfigs).find(([key]) => host.includes(key))?.[1];
    if (!config) return;

    let attempts = 0;
    const maxAttempts = 35; // ~10.5 seconds max waiting for page load

    const interval = setInterval(() => {
      attempts++;
      const editor = document.querySelector(config.input);

      if (editor) {
        clearInterval(interval);
        waitForContentAndClick(editor, config.button);
      }

      if (attempts >= maxAttempts) clearInterval(interval);
    }, 300);
  }

  function waitForContentAndClick(editor, buttonSelector) {
    let checkAttempts = 0;
    const checkInterval = setInterval(() => {
      const currentVal = editor.isContentEditable ? editor.innerText : editor.value;
      if (currentVal.trim().length > 0 || checkAttempts > 4) { // Only wait up to ~1.2s for native fill
        clearInterval(checkInterval);
        triggerSend(editor, buttonSelector);
      }
      checkAttempts++;
    }, 250);
  }

  function triggerSend(editor, buttonSelector) {
    const btn = document.querySelector(buttonSelector);
    if (btn && !btn.disabled) {
      btn.click();
    } else {
      editor.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13,
        bubbles: true, cancelable: true, composed: true
      }));
    }
  }

  function getDefaultAiSites() {
    return [
      { id: 'chatgpt',    match: 'chatgpt.com',       active: false },
      { id: 'claude',     match: 'claude.ai',         active: true },
      { id: 'gemini',     match: 'gemini.google.com', active: true },
      { id: 'deepseek',   match: 'deepseek.com',      active: false },
      { id: 'perplexity', match: 'perplexity.ai',     active: true },
      { id: 'grok',       match: 'grok.com',          active: false },
      { id: 'kimi',       match: 'kimi.com',          active: false },
      { id: 'mistral',    match: 'mistral.ai',        active: false },
      { id: 'hf',         match: 'huggingface.co',    active: false },
      { id: 'you',        match: 'you.com',           active: false },
      { id: 'manus',      match: 'manus.im',          active: false },
    ];
  }

})();
