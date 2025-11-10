// Background script: listens for keyboard commands and forwards fill requests to active tab

if (typeof chrome !== 'undefined' && chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'trigger-fill') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) return;
        chrome.tabs.sendMessage(tab.id, { type: 'DO_FILL' }, async (resp) => {
          if (chrome.runtime.lastError) {
            // Try to inject content script and retry
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
              chrome.tabs.sendMessage(tab.id, { type: 'DO_FILL' }, (r2) => {
                console.log('Fill after inject', r2);
              });
            } catch (e) {
              console.warn('Failed to inject content script', e);
            }
          } else {
            console.log('Fill response', resp);
          }
        });
      });
    }
    if (command === 'open-job-ease') {
      try { chrome.tabs.create({ url: 'https://job-ease.vercel.app/' }); } catch (e) { console.warn('Failed to open web app', e); }
    }
  });
}

// Basic message forwarding: allow popup to ask background to call content script
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req?.type === 'OPEN_WEB_APP') {
      try { chrome.tabs.create({ url: 'https://job-ease.vercel.app/' }); sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false }); }
      return; 
    }
    // Popup asks background to sync profile from the active tab's localStorage
    if (req?.type === 'SYNC_FROM_ACTIVE_TAB') {
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'no-active-tab' });
          return;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              try {
                const raw = window.localStorage.getItem('jobEaseProfile');
                return raw ? JSON.parse(raw) : null;
              } catch (e) { return null; }
            }
          });
          const value = results && results[0] ? results[0].result : null;
          if (!value) {
            sendResponse({ ok: false, error: 'no-profile-in-tab' });
            return;
          }
          chrome.storage.local.set({ profile: value }, () => {
            sendResponse({ ok: true, saved: true });
          });
        } catch (e) {
          sendResponse({ ok: false, error: 'exec-failed' });
        }
      });
      return true; // async
    }
    if (req?.type === 'DO_FILL_ACTIVE_TAB') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.id) {
          sendResponse({ ok: false, error: 'no-active-tab' });
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'DO_FILL' }, async (resp) => {
          if (chrome.runtime.lastError) {
            try {
              await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
              chrome.tabs.sendMessage(tab.id, { type: 'DO_FILL' }, (r2) => {
                // include metrics from content script
                sendResponse(r2 || { ok: true });
              });
            } catch (e) {
              sendResponse({ ok: false, error: 'inject-failed' });
            }
          } else {
            // include metrics from content script
            sendResponse(resp || { ok: true });
          }
        });
      });
      return true; // indicates we'll send response asynchronously
    }
    // LinkedIn import removed per updated requirements.
  });
}
