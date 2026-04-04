(function () {
  'use strict';

  // ── AI PROMPTER: AUTO-SEND ────────────────────────────────────────────────
  // This script ONLY runs on AI sites that DO NOT natively fill the prompt from
  // the URL parameter (e.g. Gemini, DeepSeek, Kimi, HuggingFace).

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

      autoFillAndSendEngine(hostname, promptText);
    });
  });

  function autoFillAndSendEngine(host, text) {
    const siteConfigs = {
      'gemini.google.com': {
        input: 'div[contenteditable="true"], textarea[placeholder*="Gemini" i], rich-textarea div[contenteditable="true"], [role="textbox"]',
        button: '.send-button, button[aria-label*="Send message" i], button[mattooltip*="Send message" i]'
      },
      'deepseek.com': {
        input: 'textarea[placeholder*="Message" i], textarea#chat-input',
        button: 'button[aria-label*="send" i], div[role="button"][aria-label*="send" i], button:has(svg):last-of-type'
      },
      'kimi.com': {
        input: 'div[contenteditable="true"], textarea[placeholder*="Kimi" i], textarea[placeholder*="Ask" i]',
        button: 'button[aria-label*="send" i], button[type="submit"], .send-button, button:has(svg):last-of-type'
      },
      'huggingface.co': {
        input: 'textarea[placeholder*="Ask" i], textarea',
        button: 'button[type="submit"]'
      }
    };

    const config = Object.entries(siteConfigs).find(([key]) => host.includes(key))?.[1];
    if (!config) return;

    let attempts = 0;
    const maxAttempts = 35; // ~10.5 seconds max waiting for page load

    const interval = setInterval(() => {
      attempts++;
      let editor = document.querySelector(config.input);

      // Shadow DOM handling for Gemini
      if (host.includes('gemini')) {
        const richTextarea = document.querySelector('rich-textarea');
        if (richTextarea && richTextarea.shadowRoot) {
          editor = richTextarea.shadowRoot.querySelector('div[contenteditable="true"]');
        }
        if (!editor) {
          editor = document.querySelector('div[contenteditable="true"], rich-textarea div[contenteditable="true"], [role="textbox"]');
        }
      }

      if (editor) {
        clearInterval(interval);
        fillInputAndSend(editor, text, config.button);
      }

      if (attempts >= maxAttempts) clearInterval(interval);
    }, 300);
  }

  function fillInputAndSend(editor, text, buttonSelector) {
    editor.focus();

    if (editor.isContentEditable || editor.tagName === 'DIV') {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    } else {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(editor, text);
      } else {
        editor.value = text;
      }
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setTimeout(() => triggerSend(editor, buttonSelector), 300);
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
