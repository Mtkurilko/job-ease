// Content script: autofill + diagnostics + host-only site preferences

// ---- Label helpers ----
function findLabelTextForInput(input) {
  try {
    if (!input) return '';
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) return label.innerText || label.textContent || '';
    }
    const wrap = input.closest && input.closest('label');
    if (wrap) return wrap.innerText || wrap.textContent || '';
    const labelled = input.getAttribute && input.getAttribute('aria-labelledby');
    if (labelled) { const el = document.getElementById(labelled); if (el) return el.innerText || el.textContent || ''; }
    let prev = input.previousElementSibling; let steps = 0;
    while (prev && steps < 6) { const text = (prev.innerText || prev.textContent || '').trim(); if (text) return text; prev = prev.previousElementSibling; steps++; }
    if (input.parentElement) {
      let pprev = input.parentElement.previousElementSibling; steps = 0;
      while (pprev && steps < 6) { const text = (pprev.innerText || pprev.textContent || '').trim(); if (text) return text; pprev = pprev.previousElementSibling; steps++; }
    }
    return '';
  } catch { return ''; }
}

function normalizeDegreeVariants(deg) {
  if (!deg) return [];
  const d = String(deg).toLowerCase();
  const variants = new Set();
  const cleaned = d.replace(/[\u2018\u2019']/g,'').replace(/\./g,'').trim();
  variants.add(cleaned);
  if (cleaned.includes('bachelor')) ['bachelor','bachelors','ba','bs','bsc'].forEach(v=>variants.add(v));
  if (cleaned.includes('master')) ['master','masters','ms','msc'].forEach(v=>variants.add(v));
  if (cleaned.includes('associate')) ['associate','associate\'s','aa','as'].forEach(v=>variants.add(v));
  if (cleaned.includes('doctor') || cleaned.includes('phd')) ['phd','doctorate'].forEach(v=>variants.add(v));
  variants.add(cleaned.replace(/degree$/,'').trim());
  return Array.from(variants).filter(Boolean);
}

// Month helper: produce candidate textual & numeric representations (08, 8, august, aug)
function monthVariants(m) {
  if (!m) return [];
  const n = (String(m).length===1 ? '0'+m : String(m));
  const num = parseInt(m,10);
  if (isNaN(num) || num < 1 || num > 12) return [String(m)];
  const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const full = names[num-1];
  const short = full.slice(0,3);
  const bare = String(num);
  return [n, bare, full, short].filter((v,i,a)=>v && a.indexOf(v)===i);
}

// ---- File attachment ----
function dataURLtoFile(dataurl, filename) {
  try {
    const [meta, b64] = dataurl.split(',');
    const mimeMatch = meta.match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) u8[i] = bin.charCodeAt(i);
    try { return new File([u8], filename, { type: mime }); } catch { return new Blob([u8], { type: mime }); }
  } catch { return null; }
}

function trySetFileInput(input, profile) {
  const hasResume = !!profile?.resumeData; const hasCover = !!profile?.coverData;
  if (!hasResume && !hasCover) return false;
  const label = (input.name || input.id || input.placeholder || input.getAttribute('aria-label') || findLabelTextForInput(input) || '').toLowerCase();
  let dataUrl = null; let name = 'file.pdf';
  if ((label.includes('cover') || label.includes('cover letter')) && hasCover) { dataUrl = profile.coverData; name = profile.coverName || 'cover.pdf'; }
  else if (hasResume) { dataUrl = profile.resumeData; name = profile.resumeName || 'resume.pdf'; }
  else if (hasCover) { dataUrl = profile.coverData; name = profile.coverName || 'cover.pdf'; }
  if (!dataUrl) return false;
  const file = dataURLtoFile(dataUrl, name); if (!file) return false;
  const dt = new DataTransfer();
  try { dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; } catch { return false; }
}

// ---- Site preferences storage (host-only) ----
function getHostname() { try { return location.hostname || 'unknown-host'; } catch { return 'unknown-host'; } }
function getSitePrefsEnabled() { return new Promise(r => { try { chrome?.storage?.local?.get ? chrome.storage.local.get('sitePrefsEnabled', res => r(!!res?.sitePrefsEnabled)) : r(false); } catch { r(false); } }); }
function getAllSitePrefs() { return new Promise(r => { try { chrome?.storage?.local?.get ? chrome.storage.local.get('sitePrefs', res => r(res?.sitePrefs || {})) : r({}); } catch { r({}); } }); }
function setAllSitePrefs(p) { return new Promise(r => { try { chrome?.storage?.local?.set ? chrome.storage.local.set({ sitePrefs: p }, () => r(true)) : r(false); } catch { r(false); } }); }

// ---- Autofill core ----
async function fillInputs(profile) {
  if (!profile) return { filled: 0 };
  const start = performance?.now ? performance.now() : Date.now();
  const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
  let filled = 0; let fileAttached = 0; const events = [];
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

  function metricWrap(fn, field) {
    const t0 = performance?.now ? performance.now() : Date.now(); let ok = false;
    try { ok = fn() !== false; } catch { ok = false; }
    const t1 = performance?.now ? performance.now() : Date.now();
    events.push({ field, ms: Math.round(t1 - t0), ok });
    if (ok) filled++;
    return ok;
  }

  function setValue(el, value, label) {
    return metricWrap(() => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      if (tag === 'select') {
        if (el.multiple && Array.isArray(value)) {
          for (const opt of el.options) opt.selected = value.includes(opt.value) || value.includes(opt.text);
        } else {
          const match = Array.from(el.options).find(o => (o.text||'').toLowerCase().includes(String(value).toLowerCase()) || (o.value||'').toLowerCase().includes(String(value).toLowerCase()));
          el.value = match ? match.value : value;
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (type === 'checkbox' || type === 'radio') {
        el.checked = !!value; el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        el.focus?.(); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }, label || (el.name || el.id || el.placeholder || 'field'));
  }

  for (const input of inputs) {
    const type = (input.type || '').toLowerCase();
    const fieldCandidate = [input.name, input.id, input.placeholder, input.getAttribute?.('aria-label'), input.getAttribute?.('autocomplete'), input.autocomplete, findLabelTextForInput(input)].filter(Boolean).join(' ').toLowerCase();

    if (type === 'file') {
      if (/resume|cv|curriculum|upload/.test(fieldCandidate)) { if (trySetFileInput(input, profile)) { filled++; fileAttached++; } }
      continue;
    }

    if (type === 'checkbox' || type === 'radio') {
      if (fieldCandidate.includes('disabil') || fieldCandidate.includes('access')) { input.checked = !!profile.disability; input.dispatchEvent(new Event('change', { bubbles: true })); filled++; continue; }
      if (fieldCandidate.includes('veteran') || fieldCandidate.includes('military')) { input.checked = !!profile.veteran; input.dispatchEvent(new Event('change', { bubbles: true })); filled++; continue; }
      if (fieldCandidate.includes('citizen') || fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor') || fieldCandidate.includes('authorized to work')) {
        if (typeof profile.authorizedToWork !== 'undefined' && fieldCandidate.includes('authorized to work')) { setValue(input, !!profile.authorizedToWork, 'work authorization'); continue; }
        if (typeof profile.authorizedToWork !== 'undefined' && fieldCandidate.includes('citizen')) { setValue(input, !!profile.authorizedToWork, 'citizen'); continue; }
        if (fieldCandidate.includes('visa') || fieldCandidate.includes('sponsor')) { setValue(input, !!profile.requireVisa, 'visa'); continue; }
      }
    }

    if (input.tagName.toLowerCase() === 'select') {
      const yesNo = Array.from(input.options).some(o => /^(yes|no)$/i.test((o.text||'').trim()));
      if (yesNo) {
        const map = [
          { keys: ['authorized to work','work authorization','citizen'], val: profile.authorizedToWork },
          { keys: ['require visa','sponsor','sponsorship','work visa'], val: profile.requireVisa },
          { keys: ['currently employed'], val: profile.currentlyEmployed },
          { keys: ['government official','gov official'], val: profile.govOfficial },
          { keys: ['relative','close relative government'], val: profile.relativeGovOfficial },
          { keys: ['at least 18','over 18','age 18'], val: profile.ageOver18 },
          { keys: ['use ai','ai tools','consent ai'], val: profile.consentAI }
        ];
        const hit = map.find(m => m.val !== undefined && m.keys.some(k => fieldCandidate.includes(k)));
        if (hit && typeof hit.val === 'boolean') { const desired = hit.val ? /yes/i : /no/i; const opt = Array.from(input.options).find(o => desired.test((o.text||'').trim())); if (opt) { setValue(input, opt.value, hit.keys[0]); continue; } }
      }
      if (profile.howHeard && /how did|how heard|source/.test(fieldCandidate)) { setValue(input, profile.howHeard, 'how heard'); continue; }
    }

    if (['text','email','tel','date','number'].includes(type) || input.tagName.toLowerCase() === 'textarea') {
      if ((fieldCandidate.includes('full') && fieldCandidate.includes('name')) || fieldCandidate === 'name' || fieldCandidate.includes('your name')) { if (fullName) { setValue(input, fullName, 'full name'); continue; } }
      if (fieldCandidate.includes('first')) { if (profile.firstName) { setValue(input, profile.firstName, 'first name'); } continue; }
      if (fieldCandidate.includes('last') || fieldCandidate.includes('surname') || fieldCandidate.includes('family')) { if (profile.lastName) { setValue(input, profile.lastName, 'last name'); } continue; }
      if (fieldCandidate.includes('email')) { if (profile.email) { setValue(input, profile.email, 'email'); } continue; }
      if (fieldCandidate.includes('github')) { if (profile.github) { setValue(input, profile.github, 'github'); } continue; }
      if (/school|university|college/.test(fieldCandidate)) { if (profile.school) { setValue(input, profile.school, 'school'); } continue; }
      if (fieldCandidate.includes('degree')) { if (profile.degree) { if (input.tagName.toLowerCase()==='select') { const variants = normalizeDegreeVariants(profile.degree); const opt = Array.from(input.options).find(o => { const txt=(o.text||'').toLowerCase(); const val=(o.value||'').toLowerCase(); return variants.some(v => txt.includes(v) || val.includes(v)); }); if (opt) { setValue(input, opt.value, 'degree'); } else { setValue(input, profile.degree, 'degree'); } } else { setValue(input, profile.degree, 'degree'); } } continue; }
      if (fieldCandidate.includes('discipline') || fieldCandidate.includes('major')) { if (profile.discipline) { setValue(input, profile.discipline, 'discipline'); } continue; }
      if (fieldCandidate.includes('linkedin')) { if (profile.linkedin) { setValue(input, profile.linkedin, 'linkedin'); } continue; }
      if (/location|city/.test(fieldCandidate)) { if (profile.locationCity) { setValue(input, profile.locationCity, 'city'); } continue; }
      if (/company|employer/.test(fieldCandidate)) { if (profile.companyName) { setValue(input, profile.companyName, 'company'); } continue; }
      if (/title|position/.test(fieldCandidate)) { if (profile.jobTitle) { setValue(input, profile.jobTitle, 'title'); } continue; }
      // Date parts
  if (/start .*month|start mm|\bmm\b/.test(fieldCandidate)) { if (profile.startMonth) { const mv=monthVariants(profile.startMonth); if (input.tagName.toLowerCase()==='select'){ const opt=Array.from(input.options).find(o=>{ const txt=(o.text||'').toLowerCase(); const val=(o.value||'').toLowerCase(); return mv.some(v=> txt===v.toLowerCase() || val===v.toLowerCase());}); if(opt) setValue(input,opt.value,'start month'); else setValue(input,mv[0],'start month'); } else { setValue(input,mv[0],'start month'); } } continue; }
  if (/start .*year|start yyyy/.test(fieldCandidate)) { if (profile.startYear) { setValue(input, profile.startYear, 'start year'); } continue; }
  if (/start .*day|start dd/.test(fieldCandidate)) { if (profile.startDay) { setValue(input, profile.startDay, 'start day'); } continue; }
  if (/end .*month|end mm/.test(fieldCandidate)) { if (profile.endMonth) { const mv=monthVariants(profile.endMonth); if (input.tagName.toLowerCase()==='select'){ const opt=Array.from(input.options).find(o=>{ const txt=(o.text||'').toLowerCase(); const val=(o.value||'').toLowerCase(); return mv.some(v=> txt===v.toLowerCase() || val===v.toLowerCase());}); if(opt) setValue(input,opt.value,'end month'); else setValue(input,mv[0],'end month'); } else { setValue(input,mv[0],'end month'); } } continue; }
      if (/end .*year|end yyyy/.test(fieldCandidate)) { if (profile.endYear) { setValue(input, profile.endYear, 'end year'); } continue; }
      if (/end .*day|end dd/.test(fieldCandidate)) { if (profile.endDay) { setValue(input, profile.endDay, 'end day'); } continue; }
      if (fieldCandidate.includes('date') && fieldCandidate.includes('start') && profile.startYear && profile.startMonth) { const dd = profile.startDay || '01'; const iso = `${profile.startYear}-${String(profile.startMonth).padStart(2,'0')}-${String(dd).padStart(2,'0')}`; setValue(input, iso, 'start date'); continue; }
      if (fieldCandidate.includes('date') && fieldCandidate.includes('end') && profile.endYear && profile.endMonth) { const dd = profile.endDay || '01'; const iso = `${profile.endYear}-${String(profile.endMonth).padStart(2,'0')}-${String(dd).padStart(2,'0')}`; setValue(input, iso, 'end date'); continue; }
      if (/phone|mobile|tel/.test(fieldCandidate)) { if (profile.phone) { setValue(input, profile.phone, 'phone'); } continue; }
      if (fieldCandidate.includes('address')) { if (profile.address) { setValue(input, profile.address, 'address'); } continue; }
    }
  }

  // File inputs outside main loop (generic attachment zones)
  try {
    const fileInputs = Array.from(document.querySelectorAll('input[type=file]'));
    if ((profile.resumeData || profile.coverData) && fileInputs.length) {
      for (const fi of fileInputs) {
        const label = (fi.name || fi.id || fi.placeholder || fi.getAttribute('aria-label') || findLabelTextForInput(fi) || '').toLowerCase();
        if (/resume|cv|curriculum|cover|upload|attach|application/.test(label)) continue; // skip dedicated resume fields
        const accept = (fi.getAttribute('accept') || '').toLowerCase();
        if (accept.includes('pdf') || accept.includes('word') || accept.includes('application') || accept.includes('doc')) { if (trySetFileInput(fi, profile)) { filled++; fileAttached++; break; } }
      }
      if (!fileAttached) {
        const attachEls = Array.from(document.querySelectorAll('button,a,input[type=button]')).filter(el => /resume|cv|attach|upload/i.test((el.innerText||el.textContent||el.getAttribute('aria-label')||el.value||'').toString()));
        for (const btn of attachEls) {
          let candidate = null;
          try {
            candidate = btn.closest?.('form')?.querySelector('input[type=file]');
            if (!candidate) candidate = btn.parentElement?.querySelector?.('input[type=file]');
            if (!candidate) { let sib = btn.previousElementSibling; if (sib?.tagName?.toLowerCase()==='input' && sib.type==='file') candidate = sib; sib = btn.nextElementSibling; if (!candidate && sib?.tagName?.toLowerCase()==='input' && sib.type==='file') candidate = sib; }
          } catch {}
          if (candidate && trySetFileInput(candidate, profile)) { filled++; fileAttached++; break; }
        }
      }
      if (!fileAttached && fileInputs[0] && trySetFileInput(fileInputs[0], profile)) { filled++; fileAttached++; }
    }
  } catch {}

  // Apply host-only site preferences (do not count towards filled)
  try {
    const enabled = await getSitePrefsEnabled();
    if (enabled) {
      const host = getHostname(); const all = await getAllSitePrefs(); const site = all[host];
      if (site) {
        if (site.radios) {
          for (const [name,val] of Object.entries(site.radios)) {
            try {
              const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`));
              const target = radios.find(r => (r.value||'')==String(val));
              if (target) { const t0=performance?.now?performance.now():Date.now(); target.checked=true; target.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance?.now?performance.now():Date.now(); events.push({ field:`site-pref radio:${name}`, ms:Math.round(t1-t0), ok:true }); }
            } catch {}
          }
        }
        if (site.checkboxes) {
          for (const [key,checked] of Object.entries(site.checkboxes)) {
            try { let el=document.querySelector(`input[type="checkbox"][name="${CSS.escape(key)}"]`); if(!el) el=document.getElementById(key); if(el){ const t0=performance?.now?performance.now():Date.now(); el.checked=!!checked; el.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance?.now?performance.now():Date.now(); events.push({ field:`site-pref checkbox:${key}`, ms:Math.round(t1-t0), ok:true }); } } catch{}
          }
        }
        if (site.selects) {
          for (const [key,val] of Object.entries(site.selects)) {
            try { let el=document.querySelector(`select[name="${CSS.escape(key)}"]`); if(!el) el=document.getElementById(key); if(el){ const t0=performance?.now?performance.now():Date.now(); const opt=Array.from(el.options).find(o => (o.value||'')==String(val)); el.value=opt?opt.value:val; el.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance?.now?performance.now():Date.now(); events.push({ field:`site-pref select:${key}`, ms:Math.round(t1-t0), ok:true }); } } catch{}
          }
        }
        if (site.texts) {
          for (const [key,val] of Object.entries(site.texts)) {
            try { let el=document.querySelector(`input[name="${CSS.escape(key)}"]`)||document.getElementById(key)||document.querySelector(`textarea[name="${CSS.escape(key)}"]`)||document.querySelector(`textarea#${CSS.escape(key)}`); if(el){ const t0=performance?.now?performance.now():Date.now(); el.value=val; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); const t1=performance?.now?performance.now():Date.now(); events.push({ field:`site-pref text:${key}`, ms:Math.round(t1-t0), ok:true }); } } catch{}
          }
        }
      }
      // capture user edits after 600ms
      window.__JobEase_captureEnabled=false;
      setTimeout(() => {
        window.__JobEase_captureEnabled=true; if (window.__JobEase_sitePrefCaptureInstalled) return; window.__JobEase_sitePrefCaptureInstalled=true;
        const handler=(e)=>{
          if(!window.__JobEase_captureEnabled) return; const el=e.target; if(!el) return; const tag=(el.tagName||'').toLowerCase(); const type=(el.type||'').toLowerCase(); const key=el.name||el.id; if(!key) return;
          let kind=null, val=null; if(tag==='select'){kind='select';val=el.value;} else if(type==='radio'){ if(!el.checked) return; kind='radio'; val=el.value; } else if(type==='checkbox'){ kind='checkbox'; val=!!el.checked; } else if(tag==='input'||tag==='textarea'){ kind='text'; val=el.value; }
          if(!kind) return;
          (async()=>{ const all2=await getAllSitePrefs(); const host2=getHostname(); const site2=all2[host2]||{ version:3, updatedAt:Date.now(), host:host2, radios:{}, checkboxes:{}, selects:{}, texts:{} }; if(kind==='radio') site2.radios[key]=val; else if(kind==='checkbox') site2.checkboxes[key]=val; else if(kind==='select') site2.selects[key]=val; else if(kind==='text') site2.texts[key]=val; site2.updatedAt=Date.now(); all2[host2]=site2; await setAllSitePrefs(all2); })();
        };
        document.addEventListener('change', handler, true);
        document.addEventListener('input', handler, true);
      }, 600);
    }
  } catch {}

  const end = performance?.now ? performance.now() : Date.now();
  const result = { filled, total: inputs.length, durationMs: Math.round(end-start), fileAttached, timestamp: Date.now(), events };
  try { if (window.__JobEase_diagEnabled) renderDiagnosticsOverlay(result); window.__JobEase_lastDiagnostics = result; } catch {}
  return result;
}

// ---- Diagnostics overlay ----
function renderDiagnosticsOverlay(result) {
  if (!result) return; const existing=document.getElementById('__jobease_diag'); if(existing) existing.remove();
  const root=document.createElement('div'); root.id='__jobease_diag'; Object.assign(root.style,{position:'fixed',top:'10px',right:'10px',zIndex:'999999',width:'340px',maxHeight:'70vh',overflow:'auto',fontFamily:'system-ui,-apple-system,Segoe UI,Roboto,sans-serif',fontSize:'12px',background:'rgba(17,24,39,0.95)',color:'#f8fafc',border:'1px solid #334155',borderRadius:'8px',boxShadow:'0 6px 20px rgba(0,0,0,0.4)',backdropFilter:'blur(4px)',padding:'10px'});
  root.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><strong>Diagnostics</strong><button id="__jobease_close" style="background:#dc2626;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px">Close</button></div>`;
  const summary=document.createElement('div'); const successRate = result.total ? ((result.filled/result.total)*100).toFixed(1) : '0.0'; summary.style.marginBottom='6px'; summary.textContent=`Filled ${result.filled} of ${result.total} fields in ${result.durationMs}ms (success ${successRate}%)${result.fileAttached?' • file attached':''}`; root.appendChild(summary);
  const list=document.createElement('div'); for (const ev of result.events.slice(0,150)) { const row=document.createElement('div'); row.style.display='flex'; row.style.gap='6px'; row.style.padding='2px 0'; row.innerHTML=`<span>${ev.ok?'✅':'⚠️'}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${(ev.field||'field').slice(0,60)}</span><span style="color:#94a3b8">${ev.ms}ms</span>`; list.appendChild(row); } root.appendChild(list);
  const hideBtn=document.createElement('button'); hideBtn.textContent='Hide overlay'; Object.assign(hideBtn.style,{background:'#1d4ed8',color:'#fff',border:'none',padding:'4px 8px',borderRadius:'4px',cursor:'pointer',fontSize:'11px',marginTop:'8px'}); hideBtn.onclick=()=>{ window.__JobEase_diagEnabled=false; root.remove(); }; root.appendChild(hideBtn);
  document.documentElement.appendChild(root); document.getElementById('__jobease_close')?.addEventListener('click',()=>root.remove());
}

// ---- Profile retrieval ----
function getProfileFromChromeStorage() { return new Promise(r => { try { chrome?.storage?.local?.get ? chrome.storage.local.get('profile', res => r(res?.profile || null)) : r(null); } catch { r(null); } }); }

// ---- Message handling ----
async function handleFill(request, sender, sendResponse) {
  if (request?.type === 'DO_FILL') { const profile = request.profile || await getProfileFromChromeStorage(); const result = await fillInputs(profile); sendResponse({ ok:true, ...result }); }
}

// ---- Runtime listener ----
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    if (req?.type === 'TOGGLE_DIAGNOSTICS') { window.__JobEase_diagEnabled = !!req.enabled; if (!window.__JobEase_diagEnabled) { document.getElementById('__jobease_diag')?.remove(); } else if (window.__JobEase_lastDiagnostics) { renderDiagnosticsOverlay(window.__JobEase_lastDiagnostics); } sendResponse({ ok:true, enabled:window.__JobEase_diagEnabled }); return true; }
    if (req?.type === 'GET_HOST') { sendResponse({ host:getHostname() }); return true; }
    handleFill(req, sender, sendResponse); return true;
  });
}

// Shortcut fill helper
window.__JobEase_fill = async () => { const profile = await getProfileFromChromeStorage(); return fillInputs(profile); };
