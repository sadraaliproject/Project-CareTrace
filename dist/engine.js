/** Deterministic joins over synthetic hospital facts and source-linked note assertions. */
import { BARRIERS, NOTE_TYPES, ontology } from './ontology.js';
import { hospitalPatients, sourceProvenance } from './hospital-data.js';
export { BARRIERS, NOTE_TYPES, ontology, sourceProvenance };
export const AS_OF = '2026-10-10';
const DAY = 86400000;
const dayNumber = date => Date.parse(`${String(date).slice(0, 10)}T12:00:00Z`) / DAY;
export const daysBetween = (start, end = AS_OF) => Math.floor(dayNumber(end) - dayNumber(start));
const TERMS = {
  transportation: /\b(?:transport(?:ation)?|rides?|vehicle|bus|way to (?:get to|reach)|clinic appts)\b/i,
  cost: /\b(?:afford(?:ing|ability)?|unaffordable|cost|expensive|financial)\b|\$\d+/i,
  food: /\b(?:food|groceries|meals?|hungry)\b/i,
  health_literacy: /\b(?:teach[ -]back|instructions|understand|confused|meter|sliding scale)\b/i,
};
const ACTIVE = {
  transportation: /\b(?:no (?:reliable )?(?:way|ride|vehicle|transport(?:ation)?)|unable|cannot|can't|lost|unreliable|stranded|barrier)\b/i,
  cost: /\b(?:cannot|can't|unable|unaffordable|worried about affording|too expensive|left it|could not pay|couldn't pay|struggling|barrier)\b/i,
  food: /\b(?:no food|running out|runs? out|not enough|skips?|skipping|hungry|insecurity|without|cannot afford|can't afford)\b/i,
  health_literacy: /\b(?:unable|cannot|can't|does not understand|doesn't understand|do not understand|confused|nobody showed|not shown|barrier)\b/i,
};
const MEDICATION = /\b(?:insulin|pens|strips|medicine|medication|prescription|pharmacy|counter)\b/i;
const FAMILY_SUBJECT = /^(?:(?:the )?pt(?:'s)?|patient(?:'s)?|her|his|my|the)?\s*(?:brother|sister|father|mother|daughter|son|wife|husband|spouse)\b/i;

function clauses(text) {
  return String(text).split(/(?<=[.!?])\s+|\s+(?:but|however|whereas)\s+/i).flatMap(sentence => {
    for (const boundary of sentence.matchAll(/,?\s+(?:and|while)\s+/gi)) {
      const left = sentence.slice(0, boundary.index), right = sentence.slice(boundary.index + boundary[0].length);
      const leftTypes = Object.keys(TERMS).filter(type => TERMS[type].test(left));
      const rightTypes = Object.keys(TERMS).filter(type => TERMS[type].test(right));
      if (leftTypes.length && rightTypes.length && leftTypes.some(type => !rightTypes.includes(type))) return [left, ...clauses(right)];
    }
    return [sentence];
  }).filter(Boolean);
}

export function temporalStatusFor(type, text) {
  const lower = String(text).toLowerCase().replace(/[’‘]/g, "'");
  if (!BARRIERS[type]) return null;
  if (/\bno longer (?:has|have) (?:a |any )?(?:ride|transportation|vehicle)|\bno longer (?:can )?afford\b/.test(lower)) return 'active';
  if (/\b(?:resolved|arranged by|now has assistance|assistance in place|now has reliable|no longer needs?|no longer (?:a |an )?(?:problem|barrier|concern)|can now afford|now understands|transport arranged)\b/.test(lower)) return 'resolved';
  if (/\b(?:denies|denied|no concerns|no difficulty|no problem|without difficulty|understands instructions|has reliable transportation)\b/.test(lower)) return 'negated';
  if (/\b(?:previously|historically|used to|last year|in the past)\b/.test(lower)) return 'historical';
  return ACTIVE[type].test(lower) ? 'active' : null;
}

export function extractBarriers(text, metadata = {}) {
  const result = new Map();
  if (text && typeof text === 'object') {
    const note = text;
    metadata = { documentId: note.id, note_type: note.note_type, date: note.date, authorRole: note.authorRole, daysFromDischarge: note.daysFromDischarge, sourceKind: 'note', ...metadata };
    text = note.text;
  }
  const input = String(text || '');
  for (const raw of clauses(input)) {
    const quote = raw.trim();
    const normalized = quote.replace(/[’‘]/g, "'");
    if (!quote || FAMILY_SUBJECT.test(normalized) || /\b(?:if|might|may|could)\b.{0,45}\b(?:need|develop|become)\b/i.test(quote)) continue;
    if (/\b(?:NPO|held for (?:a )?procedure|fasting for|nil by mouth)\b/i.test(quote)) continue;
    for (const type of Object.keys(BARRIERS)) {
      if (!TERMS[type].test(quote)) continue;
      // A food sentence cannot become a medication-cost assertion through the verb alone.
      if (type === 'cost' && !MEDICATION.test(quote) && !(/\$\d+/.test(quote) && MEDICATION.test(input))) continue;
      const status = temporalStatusFor(type, quote);
      if (!status) continue;
      result.set(type, { type, status, quote, confidence: status === 'active' ? 0.96 : 0.99, ...metadata });
    }
  }
  return [...result.values()];
}

export function reconcileBarriers(notes = [], socialNeeds = []) {
  const assertions = [];
  for (const row of socialNeeds) {
    const type = row.type || Object.keys(BARRIERS).find(key => BARRIERS[key].zCode === row.code);
    if (type) assertions.push({ type, status: 'active', documentId: row.id, note_type: 'Coded social need', quote: row.display || BARRIERS[type].label, confidence: 1, date: row.date, sourceKind: 'coded', code: row.code });
  }
  for (const note of notes) assertions.push(...extractBarriers(note.text, { documentId: note.id, note_type: note.note_type, date: note.date, authorRole: note.authorRole, daysFromDischarge: note.daysFromDischarge, sourceKind: 'note' }));
  assertions.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.sourceKind === 'coded' ? -1 : 1));
  const latest = new Map();
  for (const assertion of assertions) {
    if (assertion.status === 'historical') continue;
    latest.set(assertion.type, assertion);
  }
  return [...latest.values()].filter(assertion => assertion.status === 'active');
}

