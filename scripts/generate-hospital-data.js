import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sourcePatients, sourceProvenance } from '../dist/hospital-data.js';
import { BARRIERS, NOTE_TYPES } from '../dist/ontology.js';

const root = new URL('../', import.meta.url);
const asOf = '2026-10-10';
const dateAt = days => new Date(Date.parse(`${asOf}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
const addDays = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const roles = ['Inpatient nurse', 'Hospitalist', 'Social worker', 'Discharging physician', 'Transitions nurse'];
const patterns = [
  ['transportation'], ['cost'], ['food'], ['health_literacy'],
  ['transportation', 'cost'], ['food', 'health_literacy'], ['transportation', 'food'],
  [], [], [], [], [],
];
const sentences = {
  transportation: [
    'Pt states daughter drove her in, has no way to get to clinic appts once home.',
    'Lives alone, no vehicle, nearest bus stop about 2 miles.',
    'Pt unable to attend follow-up because no ride is available.',
  ],
  cost: [
    'Started basal insulin today. Pt worried about affording pens, asks if pills are an option.',
    'Has not picked up insulin. States it was $90 at the counter and she left it.',
    'Pt cannot afford the new insulin prescription.',
  ],
  food: [
    'Reports running out of food by end of month, skips meals. Afraid of going low on insulin.',
    'Pt has no food at home and has been skipping meals.',
    'Pt runs out of groceries before the end of each month.',
  ],
  health_literacy: [
    'Unable to teach back sliding scale after two attempts. Confused by written instructions.',
    'Not checking sugars. Says nobody showed her how to use the meter.',
    'Pt does not understand how to check glucose or dose insulin.',
  ],
};
const hardCases = [
  { category: 'negation', text: 'Denies transportation concerns. Wife drives.' },
  { category: 'resolved', text: 'Transport arranged by SW prior to discharge.' },
  { category: 'family-only', text: "Pt's brother lost his job and cannot afford his own medications." },
  { category: 'clinical-look-alike', text: 'NPO after midnight, meals held for procedure.' },
  { category: 'past-not-current', text: 'Previously had trouble affording strips, now has assistance in place.' },
];
const diagnoses = [
  ['Diabetic ketoacidosis', '420422005', 'Diabetic ketoacidosis'],
  ['Hyperosmolar hyperglycemic state', '395204000', 'Hyperosmolar non-ketotic state due to type 2 diabetes mellitus'],
  ['Severe hypoglycemia', '302866003', 'Hypoglycemia'],
  ['Diabetic foot infection', '371087003', 'Diabetic foot ulcer'],
  ['New insulin started with admission A1c above 9%', '44054006', 'Type 2 diabetes mellitus'],
];
const cases = [];
let trueBarrierPatients = 0;
const hospitalPatients = sourcePatients.map((source, index) => {
  const number = index + 1;
  const id = `P${String(number).padStart(4, '0')}`;
  const anchor = id === 'P0412';
  const diabetesRelated = index < 149 || anchor;
  const daysSince = anchor ? 65 : diabetesRelated && index % 11 === 0 ? 7 + index % 7 : 14 + index * 13 % 76;
  const dischargeDate = anchor ? '2026-08-06' : dateAt(daysSince);
  const admitDate = anchor ? '2026-08-02' : addDays(dischargeDate, -3 - index % 4);
  const dx = anchor ? diagnoses[0] : diagnoses[index % diagnoses.length];
  const principalDiagnosis = diabetesRelated ? dx[0] : ['Pneumonia', 'Acute appendicitis', 'Dehydration', 'Hip fracture'][index % 4];
  const admission = { id: `${id}-A01`, admitDate, dischargeDate, diabetesRelated, principalDiagnosis, unit: diabetesRelated ? 'Internal medicine' : 'General medicine', disposition: 'Home', hospital: ['North Hospital', 'Riverside Hospital', 'Central Hospital'][index % 3], dischargingPhysician: ['Dr. Morgan Chen', 'Dr. Amara Patel', 'Dr. Jordan Rivera'][index % 3] };
  const patient = { ...source, id, admission, notes: [], socialNeeds: [], labs: [], medications: [], appointments: [], emergencyVisits: [] };
  patient.condition = diabetesRelated ? { id: `${id}-C01`, code: dx[1], display: dx[2], system: 'SNOMED CT' } : { id: `${id}-C01`, code: ['233604007', '74400008', '34095006', '359817006'][index % 4], display: ['Pneumonia', 'Appendicitis', 'Dehydration', 'Closed fracture of hip'][index % 4], system: 'SNOMED CT' };
  if (!diabetesRelated) return patient;
  const a1c = anchor ? 11.2 : Number((index % 5 === 4 ? 9.5 + index % 22 / 10 : 7.2 + index % 44 / 10).toFixed(1));
  patient.labs = [
    { id: `${id}-L01`, code: '4548-4', name: 'Admission HbA1c', value: a1c, unit: '%', date: admitDate },
    { id: `${id}-L02`, code: '2339-0', name: 'Inpatient glucose', value: anchor ? 348 : 150 + index % 250, unit: 'mg/dL', date: admitDate },
  ];
  const pickedUp = anchor ? false : index % 4 === 0 || index % 4 === 3;
  patient.medications = [
    { id: `${id}-M01`, code: '261551', system: 'RxNorm', name: 'Insulin glargine', newStart: true, isInsulin: true, prescribedDate: dischargeDate, pickedUp, pickupDate: pickedUp ? addDays(dischargeDate, index % 4 === 3 ? 5 : 2) : null },
    { id: `${id}-M02`, code: '6809', system: 'RxNorm', name: 'Metformin', newStart: false, isInsulin: false, prescribedDate: dischargeDate, pickedUp: true, pickupDate: addDays(dischargeDate, 1) },
  ];
  const status = anchor ? 'no-show' : ['completed', 'no-show', 'cancelled', 'scheduled', 'completed'][index % 5];
  patient.appointments = [{ id: `${id}-V01`, clinic: 'Endocrinology', date: addDays(dischargeDate, anchor ? 10 : index % 5 === 4 ? 18 : 10), status }];
  patient.emergencyVisits = anchor || index % 9 === 0 && daysSince > 21 ? [{ id: `${id}-E01`, date: addDays(dischargeDate, anchor ? 15 : 21), reason: 'Hyperglycemia' }] : [];
  const types = anchor ? ['transportation'] : patterns[index % patterns.length];
  const hard = types.length ? null : hardCases[(index % patterns.length) - 7];
  const count = anchor ? 5 : 3 + index % 3;
  const noteIndices = count === 3 ? [0, 3, 4] : count === 4 ? [0, 2, 3, 4] : [0, 1, 2, 3, 4];
  const texts = [
    'Pt resting comfortably. Bedside review of discharge instructions completed.',
    'Glucose trend improved. Discharge medication list reviewed on rounds.',
    'Home situation reviewed. Follow-up contact number confirmed.',
    'Follow up with endocrinology in 1 to 2 weeks. New start: insulin glargine 10 units nightly.',
    'Reached pt 48 hours after discharge. Reviewed follow-up appointment and warning signs.',
  ];
  const expectedByNote = new Map();
  types.forEach((type, typeIndex) => {
    let target = type === 'transportation' ? 0 : type === 'cost' ? 4 : type === 'food' ? 2 : 0;
    if (!noteIndices.includes(target)) target = 4;
    const sentence = anchor ? sentences.transportation[0] : sentences[type][Math.floor(index / 12) % 3];
    texts[target] += ' ' + sentence;
    expectedByNote.set(target, [...(expectedByNote.get(target) || []), { type, status: 'active' }]);
  });
  if (hard) texts[0] += ' ' + hard.text;
  patient.notes = noteIndices.map((noteIndex, noteNumber) => {
    const days = [-2, -1, -1, 0, 2][noteIndex];
    const note = { id: `${id}-N${String(noteNumber + 1).padStart(2, '0')}`, patientId: id, note_type: NOTE_TYPES[noteIndex], authorRole: roles[noteIndex], date: addDays(dischargeDate, days), daysFromDischarge: days, text: texts[noteIndex] };
    cases.push({ patientId: id, noteId: note.id, note_type: note.note_type, text: note.text, expected: expectedByNote.get(noteIndex) || [], category: hard && noteIndex === 0 ? hard.category : types.length && expectedByNote.has(noteIndex) ? 'current-patient-barrier' : 'routine-note' });
    return note;
  });
  if (types.length) {
    trueBarrierPatients += 1;
    if (!anchor && trueBarrierPatients % 5 === 0) {
      const type = types[0];
      patient.socialNeeds = [{ id: `${id}-Z01`, type, code: BARRIERS[type].zCode, date: addDays(dischargeDate, -1), display: BARRIERS[type].label }];
    }
  }
  return patient;
});

const provenance = { ...sourceProvenance, scenarioVersion: 'hospital-system-2026-10-10-v1', diabetesAdmissions: 150, noteCount: cases.length };
const current = await readFile(new URL('dist/hospital-data.js', root), 'utf8');
const sourceOnly = current.split('\nexport const hospitalPatients = ')[0];
await writeFile(new URL('dist/hospital-data.js', root), sourceOnly + '\nexport const hospitalPatients = ' + JSON.stringify(hospitalPatients) + ';\n');
await writeFile(new URL('ml/hospital-ground-truth.json', root), JSON.stringify({ asOf, description: 'Human-authored expected labels for the new hospital scenarios; never passed into the extractor or delivered as a static browser asset.', provenance, cases }, null, 2) + '\n');
console.log(JSON.stringify({ patients: hospitalPatients.length, diabetesAdmissions: 150, notes: cases.length, trueBarrierPatients, codedSocialNeeds: hospitalPatients.filter(patient => patient.socialNeeds.length).length, sourceFile: fileURLToPath(new URL('dist/hospital-data.js', root)) }));
