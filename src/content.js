// Content script: listens for messages to trigger autofill using stored profile
function findLabelTextForInput(input) {
  try {
    if (!input) return '';
    // label[for=..]
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.innerText || '';
    }
    // wrapped label
    const wrap = input.closest && input.closest('label');
    if (wrap) return wrap.innerText || '';

    // aria-labelledby
    const labelled = input.getAttribute && input.getAttribute('aria-labelledby');
    if (labelled) {
      const el = document.getElementById(labelled);
      if (el) return el.innerText || '';
    }

    // try previous siblings / preceding text (label above the input)
    let prev = input.previousElementSibling;
    let steps = 0;
    while (prev && steps < 6) {
      const text = (prev.innerText || prev.textContent || '').trim();
      if (text) return text;
      prev = prev.previousElementSibling;
      steps++;
    }

    // try parent's previous sibling
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
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  try {
    return new File([u8arr], filename, { type: mime });
  } catch (e) {
    // older browsers may not support File constructor
    return new Blob([u8arr], { type: mime });
  }
}

function normalizeDegreeVariants(deg) {
  if (!deg) return [];
  const d = String(deg).toLowerCase();
  const variants = new Set();
  const cleaned = d.replace(/[\u2018\u2019']/g, "").replace(/\./g, '').trim();
  variants.add(cleaned);
  // common tokens
  if (cleaned.includes('bachelor')) {
    variants.add('bachelor');
    variants.add("bachelors");
    variants.add('ba'); variants.add('bs'); variants.add('bsc');
  }
  if (cleaned.includes('master')) {
    variants.add('master'); variants.add('masters'); variants.add('ms'); variants.add('msc');
  }
  if (cleaned.includes('associate')) {
    variants.add('associate'); variants.add("associate's"); variants.add('aa'); variants.add('as');
  }
  if (cleaned.includes('doctor') || cleaned.includes('phd')) {
    variants.add('phd'); variants.add('doctorate');
  }
  variants.add(cleaned.replace(/degree$/, '').trim());
  return Array.from(variants).filter(Boolean);
}

function trySetFileInput(input, profile) {
  // try to attach either resume or cover if matching
  const hasResume = !!profile?.resumeData;
  const hasCover = !!profile?.coverData;
  if (!hasResume && !hasCover) return false;
  // decide which file to use based on input label/name
  const label = (input.name || input.id || input.placeholder || input.getAttribute('aria-label') || findLabelTextForInput(input) || '').toLowerCase();
  let dataUrl = null;
  let name = 'file.pdf';
  if ((label.includes('cover') || label.includes('cover letter')) && hasCover) {
    dataUrl = profile.coverData;
    name = profile.coverName || 'cover.pdf';
  } else if (hasResume) {
    dataUrl = profile.resumeData;
    name = profile.resumeName || 'resume.pdf';
  } else if (hasCover) {
    dataUrl = profile.coverData;
    name = profile.coverName || 'cover.pdf';
  }
  if (!dataUrl) return false;
  const file = dataURLtoFile(dataUrl, name);
  const dt = new DataTransfer();
  try {
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // try to trigger common drag-drop handlers nearby (drop zones)
    try {
      const dropZone = input.closest && (input.closest('.dropzone') || input.closest('[role="dropzone"]') || input.parentElement && input.parentElement.querySelector('.dropzone'));
      if (dropZone) {
        const dragEvt = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
        dropZone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropZone.dispatchEvent(dragEvt);
      }
    } catch (e) {
      // ignore drop emission failures
    }
    return true;
  } catch (e) {
    return false;
  }
}

function fillInputs(profile) {
  if (!profile) return { filled: 0 };

  const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  let filled = 0;
  let fileAttached = 0;

  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

  function setValue(el, value) {
    try {
      if (el.tagName.toLowerCase() === 'select') {
        // handle multi-select
        if (el.multiple && Array.isArray(value)) {
          for (const opt of el.options) opt.selected = value.includes(opt.value) || value.includes(opt.text);
        } else {
          // choose option by text or value
          const match = Array.from(el.options).find(o => (o.text || '').toLowerCase().includes(String(value).toLowerCase()) || (o.value || '').toLowerCase().includes(String(value).toLowerCase()));
          if (match) el.value = match.value; else el.value = value;
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = !!value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.focus?.();
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  for (const input of inputs) {
    const type = (input.type || '').toLowerCase();
    const candidates = [
      input.name,
      input.id,
      input.placeholder,
      input.getAttribute('aria-label'),
      input.getAttribute && input.getAttribute('autocomplete'),
      input.autocomplete,
      findLabelTextForInput(input)
    ];
    const fieldCandidate = candidates.filter(Boolean).join(' ').toLowerCase();

    // handle file inputs (resume)
    if (type === 'file') {
      if (fieldCandidate.includes('resume') || fieldCandidate.includes('cv') || fieldCandidate.includes('curriculum') || fieldCandidate.includes('upload')) {
        if (trySetFileInput(input, profile)) { filled++; fileAttached++; }
        continue;
      }
    }

    // Additional heuristic: if this file input is not explicitly labeled as resume but there
    // exists an attach/upload button near it that mentions resume, prefer that input.
    // We'll also attempt fallback attachments later if none matched.

    // handle checkboxes / radios for prechecks
    if (type === 'checkbox' || type === 'radio') {
      // disability
      if (fieldCandidate.includes('disabil') || fieldCandidate.includes('access')) {
        try { input.checked = !!profile.disability; input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){}
        continue;
      }
      // veteran
      if (fieldCandidate.includes('veteran') || fieldCandidate.includes('military')) {
        try { input.checked = !!profile.veteran; input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){}
        continue;
      }
      // citizenship / visa
      if (fieldCandidate.includes('citizen') || fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('authorized to work')) {
        // map to profile.requireVisa and profile.authorizedToWork
        if (fieldCandidate.includes('citizen') && typeof profile.authorizedToWork !== 'undefined') {
          // treat citizen fields as authorized-to-work when explicit citizen not present
          if (setValue(input, !!profile.authorizedToWork)) filled++;
          continue;
        }
        if (fieldCandidate.includes('authorized to work') && typeof profile.authorizedToWork !== 'undefined') {
          if (setValue(input, !!profile.authorizedToWork)) filled++;
          continue;
        }
        if (fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('require sponsorship')) {
          // prefer selecting 'No' when profile.requireVisa is false
          const wantVisa = !!profile.requireVisa;
          if (setValue(input, wantVisa)) filled++;
          continue;
        }
      }
    }

    // selects for citizenship/visa
    if (input.tagName.toLowerCase() === 'select') {
      // generic Yes/No mapping for boolean questions
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
        if (hit && typeof hit.val === 'boolean') {
          const desired = hit.val ? /yes/i : /no/i;
          const opt = Array.from(input.options).find(o => desired.test((o.text||'').trim()));
          if (opt) { setValue(input, opt.value); filled++; continue; }
        }
      }

      // some selects are for citizenship/visa/authorization (legacy handling)
      if (fieldCandidate.includes('citizen') || fieldCandidate.includes('visa') || fieldCandidate.includes('authorized') || fieldCandidate.includes('work author') || fieldCandidate.includes('sponsor')) {
        // choose option by profile values
        if (fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('require sponsorship')) {
          const wantVisa = !!profile.requireVisa;
          // pick option whose text matches yes/no
          const opt = Array.from(input.options).find(o => /yes|y/i.test(o.text) === wantVisa || /no|n/i.test(o.text) === !wantVisa);
          if (opt) { setValue(input, opt.value); filled++; continue; }
        }
        if (fieldCandidate.includes('citizen') || fieldCandidate.includes('authorized')) {
          const want = !!profile.authorizedToWork;
          const opt = Array.from(input.options).find(o => /yes|y|citizen|authorized/i.test(o.text) === want || /no|n|not/i.test(o.text) === !want);
          if (opt) { setValue(input, opt.value); filled++; continue; }
        }
      }

      // generic select mapping (e.g., how did you hear)
      if (profile.howHeard && (fieldCandidate.includes('how did') || fieldCandidate.includes('how heard') || fieldCandidate.includes('source'))) {
        if (setValue(input, profile.howHeard)) { filled++; continue; }
      }
    }

  // text inputs / textareas / date-like text
  if (type === 'text' || type === 'email' || type === 'tel' || input.tagName.toLowerCase() === 'textarea' || type === 'date' || type === 'number') {
      // full name field detection
      if ((fieldCandidate.includes('full') && fieldCandidate.includes('name')) || (fieldCandidate === 'name') || (fieldCandidate.includes('your name') && fullName)) {
        if (fullName) {
          try { input.focus?.(); input.value = fullName; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){}
          continue;
        }
      }

      // first/last/email/phone/github/school/address and other text fields
      if (fieldCandidate.includes('first')) {
        if (profile.firstName) { try { input.focus?.(); input.value = profile.firstName; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} }
        continue;
      }
      if (fieldCandidate.includes('last') || fieldCandidate.includes('surname') || fieldCandidate.includes('family')) {
        if (profile.lastName) { try { input.focus?.(); input.value = profile.lastName; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} }
        continue;
      }
      if (fieldCandidate.includes('email')) {
        if (profile.email) { try { input.focus?.(); input.value = profile.email; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} }
        continue;
      }
      if (fieldCandidate.includes('github') || fieldCandidate.includes('git')) {
        if (profile.github) { try { input.focus?.(); input.value = profile.github; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} }
        continue;
      }
      if (fieldCandidate.includes('school') || fieldCandidate.includes('university') || fieldCandidate.includes('college')) {
        if (profile.school) { if (setValue(input, profile.school)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('degree')) {
        if (profile.degree) {
          // if target is a select, try to match common degree variants
          if (input.tagName.toLowerCase() === 'select') {
            const variants = normalizeDegreeVariants(profile.degree);
            const opt = Array.from(input.options).find(o => {
              const text = (o.text || '').toLowerCase();
              const val = (o.value || '').toLowerCase();
              return variants.some(v => (text.includes(v) || val.includes(v)));
            });
            if (opt) { setValue(input, opt.value); filled++; }
            else if (setValue(input, profile.degree)) { filled++; }
          } else {
            if (setValue(input, profile.degree)) filled++;
          }
        }
        continue;
      }
      if (fieldCandidate.includes('discipline') || fieldCandidate.includes('major')) {
        if (profile.discipline) { if (setValue(input, profile.discipline)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('linkedin') || fieldCandidate.includes('linkedin profile')) {
        if (profile.linkedin) { if (setValue(input, profile.linkedin)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('location') || fieldCandidate.includes('city') || fieldCandidate.includes('location (city)')) {
        if (profile.locationCity) { if (setValue(input, profile.locationCity)) filled++; }
        continue;
      }
      // employment fields
      if (fieldCandidate.includes('company') || fieldCandidate.includes('employer')) {
        if (profile.companyName) { if (setValue(input, profile.companyName)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('title') || fieldCandidate.includes('position')) {
        if (profile.jobTitle) { if (setValue(input, profile.jobTitle)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('start month') || fieldCandidate.includes('start mm') || (fieldCandidate.includes('start') && fieldCandidate.includes('month')) || /\bmm\b/.test(fieldCandidate) ) {
        if (profile.startMonth) {
          // If select with month names, pick matching by text. If numeric input, use 01..12. If text input, try month name.
          if (input.tagName.toLowerCase() === 'select') {
            const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
            const mIdx = parseInt(profile.startMonth, 10) - 1;
            const candidates = [profile.startMonth, monthNames[mIdx]];
            const opt = Array.from(input.options).find(o => {
              const t = (o.text||'').toLowerCase(); const v = (o.value||'').toLowerCase();
              return candidates.some(c => !!c && (t.includes(String(c).toLowerCase()) || v.includes(String(c).toLowerCase())));
            });
            if (opt) { setValue(input, opt.value); filled++; }
          } else if (type === 'number') {
            if (setValue(input, parseInt(profile.startMonth,10))) filled++;
          } else if (type === 'text' || type === 'date') {
            // If date field, we will fill later as a full date string. For plain text, use month name.
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const mIdx = parseInt(profile.startMonth, 10) - 1;
            if (monthNames[mIdx]) { if (setValue(input, monthNames[mIdx])) filled++; }
            else if (setValue(input, profile.startMonth)) filled++;
          } else {
            if (setValue(input, profile.startMonth)) filled++;
          }
        }
        continue;
      }
      if (fieldCandidate.includes('start year') || fieldCandidate.includes('start yyyy') || (fieldCandidate.includes('start') && fieldCandidate.includes('year'))) {
        if (profile.startYear) { if (setValue(input, profile.startYear)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('start day') || fieldCandidate.includes('start dd') || (fieldCandidate.includes('start') && fieldCandidate.includes('day')) ) {
        if (profile.startDay) { if (setValue(input, profile.startDay)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('end month') || fieldCandidate.includes('end mm') || (fieldCandidate.includes('end') && fieldCandidate.includes('month'))) {
        if (profile.endMonth) {
          if (input.tagName.toLowerCase() === 'select') {
            const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
            const mIdx = parseInt(profile.endMonth, 10) - 1;
            const candidates = [profile.endMonth, monthNames[mIdx]];
            const opt = Array.from(input.options).find(o => {
              const t = (o.text||'').toLowerCase(); const v = (o.value||'').toLowerCase();
              return candidates.some(c => !!c && (t.includes(String(c).toLowerCase()) || v.includes(String(c).toLowerCase())));
            });
            if (opt) { setValue(input, opt.value); filled++; }
          } else if (type === 'number') {
            if (setValue(input, parseInt(profile.endMonth,10))) filled++;
          } else if (type === 'text' || type === 'date') {
            const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const mIdx = parseInt(profile.endMonth, 10) - 1;
            if (monthNames[mIdx]) { if (setValue(input, monthNames[mIdx])) filled++; }
            else if (setValue(input, profile.endMonth)) filled++;
          } else {
            if (setValue(input, profile.endMonth)) filled++;
          }
        }
        continue;
      }
      if (fieldCandidate.includes('end year') || fieldCandidate.includes('end yyyy') || (fieldCandidate.includes('end') && fieldCandidate.includes('year'))) {
        if (profile.endYear) { if (setValue(input, profile.endYear)) filled++; }
        continue;
      }
      if (fieldCandidate.includes('end day') || fieldCandidate.includes('end dd') || (fieldCandidate.includes('end') && fieldCandidate.includes('day')) ) {
        if (profile.endDay) { if (setValue(input, profile.endDay)) filled++; }
        continue;
      }

      // Full date inputs (single text or input[type=date]) for start/end
      if ((fieldCandidate.includes('start') && (fieldCandidate.includes('date') || type === 'date')) && (profile.startYear && profile.startMonth)) {
        const dd = profile.startDay || '01';
        const iso = `${profile.startYear}-${String(profile.startMonth).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        if (setValue(input, iso)) { filled++; continue; }
      }
      if ((fieldCandidate.includes('end') && (fieldCandidate.includes('date') || type === 'date')) && (profile.endYear && profile.endMonth)) {
        const dd = profile.endDay || '01';
        const iso = `${profile.endYear}-${String(profile.endMonth).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
        if (setValue(input, iso)) { filled++; continue; }
      }
      if (fieldCandidate.includes('phone') || fieldCandidate.includes('mobile') || fieldCandidate.includes('tel')) {
        if (profile.phone) { try { input.focus?.(); input.value = profile.phone; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} }
        continue;
      }
      if (fieldCandidate.includes('address')) {
        if (profile.address) { try { input.focus?.(); input.value = profile.address; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); filled++; } catch(e){} }
        continue;
      }
    }
  }

  // Fallback: if no resume attachment earlier, attempt broader heuristics to find a file input
  try {
    const fileInputs = Array.from(document.querySelectorAll('input[type=file]'));
    if ((profile.resumeData || profile.coverData) && fileInputs.length) {
      // prefer inputs that accept common resume formats
      for (const fi of fileInputs) {
        const label = (fi.name || fi.id || fi.placeholder || fi.getAttribute('aria-label') || findLabelTextForInput(fi) || '').toLowerCase();
        if (/resume|cv|curriculum|cover|upload|attach|application/.test(label)) continue; // likely already handled
        const accept = (fi.getAttribute('accept') || '').toLowerCase();
        if (accept.includes('pdf') || accept.includes('word') || accept.includes('application') || accept.includes('doc')) {
          if (trySetFileInput(fi, profile)) { filled++; fileAttached++; break; }
        }
      }

      // try attach/upload buttons/links on the page mentioning resume and find their file input
      if (!fileAttached) {
        const attachEls = Array.from(document.querySelectorAll('button, a, input[type=button]')).filter(el => /resume|cv|attach|upload/i.test((el.innerText || el.textContent || el.getAttribute('aria-label') || el.value || '').toString()));
        for (const btn of attachEls) {
          let candidate = null;
          try {
            candidate = btn.closest && (btn.closest('form') ? btn.closest('form').querySelector('input[type=file]') : null);
            if (!candidate) candidate = btn.parentElement && btn.parentElement.querySelector && btn.parentElement.querySelector('input[type=file]');
            if (!candidate) {
              let sib = btn.previousElementSibling;
              if (sib && sib.tagName && sib.tagName.toLowerCase() === 'input' && sib.type === 'file') candidate = sib;
              sib = btn.nextElementSibling;
              if (!candidate && sib && sib.tagName && sib.tagName.toLowerCase() === 'input' && sib.type === 'file') candidate = sib;
            }
          } catch (e) {}
          if (candidate) {
            if (trySetFileInput(candidate, profile)) { filled++; fileAttached++; break; }
          }
        }
      }

      // final fallback: attach to first available file input
      if (!fileAttached && fileInputs.length) {
        const first = fileInputs[0];
        if (trySetFileInput(first, profile)) { filled++; fileAttached++; }
      }
    }
  } catch (e) {
    // swallow fallback errors to avoid breaking filling other fields
  }

  const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const durationMs = Math.round(endTime - startTime);
  return { filled, total: inputs.length, durationMs, fileAttached, timestamp: Date.now() };
}

function getProfileFromChromeStorage() {
  return new Promise(resolve => {
    if (window.chrome && chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get('profile', (res) => {
        resolve(res?.profile || null);
      });
    } else {
      // fallback: try to read from window.localStorage if a page exposes it (rare)
      try {
        const raw = window.localStorage.getItem('jobEaseProfile');
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        resolve(null);
      }
    }
  });
}

async function handleFill(request, sender, sendResponse) {
  if (request?.type === 'DO_FILL') {
    const profile = request.profile || await getProfileFromChromeStorage();
    const result = fillInputs(profile);
    sendResponse({ ok: true, filled: result.filled });
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    handleFill(req, sender, sendResponse);
    // LinkedIn scraping request
    if (req?.type === 'SCRAPE_LINKEDIN_PROFILE') {
      try {
        const out = { firstName: '', lastName: '', linkedin: window.location.href, companyName: '', jobTitle: '', locationCity: '' };
        const sel = (s) => document.querySelector(s);
        const getText = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
        // New LinkedIn layout selectors (best-effort; may vary)
        const nameEl = sel('h1.text-heading-xlarge, .pv-text-details__left-panel h1');
        const headlineEl = sel('.text-body-medium.break-words');
        const locationEl = sel('.pv-text-details__left-panel .text-body-small.inline.t-black--light.break-words');
        const experienceCard = sel("section[id*='experience'] li.artdeco-list__item");
        const companyEl = experienceCard ? experienceCard.querySelector('span.t-bold') : null;
        const roleEl = experienceCard ? experienceCard.querySelector('div.display-flex.flex-column span[aria-hidden="true"]') : null;

        const fullName = getText(nameEl);
        if (fullName) {
          const parts = fullName.split(/\s+/);
          out.firstName = parts[0] || '';
          out.lastName = parts.slice(1).join(' ');
        }
        out.jobTitle = getText(roleEl) || getText(headlineEl);
        out.companyName = getText(companyEl);
        out.locationCity = getText(locationEl).split(/·/)[0].trim();

        sendResponse({ ok: true, data: out });
      } catch (e) {
        sendResponse({ ok: false, error: 'scrape-failed' });
      }
      return true;
    }
    // return true to indicate async response if needed
    return true;
  });
}

// also expose a window-level command for manual testing from console
window.__JobEase_fill = async () => {
  const profile = await getProfileFromChromeStorage();
  return fillInputs(profile);
};