export function deriveFollowUp(patient, asOf = AS_OF) {
  const dischargeDate = patient.admission?.dischargeDate;
  const days = daysBetween(dischargeDate, asOf);
  const eligible = Boolean(patient.admission?.diabetesRelated && Number.isFinite(days) && days >= 14);
  const reasons = [];
  if (eligible) {
    const attendedOnTime = (patient.appointments || []).some(visit => visit.status === 'completed' && daysBetween(dischargeDate, visit.date) >= 0 && daysBetween(dischargeDate, visit.date) <= 14 && visit.date <= asOf);
    if (!attendedOnTime) reasons.push('follow_up_not_completed_within_14_days');
    const uncollectedOnTime = (patient.medications || []).some(medication => medication.newStart && (!medication.pickedUp || !medication.pickupDate || daysBetween(dischargeDate, medication.pickupDate) > 3 || daysBetween(dischargeDate, medication.pickupDate) < 0 || medication.pickupDate > asOf));
    if (uncollectedOnTime) reasons.push('new_medication_not_picked_up_within_3_days');
  }
  return { eligible, open: reasons.length > 0, reasons, daysSinceDischarge: days };
}

export function deriveLikelyReturn(patient, asOf = AS_OF) {
  if (!patient.admission?.diabetesRelated) return false;
  const a1c = (patient.labs || []).find(lab => lab.code === '4548-4');
  const anyCompleted = (patient.appointments || []).some(visit => visit.status === 'completed' && visit.date >= patient.admission.dischargeDate && visit.date <= asOf);
  const insulinNotPickedUp = (patient.medications || []).some(medication => medication.newStart && medication.isInsulin && !medication.pickedUp);
  return Boolean(a1c?.value > 9 && !anyCompleted && insulinNotPickedUp && patient.barriers?.length);
}

