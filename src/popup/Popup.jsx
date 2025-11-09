// Note: This React component isn't used by the Chrome extension popup anymore.
// The extension action now points to `public/popup.html` (static) for reliability with MV3.
// Keep this file only if you want to render a popup preview inside the web app.
import React, { useState, useEffect } from 'react';
import '../popup/Popup.css';

export default function Popup() {
  const [status, setStatus] = useState('idle');
  const [profilePreview, setProfilePreview] = useState(null);

  useEffect(() => {
    // try to load profile from extension storage for preview
    if (window.chrome && chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
      chrome.storage.local.get('profile', (res) => {
        setProfilePreview(res?.profile || null);
      });
    }
  }, []);

  function refreshPreview() {
    if (window.chrome && chrome && chrome.storage && chrome.storage.local && typeof chrome.storage.local.get === 'function') {
      chrome.storage.local.get('profile', (res) => {
        setProfilePreview(res?.profile || null);
      });
    }
  }

  async function doFill() {
    setStatus('sending');
    if (window.chrome && chrome && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'DO_FILL_ACTIVE_TAB' }, (resp) => {
        setStatus(resp?.filled ? `Filled ${resp.filled} fields` : 'Done');
        setTimeout(() => setStatus('idle'), 2000);
      });
    } else {
      setStatus('no-chrome-api');
      setTimeout(() => setStatus('idle'), 2000);
    }
  }

  return (
    <div className="je-popup" style={{ padding: 12, fontFamily: 'system-ui, sans-serif' }}>
      <div className="je-popup-header">
        <img src="icon48.png" alt="Coworker Michael" className="je-popup-avatar" />
        <div>
          <h3 style={{ margin: 0 }}>Coworker Michael</h3>
          <div className="je-popup-tagline">THE Coworker Michael. Famous One-Liner now here to simplify applying to jobs.</div>
        </div>
      </div>

      <div className="je-actions">
        <button onClick={doFill}>Fill Form</button>
        <button onClick={refreshPreview}>Refresh</button>
      </div>

      <div style={{ fontSize: 13, color: '#333', marginBottom: 8 }}>
        <strong>Status:</strong> {status}
      </div>

      <div style={{ maxHeight: 220, overflow: 'auto', padding: 8, background: '#fafafa', borderRadius: 6 }}>
        {profilePreview ? (
          <div>
            <div><strong>{profilePreview.firstName} {profilePreview.lastName}</strong></div>
            <div style={{ color: '#555', fontSize: 13 }}>{profilePreview.email}</div>
            <div style={{ color: '#555', fontSize: 13 }}>{profilePreview.locationCity}</div>
            <div style={{ marginTop: 8 }}><strong>LinkedIn:</strong> {profilePreview.linkedin || '—'}</div>
            <div style={{ marginTop: 8 }}><strong>Resume:</strong> {profilePreview.resumeName ? profilePreview.resumeName : 'none'}</div>
            <div style={{ marginTop: 6 }}><strong>Visa required:</strong> {profilePreview.requireVisa ? 'Yes' : 'No'}</div>
          </div>
        ) : (
          <div style={{ color: '#666' }}>No profile in extension storage. Open the web app and click "Sync to Extension" or use import.</div>
        )}
      </div>
    </div>
  );
}
