/** Text-only note reader. Rule set frozen before the evaluation file is generated. */
export const READER_VERSION = '2026-10-10.1';
export const BARRIER_TYPES = Object.freeze(['transportation', 'cost', 'food', 'health_literacy']);

// Short linguistic features, deliberately independent of any complete example sentence.
const FEATURES = {
  transportation: [
    ['travel resource', /\b(?:transport(?:ation)?|rides?|bus|buses|vehicle|car|driver|drives?|clinic appts?)\b/i, .38],
    ['travel obstacle', /\b(?:no (?:reliable )?(?:way|ride|car|vehicle|driver)|cannot (?:get|reach|travel)|can't (?:get|reach|travel)|unable to (?:get|reach|travel)|unreliable|stranded|broken down|out of service|two (?:bus )?transfers|only way|only ride)\b/i, .52],
    ['transport availability', /\b(?:works? days|works? nights|not available|no longer drives|stopped running|beyond walking distance|cannot walk|no bus route|ride fell through)\b/i, .38],
    ['appointment destination', /\b(?:appts?|appointments?|clinic|follow.up|hospital)\b/i, .18],
  ],
  cost: [
    ['medication resource', /\b(?:insulin|glargine|strips|pens|medications?|medicines?|scripts?|prescriptions?|pharmacy|copay)\b/i, .25],
    ['payment obstacle', /\b(?:cannot afford|can't afford|could not pay|couldn't pay|unable to pay|unaffordable|too expensive|ration(?:ing|s)?|stretches?|samples?|short of cash|payday|rent|copay|dollars?|\$\d+)\b/i, .48],
    ['unmet medication need', /\b(?:not (?:pick|collected)|left (?:it|them|the pens)|waiting|skipp(?:ing|ed)|ran out|make (?:it|them) last|declined|cut(?:ting)? back|cannot|could not|empty|delayed|beyond (?:her|his|the) budget|instead)\b/i, .25],
  ],
  food: [
    ['home nutrition', /\b(?:food|groceries|meals?|cupboards?|pantry|kitchen|dinner|breakfast|lunch|eats?|eating|hungry)\b/i, .34],
    ['nutrition obstacle', /\b(?:bare|empty|not enough|runs? out|running out|one meal|skips?|skipping|without|nothing|no (?:food|groceries|meals)|only (?:tea|toast|crackers)|last (?:can|bag)|missed|cannot afford|can't afford|stretch(?:ing)?|every other day)\b/i, .52],
    ['nutrition regularity', /\b(?:most days|end of (?:the )?month|by the \d+|at home|insulin|supper|dinner)\b/i, .12],
  ],
  health_literacy: [
    ['self-care task', /\b(?:glargine|insulin|meter|glucose|instructions?|doses?|dosing|teach.back|pen|labels?|schedule|numbers?|written sheet)\b/i, .31],
    ['understanding obstacle', /\b(?:could not (?:state|explain|show|demonstrate)|cannot (?:state|explain|read|use)|can't (?:state|explain|read|use)|unable to (?:state|explain|read|use)|confused|does not (?:know|understand)|did not understand|read .{0,24}aloud|reversed|mixed up|guessed|unable to repeat|needs .{0,18}pictures|unsure)\b/i, .55],
    ['instruction detail', /\b(?:when|how|units?|morning|night|steps?|aloud|demonstration|numbers?)\b/i, .12],
  ],
};

function sentenceRanges(text) {
  const spans = [];
  const boundary = /[.!?](?=\s|$)/g;
  let start = 0;
  for (const match of text.matchAll(boundary)) {
    const before = text.slice(start, match.index);
    if (/\b(?:Dr|Mr|Mrs|Ms|Pt|pt)$/.test(before)) continue;
    const end = match.index + 1;
    const raw = text.slice(start, end);
    const offset = raw.search(/\S/);
    if (offset >= 0) spans.push({ text: raw.trim(), start: start + offset, end });
    start = end;
  }
  const trailing = text.slice(start);
  if (trailing.trim()) spans.push({ text: trailing.trim(), start: start + trailing.search(/\S/), end: text.length });
  return spans;
}

function contextStatus(text) {
  const normalized = text.replace(/[’‘]/g, "'");
  if (/\b(?:NPO|nil by mouth|held for (?:a )?procedure|fasting for|procedure-related|bowel prep)\b/i.test(normalized)) return ['clinical', 'Clinical restriction, not a home access problem.'];
  if (/^(?:(?:pt|patient)'s|his|her|the)\s+(?:brother|sister|father|mother|neighbour|neighbor|cousin)\b.{0,70}\b(?:own|his|her|their)\b/i.test(normalized)) return ['third_party', 'The difficulty belongs to another person.'];
  if (/\b(?:resolved|arranged by|now has|now able|now available|assistance in place|assistance approved|can now afford|no longer needs?|already delivered|successfully demonstrated|now correctly|secured before|now stocked)\b/i.test(normalized)) return ['resolved', 'The note records that help is already in place.'];
  if (/\b(?:denies|denied|no concerns|no difficulty|no problem|without difficulty|no current|adequate groceries|has reliable|independently demonstrated)\b/i.test(normalized)) return ['negated', 'The note explicitly denies a current difficulty.'];
  if (/\b(?:previously|historically|used to|last year|in the past|prior admission|earlier this year)\b/i.test(normalized)) return ['historical', 'The statement is about a past difficulty.'];
  if (/\b(?:if|might|may|could)\b.{0,30}\b(?:need|develop|become|run out)\b/i.test(normalized)) return ['hypothetical', 'This is a possible future issue, not a current report.'];
  return ['active', 'Current patient-specific difficulty supported by text cues.'];
}

export function readNote(note = {}) {
  if (typeof note === 'string') note = { text: note };
  const text = String(note.text || '');
  const assertions = [];
  const sentences = sentenceRanges(text).map(span => {
    const scores = {};
    const cues = [];
    for (const type of BARRIER_TYPES) {
      let total = 0;
      for (const [label, pattern, weight] of FEATURES[type]) {
        const match = span.text.match(pattern);
        if (match) { total += weight; cues.push({ type, label, text: match[0], weight }); }
      }
      scores[type] = Math.round(Math.min(.98, total) * 100) / 100;
    }
    const [status, reason] = contextStatus(span.text);
    // Medication cost needs a medication cue; a cash phrase about groceries is not enough.
    const candidates = BARRIER_TYPES.filter(type => scores[type] >= .72 && (type !== 'cost' || FEATURES.cost[0][1].test(span.text)));
    const current = [];
    for (const type of candidates) {
      if (['clinical', 'third_party', 'hypothetical'].includes(status)) continue;
      const assertion = {
        type, status, resolved: status === 'resolved', quote: span.text,
        evidence_sentence: span.text, char_span: [span.start, span.end],
        confidence: scores[type], note_id: note.id || null, documentId: note.id || null,
        note_type: note.note_type || 'Clinical note', date: note.date || note.written_datetime?.slice(0, 10) || null,
        written_datetime: note.written_datetime || null, sourceKind: 'note',
        authorRole: note.author_role || note.authorRole || null,
        daysFromDischarge: note.daysFromDischarge ?? null,
        action_recorded: Boolean(note.action_recorded), actionRecorded: Boolean(note.action_recorded),
      };
      assertions.push(assertion); current.push(assertion);
    }
    const hasCues = cues.length > 0;
    return {
      ...span, scores, cues, assertions: current,
      outcome: candidates.length && status === 'active' ? 'edge_created' : hasCues ? 'rejected' : 'no_signal',
      reason: !hasCues ? 'No barrier-related language.' : status !== 'active' ? reason : candidates.length ? reason : 'Related language is below the evidence threshold.',
      status,
    };
  });
  return { version: READER_VERSION, sentences, assertions };
}

export const extractBarriers = note => readNote(note).assertions;
