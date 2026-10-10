/** Careweave's transparent, deterministic synthetic-data engine. No patient data is real. */
export const AS_OF = '2026-10-10';
const DAY = 86400000;
const TODAY = Date.parse(`${AS_OF}T12:00:00Z`);
const ago = days => new Date(TODAY - days * DAY).toISOString().slice(0, 10);

export const BARRIERS = Object.freeze({
  transportation: { label: 'Transportation', intervention: 'Coordinate a ride through an eligible transportation program.', color: '#7794ff' },
  cost: { label: 'Medication cost', intervention: 'Review medication affordability and connect the patient with an eligible assistance program.', color: '#dba365' },
  food: { label: 'Food insecurity', intervention: 'Offer a food-resource referral and confirm that the resource is accessible to the patient.', color: '#8ab995' },
  health_literacy: { label: 'Health literacy', intervention: 'Arrange a plain-language care-plan review using teach-back.', color: '#c29bf4' },
});

export const ontology = Object.freeze({
  nodeTypes: ['Patient', 'Condition', 'CareGap', 'Document', 'Barrier', 'Intervention'],
  relationships: ['HAS_CONDITION', 'HAS_GAP', 'HAS_DOCUMENT', 'EVIDENCES', 'EXPERIENCES', 'ADDRESSED_BY'],
  barrierTypes: Object.keys(BARRIERS),
  statuses: ['active', 'resolved'],
  rules: ['Patient-specific assertions only', 'Latest assertion wins per barrier', 'Negated, hypothetical, and family-only mentions do not count', 'Every accepted assertion retains its exact source excerpt'],
  careGapRule: 'Synthetic demo rule: diabetes and (last A1c more than 365 days ago or latest A1c above 9%). Refill delays are a separate filter. This is not a clinical guideline.',
});