export function preparePatient(patient) {
  const copy = structuredClone(patient);
  copy.daysSinceDischarge = daysBetween(copy.admission.dischargeDate);
  copy.barriers = reconcileBarriers(copy.notes, copy.socialNeeds);
  copy.followUpGap = deriveFollowUp(copy);
  copy.likelyToReturn = deriveLikelyReturn(copy);
  // This ordering is operational urgency, never a calibrated medical prediction.
  copy.priority = (copy.likelyToReturn ? 40 : 0) + (copy.followUpGap.open ? 20 : 0) + copy.barriers.length * 5 + (copy.daysSinceDischarge < 30 ? 10 : 0);
  return copy;
}
export const patients = hospitalPatients.map(preparePatient);
export const DEFAULT_PLAN = Object.freeze({ diabetesAdmissionOnly: true, gapOnly: true, barriers: [], barrierMode: 'any', barrierPresence: 'present', insulinNotPickedUp: false, likelyToReturn: false, ageMin: null, ageMax: null, within30: false, sort: 'priority', limit: 1000 });

export function parseQuestion(question = '', previousPlan = null) {
  const text = String(question).toLowerCase().replace(/[’‘]/g, "'");
  if (!/\b(?:patients?|discharge|discharges|follow-up|follow up|barriers?|transportation|transport|cost|food|literacy|insulin|likely|aged?|oldest|those|these)\b/.test(text)) return { ok: false, error: 'Ask about discharged patients, follow-up, medication pickup, or a documented barrier.', suggestions: ['Which patients have an open follow-up gap and a documented barrier?', 'Who is likely to return?'] };
  const supportedWords = new Set('we which who what how many find show me us list count give get tell please all the a an and or with without have has had is are was were be been do does did of those these them their our in on at by for to from after before during than that this about as also now only still can act right each action actions patients patient discharged discharge discharges hospitals hospital diabetes diabetic related admission admissions open follow up gap gaps documented current reported report reports barrier barriers transportation transport rides ride bus cost costs medication medications medicine medicines financial afford expensive food meals groceries insecurity health literacy teach back instructions understand meter insulin prescribed newly new start started prescription prescriptions never not no picked pick pickup unpicked uncollected likely return readmission emergency department standard call rescheduled visit visits appointment appointments within last past first days day under over older younger oldest age aged ages years year least most exactly between through sort priority top even yet just missing recorded support need needs help home reach safely attending attend due because both before'.split(' '));
  const unknownWords = (text.match(/[a-z]+/g) || []).filter(word => !supportedWords.has(word));
  const unsupported = unknownWords.length > 0 || /\b(?:19|20)\d{2}\b/.test(text) || /\b(?:a1c|hba1c|glucose)\b.{0,30}(?:above|below|over|under|greater|less|[<>])/.test(text);
  const window = text.match(/\b(?:last|past|within)\s+(\d+)\s+days\b/);
  const onlyUnsupportedTime = window && ![30, 90].includes(Number(window[1])) && !(/follow.?up/.test(text) && Number(window[1]) === 14);
  if (unsupported || onlyUnsupportedTime) return { ok: false, error: 'That filter is outside the supported hospital routes. Ask about an open follow-up gap, a documented barrier, new insulin not picked up, the likely-to-return rule, age, or patients before day 30.', suggestions: ['Which patients have an open follow-up gap and a documented barrier?', 'Which patients report a cost barrier and never picked up their discharge insulin?'] };
  if (previousPlan?.plan) previousPlan = previousPlan.plan;
  const followOn = /\b(?:of those|among those|these patients|also|only those|now show|now only)\b/.test(text);
  const plan = { ...DEFAULT_PLAN, ...(followOn && previousPlan ? previousPlan : {}), barriers: [...(followOn && previousPlan?.barriers || [])] };
  const found = Object.keys(BARRIERS).filter(type => ({ transportation: /\b(?:transport(?:ation)?|ride|bus)\b/, cost: /\b(?:cost|afford|expensive|financial)\b/, food: /\b(?:food|meals|groceries)\b/, health_literacy: /\b(?:literacy|teach.?back|instructions|understand|meter)\b/ })[type].test(text));
  if (found.length) {
    plan.barriers = [...new Set(followOn ? [...plan.barriers, ...found] : found)];
    plan.barrierMode = /\b(?:and|both|also)\b/.test(text) && plan.barriers.length > 1 ? 'all' : 'any';
    plan.barrierPresence = 'present';
  }
  if (/\b(?:no|without|no documented) (?:reported |documented )?barriers?\b|standard discharge call/.test(text)) { plan.barrierPresence = 'absent'; plan.barriers = []; }
  if (/\b(?:all discharges|all 1,?000|all discharged patients)\b/.test(text)) { plan.diabetesAdmissionOnly = false; plan.gapOnly = false; plan.barrierPresence = 'any'; }
  if (/\b(?:insulin)\b/.test(text) && /\b(?:never|not|uncollected|unpicked)\b/.test(text)) { plan.insulinNotPickedUp = true; plan.gapOnly = false; }
  if (/likely to return|return to (?:the )?(?:hospital|emergency)|readmission/.test(text)) { plan.likelyToReturn = true; plan.gapOnly = false; }
  if (/within 30|before day 30|first 30|under 30|last 30|past 30/.test(text)) plan.within30 = true;
  const ageRange = text.match(/(?:aged?|ages|between)\s*(\d{2,3})\s*(?:to|through|and|-)\s*(\d{2,3})/);
  const inclusiveAge = text.match(/(?:aged?\s*)?(\d{2,3})\s*(?:years? )?(?:or|and)\s*(older|younger|above|below)/);
  const ageMin = text.match(/(?:over|older than|age at least)\s*(\d{2,3})/);
  const ageMax = text.match(/(?:under|younger than|age at most)\s*(\d{2,3})/);
  const exactAge = text.match(/\b(?:aged?|exactly)\s*(\d{2,3})\b/);
  if (ageRange) { plan.ageMin = Number(ageRange[1]); plan.ageMax = Number(ageRange[2]); }
  else if (inclusiveAge) { plan.ageMin = /older|above/.test(inclusiveAge[2]) ? Number(inclusiveAge[1]) : null; plan.ageMax = /younger|below/.test(inclusiveAge[2]) ? Number(inclusiveAge[1]) : null; }
  else if (ageMin || ageMax) {
    if (ageMin) plan.ageMin = Number(ageMin[1]) + (/over|older than/.test(ageMin[0]) ? 1 : 0);
    if (ageMax) plan.ageMax = Number(ageMax[1]) - (/under|younger than/.test(ageMax[0]) ? 1 : 0);
  } else if (exactAge) { plan.ageMin = Number(exactAge[1]); plan.ageMax = Number(exactAge[1]); }
  if (plan.ageMin > 120 || plan.ageMax > 120 || plan.ageMin != null && plan.ageMax != null && plan.ageMin > plan.ageMax) return { ok: false, error: 'Use an adult age or age range up to 120.', suggestions: ['Show patients aged 65 or older with transportation barriers.'] };
  const limit = text.match(/(?:top|first|show)\s+(\d{1,4})\b/);
  if (limit) plan.limit = Math.max(1, Math.min(1000, Number(limit[1])));
  if (/oldest|sort by age/.test(text)) plan.sort = 'age';
  const summary = [plan.diabetesAdmissionOnly ? 'Diabetes-related discharges' : 'All hospital discharges', plan.gapOnly ? 'open follow-up gap' : null, plan.likelyToReturn ? 'matches the likely-to-return rule' : null, plan.insulinNotPickedUp ? 'new insulin not picked up' : null, plan.barriers.length ? plan.barriers.map(type => BARRIERS[type].label).join(plan.barrierMode === 'all' ? ' and ' : ' or ') : plan.barrierPresence === 'absent' ? 'no documented barrier' : plan.barrierPresence === 'present' ? 'a documented barrier' : null].filter(Boolean).join(' · ');
  return { ok: true, plan, summary };
}

