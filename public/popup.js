(function(){
  const statusEl = document.getElementById('status');
  const metricsEl = document.getElementById('metrics');
  const previewEl = document.getElementById('preview');
  const fillBtn = document.getElementById('fillBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const openAppBtn = document.getElementById('openAppBtn');
  const syncBtn = document.getElementById('syncBtn');
  const themeToggle = document.getElementById('themeToggle');
  const toggleDiagBtn = document.getElementById('toggleDiagBtn');
  const sitePrefsToggle = document.getElementById('sitePrefsToggle');
  const clearSitePrefsBtn = document.getElementById('clearSitePrefsBtn');

  // Initialize theme from storage
  const THEME_KEY = 'jobease_theme';
  try {
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme === 'dark') {
      document.body.classList.add('je-dark');
      if (themeToggle) themeToggle.checked = true;
    }
  } catch (e) {}

  function setStatus(msg){ statusEl.textContent = msg; }

  function loadProfile(){
    if (chrome?.storage?.local?.get) {
      chrome.storage.local.get('profile', (res) => {
        const p = res?.profile; 
        if (!p) { previewEl.textContent = 'No profile found. Open Coworker Michael app and sync.'; return; }
        previewEl.textContent = JSON.stringify({
          name: p.firstName + ' ' + p.lastName,
          email: p.email,
          location: p.locationCity,
          degree: p.degree,
          resume: p.resumeName || '—'
        }, null, 2);
      });
    } else {
      previewEl.textContent = 'chrome.storage not available';
    }
  }

  fillBtn.addEventListener('click', () => {
    setStatus('filling...');
    chrome.runtime.sendMessage({ type: 'DO_FILL_ACTIVE_TAB' }, (resp) => {
      if (chrome.runtime.lastError) {
        setStatus('error: content script');
        return;
      }
      if (resp && (resp.filled != null)) {
        const parts = [];
        parts.push(`Filled ${resp.filled}`);
        if (resp.total != null) parts.push(`of ${resp.total}`);
        if (resp.durationMs != null) parts.push(`in ${resp.durationMs}ms`);
        if (resp.fileAttached) parts.push(`+ file`);
        setStatus(parts.join(' '));
        try {
          if (metricsEl) {
            const slow = Array.isArray(resp.events) ? [...resp.events].sort((a,b)=> (b.ms||0)-(a.ms||0)).slice(0,5) : [];
            const lines = [
              `Last fill: ${resp.filled}/${resp.total} in ${resp.durationMs}ms`,
              slow.length ? 'Slowest fields:' : ''
            ].concat(slow.map(e => `• ${e.field || 'field'} — ${e.ms}ms`));
            metricsEl.textContent = lines.filter(Boolean).join('\n');
          }
        } catch(e) {}
      } else {
        setStatus('Done');
      }
      setTimeout(()=> setStatus('idle'), 2000);
    });
  });

  refreshBtn.addEventListener('click', () => { setStatus('refresh'); loadProfile(); setTimeout(()=> setStatus('idle'), 800); });

  // Open JobEase web app in a new tab
  openAppBtn?.addEventListener('click', () => {
    try {
      if (chrome?.tabs?.create) {
        chrome.tabs.create({ url: 'https://job-ease.vercel.app/' });
      } else {
        // fallback
        window.open('https://job-ease.vercel.app/', '_blank');
      }
    } catch(e) {
      try { window.open('https://job-ease.vercel.app/', '_blank'); } catch(_) {}
    }
  });

  // Bring back Sync From Tab in popup: pulls app's local profile from active tab localStorage
  syncBtn?.addEventListener('click', () => {
    setStatus('syncing...');
    chrome.runtime.sendMessage({ type: 'SYNC_FROM_ACTIVE_TAB' }, (resp) => {
      if (chrome.runtime.lastError) { setStatus('error'); return; }
      if (resp?.ok) {
        setStatus('synced');
        loadProfile();
      } else {
        setStatus(resp?.error || 'failed');
      }
      setTimeout(()=> setStatus('idle'), 1600);
    });
  });

  // Diagnostics overlay toggle
  let diagEnabled = false;
  toggleDiagBtn?.addEventListener('click', () => {
    diagEnabled = !diagEnabled;
    toggleDiagBtn.textContent = `Diagnostics: ${diagEnabled ? 'On' : 'Off'}`;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) return;
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DIAGNOSTICS', enabled: diagEnabled }, (resp) => {
        if (chrome.runtime.lastError) {
          // Attempt injection then retry once
          chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }).then(() => {
            chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DIAGNOSTICS', enabled: diagEnabled }, () => {});
          }).catch(() => {});
        }
      });
    });
  });


  themeToggle?.addEventListener('change', () => {
    const dark = !!themeToggle.checked;
    document.body.classList.toggle('je-dark', dark);
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) {}
  });

  // Initialize site preferences toggle
  if (chrome?.storage?.local?.get) {
    chrome.storage.local.get('sitePrefsEnabled', (res) => {
      const enabled = !!res?.sitePrefsEnabled;
      if (sitePrefsToggle) sitePrefsToggle.checked = enabled;
    });
  }

  sitePrefsToggle?.addEventListener('change', () => {
    const enabled = !!sitePrefsToggle.checked;
    try {
      chrome.storage.local.set({ sitePrefsEnabled: enabled });
      setStatus(enabled ? 'per-site prefs ON' : 'per-site prefs OFF');
      setTimeout(()=> setStatus('idle'), 1200);
    } catch (e) {}
  });

  clearSitePrefsBtn?.addEventListener('click', () => {
    setStatus('clearing...');
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs?.[0]?.url || '';
        let host = '';
        try { host = new URL(url).hostname; } catch (e) { host = ''; }
        if (!host) { setStatus('no-host'); setTimeout(()=> setStatus('idle'), 1200); return; }
        chrome.storage.local.get('sitePrefs', (res) => {
          const all = res?.sitePrefs || {};
          if (all[host]) {
            delete all[host];
            chrome.storage.local.set({ sitePrefs: all }, () => {
              setStatus('site prefs cleared');
              setTimeout(()=> setStatus('idle'), 1200);
            });
          } else {
            setStatus('no saved prefs');
            setTimeout(()=> setStatus('idle'), 1200);
          }
        });
      });
    } catch (e) { setStatus('error'); setTimeout(()=> setStatus('idle'), 1200); }
  });


  loadProfile();
})();