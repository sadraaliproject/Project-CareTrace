import * as engine from './engine.js';

const { BARRIERS, patients, parseQuestion, runQuery, makeDraft, getMetrics, evaluateExtraction, extractBarriers } = engine;
const $ = (s, root = document) => root.querySelector(s);
const e = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const icons = {
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 queue:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6M9 18h3"/>',
 lab:'<path d="M9 3h6M10 3v6l-6 10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2L14 9V3M8 15h8"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
 arrow:'<path d="M5 12h14M14 7l5 5-5 5"/>',
 chevron:'<path d="m9 5 7 7-7 7"/>',
 left:'<path d="m15 5-7 7 7 7"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
 sparkle:'<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6ZM20 2v4M18 4h4"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v2"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
 document:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9ZM14 3v6h6M8 13h8M8 17h5"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/>',
 car:'<path d="m5 6-2 7v5h2m14 0h2v-5l-2-7ZM3 12h18M6 16h2M16 16h2M5 18v3M19 18v3"/>',
 coin:'<circle cx="12" cy="12" r="9"/><path d="M15 8h-4a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H9M12 6v12"/>',
 food:'<path d="M6 3v8M3 3v4a3 3 0 0 0 6 0V3M6 11v10M16 3v18M16 3c-4 4-4 10 0 10h3V3Z"/>',
 language:'<path d="M3 5h12M9 3v2M5 5c0 7 9 10 9 10M13 5c0 7-9 10-9 10M14 21l4-10 4 10M15.5 17h5"/>',
 home:'<path d="m3 10 9-8 9 8M5 9v12h14V9M9 21v-7h6v7"/>',
 filter:'<path d="M4 5h16l-6 7v7l-4 2v-9Z"/>',
 chart:'<path d="M4 3v17h17M8 15v-4M13 15V7M18 15v-7"/>',
 nodes:'<circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/><path d="m8 10 8-4M8 14l8 4"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
 send:'<path d="m3 3 18 9-18 9 4-9ZM7 12h14"/>',
 copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
 leaf:'<path d="M20 3C4 2 2 9 5 16c5 6 15 2 15-13ZM5 21l9-12"/>',
 target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
 code:'<path d="m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18"/>',
 history:'<path d="M3 4v6h6M4 10a9 9 0 1 1 0 6M12 7v6l3 2"/>',
};
const icon = (name, cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.nodes}</svg>`;
const brand = `<svg class="brand-mark" viewBox="0 0 32 36" fill="none" aria-hidden="true"><path d="M12 3h8v10h10v8H20v12h-8V21H2v-8h10V3Z" fill="currentColor" opacity=".95"/><path d="M12 3v10H2M30 21H20v12" stroke="#122d38" stroke-width="3"/><path d="M20 3v10h10M2 21h10v12" stroke="#a5e4cf" stroke-width="2"/></svg>`;
const barrierIcon = type => ({transportation:'car',cost:'coin',food:'food',health_literacy:'document'}[type] || 'nodes');
const barrierLabel = type => BARRIERS[type]?.label || type.replaceAll('_',' ');
const initials = patient => String(patient.name || patient.id).split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase();
const num = value => Number(value || 0).toLocaleString();
const date = value => value ? new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Date unavailable';
const pct = value => `${Math.round(Number(value || 0) * (Number(value) <= 1 ? 100 : 1))}%`;
const STORAGE = 'careweave.tasks.v1';
let savedTasks = [];
try { savedTasks = JSON.parse(localStorage.getItem(STORAGE) || '[]'); if (!Array.isArray(savedTasks)) savedTasks = []; } catch { savedTasks = []; }
const state = {
 view: 'workbench', question:'Find diabetic patients who are overdue for an A1c test and have transportation barriers.',
 plan:null, result:null, summary:'', queryError:'', stale:false, page:0, perPage:7, busy:false,
 capacity:20, tasks:savedTasks, queueFilter:'pending', api:{model:false}, drawer:null,
 labText:'I used to miss appointments because I had no ride, but my daughter now drives me and transportation is no longer a problem.',
 labResult:null, repeat:null, queryId:0, lastRun:null,
};
let metrics;
try { metrics = getMetrics(); } catch { metrics = {}; }
let evaluation;
let toastTimer;
let drawerReturnFocus;

function toast(message) { const node=$('#toast'); node.textContent=message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.classList.remove('visible'),4000); }
function saveTasks() { try { localStorage.setItem(STORAGE,JSON.stringify(state.tasks)); } catch { toast('Browser storage is unavailable. Keep this tab open to retain drafts.'); } }
function eligible(patient) { return state.plan?.status!=='resolved' && Boolean(patient.gapOpen) && patient.barriers?.some(b=>b.status==='active'&&(!state.plan?.barriers?.length||state.plan.barriers.includes(b.type))); }
function chosenBarrier(patient) {
 const list=patient.barriers || [];
 const status=state.plan?.status || 'active';
 return list.find(b=>(status==='any'||b.status===status) && (!state.plan?.barriers?.length||state.plan.barriers.includes(b.type))) || list.find(b=>b.status==='active') || list[0];
}
function displayGap(patient,queryAware=true) { return queryAware&&state.plan?.refillMin != null ? 'Medication refill' : queryAware&&state.plan?.gapType==='elevated' ? 'Elevated A1c review' : patient.daysOverdue>0 ? 'A1c blood test' : patient.gapOpen ? 'Elevated A1c review' : 'No open care gap'; }
function gapDetail(patient) { return state.plan?.refillMin!=null?`${num(patient.refillGap)} days since refill due`:state.plan?.gapType==='elevated'?`A1c ${patient.a1c}% · demo rule`:patient.daysOverdue>0?`${num(patient.daysOverdue)} days overdue`:patient.gapOpen?`A1c ${patient.a1c}% · demo rule`:'No open care gap'; }
function highPriority(patient) { return typeof patient.priority==='number' ? patient.priority>=70 : /high|urgent/i.test(patient.priority); }
function patientMarkup(patient, compact=false) { return `<div class="patient-cell"><span class="avatar patient-avatar">${e(initials(patient))}</span><div><strong>${e(patient.name)}</strong><small>${e(patient.id)}${compact?'':` <span aria-hidden="true">·</span> ${e(patient.age)} years`}</small></div></div>`; }
function barrierPill(b) { return b ? `<span class="barrier-pill ${e(b.type)} ${b.status==='resolved'?'resolved':''}">${icon(barrierIcon(b.type))}${e(barrierLabel(b.type))}${b.status==='resolved'?' · resolved':''}</span>` : '<span class="mini-label">No active barrier</span>'; }
function stat(label,value,suffix,description,iconName,green=false){return `<div class="card stat-card"><div class="stat-top">${label}<span class="stat-icon">${icon(iconName)}</span></div><div class="stat-value">${e(value)}${suffix?`<small>${suffix}</small>`:''}</div><div class="stat-description ${green?'green':''}">${green?icon('check'):''}${description}</div></div>`;}
function filterTags(){
 if(!state.plan)return '';
 const p=state.plan;
 return [p.diabetesOnly?'Diabetes':null,p.gapOnly?p.gapType==='overdue'?'A1c overdue':p.gapType==='elevated'?'Elevated A1c':'Open care gap':null,p.refillMin!=null?`Refill gap ≥ ${p.refillMin} days`:null,...(p.barriers||[]).map(barrierLabel),p.status==='resolved'?'Resolved barriers':p.status==='any'?'All barrier states':'Active barriers',p.ageMin!=null?`Age ≥ ${p.ageMin}`:null,p.ageMax!=null?`Age ≤ ${p.ageMax}`:null,p.limit?`Top ${p.limit}`:null].filter(Boolean).map(x=>`<span class="filter-tag">${e(x)}</span>`).join('');
}
function footer(){return `<footer class="footnote"><div>${icon('shield')}100% fictional patient data. Human approval required for all demo tasks.</div><div>${icon('nodes')}Structured results. Source-linked evidence. Reproducible answers.</div></footer>`;}

function render(){
 const labels={workbench:'Workbench',queue:'Care queue',lab:'Evidence lab',about:'About the demo'};
 $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand">${brand}<span>careweave</span></div><div class="brand-caption">Connect care to context</div><div class="nav-label">CARE INTELLIGENCE</div><nav class="nav" aria-label="Main navigation">${[['workbench','grid','Workbench'],['queue','queue','Care queue'],['lab','lab','Evidence lab'],['about','info','About this demo']].map(([v,i,l])=>`<button class="nav-item ${state.view===v?'active':''}" data-action="view" data-view="${v}" title="${l}" ${state.view===v?'aria-current="page"':''}>${icon(i)}<span>${l}</span>${v==='queue'&&state.tasks.filter(t=>t.status==='pending').length?`<span class="nav-count">${state.tasks.filter(t=>t.status==='pending').length}</span>`:''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="demo-tag"><span></span>Built for the care between visits</div><p>A little more context.<br>A different next step.</p><div class="sidebar-person"><div class="avatar">CW</div><div><strong>Care coordination team</strong><small>Demo workspace</small></div></div></div></aside><header class="topbar"><div class="breadcrumbs">Care intelligence ${icon('chevron')}<b>${labels[state.view]}</b></div><div class="topbar-right"><span class="live-badge"><i></i>${num(patients.length)} synthetic patients</span><span class="topbar-separator"></span><div class="avatar" title="Demo workspace">CW</div></div></header><main class="content view-fade" id="main-content">${state.view==='workbench'?workbench():state.view==='queue'?queueView():state.view==='lab'?labView():aboutView()}${footer()}</main></div>`;
 bindEvents();
}

function workbench(){
 const r=state.result;
 const list=r?.patients||[];
 const evidenceCount=list.filter(p=>chosenBarrier(p)?.documentId).length;
 const overdue=list.map(p=>p.daysOverdue||0).sort((a,b)=>a-b);
 const median=overdue.length?overdue[Math.floor(overdue.length/2)]:0;
 return `<div class="page-heading"><div><div class="eyebrow">${icon('sparkle')}The story behind the care gap</div><h1>Find the reason. Close the gap.</h1><p class="subtitle">Turn the context hidden in patient notes into a clearer path to care.</p></div><button class="btn" data-action="audit">${icon('download')}Export audit</button></div><section class="card query-card ${state.busy?'busy':''}" aria-labelledby="query-title"><div class="query-label"><strong id="query-title">${icon('sparkle')}Ask your care population</strong><span class="mode-badge">${icon(state.api.model?'sparkle':'code')}${state.api.model?'AI query planning · deterministic results':'Deterministic demo engine'}</span></div><form id="query-form"><div class="query-input-wrap">${icon('search')}<label class="sr-only" for="question">Ask about the synthetic patient population</label><textarea id="question" rows="1" placeholder="Who is missing care, and what is getting in the way?">${e(state.question)}</textarea><button class="btn btn-primary" type="submit" ${state.busy?'disabled':''}>${state.busy?icon('refresh','busy-icon'):icon('sparkle')}${state.busy?'Analyzing…':'Run analysis'}${state.busy?'':icon('arrow')}</button></div></form><div class="query-chips"><span>TRY ASKING</span><button class="chip" data-action="example" data-example="transport">${icon('car')}Transportation + A1c</button><button class="chip" data-action="example" data-example="cost">${icon('coin')}Cost + missed refills</button><button class="chip" data-action="example" data-example="food">${icon('food')}Food insecurity</button><button class="chip" data-action="example" data-example="resolved">${icon('history')}What changed?</button><button class="chip" data-action="example" data-example="followup">${icon('filter')}Narrow to age 65+</button></div>${state.queryError?`<div class="query-message" role="alert">${e(state.queryError)}${state.stale?' The previous result is still shown below.':''}</div>`:''}</section><div class="stats-grid">${stat('Patients in this cohort',r?num(r.count):'—','',`${r?'Exact match across '+num(patients.length)+' records':'Ready to analyze your population'}`,'people')}${stat('Source-linked results',r?`${evidenceCount}`:'—',r&&list.length?`/ ${list.length}`:'','Displayed patients with barrier evidence','shield',true)}${stat('Typical time overdue',r?median:'—','days','Median across matched A1c records','clock')}${stat('Resolved barriers excluded',r?num(r.excludedResolved):'—','','Status-aware, beyond keyword matching','history',true)}</div><div class="workspace-grid"><div><section class="card results-card" aria-labelledby="cohort-title"><div class="section-header results-header"><div><div class="section-title"><h2 id="cohort-title">Your care cohort</h2><span class="number-badge">${r?num(r.count):0}</span>${state.stale?'<span class="stale-tag">Previous result</span>':''}</div><div class="subcopy">${e(state.summary||'Each patient, connected to the reason their care is overdue.')}</div></div><button class="btn btn-sm" data-action="csv" ${!list.length?'disabled':''}>${icon('download')}Export CSV</button></div><div class="filter-strip">${icon('filter')}${filterTags()}<span class="match-rule">${state.plan?.barrierMode==='all'?'ALL':'ANY'} barrier match</span></div>${resultsTable()}<div class="table-footer"><span>${list.length?`Showing ${state.page*state.perPage+1}–${Math.min((state.page+1)*state.perPage,list.length)} of ${num(list.length)} patients`:'No matching patients'} ${list.length?'· sorted by '+(state.plan?.sort==='age'?'age':'outreach priority'):''}</span><div class="pagination"><button class="icon-btn" aria-label="Previous page" data-action="prev" ${state.page===0?'disabled':''}>${icon('left')}</button><span>${state.page+1} / ${Math.max(1,Math.ceil(list.length/state.perPage))}</span><button class="icon-btn" aria-label="Next page" data-action="next" ${(state.page+1)*state.perPage>=list.length?'disabled':''}>${icon('chevron')}</button></div></div></section>${capacityCard()}</div><aside class="insights-column" aria-label="Evidence and reasoning">${evidencePreview(list.find(p=>p.id==='P0412')||list[0])}${tracePanel()}${graphPanel()}</aside></div>`;
}
function resultsTable(){
 const list=state.result?.patients||[];
 if(!list.length)return `<div class="empty-state">${icon('search')}<h3>${state.result?'No patients match these filters':'Your next insight starts with a question'}</h3><p>${state.result?'Try broadening the barrier, removing an age filter, or including resolved barriers. An empty cohort is an answer, too.':'Ask about transportation, medication costs, food access, health literacy barriers in the fictional diabetes population.'}</p></div>`;
 return `<div class="table-container"><table><thead><tr><th>Patient</th><th>Care gap</th><th>Hidden barrier</th><th class="evidence-column">Evidence</th><th>Priority</th><th><span class="sr-only">Open patient</span></th></tr></thead><tbody>${list.slice(state.page*state.perPage,(state.page+1)*state.perPage).map(p=>{const b=chosenBarrier(p);return `<tr data-patient="${e(p.id)}" tabindex="0" role="button" aria-label="View evidence and next step for ${e(p.name)}"><td>${patientMarkup(p)}</td><td><div class="gap-cell"><strong>${e(displayGap(p))}</strong><small>${e(gapDetail(p))}</small></div></td><td>${barrierPill(b)}</td><td class="evidence-column">${b?`<span class="evidence-ok">${icon('shield')}Source linked</span>`:'<span class="mini-label">No barrier evidence</span>'}</td><td><span class="priority ${highPriority(p)?'high':'medium'}"><i></i>${highPriority(p)?'High':'Standard'}</span></td><td><span class="row-arrow">${icon('arrow')}</span></td></tr>`}).join('')}</tbody></table></div>`;
}
function evidencePreview(patient){
 if(!patient)return `<div class="card evidence-card"><div class="section-header"><h2>Evidence, before action</h2>${icon('document')}</div><div class="empty-state"><p>Patient source quotes appear here when a cohort is found.</p></div></div>`;
 const b=chosenBarrier(patient);
 if(!b)return '';
 return `<section class="card evidence-card"><div class="section-header"><div class="section-title"><h2>Context that changes care</h2></div>${icon('document')}</div><div class="evidence-person"><span class="avatar">${e(initials(patient))}</span><div><strong>${e(patient.name)}</strong> <small>· ${e(patient.id)}</small></div></div><blockquote class="evidence-quote">“${e(b.quote)}”</blockquote><div class="quote-source">${icon('document')}${e(b.source||'Patient note')} <span>·</span> ${date(b.date)}</div><div class="evidence-bottom"><span class="evidence-ok">${icon('shield')}${b.status==='resolved'?'Resolution recognized':'Exact source excerpt'}</span><button class="text-button" data-action="patient" data-id="${e(patient.id)}">Inspect evidence ${icon('arrow')}</button></div></section>`;
}
function tracePanel(){
 const r=state.result;
 const events=r?.events||[];
 const traces=events;
 return `<section class="card trace-card"><div class="section-header"><h2>How we got here</h2><span class="trace-time">${state.lastRun?'Execution complete':'Ready'}</span></div><div class="trace-list">${traces.map((ev,i)=>`<div class="trace-step"><span class="trace-dot">${icon('check')}</span><strong>${e(({plan_cohort:'Understand the question',query_clinical_facts:'Find the clinical care gaps',traverse_barrier_evidence:'Connect the barrier evidence',validate_and_count:'Verify and count patients',lookup_patient:'Check patient context',lookup_structured_barrier:'Check the structured record',search_patient_notes:'Inspect the original notes'}[ev.tool])||String(ev.tool||ev.step).replaceAll('_',' '))}</strong><p>${e(ev.say||`${num(ev.found)} records matched`)}</p></div>`).join('')}</div>${r?`<details class="trace-details"><summary>Inspect the query & provenance</summary><pre>${e(JSON.stringify({plan:state.plan,fingerprint:r.fingerprint,events},null,2))}</pre></details>`:''}</section>`;
}
function graphMarkup(patient=null,selectedBarrier=null){
 const barrier=selectedBarrier||(patient?chosenBarrier(patient):null);
 const label=patient?'Patient':`${num(state.result?.count)} patients`;
 const bLabel=barrier?barrierLabel(barrier.type):(state.result?.groups||[]).length===1?state.result.groups[0].label:'Care barriers';
 return `<svg class="cohort-graph" viewBox="0 0 280 132" role="img" aria-label="${e(label)} connected to care gap, documented barrier, and source evidence"><defs><marker id="graph-arrow-${patient?'p':'c'}" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 0 4 2 0 4Z" fill="#b9cec4"/></marker></defs><path d="M66 68 130 34M66 68h64M66 68l64 34M155 34l66 34M155 68h66M155 102l66-34" stroke="#c4d8d0" stroke-width="1.2" fill="none"/><circle cx="53" cy="68" r="21" fill="#e5f1ec" stroke="#b9d9c9"/><circle cx="53" cy="63" r="4" fill="none" stroke="#6a9b83" stroke-width="1.5"/><path d="M46 75v-2a7 7 0 0 1 14 0v2" stroke="#6a9b83" fill="none" stroke-width="1.5"/><rect x="116" y="20" width="65" height="22" rx="6" fill="#f2f6fa" stroke="#dce6ef"/><text x="148.5" y="34" fill="#7290aa" font-size="7.5" text-anchor="middle" font-family="DM Sans,sans-serif">${e(bLabel).slice(0,22)}</text><rect x="116" y="57" width="65" height="22" rx="6" fill="#f8f4ee" stroke="#eae1d3"/><text x="148.5" y="71" fill="#ac9576" font-size="7.5" text-anchor="middle" font-family="DM Sans,sans-serif">Care gap</text><rect x="116" y="94" width="65" height="22" rx="6" fill="#f2f5f4" stroke="#e0e7e4"/><text x="148.5" y="108" fill="#88a094" font-size="7.5" text-anchor="middle" font-family="DM Sans,sans-serif">Source note</text><circle cx="230" cy="68" r="19" fill="#eef7f1" stroke="#c8e0d2"/><path d="m222 68 5 5 10-10" fill="none" stroke="#75a78b" stroke-width="1.5"/><text x="53" y="103" fill="#789288" font-size="8" text-anchor="middle" font-family="DM Sans,sans-serif">${e(label)}</text><text x="230" y="103" fill="#789288" font-size="8" text-anchor="middle" font-family="DM Sans,sans-serif">${barrier?.status==='resolved'?'Resolved':'Next step'}</text></svg>`;
}
function graphPanel(){return `<section class="card graph-card"><h3>A connected care story</h3><div class="subcopy">The evidence behind every recommendation</div>${graphMarkup()}<div class="graph-caption">Patient → barrier → source → coordinated care</div></section>`;}
function capacityCard(){
 const list=(state.result?.patients||[]).filter(eligible);
 const cap=Math.min(state.capacity,list.length);
 return `<section class="card capacity-card"><div class="capacity-heading"><span class="capacity-icon">${icon('target')}</span><div><h2>Make a small team go further</h2><p>Plan an outreach batch that fits today’s capacity.</p></div><span class="unique-tag">Capacity planner</span></div><div class="capacity-body"><div><label class="range-meta" for="capacity">Available outreach slots <strong id="capacity-label">${state.capacity} patients</strong></label><input type="range" id="capacity" min="1" max="100" value="${state.capacity}" aria-describedby="capacity-note"/><div class="range-labels"><span>1 patient</span><span>100 patients</span></div></div><div class="capacity-estimate"><strong id="capacity-count">${cap}</strong><span> / ${list.length}</span><p>eligible patients in reach<br>with your available capacity</p></div></div><div class="capacity-bottom"><span id="capacity-note">Opportunity estimate, not a clinical outcome.<br>Patients ranked by demo outreach priority.</span><button class="btn btn-soft btn-sm" data-action="batch" ${!list.length?'disabled':''}>${icon('queue')}Prepare <span id="batch-count">${cap}</span> drafts ${icon('arrow')}</button></div></section>`;
}

