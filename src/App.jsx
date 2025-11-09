import React, { useState, useEffect, useRef } from 'react';
import './App.css';
/* global chrome */

const STORAGE_KEY = 'jobEaseProfile';

function defaultProfile() {
  return {
    firstName: '',
    lastName: '',
    email: '',
  github: '',
  phone: '',
    address: '',
    // contact/links
    locationCity: '',
    linkedin: '',
    // resume and cover letter stored as dataURL and filename so the extension can attach them
    resumeName: '',
    resumeData: '',
    coverName: '',
    coverData: '',
    // education (primary)
    school: '',
    degree: '',
    discipline: '',
    // employment (primary)
    companyName: '',
    jobTitle: '',
  startMonth: '', // numeric MM or month name selectable
  startDay: '',
  startYear: '',
  endMonth: '',
  endDay: '',
  endYear: '',
    currentlyEmployed: false,
  // prechecks / legal
  ageOver18: true,
    howHeard: '',
  consentAI: false,
  authorizedToWork: true,
    requireVisa: false,
    govOfficial: false,
    relativeGovOfficial: false,
    // misc
    notes: ''
  };
}

export default function App() {
  const [profile, setProfile] = useState(defaultProfile());
  const [message, setMessage] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('jobease_theme') === 'dark'; } catch(e){ return false; }
  });
  const importInputRef = useRef(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setProfile(JSON.parse(raw));
      // apply theme class
      document.body.classList.toggle('je-dark', darkMode);
    } catch (e) {
      console.warn('Failed to load profile', e);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle('je-dark', darkMode);
    try { localStorage.setItem('jobease_theme', darkMode ? 'dark' : 'light'); } catch(e){}
  }, [darkMode]);

  // Autosave and optional sync to extension storage (debounced)
  const saveTimeout = useRef(null);
  useEffect(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch (e) {}
      if (window.chrome && chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.set === 'function') {
        try { chrome.storage.local.set({ profile }, () => {}); } catch (e) {}
      }
    }, 600);
    return () => { if (saveTimeout.current) clearTimeout(saveTimeout.current); };
  }, [profile]);

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch (e) {}
    if (window.chrome && chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.set === 'function') {
      try { chrome.storage.local.set({ profile }, () => {}); } catch (e) {}
    }
    setMessage('Saved');
    setTimeout(() => setMessage(''), 1500);
  }

    function syncToExtension() {
      try {
        if (window.chrome && chrome?.storage?.local?.set) {
          chrome.storage.local.set({ profile }, () => {
            setMessage('Synced to extension storage');
            setTimeout(() => setMessage(''), 1500);
          });
        } else if (window.chrome && chrome?.runtime?.sendMessage) {
          // Ask background to pull from this tab if direct storage API not exposed
          chrome.runtime.sendMessage({ type: 'SYNC_FROM_ACTIVE_TAB' }, (resp) => {
            if (resp?.ok) {
              setMessage('Synced via background');
            } else {
              setMessage('Background sync failed');
            }
            setTimeout(() => setMessage(''), 2000);
          });
        } else {
          setMessage('Extension APIs unavailable. Open popup then retry.');
          setTimeout(() => setMessage(''), 2200);
        }
      } catch (err) {
        console.warn('syncToExtension failed', err);
        setMessage('Sync failed');
        setTimeout(() => setMessage(''), 1800);
      }
    }

    function loadFromExtension() {
        try {
          if (window.chrome && chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
            chrome.storage.local.get('profile', (res) => {
              if (res && res.profile) {
                // Merge into defaults to ensure missing keys get default values
                setProfile(prev => ({ ...defaultProfile(), ...res.profile }));
                setMessage('Loaded from extension');
              } else {
                setMessage('No profile in extension storage');
              }
              setTimeout(() => setMessage(''), 1400);
            });
          } else {
            setMessage('Extension storage not available. Open the extension popup to load.');
            setTimeout(() => setMessage(''), 2200);
          }
        } catch (err) {
          console.warn('loadFromExtension failed', err);
          setMessage('Load failed');
          setTimeout(() => setMessage(''), 1800);
        }
  }

  function clearProfile() {
    setProfile(defaultProfile());
    localStorage.removeItem(STORAGE_KEY);
    if (window.chrome && chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove('profile');
    }
    setMessage('Cleared');
    setTimeout(() => setMessage(''), 1500);
  }

  function exportJSON() {
    const data = JSON.stringify(profile, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jobease-profile.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        setProfile({ ...defaultProfile(), ...parsed });
        setMessage('Imported');
        setTimeout(() => setMessage(''), 1500);
      } catch (err) {
        setMessage('Invalid JSON');
        setTimeout(() => setMessage(''), 2000);
      } finally {
        // reset input so the same file can be selected again if needed
        try { if (importInputRef.current) importInputRef.current.value = ''; } catch (e) {}
      }
    };
    reader.readAsText(file);
  }

  function update(key, value) {
    setProfile(prev => ({ ...prev, [key]: value }));
  }

  function handleResumeUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setProfile(prev => ({ ...prev, resumeName: file.name, resumeData: dataUrl }));
      setMessage('Resume uploaded');
      setTimeout(() => setMessage(''), 1500);
    };
    reader.readAsDataURL(file);

    // Optional auto-parse for text-based resumes (txt/rtf) for quick field extraction
    const isTextLike = /text|rtf/.test(file.type) || /\.(txt|rtf)$/i.test(file.name);
    if (isTextLike) {
      try {
        const textReader = new FileReader();
        textReader.onload = () => {
          try {
            const text = String(textReader.result || '');
            const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
            const phoneMatch = text.match(/\+?[0-9][0-9()\-\s]{7,}[0-9]/);
            // naive name extraction: first non-empty line with 2-4 words
            const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let nameParts = [];
            for (const line of lines.slice(0, 10)) {
              if (/^[A-Za-z ,.'\-]{3,}$/.test(line)) {
                const parts = line.split(/\s+/).filter(p => /^[A-Za-z\-'.]+$/.test(p));
                if (parts.length >= 2 && parts.length <= 4) { nameParts = parts; break; }
              }
            }
            setProfile(prev => ({
              ...prev,
              email: prev.email || (emailMatch ? emailMatch[0] : prev.email),
              phone: prev.phone || (phoneMatch ? phoneMatch[0] : prev.phone),
              firstName: prev.firstName || (nameParts[0] || prev.firstName),
              lastName: prev.lastName || (nameParts.slice(1).join(' ') || prev.lastName)
            }));
          } catch(err) {}
        };
        textReader.readAsText(file);
      } catch(err) {}
    }
  }

  function removeResume() {
    setProfile(prev => ({ ...prev, resumeName: '', resumeData: '' }));
    setMessage('Resume removed');
    setTimeout(() => setMessage(''), 1200);
  }

  function handleCoverUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      setProfile(prev => ({ ...prev, coverName: file.name, coverData: dataUrl }));
      setMessage('Cover letter uploaded');
      setTimeout(() => setMessage(''), 1500);
    };
    reader.readAsDataURL(file);
  }

  function removeCover() {
    setProfile(prev => ({ ...prev, coverName: '', coverData: '' }));
    setMessage('Cover removed');
    setTimeout(() => setMessage(''), 1200);
  }

  return (
    <div className="je-container" style={{ maxWidth: 900, margin: '20px auto' }}>
  <div className="je-hero">
    <img src="icon128.png" alt="Coworker Michael" className="je-hero-avatar" />
    <div>
      <h1 id="job-ease-title">Coworker Michael — Profile</h1>
      <p className="je-small je-hero-tagline">“I wrote that one-liner.” Now I write all your application fields. Command: <code>Ctrl/Cmd+Shift+Y</code></p>
    </div>
  </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <input autoComplete="given-name" className="je-input" placeholder="First name *" value={profile.firstName} onChange={e => update('firstName', e.target.value)} />
          <input autoComplete="family-name" className="je-input" placeholder="Last name *" value={profile.lastName} onChange={e => update('lastName', e.target.value)} />
          <input autoComplete="email" className="je-input" placeholder="Email *" value={profile.email} onChange={e => update('email', e.target.value)} />
          <input autoComplete="tel" className="je-input" placeholder="Phone *" value={profile.phone} onChange={e => update('phone', e.target.value)} />
          <input autoComplete="address-level2" className="je-input" placeholder="Location (City)" value={profile.locationCity} onChange={e => update('locationCity', e.target.value)} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label className="je-label">Upload Resume/CV (pdf/doc/docx)</label>
            <input className="je-input" type="file" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/rtf" onChange={handleResumeUpload} />
            {profile.resumeName && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <strong>Selected:</strong> {profile.resumeName}
                <button className="je-button alt" onClick={removeResume} style={{ marginLeft: 8 }}>Remove</button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label className="je-label">Upload Cover Letter (optional)</label>
            <input className="je-input" type="file" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,application/rtf" onChange={handleCoverUpload} />
            {profile.coverName && (
              <div style={{ marginTop: 6, fontSize: 13 }}>
                <strong>Selected:</strong> {profile.coverName}
                <button className="je-button alt" onClick={removeCover} style={{ marginLeft: 8 }}>Remove</button>
              </div>
            )}
          </div>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="je-grid" style={{ marginTop: 12 }}>
          <input autoComplete="school" className="je-input" placeholder="School *" value={profile.school} onChange={e => update('school', e.target.value)} />
          <select className="je-input" value={profile.degree} onChange={e => update('degree', e.target.value)}>
            <option value="">Select degree</option>
            <option>High School Diploma</option>
            <option>Associate's Degree</option>
            <option>Bachelor's Degree</option>
            <option>Master's Degree</option>
            <option>Doctorate / PhD</option>
            <option>Other</option>
          </select>
          <input className="je-input" placeholder="Discipline *" value={profile.discipline} onChange={e => update('discipline', e.target.value)} />
          <input autoComplete="url" className="je-input" placeholder="LinkedIn Profile URL" value={profile.linkedin} onChange={e => update('linkedin', e.target.value)} />
        </div>
      </div>

      <h4 style={{ marginTop: 14 }}>Employment (most recent)</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="je-grid" style={{ marginTop: 6 }}>
          <input className="je-input" placeholder="Company Name" value={profile.companyName} onChange={e => update('companyName', e.target.value)} />
          <input className="je-input" placeholder="Title" value={profile.jobTitle} onChange={e => update('jobTitle', e.target.value)} />
          <select className="je-input" value={profile.startMonth} onChange={e => update('startMonth', e.target.value)}>
            <option value="">Start Month</option>
            <option value="01">January</option>
            <option value="02">February</option>
            <option value="03">March</option>
            <option value="04">April</option>
            <option value="05">May</option>
            <option value="06">June</option>
            <option value="07">July</option>
            <option value="08">August</option>
            <option value="09">September</option>
            <option value="10">October</option>
            <option value="11">November</option>
            <option value="12">December</option>
          </select>
          <input className="je-input" placeholder="Start Day (DD)" value={profile.startDay} onChange={e => update('startDay', e.target.value)} />
          <input className="je-input" placeholder="Start Year (YYYY)" value={profile.startYear} onChange={e => update('startYear', e.target.value)} />
          <select className="je-input" value={profile.endMonth} onChange={e => update('endMonth', e.target.value)}>
            <option value="">End Month</option>
            <option value="01">January</option>
            <option value="02">February</option>
            <option value="03">March</option>
            <option value="04">April</option>
            <option value="05">May</option>
            <option value="06">June</option>
            <option value="07">July</option>
            <option value="08">August</option>
            <option value="09">September</option>
            <option value="10">October</option>
            <option value="11">November</option>
            <option value="12">December</option>
          </select>
          <input className="je-input" placeholder="End Day (DD)" value={profile.endDay} onChange={e => update('endDay', e.target.value)} />
          <input className="je-input" placeholder="End Year (YYYY)" value={profile.endYear} onChange={e => update('endYear', e.target.value)} />
          <label className="je-small"><input type="checkbox" checked={profile.currentlyEmployed} onChange={e => update('currentlyEmployed', e.target.checked)} /> Currently employed</label>
        </div>
      </div>

      <h4 style={{ marginTop: 14 }}>Application Questions</h4>
      <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="je-grid" style={{ marginTop: 8 }}>
          <label className="je-small"><input type="checkbox" checked={profile.ageOver18} onChange={e => update('ageOver18', e.target.checked)} /> Are you at least 18 years of age?</label>
          <input className="je-input" placeholder="How did you hear about this job?" value={profile.howHeard} onChange={e => update('howHeard', e.target.value)} />
          <label className="je-small"><input type="checkbox" checked={profile.consentAI} onChange={e => update('consentAI', e.target.checked)} /> I understand this employer may use AI tools</label>
          <label className="je-small"><input type="checkbox" checked={profile.authorizedToWork} onChange={e => update('authorizedToWork', e.target.checked)} /> Legally authorized to work in country</label>
          <label className="je-small"><input type="checkbox" checked={profile.requireVisa} onChange={e => update('requireVisa', e.target.checked)} /> Will you require sponsorship for an employment visa?</label>
          <label className="je-small"><input type="checkbox" checked={profile.govOfficial} onChange={e => update('govOfficial', e.target.checked)} /> Current/recent government official?</label>
          <label className="je-small"><input type="checkbox" checked={profile.relativeGovOfficial} onChange={e => update('relativeGovOfficial', e.target.checked)} /> Close relative of a government official?</label>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div className="je-actions">
          <button className="je-button" onClick={save}>Save</button>
          <button className="je-button alt" onClick={clearProfile}>Clear</button>
          <button className="je-button alt" onClick={exportJSON}>Export JSON</button>
          <input ref={importInputRef} type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
          <button type="button" className="je-button alt" onClick={() => importInputRef.current && importInputRef.current.click()}>Import JSON</button>
          <button className="je-button" onClick={syncToExtension}>Sync to Extension</button>
          <button className="je-button alt" onClick={loadFromExtension}>Load from Extension</button>
          <button className="je-button alt" onClick={() => setDarkMode(d => !d)}>{darkMode ? 'Light Mode' : 'Dark Mode'}</button>
        </div>
      </div>

      {message && <div style={{ marginTop: 12 }} className="je-small">{message}</div>}

  <h3 className="je-section-title">Preview</h3>
  <pre className="je-preview">{JSON.stringify(profile, null, 2)}</pre>

      <p style={{ marginTop: 12, color: '#666' }}>Tip: Install the extension and use the popup or keyboard shortcut to auto-fill forms on any page.</p>
    </div>
  );
}