export function matchesPlan(patient, plan) {
  if (plan.diabetesAdmissionOnly && !patient.admission.diabetesRelated) return false;
  if (plan.gapOnly && !patient.followUpGap.open) return false;
  if (plan.likelyToReturn && !patient.likelyToReturn) return false;
  if (plan.within30 && patient.daysSinceDischarge >= 30) return false;
  if (plan.ageMin != null && patient.age < plan.ageMin || plan.ageMax != null && patient.age > plan.ageMax) return false;
  if (plan.insulinNotPickedUp && !patient.medications.some(medication => medication.isInsulin && medication.newStart && !medication.pickedUp)) return false;
  if (plan.barrierPresence === 'present' && !patient.barriers.length || plan.barrierPresence === 'absent' && patient.barriers.length) return false;
  const types = new Set(patient.barriers.map(assertion => assertion.type));
  if (plan.barriers?.length && !(plan.barrierMode === 'all' ? plan.barriers.every(type => types.has(type)) : plan.barriers.some(type => types.has(type)))) return false;
  return true;
}

function fingerprintFor(ids, plan) {
  let hash = 2166136261;
  for (const character of JSON.stringify({ ids: [...ids].sort(), plan })) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `cw-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function runQuery(plan = DEFAULT_PLAN, records = patients) {
  if (plan.ok === false) throw new TypeError('A declined question cannot be executed.');
  if (plan.plan) plan = plan.plan;
  const selected = records.filter(patient => matchesPlan(patient, plan)).sort((a, b) => (plan.sort === 'age' ? b.age - a.age : b.priority - a.priority) || a.id.localeCompare(b.id));
  const groups = Object.fromEntries(Object.keys(BARRIERS).map(type => [type, selected.filter(patient => patient.barriers.some(barrier => barrier.type === type))]));
  groups.standard = selected.filter(patient => patient.barriers.length === 0);
  return { patients: selected.slice(0, plan.limit || 1000), count: selected.length, groups, fingerprint: fingerprintFor(selected.map(patient => patient.id), plan), asOf: AS_OF, plan };
}

export function buildGraph(records = patients, options = {}) {
  if (!Array.isArray(records)) records = [records];
  const nodes = new Map(), edges = new Map();
  const addNode = (id, type, label, patientId = null, details = {}) => nodes.set(id, { id, type, label, patientId, ...details });
  const addEdge = (source, target, type, details = {}) => { const id = `${source}:${type}:${target}`; edges.set(id, { id, source, target, type, ...details }); };
  for (const type of Object.keys(BARRIERS)) {
    addNode(`barrier:${type}`, 'Barrier', BARRIERS[type].label, null, { barrierType: type, color: BARRIERS[type].color });
    addNode(`action:${type}`, 'Action', BARRIERS[type].action, null, { barrierType: type, owner: BARRIERS[type].owner });
    addEdge(`barrier:${type}`, `action:${type}`, 'ADDRESSED_BY');
  }
  for (const patient of records) {
    const id = patient.id;
    addNode(id, 'Patient', `${id} · ${patient.name}`, id, { age: patient.age, likelyToReturn: patient.likelyToReturn });
    addNode(patient.admission.id, 'Admission', `${patient.admission.principalDiagnosis} · discharged ${patient.admission.dischargeDate}`, id, patient.admission);
    addEdge(id, patient.admission.id, 'HAD_ADMISSION', { patientId: id });
    if (patient.condition) { addNode(patient.condition.id, 'Condition', patient.condition.display, id, patient.condition); addEdge(id, patient.condition.id, 'HAS_CONDITION', { patientId: id }); }
    for (const lab of patient.labs) { addNode(lab.id, 'LabResult', `${lab.name}: ${lab.value}${lab.unit}`, id, lab); addEdge(id, lab.id, 'HAS_RESULT', { patientId: id }); }
    for (const medication of patient.medications) { addNode(medication.id, 'Medication', `${medication.name} · ${medication.pickedUp ? 'picked up' : 'not picked up'}`, id, medication); addEdge(id, medication.id, 'PRESCRIBED_AT_DISCHARGE', { patientId: id }); }
    for (const appointment of patient.appointments) { addNode(appointment.id, 'Appointment', `${appointment.clinic} · ${appointment.status}`, id, appointment); addEdge(id, appointment.id, 'HAS_APPOINTMENT', { patientId: id }); }
    for (const note of patient.notes) { addNode(note.id, 'ClinicalNote', note.note_type, id, { ...note, sourceKind: 'note' }); addEdge(id, note.id, 'HAS_NOTE', { patientId: id }); }
    if (patient.followUpGap.open) { addNode(`gap:${id}`, 'FollowUpGap', 'Open follow-up gap', id, patient.followUpGap); addEdge(id, `gap:${id}`, 'HAS_GAP', { patientId: id }); }
    for (const assertion of patient.barriers) {
      const { type, ...evidence } = assertion;
      addEdge(id, `barrier:${type}`, 'REPORTED_BARRIER', { patientId: id, barrierType: type, ...evidence });
    }
    if (patient.likelyToReturn) addEdge(id, patient.admission.id, 'LIKELY_TO_RETURN', { patientId: id, inferred: true, explanation: ontology.likelyToReturnRule });
  }
  const allNodes = [...nodes.values()], allEdges = [...edges.values()];
  const cap = options.maxNodes || Infinity;
  const visible = allNodes.slice(0, cap), allowed = new Set(visible.map(node => node.id));
  return { nodes: visible, edges: allEdges.filter(edge => allowed.has(edge.source) && allowed.has(edge.target)), totalNodes: allNodes.length, totalEdges: allEdges.length, truncated: allNodes.length > visible.length };
}

export function makeDraft(patient, type = patient.barriers[0]?.type) {
  const definition = BARRIERS[type];
  const assertion = patient.barriers.find(barrier => barrier.type === type);
  if (!definition || !assertion) return { patientId: patient.id, type: 'standard', title: 'Standard discharge call and rescheduled visit', owner: 'Care transitions nurse', body: `Review the discharge instructions with ${patient.name}, confirm the medication pickup, and reschedule the follow-up visit. No current barrier is documented.`, evidence: [], status: 'pending' };
  return { patientId: patient.id, type, title: definition.action, owner: definition.owner, body: `${definition.owner}: ${definition.action}\n\n${patient.name} (${patient.id}) was discharged ${patient.admission.dischargeDate}. ${definition.behavior}.\n\nEvidence: "${assertion.quote}" (${assertion.documentId}; ${assertion.note_type}).\n\nPrepared for human review. No appointment, transport, or prescription has been changed.`, evidence: [assertion], status: 'pending' };
}

export function evaluateExtraction(truth = { cases: [] }) {
  const rows = truth.cases || truth;
  const perBarrier = Object.fromEntries(Object.keys(BARRIERS).map(type => [type, { precision: 0, recall: 0, truePositive: 0, falsePositive: 0, falseNegative: 0 }]));
  let truePositive = 0, falsePositive = 0, falseNegative = 0, correct = 0, hardPassed = 0, hardTotal = 0;
  const cases = rows.map(item => {
    const expected = new Set((item.expected || []).filter(value => value.status === 'active').map(value => value.type));
    const actual = new Set(extractBarriers(item.text).filter(value => value.status === 'active').map(value => value.type));
    for (const type of actual) {
      if (expected.has(type)) { truePositive++; perBarrier[type].truePositive++; }
      else { falsePositive++; perBarrier[type].falsePositive++; }
    }
    for (const type of expected) if (!actual.has(type)) {
      falseNegative++;
      if (perBarrier[type]) perBarrier[type].falseNegative++;
    }
    const passed = expected.size === actual.size && [...expected].every(type => actual.has(type));
    if (passed) correct++;
    if (!['current-patient-barrier', 'routine-note'].includes(item.category)) { hardTotal++; if (passed) hardPassed++; }
    return { noteId: item.noteId, category: item.category, expected: [...expected], actual: [...actual], passed };
  });
  for (const metrics of Object.values(perBarrier)) {
    const accepted = metrics.truePositive + metrics.falsePositive;
    const seeded = metrics.truePositive + metrics.falseNegative;
    metrics.precision = accepted ? metrics.truePositive / accepted : 0;
    metrics.recall = seeded ? metrics.truePositive / seeded : 0;
  }
  return { precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0, recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0, truePositive, falsePositive, falseNegative, perBarrier, correct, total: rows.length, hardCases: { passed: hardPassed, total: hardTotal }, cases };
}

export function getMetrics(records = patients) {
  const graph = buildGraph(records);
  const withGap = records.filter(patient => patient.followUpGap.open);
  return { patients: records.length, discharges: records.length, diabetesAdmissions: records.filter(patient => patient.admission.diabetesRelated).length, notes: records.reduce((sum, patient) => sum + patient.notes.length, 0), openFollowUpGaps: withGap.length, withActionableBarrier: withGap.filter(patient => patient.barriers.length).length, standardDischargeCall: withGap.filter(patient => !patient.barriers.length).length, reachableBeforeDay30: withGap.filter(patient => patient.daysSinceDischarge < 30).length, likelyToReturn: records.filter(patient => patient.likelyToReturn).length, graphNodes: graph.totalNodes, graphEdges: graph.totalEdges, asOf: AS_OF, sourceProvenance };
}