function queueView(){
 const tasks=state.tasks.filter(t=>t.status===state.queueFilter);
 return `<div class="page-heading"><div><div class="eyebrow">${icon('queue')}Context becomes a next step</div><h1>The care queue.</h1><p class="subtitle">Evidence-backed outreach drafts, ready for a human to review.</p></div><button class="btn" data-action="queue-export">${icon('download')}Export tasks</button></div><div class="queue-toolbar"><div class="segmented" role="group" aria-label="Task status"><button data-action="queue-filter" data-filter="pending" class="${state.queueFilter==='pending'?'active':''}">Needs review (${state.tasks.filter(t=>t.status==='pending').length})</button><button data-action="queue-filter" data-filter="approved" class="${state.queueFilter==='approved'?'active':''}">Approved (${state.tasks.filter(t=>t.status==='approved').length})</button></div><span class="mode-badge">${icon('lock')}Demo only · nothing is sent</span></div>${tasks.length?`<div class="queue-grid">${tasks.map(t=>{const patient=patients.find(p=>p.id===t.patientId);return `<article class="card task-card"><div class="task-top">${patient?patientMarkup(patient,true):e(t.patientId)}<span class="task-status ${t.status}">${t.status==='approved'?'Approved · demo':'Human review required'}</span></div>${barrierPill({type:t.barrier,status:'active'})}<h3>${e(t.title)}</h3><div class="task-body">${e(t.body)}</div><div class="task-actions"><button class="text-button" data-action="patient" data-id="${e(t.patientId)}" data-barrier="${e(t.barrier)}">${icon('document')}Evidence & edit</button><div>${t.status==='pending'?`<button class="btn btn-sm" data-action="remove-task" data-id="${e(t.id)}" aria-label="Remove draft for ${e(patient?.name)}">Remove</button><button class="btn btn-primary btn-sm" data-action="approve" data-id="${e(t.id)}">${icon('check')}Approve draft</button>`:`<button class="btn btn-soft btn-sm" data-action="copy-task" data-id="${e(t.id)}">${icon('copy')}Copy approved draft</button>`}</div></div></article>`}).join('')}</div>`:`<div class="card empty-state">${icon(state.queueFilter==='approved'?'shield':'queue')}<h3>${state.queueFilter==='approved'?'A human stays in the loop.':'Your next good move starts with context.'}</h3><p>${state.queueFilter==='approved'?'Approved drafts will appear here after you review their evidence and approve them. Approval is recorded locally; no message is sent.':'Open a patient in the workbench to prepare an outreach draft, or use the capacity planner to assemble a batch.'}</p><button class="btn btn-primary" data-action="view" data-view="workbench">Return to workbench ${icon('arrow')}</button></div>`}`;
}
function labView(){
 if(!evaluation)evaluation=evaluateExtraction();
 const cases=evaluation.cases||[];
 return `<div class="page-heading"><div><div class="eyebrow">${icon('lab')}Trust is something you can test</div><h1>Show your work. Every time.</h1><p class="subtitle">Probe the extraction rules, test a tricky sentence, and reproduce a cohort.</p></div><button class="btn" data-action="lab-export">${icon('download')}Export test results</button></div><div class="lab-grid"><div><section class="card lab-card"><h2>Language changes the answer.</h2><p>A mention of a barrier is not always a current patient barrier. Try a negation, a family member, or a problem that has been resolved.</p><label class="field-label" for="lab-text">Paste a fictional note excerpt</label><textarea class="text-field" id="lab-text">${e(state.labText)}</textarea><button class="btn btn-primary" data-action="check-sentence">${icon('lab')}Inspect this sentence</button>${state.labResult!==null?`<div class="lab-result"><p>${state.labResult.length?`${state.labResult.length} patient-specific assertion${state.labResult.length===1?'':'s'} found.`:'No active or resolved patient-specific barrier was extracted.'}</p>${state.labResult.length?state.labResult.map(b=>`<div style="margin-top:12px">${barrierPill(b)}<p style="margin-top:8px">“${e(b.quote)}”</p></div>`).join(''):''}</div>`:''}<p class="inline-note">This demo uses inspectable, deterministic extraction rules. The evaluation measures this included synthetic fixture set; it does not establish clinical validity or performance on real records.</p></section><section class="card lab-card"><h2>Same question. Same cohort.</h2><p>Execute the current structured query twice and compare the exact ordered patient IDs and result fingerprints.</p><button class="btn btn-soft" data-action="repeat">${icon('refresh')}Run repeatability check</button>${state.repeat?`<div class="lab-result"><p>${state.repeat.ok?'✓ Identical patient IDs and fingerprints across both runs.':'Results differed between the two executions.'}</p><pre>${e(JSON.stringify(state.repeat,null,2))}</pre></div>`:''}</section></div><section class="card lab-card"><div class="section-title"><h2>Extraction scorecard</h2><span class="number-badge">${num(evaluation.total||cases.length)} fixtures</span></div><div class="lab-metrics"><div class="lab-metric"><strong>${pct(evaluation.precision)}</strong><small>Precision</small></div><div class="lab-metric"><strong>${pct(evaluation.recall)}</strong><small>Recall</small></div><div class="lab-metric"><strong>${pct(evaluation.f1)}</strong><small>F1 score</small></div></div><p>Executed against the same extractor used to build the patient graph. Expand any case to inspect expected and actual assertions.</p><div>${cases.map(c=>`<div class="test-row"><details><summary>${e(c.name||c.id||'Extraction case')}</summary><p>“${e(c.text)}”</p><p><b>Expected:</b> ${e(JSON.stringify(c.expected))}<br><b>Actual:</b> ${e(JSON.stringify(c.actual))}</p></details><span class="test-pass ${c.passed?'':'test-fail'}">${c.passed?'PASS':'FAIL'}</span></div>`).join('')}</div></section></div>`;
}
function aboutView(){return `<div class="page-heading"><div><div class="eyebrow">${icon('leaf')}Care is more than a clinical record</div><h1>Built for the reason behind the gap.</h1><p class="subtitle">A focused prototype that connects evidence to useful, human-approved action.</p></div></div><div class="about-grid"><section class="card about-card">${icon('people')}<h2>One fictional population</h2><p>${num(patients.length)} synthetic patients, ${num(metrics.docs)} fictional notes, and a diabetes-focused care workflow. There are no real patient records in this demo.</p></section><section class="card about-card">${icon('nodes')}<h2>Structured, auditable answers</h2><p>Patient facts and current barrier assertions form an in-memory graph. Queries select exact cohorts. Every barrier is attached to its original source document.</p></section><section class="card about-card">${icon('queue')}<h2>A next step, with oversight</h2><p>The capacity planner turns a cohort into editable coordination drafts. You inspect the evidence, review the next step, and explicitly approve. Nothing is sent externally.</p></section></div><section class="card about-bottom"><h2>What makes Careweave different</h2><p>Context is temporal. “I have no ride” and “I no longer need help with rides” should never lead to the same care task. Careweave tracks the latest patient-specific assertion, preserves source documents, and lets you inspect resolved barriers directly. The evidence lab makes its limitations and consistency testable.</p><p>Priority and overdue thresholds are fixed demonstration policies. Program eligibility, clinical decisions, and any actual contact require review by a qualified care team. Browser drafts are stored only in this browser. An optional server-side model can plan queries; exact filtering and counts remain deterministic.</p><button class="btn btn-soft" data-action="view" data-view="lab">Test the evidence engine ${icon('arrow')}</button></section>`;}

