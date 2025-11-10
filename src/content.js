// Content script: listens for messages to trigger autofill using stored profile
function findLabelTextForInput(input) {
  try {
    if (!input) return '';
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.innerText || '';
    }
    const wrap = input.closest && input.closest('label');
    if (wrap) return wrap.innerText || '';
    const labelled = input.getAttribute && input.getAttribute('aria-labelledby');
    if (labelled) {
      const el = document.getElementById(labelled);
      if (el) return el.innerText || '';
    }
    let prev = input.previousElementSibling;
    let steps = 0;
    while (prev && steps < 6) {
      const text = (prev.innerText || prev.textContent || '').trim();
      if (text) return text;
      prev = prev.previousElementSibling;
      steps++;
    }
    if (input.parentElement) {
      let pprev = input.parentElement.previousElementSibling;
      steps = 0;
      while (pprev && steps < 6) {
        const text = (pprev.innerText || pprev.textContent || '').trim();
        if (text) return text;
        pprev = pprev.previousElementSibling;
        steps++;
      }
    }
    return '';
  } catch (e) {
    return '';
  }
}

function matchesField(fieldName, key) {
  if (!fieldName || !key) return false;
  const n = fieldName.toLowerCase();
  const k = key.toLowerCase();
  return n.includes(k) || k.includes(n) || n === k;
}

function dataURLtoFile(dataurl, filename) {
  const arr = dataurl.split(',');
  const mimeMatch = arr[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) { u8arr[n] = bstr.charCodeAt(n); }
  try { return new File([u8arr], filename, { type: mime }); } catch (e) { return new Blob([u8arr], { type: mime }); }
}