const TERMS = {
  transportation: /\b(transport(?:ation)?|rides?|bus|vehicle|car|getting to (?:the )?(?:clinic|appointment))\b/i,
  cost: /\b(afford|affordability|copay|co-pay|expensive|cost|money|pay for|financial)\b/i,
  food: /\b(food|groceries|meals?|hungry|pantry)\b/i,
  health_literacy: /\b(understand|confus(?:ed|ing|ion)|instructions|read|medical words|health literacy|teach-back)\b/i,
};
const ACTIVE = {
  transportation: /\b(cannot|can't|unable|no (?:reliable )?(?:ride|car|bus|transport(?:ation)?)|lack|missed|broke|stranded|barrier|difficult|unreliable)\b/i,
  cost: /\b(cannot|can't|unable|unaffordable|too expensive|skipp?ed|skipping|barrier|struggl|lack|no money|financial hardship)\b/i,
  food: /\b(cannot|can't|unable|ran out|run out|running out|not enough|without|hungry|insecurity|insecure|skipp?ed|skipping|barrier)\b/i,
  health_literacy: /\b(cannot|can't|unable|does not understand|do not understand|doesn't understand|don't understand|confus(?:ed|ing|ion)|barrier|difficulty)\b/i,
};

// Temporal phrases describe a change in the predicate that follows them.
// Losing access is an active obstacle; losing the need for help is resolution.
const LOST_ACCESS = {
  transportation: /\bno longer\s+(?:(?:have|has|have access to|has access to|can get|can arrange|can use|can take)\b.{0,35}\b(?:rides?|transport(?:ation)?|car|bus|vehicle)|(?:reaches?|serves?|runs?|operates?|comes?|takes?|available|reliable)\b)/,
  cost: /\bno longer\s+(?:can\s+)?afford\b|\bno longer\s+(?:have|has)\s+(?:enough\s+)?money\b/,
  food: /\bno longer\s+(?:have|has|receive|receives|can get)\s+(?:enough\s+|regular\s+)?(?:food|groceries|meals)\b/,
  health_literacy: /\bno longer\s+(?:can\s+)?(?:understand|understands|read)\b/,
};
const NO_LONGER_RESOLVED = {
  transportation: /\bno longer\s+(?:needs?|requires?)\b.{0,40}\b(?:transport(?:ation)?|rides?)\b|\bno longer\s+(?:have|has)\s+(?:a\s+)?transportation\s+(?:barrier|problem)\b/,
  cost: /\bno longer\s+(?:struggle|struggles|struggling|have trouble|has trouble|have difficulty)\b.{0,35}\b(?:afford|pay|cost|copay)\b|\bno longer\s+(?:have|has)\s+(?:a\s+)?cost\s+(?:barrier|problem)\b/,
  food: /\bno longer\s+(?:(?:have|has|experience|experiences)\s+food insecurity|hungry|skipping meals|running out of food)\b/,
  health_literacy: /\bno longer\s+(?:confused|confusing|have difficulty understanding|has difficulty understanding|struggle to understand|struggles to understand)\b/,
};
const RESTORED_ACCESS = {
  transportation: /\bnow has reliable\b|\bnow (?:have|has)\s+(?:a\s+)?reliable (?:ride|transportation)\b/,
  cost: /\b(?:now can afford|can now afford)\b/,
  food: /\b(?:now has enough|now receives regular)\b/,
  health_literacy: /\bnow understands\b/,
};

export function temporalStatusFor(type, text) {
  const lower = text.toLowerCase().replace(/[’‘]/g, "'");
  if (!BARRIERS[type]) return null;
  if (/\b(?:not|never|isn't|wasn't|not yet)\s+(?:fully\s+)?resolved\b/.test(lower)) return 'active';
  if (TERMS[type].test(lower) && /\bno longer\s+(?:(?:a|an)\s+)?(?:problem|barrier|difficult|issue)\b/.test(lower)) return 'resolved';
  if (/\bno longer\b/.test(lower) && NO_LONGER_RESOLVED[type].test(lower)) return 'resolved';
  if (LOST_ACCESS[type].test(lower)) return 'active';
  if (/\bno longer\b/.test(lower)) return 'ambiguous';
  if (/\b(?:not anymore|resolved)\b/.test(lower) || RESTORED_ACCESS[type].test(lower)) return 'resolved';
  return null;
}

/** Rules extract assertions from text; patient seeds are never consulted here. */
export function extractBarriers(doc) {
  return extractAssertions(doc).filter(a => a.status !== 'negated');
}

function extractAssertions(doc) {
  const output = [];
  const text = typeof doc === 'string' ? doc : doc.text || '';
  const segments = text.split(/(?<=[.!?])\s+|\s+(?:but|however)\s+/i);
  for (const raw of segments) {
    const quote = raw.trim();
    if (!quote) continue;
    const lower = quote.toLowerCase().replace(/[’‘]/g, "'");
    // Family experiences and future possibilities are not the patient's current barrier.
    if (/\b(?:mother|father|sister|brother|daughter|son|spouse|husband|wife)\b.{0,28}\b(?:cannot|can't|has|had|needs|lacks|is|struggles|reports)\b/.test(lower) && !/\bpatient (?:cannot|can't|has|needs|lacks|is)\b/.test(lower)) continue;
    if (/\b(?:if (?:the )?patient|might (?:need|have)|may (?:need|develop)|screen(?:ed|ing)? for|discussed possible|at risk for)\b/.test(lower)) continue;
    for (const type of Object.keys(BARRIERS)) {
      if (!TERMS[type].test(lower)) continue;
      const temporal = temporalStatusFor(type, lower);
      if (temporal === 'ambiguous') continue;
      const resolved = temporal === 'resolved';
      const negated = (temporal !== 'active' || /\b(?:denies|denied)\b/.test(lower)) && /\b(?:denies|denied|no difficulty|no problems?|no issues?|no concerns?|not a barrier|without difficulty|never had|do not need|does not need|doesn't need|don't need|does not have (?:a |any )?(?:transportation|cost|food|health literacy)|no (?:transportation|cost|food insecurity|health literacy) (?:barrier|problem|concern)|transportation is reliable|has reliable transportation|has enough food|understands (?:the |her |his )?(?:medication )?instructions)\b/.test(lower);
      if (!resolved && !negated && temporal !== 'active' && !ACTIVE[type].test(lower)) continue;
      output.push({
        type, status: resolved ? 'resolved' : negated ? 'negated' : 'active', documentId: doc.id || 'input',
        quote, date: doc.date || AS_OF, source: doc.type || 'Note', confidence: resolved ? 0.98 : 0.96,
      });
    }
  }
  // Do not inflate evidence counts when repeated words occur in the same sentence.
  return output.filter((item, i, all) => all.findIndex(other => other.type === item.type && other.status === item.status && other.quote === item.quote) === i);
}

const FIRST = ['Maya','Oliver','Elena','James','Amara','Leo','Nora','Daniel','Sofia','Ethan','Iris','Mateo','Amina','Julian','Clara','Theo','Lena','Noah','Zara','Eli','Priya','Adrian','Ada','Owen','Nina','Isaac','Mila','Simon','Aria','Lucas','Rosa'];
const LAST = ['Bennett','Chen','Rivera','Patel','Morgan','Brooks','Park','Reed','Santos','Hayes','Foster','Ali','Cole','Kim','Evans','Lopez','Shah','Price','Nguyen','Reyes','Ward','Bell','Cruz','Stone','Diaz','Ross','Tran','Ellis','Lane','Wright','Singh','Vega','Lin'];
const PROVIDERS = ['Northside Family Clinic','Riverbend Community Health','Eastgate Primary Care','Maple Street Health'];
const ACTIVE_TEXT = {
  transportation: ['Patient cannot get a ride to the clinic and missed the lab visit.', 'I have no transportation to my appointments.', 'The bus is unreliable and I cannot get to the clinic.'],
  cost: ['Patient cannot afford the medication copay and skipped refills.', 'The prescription is too expensive and I cannot pay for it.', 'I am skipping medication because I have no money for the copay.'],
  food: ['Patient ran out of food before the end of the month.', 'I am skipping meals because there is not enough food at home.', 'Patient reports food insecurity and is running out of groceries.'],
  health_literacy: ['Patient is confused by the medication instructions.', 'I cannot understand the instructions on my medicine bottle.', 'Patient does not understand the care-plan instructions.'],
};
const RESOLVED_TEXT = {
  transportation: 'Patient no longer needs transportation help and now has reliable rides.',
  cost: 'The medication cost barrier is resolved; patient can now afford the copay.',
  food: 'Food insecurity is resolved; patient now has enough food.',
  health_literacy: 'Patient is no longer confused and now understands the medication instructions.',
};
const NEGATIVE_TEXT = [
  'Patient denies transportation problems.',
  'Patient denies food insecurity.',
  'Patient has reliable transportation to the clinic.',
  'Her mother cannot afford the medication copay.',
  'If the patient needs transportation help, provide a resource list.',
  'Patient understands the medication instructions.',
];
const seedLabels = [];

function createPatient(index) {
  const id = `P${String(index).padStart(4, '0')}`;
  const diabetes = index % 5 !== 0;
  const age = 28 + (index * 17 % 59);
  const a1c = Number((5.8 + (index * 13 % 64) / 10).toFixed(1));
  const a1cAge = 35 + (index * 41 % 660);
  const refillGap = index % 4 === 0 ? 31 + (index * 7 % 75) : index * 3 % 29;
  const historical = [];
  const latest = [];
  const expected = [];
  for (let j = 0; j < 4; j++) {
    const type = Object.keys(BARRIERS)[j];
    const slot = (index * (j * 4 + 7) + j * 13) % 100;
    if (slot < [30, 25, 23, 22][j]) {
      historical.push(ACTIVE_TEXT[type][index % 3]);
      const resolved = (index + j * 3) % 6 === 0;
      latest.push(resolved ? RESOLVED_TEXT[type] : ACTIVE_TEXT[type][(index + 1) % 3]);
      expected.push({ type, status: resolved ? 'resolved' : 'active' });
    }
  }
  const name = `${FIRST[(index * 7) % FIRST.length]} ${LAST[(index * 11 + Math.floor(index / FIRST.length)) % LAST.length]}`;
  const documents = [
    { id: `${id}-D01`, type: 'Primary care note', date: ago(190), text: `Synthetic record for ${name}. ${diabetes ? `Type 2 diabetes is documented. Latest recorded A1c is ${a1c}%.` : 'Routine primary care follow-up; no diabetes diagnosis.'} ${historical.join(' ') || 'No social-care concerns were reported at this visit.'}` },
    { id: `${id}-D02`, type: 'Care coordinator call', date: ago(2 + index % 25), text: `Synthetic call transcript. Coordinator: What has made it difficult to follow the care plan? Patient: ${latest.join(' ') || 'I have no current concerns about completing the care plan.'} Coordinator: Thank you; we will review the next steps together.` },
    { id: `${id}-D03`, type: 'Resource screening note', date: ago(1), text: `Synthetic resource screening. ${NEGATIVE_TEXT[index % NEGATIVE_TEXT.length]} No additional patient-specific needs were confirmed during this screening.` },
  ];
  const patient = { id, name, age, diabetes, a1c, lastA1c: ago(a1cAge), refillGap, daysOverdue: Math.max(0, a1cAge - 365), provider: PROVIDERS[index % PROVIDERS.length], documents, structuredBarrierCode: index % 7 === 0 };
  if (index === 412) {
    Object.assign(patient, { name: 'Maya Bennett', age: 58, diabetes: true, a1c: 9.4, lastA1c: '2025-07-18', refillGap: 12, daysOverdue: Math.floor((TODAY - Date.parse('2025-07-18T12:00:00Z')) / DAY) - 365 });
    documents[0].text = 'Synthetic primary care note. Maya Bennett has type 2 diabetes. Last A1c: 9.4%, collected July 18, 2025. Repeat lab ordered; no transportation barrier is coded in the structured record.';
    documents[1].text = 'Synthetic call transcript. Coordinator: We noticed your A1c lab is still pending. Patient: I have no transportation to my appointments. My car broke down and I cannot get a ride to the clinic. Coordinator: Would you like help arranging a ride? Patient: Yes, please. Mornings work best for me.';
    documents[1].date = '2026-10-07';
    documents[2].text = 'Synthetic resource screening. Patient denies food insecurity. Her mother cannot afford the medication copay. No other patient-specific barriers confirmed.';
    expected.splice(0, expected.length, { type: 'transportation', status: 'active' });
  }
  // Evaluation ground truth follows the independently seeded screening label.
  // A later patient denial resolves a prior active barrier; a family mention does not.
  const screeningType = index === 412 ? 'food' : ({ 0: 'transportation', 1: 'food', 2: 'transportation', 5: 'health_literacy' })[index % NEGATIVE_TEXT.length];
  const screeningLabel = expected.find(item => item.type === screeningType);
  if (screeningLabel) screeningLabel.status = 'resolved';
  patient.barriers = reconcileBarriers(documents);
  patient.gapOpen = patient.diabetes && (patient.daysOverdue > 0 || patient.a1c > 9);
  patient.refillOverdue = patient.refillGap > 30;
  patient.gaps = patient.diabetes ? [
    ...(patient.daysOverdue > 0 ? [{ type: 'a1c_overdue', label: 'A1c test overdue', days: patient.daysOverdue }] : []),
    ...(patient.a1c > 9 ? [{ type: 'a1c_elevated', label: 'A1c above demo threshold', value: patient.a1c }] : []),
  ] : [];
  const activeCount = patient.barriers.filter(b => b.status === 'active').length;
  patient.priority = Math.min(99, Math.round((patient.gapOpen ? 30 : 5) + patient.daysOverdue / 12 + Math.max(0, patient.a1c - 8) * 5 + patient.refillGap / 5 + activeCount * 8));
  seedLabels.push({ patientId: id, expected });
  return patient;
}

function latestAssertions(assertions) {
  const latest = new Map();
  for (const assertion of assertions.sort((a, b) => a.date.localeCompare(b.date))) {
    if (assertion.status === 'negated') {
      if (latest.has(assertion.type)) latest.set(assertion.type, { ...assertion, status: 'resolved', resolution: 'Later patient denial or affirmative access statement supersedes earlier evidence.' });
    } else latest.set(assertion.type, assertion);
  }
  return [...latest.values()];
}

/** Patient-specific temporal reconciliation includes later explicit denials. */
export function reconcileBarriers(documents) {
  return latestAssertions(documents.flatMap(extractAssertions));
}

export const patients = Array.from({ length: 1000 }, (_, i) => createPatient(i + 1));

/** A real typed property graph projected from current assertions and their source documents. */
export function buildGraph(patientIds) {
  const selectedIds = patientIds ? new Set(patientIds) : null;
  const selected = selectedIds ? patients.filter(p => selectedIds.has(p.id)) : patients;
  const nodes = [{ id: 'condition:diabetes', type: 'Condition', label: 'Type 2 diabetes' }];
  const edges = [];
  const edge = (source, target, type, properties = {}) => edges.push({ id: `E${edges.length + 1}`, source, target, type, ...properties });
  for (const [type, info] of Object.entries(BARRIERS)) {
    nodes.push({ id: `barrier:${type}`, type: 'Barrier', label: info.label }, { id: `intervention:${type}`, type: 'Intervention', label: info.intervention });
    edge(`barrier:${type}`, `intervention:${type}`, 'ADDRESSED_BY');
  }
  for (const p of selected) {
    nodes.push({ id: p.id, type: 'Patient', label: p.name, fictional: true, age: p.age, priority: p.priority });
    if (p.diabetes) edge(p.id, 'condition:diabetes', 'HAS_CONDITION');
    for (const d of p.documents) {
      nodes.push({ id: d.id, type: 'Document', label: d.type, date: d.date, patientId: p.id, text: d.text });
      edge(p.id, d.id, 'HAS_DOCUMENT');
    }
    for (const g of p.gaps) {
      const gapId = `${p.id}:${g.type}`;
      nodes.push({ id: gapId, label: g.label, ...g, type: 'CareGap', gapType: g.type, patientId: p.id });
      edge(p.id, gapId, 'HAS_GAP');
    }
    for (const b of p.barriers) {
      edge(b.documentId, `barrier:${b.type}`, 'EVIDENCES', { patientId: p.id, status: b.status, quote: b.quote, date: b.date });
      edge(p.id, `barrier:${b.type}`, 'EXPERIENCES', { status: b.status, documentId: b.documentId, date: b.date });
    }
  }
  return { nodes, edges, asOf: AS_OF, ontology };
}

const SUGGESTIONS = [
  'Find diabetic patients with open care gaps and transportation barriers',
  'Show patients with medication cost and food insecurity barriers',
  'Which patients over 65 have resolved transportation barriers?',
];
const defaults = () => ({ barriers: [], barrierMode: 'any', gapOnly: true, gapType: 'any', diabetesOnly: true, refillMin: null, ageMin: null, ageMax: null, status: 'active', sort: 'priority', limit: null });
const fail = message => ({ ok: false, error: message, suggestions: SUGGESTIONS });

/** Finite, inspectable question planner. It declines unsupported predicates instead of inventing answers. */
export function parseQuestion(text, previousPlan) {
  if (typeof text !== 'string' || !text.trim()) return fail('Ask about care gaps, a supported barrier, age, or refill delays.');
  const q = text.toLowerCase().replace(/[’‘]/g, "'").replace(/[–—]/g, '-').trim();
  if (q.length > 1000) return fail('Please keep the question under 1,000 characters.');
  const remainingNegation = q.replace(/\bno longer\b|\bwith or without (?:diabetes|(?:care )?gaps?)\b|\bno limit\b/g, '');
  if (/\b(?:not|no|without|don't|doesn't)\b/.test(remainingNegation)) return fail('That negative filter is not supported safely. Ask for active or resolved barriers, open care gaps, or all patients explicitly.');
  if (/\b(?:completed|complete|normal)\s+(?:an?\s+)?(?:a1c|hba1c|tests?|labs?)\b|\b(?:years?|months?|days?) ago\b/.test(q)) return fail('Completed-test and historical-time filters are not supported in this fixed-snapshot demo.');
  if (/\b(?:high|elevated)\s+(?:a1c|hba1c)\b/.test(q) && /\b(?:missing|missed|overdue|pending)\b/.test(q)) return fail('Combined elevated-A1c and overdue-A1c expressions are not supported. Ask about all open gaps, overdue tests, or elevated A1c separately.');
  if (/\b(?:active|current|unresolved)\b/.test(q) && /\b(?:resolved|previously|no longer)\b/.test(q) && !/\b(?:active and resolved|resolved and active|including resolved)\b/.test(q)) return fail('Use one shared barrier status per query: active, resolved, or explicitly active and resolved.');
  const followup = !!previousPlan && /^(and\b|now\b|only\b|just\b|what about\b|how about\b|of (?:those|them)\b|among (?:those|them)\b|narrow\b|filter\b|same\b)/.test(q);
  const plan = { ...defaults(), ...(followup ? previousPlan : {}), barriers: followup ? [...previousPlan.barriers] : [] };
  const consumedNumbers = [];
  const consume = match => { if (match) consumedNumbers.push([match.index, match.index + match[0].length]); };
  for (const match of q.matchAll(/\btype 2\b/g)) consume(match);
  // Unsupported dimensions must never silently broaden the result.
  if (/\b(?:male|female|men|women|gender|sex|pregnant|pregnancy|race|ethnicity|hispanic|black|white|asian|spanish|english|language|zip|postal|insurance|medicaid|medicare|uninsured|hypertension|cancer|asthma|depression|suicide|kidney|hospitalized|mortality|predict|risk of|diagnose|prescribe|dosage|dose|email|send|call them|contact them|delete|update record|emergency|latest guidelines)\b/.test(q)) return fail('That question uses a field or action outside this demo. Supported filters are diabetes, open care gaps, four care barriers, age, and refill delay.');
  if (/\b(?:no|not|without|exclude|excluding|except)\s+(?:(?:any|all|a|the|current|active)\s+)*(?:transportation|transport|cost|food|health literacy|barriers?)\b/.test(q)) return fail('Negative barrier filters are not supported yet. Ask for active or resolved barriers explicitly.');
  if (/\b(?:no|without)\s+(?:(?:open|a|any|medication)\s+)*(?:care\s+)?(?:refill\s+)?gaps?\b/.test(q)) return fail('Negative care-gap and refill-gap filters are not supported. Ask for open gaps or remove the gap restriction.');
  if (/\b(?:at least|more than|less than|exactly|at most)\s+(?:\d+|one|two|three|four)\s+barriers?\b/.test(q)) return fail('Barrier-count comparisons are not supported. Name barriers with AND or OR instead.');
  if (/\b20\d\d\b/.test(q)) return fail('Custom dates are not supported. The demo uses a fixed snapshot of October 10, 2026.');
  if (/\b(?:before|after|since|between)\s+(?:20\d\d|january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(q) || /\b(?:last|past|next)\s+\d+\s+(?:days|weeks|months|years)\b/.test(q)) return fail('Custom date windows are not supported. The demo uses a fixed snapshot of October 10, 2026.');
  if (/\b(?:a1c|hba1c)\s*(?:is\s*)?(?:>|<|above|below|over|under|at least|at most|greater|less|between)/.test(q)) return fail('Custom A1c thresholds are not supported. Open gaps use the visible demo rule: A1c older than 365 days or A1c above 9%.');
  if (/\b(?:youngest|average|median|percentage|percent|trend|compare|comparison|correlation|why did|caused|cause of|prove|guarantee|allerg|address|phone number)\b/.test(q)) return fail('This demo supports exact patient cohorts and source evidence; it does not support that calculation or causal claim.');

  const found = [];
  if (/\b(?:transportation|transport|ride|rides|bus|car|travel)\b/.test(q)) found.push('transportation');
  if (/\b(?:cost|costs|afford|affordability|copay|co-pay|expensive|financial|money)\b/.test(q)) found.push('cost');
  if (/\b(?:food|meals|groceries|hungry|hunger|nutrition)\b/.test(q)) found.push('food');
  if (/\b(?:literacy|understand|understanding|confused|confusion|instructions|teach-back)\b/.test(q)) found.push('health_literacy');
  if (found.length) {
    const barrierPhrase = q.match(/(?:transportation|transport|cost|food|literacy|ride|copay|confused|instructions)[\s\S]*/)?.[0] || '';
    if (found.length > 1 && /\band\b/.test(barrierPhrase) && /\bor\b/.test(barrierPhrase)) return fail('Mixed AND/OR barrier expressions are not supported. Use only AND, or only OR.');
    if (found.length > 1 && /\b(?:active|current|unresolved)\b/.test(q) && /\b(?:resolved|previously)\b/.test(q) && !/\b(?:active and resolved|resolved and active|including resolved)\b/.test(q)) return fail('A cohort can use one shared barrier status. Ask about active barriers or resolved barriers separately.');
    if (followup && /\b(?:also|as well|in addition)\b/.test(q)) plan.barriers = [...new Set([...plan.barriers, ...found])];
    else plan.barriers = found;
    plan.barrierMode = found.length > 1 && /\b(?:and|both|all)\b/.test(q) && !/\b(?:or|either)\b/.test(q) ? 'all' : 'any';
  }
  if (/\b(?:any|all) barriers\b/.test(q)) { plan.barriers = Object.keys(BARRIERS); plan.barrierMode = /\ball barriers\b/.test(q) ? 'all' : 'any'; }
  if (!found.length && /\b(?:with|has|have|any|a)\s+(?:(?:active|resolved|current|unresolved|any|a)\s+)*barriers?\b/.test(q) && !/\ball barriers\b/.test(q)) { plan.barriers = Object.keys(BARRIERS); plan.barrierMode = 'any'; }
  if (/\b(?:resolved|no longer|fixed|used to|previously had)\b/.test(q)) plan.status = 'resolved';
  else if (/\b(?:active and resolved|resolved and active|any status|all statuses|including resolved)\b/.test(q)) plan.status = 'any';
  else if (/\b(?:active|current|still|unresolved)\b/.test(q)) plan.status = 'active';
  // "Including resolved" is intentionally broader than a resolved-only question.
  if (/\b(?:active and resolved|resolved and active|any status|all statuses|including resolved)\b/.test(q)) plan.status = 'any';
  if (plan.status === 'resolved' && !plan.barriers.length) { plan.barriers = Object.keys(BARRIERS); plan.barrierMode = 'any'; }
  if (/\b(?:all patients|entire population|whole population|with or without diabetes|regardless of diabetes|non-diabetic)\b/.test(q)) plan.diabetesOnly = false;
  if (/\b(?:non-diabetic|not diabetic|not diabetes|without diabetes|no diabetes)\b/.test(q) && !/\bwith or without diabetes\b/.test(q)) return fail('The demo supports the whole population or patients with diabetes. A diabetes-exclusion filter is not yet supported.');
  if (/\b(?:diabet(?:es|ic)|type 2)\b/.test(q) && !/\b(?:with or without diabetes|regardless of diabetes)\b/.test(q)) plan.diabetesOnly = true;
  if (/\b(?:regardless of (?:care )?gaps?|including (?:closed|no) gaps?|all patients|entire population|whole population|all diabetic patients|all patients with diabetes)\b/.test(q)) plan.gapOnly = false;
  if (/\b(?:missing|missed|overdue|open (?:care )?gaps?|care gaps?|pending|due|behind|important tests|not getting care)\b/.test(q)) plan.gapOnly = true;
  if (/\b(?:missing|missed|overdue|pending|due|behind)\b/.test(q) && /\b(?:a1c|hba1c|test|tests|lab|labs|labwork)\b/.test(q)) { plan.gapOnly = true; plan.gapType = 'overdue'; }
  else if (/\b(?:high|elevated)\s+(?:a1c|hba1c)\b|\b(?:a1c|hba1c)\s+(?:is\s+)?(?:high|elevated)\b/.test(q)) { plan.gapOnly = true; plan.gapType = 'elevated'; }
  else if (/\b(?:open (?:care )?gaps?|all (?:care )?gaps?)\b/.test(q)) plan.gapType = 'any';
  if (!plan.gapOnly) plan.gapType = 'any';
  if (/\b(?:regardless of (?:care )?gaps?|with or without (?:care )?gaps?|including (?:closed|no) gaps?)\b/.test(q)) { plan.gapOnly = false; plan.gapType = 'any'; }
  if (/\b(?:closed gaps?|without (?:a )?(?:care )?gap|no (?:care )?gaps?)\b/.test(q) && !/including/.test(q)) return fail('Closed-gap-only cohorts are not supported. Ask for open care gaps or all patients.');

  const range = q.match(/\b(?:ages?|aged|between)\s*(\d{1,3})\s*(?:-|and|to)\s*(\d{1,3})\b/);
  if (range) { plan.ageMin = +range[1]; plan.ageMax = +range[2]; consume(range); }
  const ageMin = q.match(/(?:\b(?:age|aged|ages)\s*)?(?:over|older than|above)\s+(\d{1,3})(?!\d)(?!\s*(?:days?|months?|%))/);
  const ageInclusive = q.match(/\b(?:age[ds]?\s*)?(?:at least|>=)\s*(\d{1,3})(?!\d)(?!\s*(?:days?|months?|%))/) || q.match(/\b(?:age[ds]?\s*)?(\d{1,3})\s*(?:\+|and older|or older)/);
  const ageMax = q.match(/(?:\b(?:age|aged|ages)\s*)?(?:under|younger than|below)\s+(\d{1,3})(?!\d)(?!\s*(?:days?|months?|%))/);
  const ageMaxInclusive = q.match(/\b(?:age[ds]?\s*)?(?:at most|<=)\s*(\d{1,3})(?!\d)(?!\s*(?:days?|months?|%))/) || q.match(/\b(?:age[ds]?\s*)?(\d{1,3})\s*(?:and younger|or younger)/);
  const ageExact = !range && q.match(/\b(?:age|aged)\s+(?:exactly\s+)?(\d{1,3})\b(?!\s*(?:\+|and|or|to|-))/);
  if (ageExact) { plan.ageMin = +ageExact[1]; plan.ageMax = +ageExact[1]; consume(ageExact); }
  if (ageMin) { plan.ageMin = +ageMin[1] + 1; consume(ageMin); }
  if (ageInclusive) { plan.ageMin = +ageInclusive[1]; consume(ageInclusive); }
  if (ageMax) { plan.ageMax = +ageMax[1] - 1; consume(ageMax); }
  if (ageMaxInclusive) { plan.ageMax = +ageMaxInclusive[1]; consume(ageMaxInclusive); }
  if (/\b(?:any age|all ages|regardless of age)\b/.test(q)) { plan.ageMin = null; plan.ageMax = null; }
  if (plan.ageMin !== null && plan.ageMin > 120 || plan.ageMax !== null && plan.ageMax > 120 || plan.ageMin !== null && plan.ageMax !== null && plan.ageMin > plan.ageMax) return fail('Use a valid age range from 0 to 120.');
  if (/\b(?:refill|refills|medication gap|medication gaps)\b/.test(q)) {
    const refill = q.match(/(?:over|more than|above|greater than)\s*(\d+)\s*(?:days?|day)/) || q.match(/(\d+)\s*(?:days?|day)\s*(?:or more|and longer|\+)/);
    const inclusive = q.match(/(?:at least|>=)\s*(\d+)\s*days?/);
    if (/\b(?:under|less than|below|at most)\s*\d+\s*days?/.test(q)) return fail('Refill queries currently support minimum delays only, such as "refill gaps over 30 days".');
    plan.refillMin = inclusive ? +inclusive[1] : refill ? +refill[1] + (/or more|and longer|\+/.test(refill[0]) ? 0 : 1) : 31;
    consume(inclusive || refill);
  }
  if (/\b(?:oldest|sort by age|order by age)\b/.test(q)) plan.sort = 'age';
  if (/\b(?:priority|urgent|highest risk)\b/.test(q)) plan.sort = 'priority';
  if (/\b(?:sort|order) by\b/.test(q) && !/\b(?:sort|order) by (?:age|priority)\b/.test(q)) return fail('Supported sorting is by age or demo priority score.');
  const limit = q.match(/\b(?:top|first|limit to)\s*(\d+)\b/);
  if (limit) { if (+limit[1] < 1 || +limit[1] > 1000) return fail('Choose a result limit from 1 to 1,000.'); plan.limit = +limit[1]; consume(limit); }
  if (/\b(?:show all|no limit|remove limit)\b/.test(q)) plan.limit = null;

  // Recognized vocabulary is deliberately bounded; unsupported content is not discarded.
  const allowed = new Set(`a an the i we our you me my please can could would will want need needs find show list get tell give display identify count how many which who what about help discover search query ask patients patient people person diabetic diabetes type 2 with have has having are is be were been and or either both all any those them their these that this of for from in on to at by because due as than whose not don't doesn't can't cannot unable getting get no longer still active current unresolved resolved fixed used previously had status statuses barriers barrier transportation transport ride rides bus car travel cost costs afford affordability copay co-pay expensive financial money medication medications medicine medicines prescription prescriptions refill refills gap gaps delay delays food meals groceries hungry hunger nutrition insecurity literacy health understand understanding confused confusion instructions teach-back care important tests test a1c hba1c blood lab labs laboratory screening missed missing overdue open pending behind completing completed appointment appointments followup follow-up now only just also same narrow filter among within instead as well addition over older above under younger below age ages aged between years year old least most more greater less days day months month regardless including without entire whole population closed high elevated priority urgent highest risk oldest sort order first top limit remove longer than or more exact evidence source sources records record documents document notes note transcript transcripts why hidden overlooked structured code coded uncoded snapshot October 10 2026 transportations assistance support access trouble issues problems facing experience experiencing experiencing needs needing across through it into then else tell us do does did number total affected affected discover uncovered experiencing medical clinical no restrictions expand reset start again versus either else unable out run running lack enough meal program task draft coordinate eligible outreach prepare intervention interventions recommendations recommend action actions eligible coordinator approval explain reason reasons unmet relevant complete getting better previously unaddressed likely match matches matching use aged selected selected together versus unanswered ask really anyone anyones really day delayed delay cannot labwork work ago follow ups 365 30 9 percent percent of`.split(/\s+/));
  allowed.add('they'); allowed.add('their'); allowed.add('exactly');
  const words = q.replace(/\b(?:a1c|hba1c)\b/g, ' a1c ').replace(/\b\d+(?:\.\d+)?\b/g, ' ').replace(/[^a-z0-9'-]/g, ' ').split(/\s+/).filter(Boolean);
  const unknown = [...new Set(words.filter(word => !allowed.has(word)))];
  if (unknown.length) return fail(`I cannot safely interpret ${unknown.slice(0, 3).map(w => `“${w}”`).join(', ')} as a supported filter. Try diabetes, care gaps, transportation, cost, food insecurity, health literacy, age, or refill delay.`);
  const unusedNumber = [...q.matchAll(/\b\d+(?:\.\d+)?\b/g)].find(match => !consumedNumbers.some(([start, end]) => match.index >= start && match.index < end));
  if (unusedNumber) return fail(`I cannot safely interpret the number ${unusedNumber[0]}. Use a supported age range, minimum refill delay, or result limit.`);
  const meaningful = found.length || /\b(?:patients|patient|people|diabetes|diabetic|care|gap|gaps|refill|refills|barriers|barrier|population|age|ages|aged|older|oldest|over|under|younger|resolved|evidence|count|top)\b/.test(q);
  if (!meaningful) return fail('Ask a patient-cohort question, such as patients with open care gaps and transportation barriers.');
  const scope = [plan.diabetesOnly ? 'Patients with diabetes' : 'All patients', plan.gapOnly ? plan.gapType === 'overdue' ? 'overdue A1c tests' : plan.gapType === 'elevated' ? 'elevated A1c' : 'open care gaps' : 'with or without care gaps'];
  if (plan.barriers.length) scope.push(`${plan.status === 'any' ? 'active or resolved' : plan.status} ${plan.barriers.map(b => BARRIERS[b].label.toLowerCase()).join(plan.barrierMode === 'all' ? ' + ' : ' or ')}`);
  else if (plan.status === 'resolved') scope.push('at least one resolved barrier');
  if (plan.ageMin !== null) scope.push(`age ≥ ${plan.ageMin}`);
  if (plan.ageMax !== null) scope.push(`age ≤ ${plan.ageMax}`);
  if (plan.refillMin !== null) scope.push(`refill delay ≥ ${plan.refillMin} days`);
  if (plan.limit) scope.push(`show first ${plan.limit}`);
  return { ok: true, plan, summary: scope.join(' · ') };
}

function barrierMatch(patient, plan, overrideStatus) {
  const status = overrideStatus || plan.status;
  const assertions = patient.barriers.filter(b => status === 'any' || b.status === status);
  if (!plan.barriers.length) return true;
  return plan.barriers[plan.barrierMode === 'all' ? 'every' : 'some'](type => assertions.some(b => b.type === type));
}

function hash(value) {
  let h = 2166136261;
  for (const c of value) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
}

export function runQuery(input) {
  const plan = { ...defaults(), ...input, barriers: [...(input?.barriers || [])] };
  if (plan.barriers.some(b => !BARRIERS[b]) || !['any','all'].includes(plan.barrierMode) || !['active','resolved','any'].includes(plan.status)) throw new Error('Invalid query plan.');
  const base = patients.filter(p => (!plan.diabetesOnly || p.diabetes) && (!plan.gapOnly || p.gapOpen) && (plan.gapType !== 'overdue' || p.diabetes && p.daysOverdue > 0) && (plan.gapType !== 'elevated' || p.diabetes && p.a1c > 9) && (plan.refillMin === null || p.refillGap >= plan.refillMin) && (plan.ageMin === null || p.age >= plan.ageMin) && (plan.ageMax === null || p.age <= plan.ageMax));
  const matching = base.filter(p => barrierMatch(p, plan)).sort((a, b) => (plan.sort === 'age' ? b.age - a.age : b.priority - a.priority) || a.id.localeCompare(b.id));
  const excludedResolved = plan.status === 'active' && plan.barriers.length ? base.filter(p => !barrierMatch(p, plan) && barrierMatch(p, plan, 'resolved')).length : 0;
  const evidence = matching.flatMap(p => p.barriers.filter(b => (!plan.barriers.length || plan.barriers.includes(b.type)) && (plan.status === 'any' || b.status === plan.status)));
  const groups = Object.entries(BARRIERS).map(([type, info]) => ({ type, label: info.label, intervention: info.intervention, count: matching.filter(p => p.barriers.some(b => b.type === type && (plan.status === 'any' || b.status === plan.status))).length })).filter(g => g.count > 0);
  const fingerprint = hash(JSON.stringify({ ...plan, barriers: [...plan.barriers].sort(), ids: matching.map(p => p.id), asOf: AS_OF }));
  const witness = matching.find(p => p.id === 'P0412') || matching.find(p => !p.structuredBarrierCode && p.barriers.some(b => b.status === 'active'));
  const routeEvents = witness && plan.barriers.length ? [
    { step: 3, tool: 'lookup_structured_barrier', say: `${witness.id}: structured record ${witness.structuredBarrierCode ? 'contains a barrier flag' : 'contains no barrier flag'}.`, found: witness.structuredBarrierCode ? 1 : 0, nodes: ['Patient'], edges: [], evidence: [] },
    ...(!witness.structuredBarrierCode ? [{ step: 4, tool: 'retrieve_source_assertion', say: `${witness.id}: followed the source-document path and recovered the latest patient-specific evidence.`, found: witness.barriers.filter(b => plan.barriers.includes(b.type) && (plan.status === 'any' || b.status === plan.status)).length, nodes: ['Patient','Document','Barrier'], edges: ['HAS_DOCUMENT','EVIDENCES'], evidence: witness.barriers.filter(b => plan.barriers.includes(b.type) && (plan.status === 'any' || b.status === plan.status)) }] : []),
  ] : [];
  return {
    patients: plan.limit ? matching.slice(0, plan.limit) : matching, count: matching.length, groups, excludedResolved, fingerprint,
    events: [
      { step: 1, tool: 'plan_cohort', say: 'Mapped the question to supported filters and the fixed demo ontology.', found: patients.length, nodes: ['Question','Query plan'], edges: ['MAPS_TO'], evidence: [] },
      { step: 2, tool: 'query_clinical_facts', say: `Applied structured clinical and age filters to ${patients.length.toLocaleString()} fictional patient records.`, found: base.length, nodes: ['Patient','Condition','CareGap'], edges: ['HAS_CONDITION','HAS_GAP'], evidence: [] },
      ...routeEvents,
      { step: 3 + routeEvents.length, tool: 'traverse_barrier_evidence', say: `Matched source-backed ${plan.status} barrier assertions. ${excludedResolved} resolved-only matches were excluded.`, found: matching.length, nodes: ['Patient','Document','Barrier'], edges: ['HAS_DOCUMENT','EVIDENCES','EXPERIENCES'], evidence: evidence.slice(0, 6) },
      { step: 4 + routeEvents.length, tool: 'validate_and_count', say: `Deduplicated patient IDs and returned an exact count of ${matching.length}. Repeatable result fingerprint: ${fingerprint}.`, found: matching.length, nodes: ['Patient','Intervention'], edges: ['ADDRESSED_BY'], evidence: evidence.slice(0, 3) },
    ],
  };
}

export function makeDraft(patient, barrierType) {
  if (!patient.gapOpen) throw new Error('An open A1c care gap is required to prepare a care-coordination draft.');
  const type = barrierType || patient.barriers.find(b => b.status === 'active')?.type;
  const barrier = patient.barriers.find(b => b.type === type && b.status === 'active');
  if (!barrier || !BARRIERS[type]) throw new Error('An active, source-backed barrier is required to prepare an outreach draft.');
  const info = BARRIERS[type];
  const need = patient.gaps.map(g => g.label.toLowerCase()).join('; ') || 'care-plan follow-up';
  return {
    title: `${info.label} outreach · ${patient.id}`,
    intervention: info.intervention,
    body: `DEMO DRAFT — HUMAN REVIEW REQUIRED\n\nPatient: ${patient.name} (${patient.id}) — fictional record\nCare need: ${need}.\nBarrier: ${info.label.toLowerCase()}.\n\nSource evidence: “${barrier.quote}”\n${barrier.source}, ${barrier.date} · ${barrier.documentId}\n\nRecommended next step: ${info.intervention}\n\nOutreach draft:\nHi ${patient.name.split(' ')[0]}, this is your care coordination team. You recently shared that ${type === 'transportation' ? 'getting to appointments has been difficult' : type === 'cost' ? 'medication costs have been difficult to manage' : type === 'food' ? 'getting enough food has been difficult' : 'your care instructions have been difficult to understand'}. We would like to help you complete your care plan. May we confirm whether this is still a concern and discuss support options that work for you?\n\nBefore approval: confirm the barrier is current, obtain permission, verify eligibility and availability, and confirm the appropriate clinical follow-up with the care team.\n\nNo message has been sent. No service has been booked.`,
  };
}

export function getMetrics() {
  const docs = patients.reduce((n, p) => n + p.documents.length, 0);
  const evidence = patients.reduce((n, p) => n + p.barriers.length, 0);
  const gaps = patients.reduce((n, p) => n + p.gaps.length, 0);
  const diabetes = patients.filter(p => p.diabetes).length;
  const graph = buildGraph();
  const nodes = graph.nodes.length;
  const edges = graph.edges.length;
  return {
    population: patients.length, diabetes, openGaps: patients.filter(p => p.gapOpen).length,
    actionable: patients.filter(p => p.gapOpen && p.barriers.some(b => b.status === 'active')).length,
    docs, documents: docs, nodes, edges, graph: { nodes, edges }, evidence,
    hiddenBarriers: patients.filter(p => p.gapOpen && !p.structuredBarrierCode && p.barriers.some(b => b.status === 'active')).length,
    resolved: patients.filter(p => p.barriers.some(b => b.status === 'resolved')).length,
    asOf: AS_OF,
  };
}

const EXTRACTION_CASES = [
  { name: 'Direct transportation barrier', text: 'I have no transportation to my appointments.', expected: [{ type: 'transportation', status: 'active' }] },
  { name: 'Negated transportation problem', text: 'Patient denies transportation problems.', expected: [] },
  { name: 'Resolved transportation need', text: 'I no longer need transportation help.', expected: [{ type: 'transportation', status: 'resolved' }] },
  { name: 'Family-only transportation problem', text: 'Her mother cannot get a ride to the clinic.', expected: [] },
  { name: 'Conditional future transportation need', text: 'If the patient needs transportation help, provide a resource list.', expected: [] },
  { name: 'Active medication cost barrier', text: 'Patient cannot afford the medication copay.', expected: [{ type: 'cost', status: 'active' }] },
  { name: 'Family-only medication cost', text: 'Her mother cannot afford the medication copay.', expected: [] },
  { name: 'Resolved medication cost', text: 'The medication cost barrier is resolved; patient can now afford the copay.', expected: [{ type: 'cost', status: 'resolved' }] },
  { name: 'Active food insecurity', text: 'Patient ran out of food before the end of the month.', expected: [{ type: 'food', status: 'active' }] },
  { name: 'Negated food insecurity', text: 'Patient denies food insecurity.', expected: [] },
  { name: 'Resolved food insecurity', text: 'Food insecurity is resolved; patient now has enough food.', expected: [{ type: 'food', status: 'resolved' }] },
  { name: 'Active health literacy barrier', text: 'Patient does not understand the care-plan instructions.', expected: [{ type: 'health_literacy', status: 'active' }] },
  { name: 'No health literacy barrier', text: 'Patient understands the medication instructions.', expected: [] },
  { name: 'Resolved health literacy barrier', text: 'Patient is no longer confused and now understands the medication instructions.', expected: [{ type: 'health_literacy', status: 'resolved' }] },
  { name: 'Two independent active barriers', text: 'I have no transportation to my appointments. I cannot afford the medication copay.', expected: [{ type: 'transportation', status: 'active' }, { type: 'cost', status: 'active' }] },
  { name: 'Negation stays in its sentence', text: 'Patient denies food insecurity. Patient cannot get a ride to the clinic.', expected: [{ type: 'transportation', status: 'active' }] },
  { name: 'Contrast preserves a real barrier', text: 'Patient denies transportation problems but cannot afford the medication copay.', expected: [{ type: 'cost', status: 'active' }] },
  { name: 'Uncertain future food need', text: 'Patient might have food insecurity.', expected: [] },
  { name: 'Reliable transportation', text: 'Patient has reliable transportation to the clinic.', expected: [] },
  { name: 'Transport mention without obstacle', text: 'Transportation options were reviewed with the patient.', expected: [] },
];

function scoreCases(cases) {
  let tp = 0, fp = 0, fn = 0;
  const perBarrier = Object.fromEntries(Object.keys(BARRIERS).map(type => [type, { tp: 0, fp: 0, fn: 0 }]));
  const key = item => `${item.type}:${item.status}`;
  for (const c of cases) {
    const actual = new Set(c.actual.map(key)), expected = new Set(c.expected.map(key));
    for (const item of actual) { const type = item.split(':')[0]; if (expected.has(item)) { tp++; perBarrier[type].tp++; } else { fp++; perBarrier[type].fp++; } }
    for (const item of expected) if (!actual.has(item)) { fn++; perBarrier[item.split(':')[0]].fn++; }
    c.passed = actual.size === expected.size && [...actual].every(k => expected.has(k));
  }
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  for (const stat of Object.values(perBarrier)) {
    stat.precision = stat.tp + stat.fp ? stat.tp / (stat.tp + stat.fp) : 1;
    stat.recall = stat.tp + stat.fn ? stat.tp / (stat.tp + stat.fn) : 1;
    stat.f1 = stat.precision + stat.recall ? 2 * stat.precision * stat.recall / (stat.precision + stat.recall) : 0;
  }
  return { precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, tp, fp, fn, perBarrier };
}

export function evaluateExtraction() {
  const cases = EXTRACTION_CASES.map(c => ({ ...c, actual: extractBarriers({ id: 'evaluation', date: AS_OF, type: 'Synthetic evaluation note', text: c.text }).map(({ type, status }) => ({ type, status })) }));
  const corpus = seedLabels.map(label => ({ name: label.patientId, expected: label.expected, actual: patients.find(p => p.id === label.patientId).barriers.map(({ type, status }) => ({ type, status })) }));
  const stats = scoreCases(cases);
  const corpusStats = scoreCases(corpus);
  return { ...stats, cases, total: cases.length, passed: cases.filter(c => c.passed).length, corpus: { ...corpusStats, total: corpus.length, passed: corpus.filter(c => c.passed).length }, note: 'Deterministic rule baseline evaluated on synthetic, template-derived cases. These are demonstration checks, not independently validated clinical accuracy.' };
}