async function analyze(question){
 if(!question.trim()){toast('Enter a question about the synthetic population.');return;}
 const id=++state.queryId;
 state.question=question.trim(); state.busy=true;state.queryError='';render();
 let parsed;
 let warning='';
 try {
  if(state.api.model){
   try{
    const response=await fetch('/api/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:state.question,previousPlan:state.plan}),signal:AbortSignal.timeout(25000)});
    parsed=await response.json();
    if(!response.ok || !parsed || (parsed.ok && !parsed.plan))throw new Error('Planning service unavailable');
   }catch {parsed=parseQuestion(state.question,state.plan);warning='AI planning is unavailable. This result uses the deterministic demo parser.';}
  }else parsed=parseQuestion(state.question,state.plan);
  if(id!==state.queryId)return;
  if(!parsed?.ok){state.queryError=parsed?.error||'This question is outside the supported demo queries.';if(parsed?.suggestions?.length)state.queryError+=' Try: '+parsed.suggestions.join(' · ');state.stale=Boolean(state.result);}
  else{const result=runQuery(parsed.plan);state.plan=parsed.plan;state.result=result;state.summary=parsed.summary||'Exact matches from the synthetic care graph.';state.queryError=warning;state.stale=false;state.page=0;state.lastRun=new Date().toISOString();state.lastQuestion=state.question;}
 } catch(error){state.queryError=`Analysis could not complete: ${error.message}.`;state.stale=Boolean(state.result);}
 finally {if(id===state.queryId){state.busy=false;render();}}
}

function bindEvents(){
 $('#query-form')?.addEventListener('submit',event=>{event.preventDefault();analyze($('#question').value);});
 $('#question')?.addEventListener('input',event=>state.question=event.target.value);
 $('#question')?.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();analyze(event.currentTarget.value);}});
 $('#capacity')?.addEventListener('input',event=>{state.capacity=Number(event.target.value);const count=Math.min(state.capacity,(state.result?.patients||[]).filter(eligible).length);$('#capacity-label').textContent=`${state.capacity} patients`;$('#capacity-count').textContent=count;$('#batch-count').textContent=count;});
 $('#lab-text')?.addEventListener('input',event=>state.labText=event.target.value);
 document.querySelectorAll('[data-patient]').forEach(row=>{row.addEventListener('click',()=>openPatient(row.dataset.patient));row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openPatient(row.dataset.patient);}});});
 document.querySelectorAll('#app [data-action]').forEach(button=>button.addEventListener('click',()=>act(button.dataset.action,button.dataset)));
}
function act(action,data={}){
 if(action==='view'){state.view=data.view;render();window.scrollTo({top:0,behavior:'instant'});}
 if(action==='example'){
  const examples={transport:'Find diabetic patients who are overdue for an A1c test and have transportation barriers.',cost:'Find diabetic patients with cost barriers and medication refill gaps of at least 30 days.',food:'Find diabetic patients with overdue A1c tests and food insecurity.',resolved:'Show diabetic patients whose transportation barriers are resolved.',followup:'Of those patients, show only people age 65 and older.'};
  analyze(examples[data.example]);
 }
 if(action==='patient')openPatient(data.id,data.barrier);
 if(action==='prev'){state.page=Math.max(0,state.page-1);render();}
 if(action==='next'){state.page++;render();}
 if(action==='csv')exportCsv();
 if(action==='audit')download('careweave-audit.json',audit(),'application/json');
 if(action==='queue-export')download('careweave-coordination-tasks.json',{demo:true,nothingSent:true,exportedAt:new Date().toISOString(),tasks:state.tasks},'application/json');
 if(action==='batch')prepareBatch();
 if(action==='queue-filter'){state.queueFilter=data.filter;render();}
 if(action==='remove-task'){state.tasks=state.tasks.filter(t=>t.id!==data.id);saveTasks();render();toast('Draft removed from the care queue.');}
 if(action==='approve')approveTask(data.id);
 if(action==='copy-task'){
  const task=state.tasks.find(t=>t.id===data.id);
  navigator.clipboard.writeText(`${task.title}\n\n${task.body}\n\nDEMO — synthetic patient. Nothing has been sent.`).then(()=>toast('Approved demo draft copied.')).catch(()=>toast('Clipboard access is unavailable. Use Export tasks to save the draft.'));
 }
 if(action==='check-sentence'){state.labText=$('#lab-text').value;state.labResult=extractBarriers({id:'LAB-INPUT',type:'Fictional user test',date:'2026-10-10',text:state.labText});render();}
 if(action==='repeat'){
  const plan=state.plan||parseQuestion('Find diabetic patients with transportation barriers and overdue A1c tests.').plan;
  const first=runQuery(plan),second=runQuery(plan);
  state.repeat={ok:first.fingerprint===second.fingerprint&&JSON.stringify(first.patients.map(p=>p.id))===JSON.stringify(second.patients.map(p=>p.id)),firstFingerprint:first.fingerprint,secondFingerprint:second.fingerprint,patientCount:first.count,orderedIdsIdentical:JSON.stringify(first.patients.map(p=>p.id))===JSON.stringify(second.patients.map(p=>p.id))};render();
 }
 if(action==='lab-export')download('careweave-extraction-evaluation.json',evaluateExtraction(),'application/json');
}

