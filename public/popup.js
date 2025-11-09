(function(){
  const statusEl = document.getElementById('status');
  const previewEl = document.getElementById('preview');
  const fillBtn = document.getElementById('fillBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const syncBtn = document.getElementById('syncBtn');
  const themeToggle = document.getElementById('themeToggle');
  const importLinkedInBtn = document.getElementById('importLinkedInBtn');

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
      } else {
        setStatus('Done');
      }
      setTimeout(()=> setStatus('idle'), 2000);
    });
  });

  refreshBtn.addEventListener('click', () => { setStatus('refresh'); loadProfile(); setTimeout(()=> setStatus('idle'), 800); });

  syncBtn.addEventListener('click', () => {
    setStatus('syncing...');
    chrome.runtime.sendMessage({ type: 'SYNC_FROM_ACTIVE_TAB' }, (resp) => {
      if (chrome.runtime.lastError) { setStatus('error'); return; }
      if (resp?.ok) {
        setStatus('synced');
        loadProfile();
      } else {
        setStatus(resp?.error || 'failed');
      }
      setTimeout(()=> setStatus('idle'), 1800);
    });
  });

  themeToggle?.addEventListener('change', () => {
    const dark = !!themeToggle.checked;
    document.body.classList.toggle('je-dark', dark);
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) {}
  });

  importLinkedInBtn?.addEventListener('click', () => {
    setStatus('importing...');
    chrome.runtime.sendMessage({ type: 'IMPORT_FROM_LINKEDIN' }, (resp) => {
      if (chrome.runtime.lastError) { setStatus('error'); return; }
      if (resp?.ok && resp.data) {
        // Merge imported data into stored profile
        const data = resp.data;
        chrome.storage.local.get('profile', (res) => {
          const p = res?.profile || {};
          const merged = { ...p, ...data };
          chrome.storage.local.set({ profile: merged }, () => {
            setStatus('imported');
            loadProfile();
            setTimeout(()=> setStatus('idle'), 1600);
          });
        });
      } else {
        setStatus(resp?.error || 'not on LinkedIn profile');
        setTimeout(()=> setStatus('idle'), 1600);
      }
    });
  });

  loadProfile();
})();