function normalizeDegreeVariants(deg) {
  if (!deg) return [];
  const d = String(deg).toLowerCase();
  const variants = new Set();
  const cleaned = d.replace(/[\u2018\u2019']/g, "").replace(/\./g, '').trim();
  variants.add(cleaned);
  if (cleaned.includes('bachelor')) { variants.add('bachelor'); variants.add('bachelors'); variants.add('ba'); variants.add('bs'); variants.add('bsc'); }
  if (cleaned.includes('master')) { variants.add('master'); variants.add('masters'); variants.add('ms'); variants.add('msc'); }
  if (cleaned.includes('associate')) { variants.add('associate'); variants.add("associate's"); variants.add('aa'); variants.add('as'); }
  if (cleaned.includes('doctor') || cleaned.includes('phd')) { variants.add('phd'); variants.add('doctorate'); }
  variants.add(cleaned.replace(/degree$/, '').trim());
  return Array.from(variants).filter(Boolean);
}

function trySetFileInput(input, profile) {
  const hasResume = !!profile?.resumeData;
  const hasCover = !!profile?.coverData;
  if (!hasResume && !hasCover) return false;
  const label = (input.name || input.id || input.placeholder || input.getAttribute('aria-label') || findLabelTextForInput(input) || '').toLowerCase();
  let dataUrl = null; let name = 'file.pdf';
  if ((label.includes('cover') || label.includes('cover letter')) && hasCover) { dataUrl = profile.coverData; name = profile.coverName || 'cover.pdf'; }
  else if (hasResume) { dataUrl = profile.resumeData; name = profile.resumeName || 'resume.pdf'; }
  else if (hasCover) { dataUrl = profile.coverData; name = profile.coverName || 'cover.pdf'; }
  if (!dataUrl) return false;
  const file = dataURLtoFile(dataUrl, name);
  const dt = new DataTransfer();
  try {
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      const dropZone = input.closest && (input.closest('.dropzone') || input.closest('[role="dropzone"]') || input.parentElement && input.parentElement.querySelector('.dropzone'));
      if (dropZone) {
        const dragEvt = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
        dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(dragEvt);
      }
    } catch (e) {}
    return true;
  } catch (e) { return false; }
}

// Site prefs helpers
function getHostname() { try { return location.hostname || 'unknown-host'; } catch (e) { return 'unknown-host'; } }
function getRootDomain(host) {
  try {
    const h = (host || getHostname() || '').toLowerCase();
    const multipartTLDs = ['co.uk','com.au','co.jp','com.br'];
    for (const t of multipartTLDs) {
      if (h.endsWith('.' + t)) {
        const rest = h.slice(0, -('.' + t).length);
        const parts = rest.split('.');
        const sld = parts[parts.length - 1] || '';
        return sld ? (sld + '.' + t) : h;
      }
    }
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    return parts.slice(-2).join('.');
  } catch (e) { return host; }
}
function detectVendor() {
  try {
    const h = (location.hostname || '').toLowerCase();
    const u = (location.href || '').toLowerCase();
    const html = document.documentElement?.outerHTML?.toLowerCase() || '';
    if (h.includes('greenhouse.io') || u.includes('boards.greenhouse.io') || html.includes('greenhouse')) return 'greenhouse';
    if (h.includes('lever.co') || html.includes('lever.co')) return 'lever';
    if (h.includes('workday.com') || u.includes('myworkdayjobs') || html.includes('workday')) return 'workday';
    if (h.includes('ashbyhq.com') || html.includes('ashbyhq')) return 'ashby';
    if (h.includes('smartrecruiters') || html.includes('smartrecruiters')) return 'smartrecruiters';
    return '';
  } catch (e) { return ''; }
}
function normalizeLabelKey(t) {
  try { return (t || '').toLowerCase().replace(/\s+/g,' ').replace(/[\:*?"'`~<>{}\[\]()\\/.,;|!@#$%^&+=_-]+/g, ' ').trim(); } catch (e) { return ''; }
}
function findGroupLabelForRadio(radio) {
  try {
    const fs = radio.closest && radio.closest('fieldset');
    const legend = fs && fs.querySelector && fs.querySelector('legend');
    if (legend && (legend.innerText || legend.textContent)) return (legend.innerText || legend.textContent).trim();
    const container = (radio.closest && (radio.closest('[role="group"]') || radio.closest('.field') || radio.closest('.form-group'))) || radio.parentElement;
    if (container) {
      let prev = container.previousElementSibling; let steps = 0;
      while (prev && steps < 4) { const txt = (prev.innerText || prev.textContent || '').trim(); if (txt) return txt; prev = prev.previousElementSibling; steps++; }
    }
    return findLabelTextForInput(radio);
  } catch (e) { return ''; }
}
function findLabelForSelect(select) { return findLabelTextForInput(select); }
function findLabelForCheckbox(cb) { return findLabelTextForInput(cb); }

function getSitePrefsEnabled() { return new Promise(resolve => { try { chrome?.storage?.local?.get ? chrome.storage.local.get('sitePrefsEnabled', (res) => resolve(!!res?.sitePrefsEnabled)) : resolve(false); } catch (e) { resolve(false); } }); }
function getAllSitePrefs() { return new Promise(resolve => { try { chrome?.storage?.local?.get ? chrome.storage.local.get('sitePrefs', (res) => resolve(res?.sitePrefs || {})) : resolve({}); } catch (e) { resolve({}); } }); }
function setAllSitePrefs(prefs) { return new Promise(resolve => { try { chrome?.storage?.local?.set ? chrome.storage.local.set({ sitePrefs: prefs }, () => resolve(true)) : resolve(false); } catch (e) { resolve(false); } }); }

async function fillInputs(profile) {
  if (!profile) return { filled: 0 };
  const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  let filled = 0; let fileAttached = 0; const events = [];
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

  function setValue(el, value, fieldNameForMetrics) {
    try {
      const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      if (el.tagName.toLowerCase() === 'select') {
        if (el.multiple && Array.isArray(value)) { for (const opt of el.options) opt.selected = value.includes(opt.value) || value.includes(opt.text); }
        else { const match = Array.from(el.options).find(o => (o.text || '').toLowerCase().includes(String(value).toLowerCase()) || (o.value || '').toLowerCase().includes(String(value).toLowerCase())); if (match) el.value = match.value; else el.value = value; }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = !!value; el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.focus?.(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      events.push({ field: fieldNameForMetrics || (el.name || el.id || el.placeholder || ''), ms: Math.round(t1 - t0), ok: true });
      return true;
    } catch (e) { events.push({ field: fieldNameForMetrics || (el.name || el.id || el.placeholder || ''), ms: 0, ok: false }); return false; }
  }

  for (const input of inputs) {
    const type = (input.type || '').toLowerCase();
    const candidates = [input.name, input.id, input.placeholder, input.getAttribute('aria-label'), input.getAttribute && input.getAttribute('autocomplete'), input.autocomplete, findLabelTextForInput(input)];
    const fieldCandidate = candidates.filter(Boolean).join(' ').toLowerCase();

    if (type === 'file') {
      if (fieldCandidate.includes('resume') || fieldCandidate.includes('cv') || fieldCandidate.includes('curriculum') || fieldCandidate.includes('upload')) {
        if (trySetFileInput(input, profile)) { filled++; fileAttached++; }
        continue;
      }
    }

    if (type === 'checkbox' || type === 'radio') {
      if (fieldCandidate.includes('disabil') || fieldCandidate.includes('access')) { try { input.checked = !!profile.disability; input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} continue; }
      if (fieldCandidate.includes('veteran') || fieldCandidate.includes('military')) { try { input.checked = !!profile.veteran; input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} continue; }
      if (fieldCandidate.includes('citizen') || fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('authorized to work')) {
        if (fieldCandidate.includes('citizen') && typeof profile.authorizedToWork !== 'undefined') { if (setValue(input, !!profile.authorizedToWork)) filled++; continue; }
        if (fieldCandidate.includes('authorized to work') && typeof profile.authorizedToWork !== 'undefined') { if (setValue(input, !!profile.authorizedToWork)) filled++; continue; }
        if (fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('require sponsorship')) { const wantVisa = !!profile.requireVisa; if (setValue(input, wantVisa)) filled++; continue; }
      }
    }

    if (input.tagName.toLowerCase() === 'select') {
      const yesNo = Array.from(input.options).some(o => /^(yes|no)$/i.test((o.text||'').trim()));
      if (yesNo) {
        const text = fieldCandidate;
        const map = [
          { keys: ['at least 18','over 18','age 18','age over'], val: !!profile.ageOver18 },
          { keys: ['use ai','ai tools','consent ai'], val: !!profile.consentAI },
          { keys: ['authorized to work','work authorization','work author'], val: !!profile.authorizedToWork },
          { keys: ['require visa','sponsor','sponsorship','work visa','visa'], val: !!profile.requireVisa },
          { keys: ['government official','gov official','public official'], val: !!profile.govOfficial },
          { keys: ['relative of a government','relative gov','close relative government'], val: !!profile.relativeGovOfficial },
          { keys: ['currently employed','current employment','currently working'], val: !!profile.currentlyEmployed }
        ];
        const hit = map.find(m => m.keys.some(k => text.includes(k)));
        if (hit && typeof hit.val === 'boolean') { const desired = hit.val ? /yes/i : /no/i; const opt = Array.from(input.options).find(o => desired.test((o.text||'').trim())); if (opt) { setValue(input, opt.value, fieldCandidate); filled++; continue; } }
      }
      if (fieldCandidate.includes('citizen') || fieldCandidate.includes('visa') || fieldCandidate.includes('authorized') || fieldCandidate.includes('work author') || fieldCandidate.includes('sponsor')) {
        if (fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('require sponsorship')) { const wantVisa = !!profile.requireVisa; const opt = Array.from(input.options).find(o => /yes|y/i.test(o.text) === wantVisa || /no|n/i.test(o.text) === !wantVisa); if (opt) { setValue(input, opt.value, fieldCandidate); filled++; continue; } }
        if (fieldCandidate.includes('citizen') || fieldCandidate.includes('authorized')) { const want = !!profile.authorizedToWork; const opt = Array.from(input.options).find(o => /yes|y|citizen|authorized/i.test(o.text) === want || /no|n|not/i.test(o.text) === !want); if (opt) { setValue(input, opt.value, fieldCandidate); filled++; continue; } }
      }
      if (profile.howHeard && (fieldCandidate.includes('how did') || fieldCandidate.includes('how heard') || fieldCandidate.includes('source'))) { if (setValue(input, profile.howHeard, fieldCandidate)) { filled++; continue; } }
    }

    if (type === 'text' || type === 'email' || type === 'tel' || input.tagName.toLowerCase() === 'textarea' || type === 'date' || type === 'number') {
      if ((fieldCandidate.includes('full') && fieldCandidate.includes('name')) || (fieldCandidate === 'name') || (fieldCandidate.includes('your name') && fullName)) { if (fullName) { try { input.focus?.(); input.value = fullName; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); events.push({ field: 'full name', ms: 0, ok: true }); filled++; } catch(e){ events.push({ field: 'full name', ms: 0, ok: false }); } continue; } }
      if (fieldCandidate.includes('first')) { if (profile.firstName) { try { const t0=performance.now?performance.now():Date.now(); input.focus?.(); input.value = profile.firstName; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); const t1=performance.now?performance.now():Date.now(); events.push({ field: 'first name', ms: Math.round(t1-t0), ok: true }); filled++; } catch(e){ events.push({ field: 'first name', ms: 0, ok: false }); } } continue; }
      if (fieldCandidate.includes('last') || fieldCandidate.includes('surname') || fieldCandidate.includes('family')) { if (profile.lastName) { try { const t0=performance.now?performance.now():Date.now(); input.focus?.(); input.value = profile.lastName; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); const t1=performance.now?performance.now():Date.now(); events.push({ field: 'last name', ms: Math.round(t1-t0), ok: true }); filled++; } catch(e){ events.push({ field: 'last name', ms: 0, ok: false }); } } continue; }
      if (fieldCandidate.includes('email')) { if (profile.email) { try { const t0=performance.now?performance.now():Date.now(); input.focus?.(); input.value = profile.email; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); const t1=performance.now?performance.now():Date.now(); events.push({ field: 'email', ms: Math.round(t1-t0), ok: true }); filled++; } catch(e){ events.push({ field: 'email', ms: 0, ok: false }); } } continue; }
      if (fieldCandidate.includes('github') || fieldCandidate.includes('git')) { if (profile.github) { try { const t0=performance.now?performance.now():Date.now(); input.focus?.(); input.value = profile.github; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); const t1=performance.now?performance.now():Date.now(); events.push({ field: 'github', ms: Math.round(t1-t0), ok: true }); filled++; } catch(e){ events.push({ field: 'github', ms: 0, ok: false }); } } continue; }
      if (fieldCandidate.includes('school') || fieldCandidate.includes('university') || fieldCandidate.includes('college')) { if (profile.school) { if (setValue(input, profile.school, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('degree')) { if (profile.degree) { if (input.tagName.toLowerCase() === 'select') { const variants = normalizeDegreeVariants(profile.degree); const opt = Array.from(input.options).find(o => { const text = (o.text || '').toLowerCase(); const val = (o.value || '').toLowerCase(); return variants.some(v => (text.includes(v) || val.includes(v))); }); if (opt) { setValue(input, opt.value, fieldCandidate); filled++; } else if (setValue(input, profile.degree, fieldCandidate)) { filled++; } } else { if (setValue(input, profile.degree, fieldCandidate)) filled++; } } continue; }
      if (fieldCandidate.includes('discipline') || fieldCandidate.includes('major')) { if (profile.discipline) { if (setValue(input, profile.discipline, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('linkedin') || fieldCandidate.includes('linkedin profile')) { if (profile.linkedin) { if (setValue(input, profile.linkedin, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('location') || fieldCandidate.includes('city') || fieldCandidate.includes('location (city)')) { if (profile.locationCity) { if (setValue(input, profile.locationCity, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('company') || fieldCandidate.includes('employer')) { if (profile.companyName) { if (setValue(input, profile.companyName, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('title') || fieldCandidate.includes('position')) { if (profile.jobTitle) { if (setValue(input, profile.jobTitle, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('start month') || fieldCandidate.includes('start mm') || (fieldCandidate.includes('start') && fieldCandidate.includes('month')) || /\bmm\b/.test(fieldCandidate) ) {
        if (profile.startMonth) {
          if (input.tagName.toLowerCase() === 'select') { const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december']; const mIdx = parseInt(profile.startMonth, 10) - 1; const candidates = [profile.startMonth, monthNames[mIdx]]; const opt = Array.from(input.options).find(o => { const t = (o.text||'').toLowerCase(); const v = (o.value||'').toLowerCase(); return candidates.some(c => !!c && (t.includes(String(c).toLowerCase()) || v.includes(String(c).toLowerCase()))); }); if (opt) { setValue(input, opt.value, fieldCandidate); filled++; } }
          else if (type === 'number') { if (setValue(input, parseInt(profile.startMonth,10), fieldCandidate)) filled++; }
          else if (type === 'text' || type === 'date') { const monthNames2 = ['January','February','March','April','May','June','July','August','September','October','November','December']; const mIdx2 = parseInt(profile.startMonth, 10) - 1; if (monthNames2[mIdx2]) { if (setValue(input, monthNames2[mIdx2], fieldCandidate)) filled++; } else if (setValue(input, profile.startMonth, fieldCandidate)) filled++; }
          else { if (setValue(input, profile.startMonth, fieldCandidate)) filled++; }
        }
        continue;
      }
      if (fieldCandidate.includes('start year') || fieldCandidate.includes('start yyyy') || (fieldCandidate.includes('start') && fieldCandidate.includes('year'))) { if (profile.startYear) { if (setValue(input, profile.startYear, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('start day') || fieldCandidate.includes('start dd') || (fieldCandidate.includes('start') && fieldCandidate.includes('day')) ) { if (profile.startDay) { if (setValue(input, profile.startDay, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('end month') || fieldCandidate.includes('end mm') || (fieldCandidate.includes('end') && fieldCandidate.includes('month'))) {
        if (profile.endMonth) {
          if (input.tagName.toLowerCase() === 'select') { const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december']; const mIdx = parseInt(profile.endMonth, 10) - 1; const candidates = [profile.endMonth, monthNames[mIdx]]; const opt = Array.from(input.options).find(o => { const t = (o.text||'').toLowerCase(); const v = (o.value||'').toLowerCase(); return candidates.some(c => !!c && (t.includes(String(c).toLowerCase()) || v.includes(String(c).toLowerCase()))); }); if (opt) { setValue(input, opt.value, fieldCandidate); filled++; } }
          else if (type === 'number') { if (setValue(input, parseInt(profile.endMonth,10), fieldCandidate)) filled++; }
          else if (type === 'text' || type === 'date') { const monthNames2 = ['January','February','March','April','May','June','July','August','September','October','November','December']; const mIdx2 = parseInt(profile.endMonth, 10) - 1; if (monthNames2[mIdx2]) { if (setValue(input, monthNames2[mIdx2], fieldCandidate)) filled++; } else if (setValue(input, profile.endMonth, fieldCandidate)) filled++; }
          else { if (setValue(input, profile.endMonth, fieldCandidate)) filled++; }
        }
        continue;
      }
      if (fieldCandidate.includes('end year') || fieldCandidate.includes('end yyyy') || (fieldCandidate.includes('end') && fieldCandidate.includes('year'))) { if (profile.endYear) { if (setValue(input, profile.endYear, fieldCandidate)) filled++; } continue; }
      if (fieldCandidate.includes('end day') || fieldCandidate.includes('end dd') || (fieldCandidate.includes('end') && fieldCandidate.includes('day')) ) { if (profile.endDay) { if (setValue(input, profile.endDay, fieldCandidate)) filled++; } continue; }
      if ((fieldCandidate.includes('start') && (fieldCandidate.includes('date') || type === 'date')) && (profile.startYear && profile.startMonth)) { const dd = profile.startDay || '01'; const iso = `${profile.startYear}-${String(profile.startMonth).padStart(2,'0')}-${String(dd).padStart(2,'0')}`; if (setValue(input, iso, fieldCandidate)) { filled++; continue; } }
      if ((fieldCandidate.includes('end') && (fieldCandidate.includes('date') || type === 'date')) && (profile.endYear && profile.endMonth)) { const dd = profile.endDay || '01'; const iso = `${profile.endYear}-${String(profile.endMonth).padStart(2,'0')}-${String(dd).padStart(2,'0')}`; if (setValue(input, iso, fieldCandidate)) { filled++; continue; } }
      if (fieldCandidate.includes('phone') || fieldCandidate.includes('mobile') || fieldCandidate.includes('tel')) { if (profile.phone) { try { const t0=performance.now?performance.now():Date.now(); input.focus?.(); input.value = profile.phone; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); const t1=performance.now?performance.now():Date.now(); events.push({ field: 'phone', ms: Math.round(t1-t0), ok: true }); filled++; } catch(e){ events.push({ field: 'phone', ms: 0, ok: false }); } } continue; }
      if (fieldCandidate.includes('address')) { if (profile.address) { try { const t0=performance.now?performance.now():Date.now(); input.focus?.(); input.value = profile.address; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); const t1=performance.now?performance.now():Date.now(); events.push({ field: 'address', ms: Math.round(t1-t0), ok: true }); filled++; } catch(e){ events.push({ field: 'address', ms: 0, ok: false }); } } continue; }
    }
  }

  try {
    const fileInputs = Array.from(document.querySelectorAll('input[type=file]'));
    if ((profile.resumeData || profile.coverData) && fileInputs.length) {
      for (const fi of fileInputs) {
        const label = (fi.name || fi.id || fi.placeholder || fi.getAttribute('aria-label') || findLabelTextForInput(fi) || '').toLowerCase();
        if (/resume|cv|curriculum|cover|upload|attach|application/.test(label)) continue;
        const accept = (fi.getAttribute('accept') || '').toLowerCase();
        if (accept.includes('pdf') || accept.includes('word') || accept.includes('application') || accept.includes('doc')) { if (trySetFileInput(fi, profile)) { filled++; fileAttached++; break; } }
      }
      if (!fileAttached) {
        const attachEls = Array.from(document.querySelectorAll('button, a, input[type=button]')).filter(el => /resume|cv|attach|upload/i.test((el.innerText || el.textContent || el.getAttribute('aria-label') || el.value || '').toString()));
        for (const btn of attachEls) {
          let candidate = null; try {
            candidate = btn.closest && (btn.closest('form') ? btn.closest('form').querySelector('input[type=file]') : null);
            if (!candidate) candidate = btn.parentElement && btn.parentElement.querySelector && btn.parentElement.querySelector('input[type=file]');
            if (!candidate) { let sib = btn.previousElementSibling; if (sib && sib.tagName && sib.tagName.toLowerCase() === 'input' && sib.type === 'file') candidate = sib; sib = btn.nextElementSibling; if (!candidate && sib && sib.tagName && sib.tagName.toLowerCase() === 'input' && sib.type === 'file') candidate = sib; }
          } catch (e) {}
          if (candidate) { if (trySetFileInput(candidate, profile)) { filled++; fileAttached++; break; } }
        }
      }
      if (!fileAttached && fileInputs.length) { const first = fileInputs[0]; if (trySetFileInput(first, profile)) { filled++; fileAttached++; } }
    }
  } catch (e) {}

  // Enhanced site preferences: apply from same site or similar ones
  try {
    const enabled = await getSitePrefsEnabled();
    if (enabled) {
      const host = getHostname(); const root = getRootDomain(host); const vendor = detectVendor();
      const all = await getAllSitePrefs();
      let candidateKey = null; let candidate = all[host] || null;
      const buildLabelSet = () => { const set = new Set(); try { const radios = Array.from(document.querySelectorAll('input[type="radio"]')); const added = new Set(); for (const r of radios) { if (!r.name) continue; if (added.has(r.name)) continue; added.add(r.name); const l = findGroupLabelForRadio(r); if (l) set.add(normalizeLabelKey(l)); } const sels = Array.from(document.querySelectorAll('select')); for (const s of sels) { const l = findLabelForSelect(s); if (l) set.add(normalizeLabelKey(l)); } const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')); for (const c of cbs) { const l = findLabelForCheckbox(c); if (l) set.add(normalizeLabelKey(l)); } } catch (e) {} return set; };
      const currentLabels = buildLabelSet();
      function labelOverlapScore(aSet, bArr){ if (!aSet || !bArr) return 0; let hits=0; for (const x of bArr){ if (aSet.has(x)) hits++; } return hits; }
      if (!candidate) { let best=null, bestScore=0, bestKey=null; for (const [k, entry] of Object.entries(all)) { if (entry?.vendor && vendor && entry.vendor === vendor) { const score = labelOverlapScore(currentLabels, entry.labels || []); if (score > bestScore) { best=entry; bestScore=score; bestKey=k; } } } if (best && bestScore >= 2) { candidate = best; candidateKey = bestKey; } }
      if (!candidate) { for (const [k, entry] of Object.entries(all)) { if (entry?.rootDomain && entry.rootDomain === root) { candidate = entry; candidateKey = k; break; } } }
      const applyByNameMaps = (entry) => { if (!entry) return; if (entry.radios) { for (const [name, val] of Object.entries(entry.radios)) { try { const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`)); const target = radios.find(r => (r.value || '') == String(val)); if (target) { const t0=performance.now?performance.now():Date.now(); target.checked = true; target.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance.now?performance.now():Date.now(); events.push({ field: `site-pref radio:${name}${candidateKey?` ← ${candidateKey}`:''}`, ms: Math.round(t1-t0), ok: true }); } } catch(e){} } } if (entry.checkboxes) { for (const [key, checked] of Object.entries(entry.checkboxes)) { try { let el = document.querySelector(`input[type=\"checkbox\"][name=\"${CSS.escape(key)}\"]`); if (!el) el = document.getElementById(key); if (el && el.type === 'checkbox') { const t0=performance.now?performance.now():Date.now(); el.checked = !!checked; el.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance.now?performance.now():Date.now(); events.push({ field: `site-pref checkbox:${key}${candidateKey?` ← ${candidateKey}`:''}`, ms: Math.round(t1-t0), ok: true }); } } catch(e){} } } if (entry.selects) { for (const [key, val] of Object.entries(entry.selects)) { try { let el = document.querySelector(`select[name=\"${CSS.escape(key)}\"]`); if (!el) el = document.getElementById(key); if (el && el.tagName && el.tagName.toLowerCase() === 'select') { const t0=performance.now?performance.now():Date.now(); const opt = Array.from(el.options).find(o => (o.value || '') == String(val)); if (opt) el.value = opt.value; else el.value = val; el.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance.now?performance.now():Date.now(); events.push({ field: `site-pref select:${key}${candidateKey?` ← ${candidateKey}`:''}`, ms: Math.round(t1-t0), ok: true }); } } catch(e){} } } };
      applyByNameMaps(candidate);
      const applyByLabel = (labelMap, applyFn) => { if (!labelMap || typeof labelMap !== 'object') return; for (const [labelKey, desired] of Object.entries(labelMap)) { try { applyFn(labelKey, desired); } catch (e) {} } };
      applyByLabel(candidate?.radiosByLabel, (labelKey, desiredText) => { const groups = new Map(); const radios = Array.from(document.querySelectorAll('input[type="radio"]')); for (const r of radios) { if (!r.name) continue; if (!groups.has(r.name)) groups.set(r.name, []); groups.get(r.name).push(r); } for (const arr of groups.values()) { const l = normalizeLabelKey(findGroupLabelForRadio(arr[0])); if (l === labelKey) { const t0=performance.now?performance.now():Date.now(); let target=null; for (const r of arr) { const lbl = r.closest('label') || (r.id && document.querySelector(`label[for=\"${CSS.escape(r.id)}\"]`)); const txt = normalizeLabelKey((lbl?.innerText || lbl?.textContent || '').trim()); if (txt && desiredText && txt.includes(desiredText)) { target = r; break; } } if (!target) target = arr.find(r => String(r.value || '').toLowerCase().includes(String(desiredText || '').toLowerCase())); if (target) { target.checked = true; target.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance.now?performance.now():Date.now(); events.push({ field: `site-pref radio:${labelKey}${candidateKey?` ← ${candidateKey}`:''}`, ms: Math.round(t1-t0), ok: true }); } } } });
      applyByLabel(candidate?.checkboxesByLabel, (labelKey, checked) => { const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')); for (const cb of cbs) { const l = normalizeLabelKey(findLabelForCheckbox(cb)); if (l === labelKey) { const t0=performance.now?performance.now():Date.now(); cb.checked = !!checked; cb.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance.now?performance.now():Date.now(); events.push({ field: `site-pref checkbox:${labelKey}${candidateKey?` ← ${candidateKey}`:''}`, ms: Math.round(t1-t0), ok: true }); } } });
      applyByLabel(candidate?.selectsByLabel, (labelKey, desiredText) => { const sels = Array.from(document.querySelectorAll('select')); for (const s of sels) { const l = normalizeLabelKey(findLabelForSelect(s)); if (l === labelKey) { const t0=performance.now?performance.now():Date.now(); const opt = Array.from(s.options).find(o => (o.text || '').toLowerCase().includes(String(desiredText || '').toLowerCase()) || (o.value || '').toLowerCase().includes(String(desiredText || '').toLowerCase())); if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change',{bubbles:true})); } const t1=performance.now?performance.now():Date.now(); events.push({ field: `site-pref select:${labelKey}${candidateKey?` ← ${candidateKey}`:''}`, ms: Math.round(t1-t0), ok: !!opt }); } } });

      // Capture current prefs
      const radios = {}; const radiosByLabel = {}; try { const radioInputs = Array.from(document.querySelectorAll('input[type="radio"]')); const byName = new Map(); for (const r of radioInputs) { if (!r.name) continue; if (!byName.has(r.name)) byName.set(r.name, []); byName.get(r.name).push(r); } for (const [name, arr] of byName.entries()) { const checked = arr.find(x => x.checked); if (checked) { radios[name] = checked.value; const l = normalizeLabelKey(findGroupLabelForRadio(arr[0])); if (l) { const lbl = checked.closest('label') || (checked.id && document.querySelector(`label[for=\"${CSS.escape(checked.id)}\"]`)); const txt = normalizeLabelKey((lbl?.innerText || lbl?.textContent || '').trim()); radiosByLabel[l] = txt || String(checked.value || ''); } } } } catch(e){}
      const checkboxes = {}; const checkboxesByLabel = {}; try { const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')); for (const cb of cbs) { const key = cb.name || cb.id; if (!key) continue; checkboxes[key] = !!cb.checked; const l = normalizeLabelKey(findLabelForCheckbox(cb)); if (l) checkboxesByLabel[l] = !!cb.checked; } } catch(e){}
      const selects = {}; const selectsByLabel = {}; let currentLabelsArr = []; try { const sels = Array.from(document.querySelectorAll('select')); for (const s of sels) { const key2 = s.name || s.id; if (!key2) continue; selects[key2] = s.value; const l = normalizeLabelKey(findLabelForSelect(s)); if (l) { const opt = s.selectedOptions && s.selectedOptions[0]; const text = normalizeLabelKey((opt?.text || '').trim()); selectsByLabel[l] = text || String(s.value || ''); } } currentLabelsArr = Array.from(currentLabels || []); } catch(e){}
      const updated = { ...(all || {}) }; updated[host] = { version: 2, updatedAt: Date.now(), host, rootDomain: root, vendor, labels: currentLabelsArr, radios, checkboxes, selects, radiosByLabel, checkboxesByLabel, selectsByLabel }; await setAllSitePrefs(updated);
    }
  } catch (e) {}

  const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const durationMs = Math.round(endTime - startTime);
  const result = { filled, total: inputs.length, durationMs, fileAttached, timestamp: Date.now(), events };
  try { if (window.__JobEase_diagEnabled) { renderDiagnosticsOverlay(result); } window.__JobEase_lastDiagnostics = result; } catch(e) {}
  return result;
}

function getProfileFromChromeStorage() {
  return new Promise(resolve => {
    if (window.chrome && chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('profile', (res) => { resolve(res?.profile || null); });
    } else {
      try { const raw = window.localStorage.getItem('jobEaseProfile'); resolve(raw ? JSON.parse(raw) : null); } catch (e) { resolve(null); }
    }
  });
}

async function handleFill(request, sender, sendResponse) {
  if (request?.type === 'DO_FILL') {
    const profile = request.profile || await getProfileFromChromeStorage();
    const result = await fillInputs(profile);
    sendResponse({ ok: true, ...result });
  }
}

function renderDiagnosticsOverlay(result) {
  if (!result) return;
  const existing = document.getElementById('__jobease_diag'); if (existing) existing.remove();
  const root = document.createElement('div'); root.id='__jobease_diag';
  root.style.position='fixed'; root.style.top='10px'; root.style.right='10px'; root.style.zIndex='999999'; root.style.width='340px'; root.style.maxHeight='70vh'; root.style.overflow='auto'; root.style.fontFamily='system-ui, -apple-system, Segoe UI, Roboto, sans-serif'; root.style.fontSize='12px'; root.style.background='rgba(17,24,39,0.95)'; root.style.color='#f8fafc'; root.style.border='1px solid #334155'; root.style.borderRadius='8px'; root.style.boxShadow='0 6px 20px rgba(0,0,0,0.4)'; root.style.backdropFilter='blur(4px)'; root.style.padding='10px';
  const header = document.createElement('div'); header.style.display='flex'; header.style.alignItems='center'; header.style.justifyContent='space-between'; header.style.marginBottom='6px'; header.innerHTML = `<strong>Diagnostics</strong><button style="background:#dc2626;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px" id="__jobease_diag_close">Close</button>`;
  const summary = document.createElement('div'); const successRate = result.total ? ((result.filled / result.total) * 100).toFixed(1) : '0.0'; summary.style.marginBottom='6px'; summary.innerHTML = `Filled <strong>${result.filled}</strong> of <strong>${result.total}</strong> fields in <strong>${result.durationMs}ms</strong> (success rate ${successRate}%)${result.fileAttached? ' • file attached':''}`;
  const list = document.createElement('div'); for (const ev of result.events.slice(0,150)) { const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='6px'; row.style.padding='2px 0'; const icon = ev.ok ? '✅' : '⚠️'; const fieldLabel = (ev.field || 'field').slice(0,60); row.innerHTML = `<span>${icon}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fieldLabel}</span><span style="color:#94a3b8">${ev.ms}ms</span>`; list.appendChild(row); }
  const actions = document.createElement('div'); actions.style.marginTop='8px'; actions.style.display='flex'; actions.style.gap='6px'; const toggleBtn = document.createElement('button'); toggleBtn.textContent='Hide overlay'; toggleBtn.style.background='#1d4ed8'; toggleBtn.style.color='#fff'; toggleBtn.style.border='none'; toggleBtn.style.padding='4px 8px'; toggleBtn.style.borderRadius='4px'; toggleBtn.style.cursor='pointer'; toggleBtn.style.fontSize='11px'; toggleBtn.onclick = () => { window.__JobEase_diagEnabled = false; root.remove(); };
  actions.appendChild(toggleBtn);
  root.appendChild(header); root.appendChild(summary); root.appendChild(list); root.appendChild(actions); document.documentElement.appendChild(root);
  const close = root.querySelector('#__jobease_diag_close'); if (close) close.addEventListener('click', () => root.remove());
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req?.type === 'TOGGLE_DIAGNOSTICS') {
      window.__JobEase_diagEnabled = !!req.enabled;
      if (!window.__JobEase_diagEnabled) { const existing = document.getElementById('__jobease_diag'); if (existing) existing.remove(); }
      else if (window.__JobEase_lastDiagnostics) { renderDiagnosticsOverlay(window.__JobEase_lastDiagnostics); }
      sendResponse({ ok: true, enabled: window.__JobEase_diagEnabled });
      return true;
    }
    if (req?.type === 'GET_HOST') { sendResponse({ host: getHostname() }); return true; }
    handleFill(req, sender, sendResponse);
    return true;
  });
}

window.__JobEase_fill = async () => { const profile = await getProfileFromChromeStorage(); return fillInputs(profile); };