function taskFor(patient,barrier){return state.tasks.find(t=>t.patientId===patient.id&&t.barrier===barrier.type);}
function addTask(patient,barrier,title,body){
 if(!patient.gapOpen||barrier.status!=='active')return null;
 if(taskFor(patient,barrier))return null;
 const task={id:`TASK-${Date.now()}-${patient.id}-${barrier.type}`,patientId:patient.id,barrier:barrier.type,title,body,status:'pending',createdAt:new Date().toISOString(),evidence:{documentId:barrier.documentId,quote:barrier.quote,date:barrier.date,status:barrier.status},demo:true};
 state.tasks.unshift(task);return task;
}
function prepareBatch(){
 const ranked=(state.result?.patients||[]).filter(eligible).sort((a,b)=>(Number(b.priority)||0)-(Number(a.priority)||0)||a.id.localeCompare(b.id));
 let count=0;
 for(const patient of ranked.slice(0,state.capacity)){
  const b=patient.barriers.find(b=>b.status==='active'&&(!state.plan?.barriers?.length||state.plan.barriers.includes(b.type)))||patient.barriers.find(b=>b.status==='active');
  const draft=makeDraft(patient,b.type);
  if(addTask(patient,b,draft.title,draft.body))count++;
 }
 saveTasks();state.view='queue';state.queueFilter='pending';render();toast(count?`${count} outreach drafts prepared for human review. Nothing sent.`:'These patients already have a draft in the care queue.');
}
function approveTask(id){
 const task=state.tasks.find(t=>t.id===id);
 if(!task)return;
 const patient=patients.find(p=>p.id===task.patientId);
 const barrier=patient?.barriers.find(b=>b.type===task.barrier);
 if(!patient?.gapOpen||barrier?.status!=='active'){toast('This patient no longer has an eligible active gap and barrier. Approval blocked.');return;}
 task.status='approved';task.approvedAt=new Date().toISOString();task.approvedBy='Demo care coordinator';saveTasks();render();toast('Draft approved locally. No outreach was sent.');
}

