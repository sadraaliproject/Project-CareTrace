/** Hospital-owned evidence model. Derived edges are declared separately. */
export const BARRIERS = Object.freeze({
  transportation: { label: 'Transportation', zCode: 'Z59.82', behavior: 'Attend the follow-up visit', action: 'Book hospital patient transport for the visit and offer a video visit as the alternative.', owner: 'Care transitions nurse', color: '#7794ff' },
  cost: { label: 'Cost', zCode: 'Z59.86', behavior: 'Pick up and start new insulin', action: 'Ask the outpatient pharmacist to review a lower-cost formulation, deliver the first fill to the bedside or home, and refer to financial counseling.', owner: 'Outpatient pharmacist', color: '#dba365' },
  food: { label: 'Food insecurity', zCode: 'Z59.41', behavior: 'Take insulin safely and eat regularly', action: 'Arrange a dietitian consult and referral to the hospital food pharmacy or a medically tailored meal program.', owner: 'Social worker and dietitian', color: '#8ab995' },
  health_literacy: { label: 'Health literacy', zCode: 'Z55.6', behavior: 'Check glucose and dose correctly', action: 'Arrange a diabetes educator session with teach-back, simplified one-page insulin instructions, and a 48-hour call.', owner: 'Diabetes educator', color: '#c29bf4' },
});

export const NOTE_TYPES = Object.freeze([
  'Bedside nursing note', 'Physician progress note', 'Social work and case management note',
  'Discharge summary', 'Post-discharge nurse call note',
]);

export const ontology = Object.freeze({
  nodeTypes: ['Patient', 'Admission', 'Condition', 'LabResult', 'Medication', 'Appointment', 'FollowUpGap', 'ClinicalNote', 'Barrier', 'Action'],
  relationships: ['HAD_ADMISSION', 'HAS_CONDITION', 'HAS_RESULT', 'PRESCRIBED_AT_DISCHARGE', 'HAS_APPOINTMENT', 'HAS_NOTE', 'HAS_GAP', 'REPORTED_BARRIER', 'ADDRESSED_BY'],
  inferredRelationships: ['LIKELY_TO_RETURN'],
  paths: [
    ['Patient', 'HAD_ADMISSION', 'Admission'], ['Patient', 'HAS_CONDITION', 'Condition'],
    ['Patient', 'HAS_RESULT', 'LabResult'], ['Patient', 'PRESCRIBED_AT_DISCHARGE', 'Medication'],
    ['Patient', 'HAS_APPOINTMENT', 'Appointment'], ['Patient', 'HAS_NOTE', 'ClinicalNote'],
    ['Patient', 'HAS_GAP', 'FollowUpGap'], ['Patient', 'REPORTED_BARRIER', 'Barrier'],
    ['Barrier', 'ADDRESSED_BY', 'Action'], ['Patient', 'LIKELY_TO_RETURN', 'Admission'],
  ],
  barrierTypes: Object.keys(BARRIERS), noteTypes: NOTE_TYPES,
  limits: { maxHops: 12, maxNodes: 50 },
  rules: [
    'Only current patient-specific assertions create reported barrier edges.',
    'Every reported barrier retains a source ID, note type, evidence sentence, and confidence.',
    'Negated, resolved, historical, family-only, and clinical look-alike statements create no active barrier edge.',
    'Graph paths must match a declared relationship; a displayed route may join through the patient.',
  ],
  followUpGapRule: 'At least 14 days after a diabetes-related discharge: no completed follow-up within 14 days, or a newly started discharge medication was not picked up within 3 days.',
  likelyToReturnRule: 'Admission A1c above 9%, no completed follow-up visit, new insulin not picked up, and at least one reported barrier.',
  disclaimer: 'Simplified hackathon rules. This is not a validated readmission prediction model.',
});
