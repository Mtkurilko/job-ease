# Coworker Michael (JobEase)

Autofill job application forms from your saved profile, attach resume/cover letter automatically, remember per‑site preferences, show a diagnostics overlay, and launch the web app when you need to edit your profile.

## Features

- Autofill common fields (name, email, phone, LinkedIn, school, degree, dates, etc.)
- File attach for Resume/Cover Letter (PDF/Word)
- Per‑site preferences: your manual edits on a site are remembered and re‑applied only on that host
- Diagnostics overlay with timing/field metrics
- Keyboard shortcuts:
	- Fill form: Ctrl+Shift+Y
	- Open web app: Ctrl+Shift+O
- Popup actions: Fill, Sync From Tab (pull profile from the web app), Diagnostics toggle, Open Web App

Month handling: the content script tries the right variant for month fields: 08, 8, August, or Aug, matching select option text/value or input format.

## Install (local development)

1) Install dependencies

```bash
npm install
```

2) Build the extension (content/background are copied into build/ by postbuild)

```bash
npm run build
```

3) Load in Chrome

- Open chrome://extensions
- Enable Developer mode
- Click “Load unpacked” and select the `build/` folder
- After updating `public/manifest.json` permissions (e.g., adding `tabs`), you must click “Reload” on the extension

## Using the popup

- Fill Form: triggers autofill on the active tab
- Sync From Tab: grabs the `jobEaseProfile` JSON from the active tab’s localStorage and saves it to extension storage
- Diagnostics: toggles the on‑page metrics overlay
- Open Web App: opens https://job-ease.vercel.app/

## Why a .crx won’t install (CRX_REQUIRED_PROOF)

If you tried to drag‑and‑drop a `.crx` file into Chrome and saw an error like:

> CRX_REQUIRED_PROOF_MISSING (or similar “CRX required proof” message)

That’s expected in modern Chrome. Installing unsigned `.crx` files is blocked unless you:

- Publish the extension in the Chrome Web Store (signed by Google), or
- Use enterprise policies to allow external installs

For local development, use “Load unpacked” with the `build/` directory. If you truly need a packed build, use chrome://extensions → “Pack extension” to generate a `.crx` and `.pem`, but note that end‑users still won’t be able to install it outside the Web Store without enterprise policy.

## Troubleshooting

- Button “Open Web App” doesn’t open: ensure the extension was reloaded after adding the `tabs` permission in `manifest.json`.
- Autofill didn’t run: some pages block content scripts until interaction. Try the keyboard shortcut or click “Fill Form” again. The background will attempt to inject the content script if needed.
- Per‑site preferences didn’t save: make a manual edit, wait ~600ms, then reload or fill again on the same host.

## Development notes

- Content script: `src/content.js`
- Background service worker: `src/background.js`
- Popup UI: `public/popup.html` + `public/popup.js` (+ `public/popup.css`)
- Manifest: `public/manifest.json`

Build copies `src/content.js` and `src/background.js` into `build/` (see the `postbuild` script in `package.json`).