function openPatient(id,barrierType){
 const patient=patients.find(p=>p.id===id);if(!patient)return;
 drawerReturnFocus=document.activeElement;
 state.drawer=id;
 const b=barrierType?patient.barriers.find(item=>item.type===barrierType):chosenBarrier(patient);
 const doc=patient.documents.find(d=>d.id===b?.documentId);
 const active=b?.status==='active'?b:null;
 const actionable=Boolean(patient.gapOpen&&active&&b?.status==='active');
 const existing=actionable?taskFor(patient,active):null;
 const draft=actionable?(existing||makeDraft(patient,active.type)):null;
 let assertions=patient.documents.flatMap(d=>extractBarriers(d).map(a=>({...a,documentId:d.id,date:a.date||d.date}))).filter(a=>!b||a.type===b.type).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 if(b&&!assertions.some(a=>a.documentId===b.documentId&&a.status===b.status&&a.quote===b.quote)){assertions.push(b);assertions.sort((a,b)=>String(a.date).localeCompare(String(b.date)));}
 $('#overlay-root').innerHTML=`<div class="drawer-backdrop" data-close="true"></div><section class="drawer" role="dialog" aria-modal="true" aria-label="Patient evidence and care coordination"><header class="drawer-header">${patientMarkup(patient)}<button class="icon-btn" id="close-drawer" aria-label="Close patient details">${icon('close')}</button></header><div class="drawer-content"><div class="drawer-meta">${barrierPill(b)}<span class="filter-tag">${patient.diabetes?'Diabetes':'No diabetes flag'}</span><span class="filter-tag">${e(displayGap(patient,false))}${patient.daysOverdue>0?' · '+num(patient.daysOverdue)+'d overdue':patient.gapOpen?' · '+patient.a1c+'%':''}</span><span class="filter-tag">Priority ${e(patient.priority)}</span></div><section class="card drawer-card"><span class="mini-label">${b?.status==='resolved'?'A barrier that changed':'The reason behind the gap'}</span><h3>Evidence you can trace back to the source.</h3>${b?`<blockquote class="drawer-quote">“${e(b.quote)}”</blockquote><div class="document-meta"><span>${e(b.source||doc?.type||'Patient note')} · ${date(b.date)}<br>Source ${e(b.documentId)}</span><span class="evidence-ok">${icon('shield')}${b.status==='resolved'?'Resolved assertion':'Source linked'}</span></div>`:'<p class="subtitle">No patient-specific barrier was extracted.</p>'}${doc?`<details class="source-details" open><summary>Read the complete source document</summary><div class="source-document">${highlightQuote(doc.text,b?.quote)}</div></details>`:''}<details class="source-details"><summary>All patient documents (${patient.documents.length})</summary>${patient.documents.map(d=>`<details class="source-details"><summary>${e(d.type)} · ${date(d.date)} · ${e(d.id)}</summary><div class="source-document">${e(d.text)}</div></details>`).join('')}</details></section><section class="card drawer-card"><h3>What changed over time</h3><p class="subtitle">Latest patient-specific assertion determines the current barrier status.</p><div class="timeline">${assertions.length?assertions.map(a=>`<div class="timeline-item ${a.status}"><strong>${a.status==='resolved'?'Barrier resolved':'Barrier active'}</strong><p>“${e(a.quote)}”</p><small>${date(a.date)} · ${e(a.documentId)}</small></div>`).join(''):'<p class="subtitle">No patient-specific barrier history was extracted.</p>'}</div></section><section class="card drawer-card"><h3>The connected evidence</h3><div class="graph-card">${graphMarkup(patient,b)}</div></section><section class="card drawer-card"><div class="drawer-action-banner">${icon(actionable?'queue':'shield')}<div><strong>${actionable?existing?.status==='approved'?'Demo task approved':'A practical next step':b?.status==='resolved'?'This barrier is resolved.':'No eligible outreach task.'}</strong><p>${actionable?'Prepare a care-coordination draft, then review and approve it in the care queue.':b?.status==='resolved'?'A resolved barrier does not trigger new assistance outreach. Review the current care gap separately.':'Careweave prepares tasks only for patients with an open A1c gap and a current active barrier.'}</p></div></div>${draft?`<label class="field-label" for="draft-title">Coordination task</label><input id="draft-title" class="text-field" value="${e(draft.title)}" ${existing?.status==='approved'?'readonly':''}/><label class="field-label" for="draft-body">Outreach draft · editable before approval</label><textarea id="draft-body" class="text-field" ${existing?.status==='approved'?'readonly':''}>${e(draft.body)}</textarea><div class="drawer-footer"><small>Synthetic patient. Demo workflow only.<br>No message will be sent.</small>${existing?.status==='approved'?'<span class="task-status approved">Approved locally</span>':`<button class="btn btn-primary" id="save-draft">${icon('queue')}${existing?'Save draft changes':'Prepare draft'}${icon('arrow')}</button>`}</div>`:''}</section></div></section>`;
 document.body.style.overflow='hidden';
 $('#close-drawer').addEventListener('click',closeDrawer);$('.drawer-backdrop').addEventListener('click',closeDrawer);
 $('#save-draft')?.addEventListener('click',()=>{
  const title=$('#draft-title').value.trim(),body=$('#draft-body').value.trim();
  if(!title||!body){toast('Keep a title and outreach body before saving.');return;}
  if(existing){existing.title=title;existing.body=body;existing.updatedAt=new Date().toISOString();}
  else addTask(patient,active,title,body);
  saveTasks();closeDrawer();render();toast(existing?'Draft changes saved. Review and approve in Care queue.':'Draft prepared. Review and approve in Care queue.');
 });
 $('#close-drawer').focus();
}
function highlightQuote(text,quote){if(!quote||!String(text).includes(quote))return e(text);const index=text.indexOf(quote);return e(text.slice(0,index))+`<mark>${e(quote)}</mark>`+e(text.slice(index+quote.length));}
function closeDrawer(){state.drawer=null;$('#overlay-root').innerHTML='';document.body.style.overflow='';if(drawerReturnFocus?.isConnected)drawerReturnFocus.focus();}
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'&&state.drawer)closeDrawer();
 if((event.ctrlKey||event.metaKey)&&event.key==='k'){event.preventDefault();state.view='workbench';render();$('#question')?.focus();$('#question')?.select();}
 if(event.key==='Tab'&&state.drawer){const all=[...$('.drawer').querySelectorAll('button:not([disabled]),input:not([readonly]),textarea:not([readonly]),summary,[tabindex="0"]')];const first=all[0],last=all.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
function audit(){return {application:'Careweave',version:'1.0.0-demo',syntheticData:true,generatedAt:new Date().toISOString(),question:state.lastQuestion,attemptedQuestion:state.question,interpretedPlan:state.plan,summary:state.summary,stale:state.stale,count:state.result?.count,fingerprint:state.result?.fingerprint,events:state.result?.events,cohort:(state.result?.patients||[]).map(p=>({id:p.id,name:p.name,age:p.age,gapOpen:p.gapOpen,daysOverdue:p.daysOverdue,priority:p.priority,barriers:p.barriers,documents:p.documents})),coordinationTasks:state.tasks};}
function download(filename,data,type='application/json'){
 const text=typeof data==='string'?data:JSON.stringify(data,null,2);
 const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`${filename} exported.`);
}
function exportCsv(){
 const safe=value=>{const s=String(value??'');return '"'+(/^[=+@-]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';};
 const rows=[['Patient ID','Name (synthetic)','Age','Diabetes','A1c gap open','Days overdue','Refill gap days','Barrier','Barrier status','Source document','Source date','Exact source quote','Priority']];
 for(const p of state.result?.patients||[]){const b=chosenBarrier(p);rows.push([p.id,p.name,p.age,p.diabetes,p.gapOpen,p.daysOverdue,p.refillGap,b?.type,b?.status,b?.documentId,b?.date,b?.quote,p.priority]);}
 download('careweave-cohort.csv','\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}

render();
analyze(state.question);
fetch('/api/status',{signal:AbortSignal.timeout(3000)}).then(r=>r.ok?r.json():null).then(status=>{if(status?.model){state.api=status;render();}}).catch(()=>{});
