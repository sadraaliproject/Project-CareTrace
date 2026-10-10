/** Reproducible hospital scenarios and an isolated author answer key. */
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { sourcePatients, sourceProvenance } from '../dist/hospital-data.js';
import { BARRIERS, NOTE_TYPES } from '../dist/ontology.js';

export const AS_OF = '2026-10-10';
const DAY = 86400000;
const readerDigest = '62159925fbc35cd871ad0de4a5beafd8ae8770725e6599c3df0f0c3e2582fb6f';
const datePlus = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const atTime = (date, hour, minute = 0) => `${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-04:00`;

// Eight independent clinical phrasings per type are adapted to five documentation contexts.
// This catalog belongs to the authoring pipeline; the reader never imports it.
const wording = {
  transportation: [
    'pt has no reliable ride to the Endocrinology Clinic visit',
    'daughter works days and is the only way to clinic appts',
    'pt describes two bus transfers to reach the follow-up clinic',
    'the family vehicle is broken down and pt cannot reach the clinic',
    'the bus stopped running on the route to Primary Care West',
    'the clinic is beyond walking distance with the current knee brace',
    'the planned ride fell through for the follow-up appointment',
    'pt has no driver available for the hospital appointment',
  ],
  cost: [
    'pt cannot afford the new insulin glargine prescription',
    'pt asked for medication samples and has not collected the last script',
    'pt is rationing glucose strips to make them last',
    'rent was paid instead of the new insulin prescription',
    'the $72 copay led pt to leave the pens at the pharmacy',
    'pt is waiting until payday to obtain insulin',
    'only four pen needles remain for the next ten nights',
    'glargine is too expensive and pt has delayed starting it',
  ],
  food: [
    'pt reports cupboards are bare by the 20th of each month',
    'pt eats one meal most days at home',
    'the last bag of rice is being stretched until Friday',
    'pt skips dinner when the groceries run out',
    'the pantry is empty and pt took insulin without breakfast',
    'pt reports only tea and toast for supper most days',
    'a neighbour brings a plate on Sundays; other evenings vary',
    'there is not enough food at home to eat regularly with insulin',
  ],
  health_literacy: [
    'pt could not state when to take glargine during teach-back',
    'pt asked RN to read the insulin instructions aloud',
    'pt reversed the morning and night doses on the written sheet',
    'pt guessed the pen setting instead of reading the dose numbers',
    'pt could not demonstrate the glucose meter steps',
    'pt is confused by the dosing schedule and needs pictures',
    'pt points to the sun symbol for both injections',
    'pt does not understand how the glucose numbers relate to the insulin schedule',
  ],
};
const noteFrames = [
  phrase => `At the bedside, ${phrase}.`,
  phrase => `On rounds, ${phrase}; the discharge plan requires follow-up.`,
  phrase => `During the resource review, ${phrase}.`,
  phrase => `At discharge review, ${phrase}; this remains an open item.`,
  phrase => `On the 48-hour call, ${phrase}.`,
];
export const wordingCatalog = Object.fromEntries(Object.entries(wording).map(([type, phrases]) => [type, Object.fromEntries(NOTE_TYPES.map((name, index) => [name, phrases.map(noteFrames[index])]))]));

const hardCases = {
  negation: [
    'Denies transportation concerns; wife drives to appointments.',
    'Pt reports no difficulty paying for insulin at the pharmacy.',
    'Denies running out of groceries or skipping meals at home.',
    'Pt independently demonstrated the glucose meter steps without difficulty.',
    'Pt denies needing a ride to Primary Care West.',
    'Pt has reliable transportation and no concerns about the clinic visit.',
    'Pt reports no current problem paying the insulin copay.',
    'Pt denies confusion about the insulin dosing schedule.',
  ],
  resolved: [
    'Transport arranged by SW prior to discharge; no ride remains outstanding.',
    'Medication assistance approved and insulin already delivered before discharge.',
    'Food pharmacy parcel already delivered and the kitchen is now stocked.',
    'Pt now correctly explains the insulin schedule after a second teaching session.',
    'The ride was secured before discharge by case management.',
    'Pt can now afford glargine with assistance in place.',
    'Pt now has groceries available for regular meals with insulin.',
    'Pt successfully demonstrated glucose meter use without prompting.',
  ],
  third_party: [
    "Pt's brother lost his job and cannot afford his own medications.",
    "Pt's sister has no reliable ride to her own clinic appointment.",
    "Pt's cousin is skipping his meals after losing access to his kitchen.",
    "Pt's mother is confused by her own insulin dosing schedule.",
    "Her brother reports rationing his own glucose strips.",
    "His sister cannot reach her own follow-up clinic because her car broke down.",
    "Her neighbour reports empty cupboards in her own home.",
    "His father could not state his own glargine schedule during a recent call.",
  ],
  clinical: [
    'NPO after midnight; meals held for procedure.',
    'Breakfast was held for a procedure and pt received the planned IV fluids.',
    'Pt is fasting for abdominal imaging; usual meals resume afterward.',
    'Nil by mouth for surgery; this is not a home meal issue.',
    'Dinner held for a procedure after the surgical team review.',
    'Bowel prep requires skipping solid meals tonight under the inpatient orders.',
    'Procedure-related fasting explains the missed breakfast.',
    'NPO status continues overnight with scheduled glucose checks.',
  ],
  historical: [
    'Previously had trouble affording strips, now has assistance in place.',
    'Last year the car was unavailable, but pt now has a reliable ride.',
    'In the past pt skipped meals; groceries are now available every week.',
    'During a prior admission pt was confused by insulin instructions.',
    'Earlier this year the insulin copay was too expensive; that episode ended.',
    'Pt used to have no ride to the clinic before moving closer to family.',
    'Historically the pantry was empty near month end, before the current housing arrangement.',
    'Previously pt could not demonstrate meter use; no current difficulty is reported.',
  ],
  contextual: [
    "Discussed her sister's recent admission. She cannot afford the new insulin prescription. Pt confirms her own medications are available at home.",
    'Reviewed an old quote in the admission packet: pt has no reliable ride to the clinic. Pt explains that the quote described last winter; the current trip is arranged.',
    'Patient education card lists reasons people may miss treatment. Unable to pay for insulin is one example. Pt reports medications are already at home.',
    'Pt described the recovery plan for a cousin living elsewhere. The pantry is empty and meals are being skipped in that home. Pt confirms groceries are available in the current residence.',
    'Discussed hypothetical loss of wages during recovery. Paying for glargine could become difficult if leave is extended. Pt has medication in hand for the current course.',
    'The printed teaching example says a person could be confused by an insulin dosing schedule. Pt accurately repeated the actual schedule and corrected the example.',
    'Family discussed the previous home before moving. There was no bus route to the clinic from that address. A direct route serves the current address.',
    'Pt explains that the neighbour occasionally asks for help reading labels. Pt reads the current glargine label correctly and demonstrates the documented schedule.',
  ],
};

const ROLES = ['Inpatient nurse', 'Hospitalist', 'Social worker', 'Discharging physician', 'Care transitions nurse'];
const INITIALS = ['AM', 'JT', 'RK', 'SL', 'DN', 'CP', 'EW', 'BG'];
const UNITS = ['4 West Medical', '5 East Step-Down', '3 South Medicine'];
const PHYSICIANS = ['Dr. Morgan Chen', 'Dr. Amara Patel', 'Dr. Jordan Rivera', 'Dr. Avery Thomas'];
const primaryTypes = [
  ...Array(8).fill('transportation'), ...Array(10).fill('cost'),
  ...Array(5).fill('food'), ...Array(4).fill('health_literacy'),
];
const secondTypes = new Map([[8, 'transportation'], [18, 'cost'], [23, 'food'], [16, 'health_literacy']]);
const plainMiddle = [
  'Reviewed the discharge medication list with pt and documented the preferred pharmacy.',
  'Morning glucose reviewed with the team; no new symptoms reported.',
  'Pt identifies Primary Care West as the preferred follow-up site.',
  'Discharge medication list reconciled with the inpatient orders.',
  'Pt confirms the contact number in the discharge packet remains correct.',
];
const noteOpening = [
  'Pt awake, conversant, resting in chair after morning observations.',
  'Afebrile overnight, breathing comfortably on room air.',
  'Met with pt to review practical needs after the hospital stay.',
  'Clinically stable for discharge home after treatment of hyperglycemia.',
  'Reached pt at the documented home number; identity confirmed.',
];
const noteClosing = [
  'Call light in reach; bedside handover completed.',
  'Continue the documented discharge plan and follow-up arrangements.',
  'Contact preferences documented for the care transitions team.',
  'Return precautions reviewed; printed medication list accompanies pt.',
  'Callback number repeated and pt agrees to the next scheduled check-in.',
];

export function generatePilot() {
  const noteLabels = [];
  const patientLabels = [];
  const phraseUse = new Map();
  const hardEntries = Object.entries(hardCases).flatMap(([category, phrases]) => phrases.map(text => ({ category, text })));
  const rawPatients = sourcePatients.map((identity, index) => {
    const id = `P${String(index + 1).padStart(4, '0')}`;
    const diabetes = index < 150;
    const gap = index < 60;
    const trueTypes = index < 27 ? [primaryTypes[index], ...(secondTypes.has(index) ? [secondTypes.get(index)] : [])] : [];
    const days = index < 3 ? 14 + index * 2 : gap ? index < 19 ? 14 + index % 16 : 31 + index % 57 : 7 + index * 17 % 83;
    const dischargeDate = datePlus(AS_OF, -days);
    const admitDate = datePlus(dischargeDate, -3 - index % 3);
    const principalDiagnosis = diabetes ? index < 3 || index % 4 === 0 ? 'Diabetic ketoacidosis' : 'Type 2 diabetes with hyperglycemia' : ['Pneumonia', 'Acute appendicitis', 'Dehydration', 'Hip fracture'][index % 4];
    const unit = UNITS[index % UNITS.length];
    const physician = PHYSICIANS[index % PHYSICIANS.length];
    const admission = {
      id: `${id}-A01`, admitDate, dischargeDate, diabetesRelated: diabetes, principalDiagnosis,
      unit, disposition: 'Home', hospital: ['North Hospital', 'Riverside Hospital', 'Central Hospital'][index % 3],
      dischargingPhysician: physician, admit_datetime: atTime(admitDate, 9 + index % 5, 12),
      discharge_datetime: atTime(dischargeDate, 15, 30), principal_diagnosis: principalDiagnosis,
      discharging_physician: physician,
    };
    const patient = {
      ...identity, id, admission, notes: [], socialNeeds: [], labs: [], medications: [], appointments: [], emergencyVisits: [],
      condition: { id: `${id}-C01`, code: diabetes ? principalDiagnosis === 'Diabetic ketoacidosis' ? '420422005' : '237599002' : ['233604007', '74400008', '34095006', '359817006'][index % 4], display: principalDiagnosis, system: 'SNOMED CT' },
    };
    if (!diabetes) return patient;
    const a1c = index < 3 ? 10.2 + index * .4 : Math.round((7.2 + index % 20 * .21) * 10) / 10;
    patient.labs = [
      { id: `${id}-L01`, code: '4548-4', name: 'Admission HbA1c', value: a1c, unit: '%', date: admitDate },
      { id: `${id}-L02`, code: '2339-0', name: 'Inpatient glucose', value: 156 + index % 180, unit: 'mg/dL', date: admitDate },
    ];
    patient.medications = [
      { id: `${id}-M01`, code: '261551', system: 'RxNorm', name: 'Insulin glargine', newStart: true, isInsulin: true, prescribedDate: dischargeDate, pickedUp: !gap, pickupDate: gap ? null : datePlus(dischargeDate, 1) },
      { id: `${id}-M02`, code: '6809', system: 'RxNorm', name: 'Metformin', newStart: false, isInsulin: false, prescribedDate: dischargeDate, pickedUp: true, pickupDate: datePlus(dischargeDate, 1) },
    ];
    patient.appointments = [{ id: `${id}-V01`, clinic: index % 2 ? 'Primary Care West' : 'Endocrinology Clinic', date: datePlus(dischargeDate, gap ? 10 : 5), status: gap ? 'no_show' : 'completed' }];
    if (gap && index % 10 === 4) patient.emergencyVisits.push({ id: `${id}-ED01`, date: datePlus(dischargeDate, 12), reason: 'Symptomatic hyperglycemia after missed follow-up', disposition: 'Discharged home' });
    if ([5, 10, 15, 20, 25].includes(index)) {
      const type = trueTypes[0];
      patient.socialNeeds.push({ id: `${id}-Z01`, type, code: BARRIERS[type].zCode, display: BARRIERS[type].label, date: dischargeDate, resolved: false });
    }
    const noteIndexes = index % 3 === 0 ? [0, 1, 2, 3, 4] : index % 3 === 1 ? [0, 3, 4] : [0, index % 2 ? 1 : 2, 3, 4];
    for (let n = 0; n < noteIndexes.length; n++) {
      const kind = noteIndexes[n];
      const typeName = NOTE_TYPES[kind];
      const dayOffset = kind === 4 ? 2 : kind === 3 ? 0 : -2 + (kind === 2 ? 1 : 0);
      const date = datePlus(dischargeDate, dayOffset);
      const pre = index < 19;
      const hasActive = trueTypes.length && (pre ? n === 0 || n === 1 && kind !== 3 || kind === 4 && index % 3 === 0 : kind === 4);
      const activeTypes = hasActive ? trueTypes : [];
      const middles = activeTypes.map(type => {
        const key = `${type}:${kind}`;
        const used = phraseUse.get(key) || 0;
        phraseUse.set(key, used + 1);
        const sentence = wordingCatalog[type][typeName][used % 8];
        // A bounded location detail preserves exact sentence uniqueness after eight uses.
        return used < 8 ? sentence : sentence.replace(/\.$/, `; discussed at the ${['morning', 'afternoon', 'evening'][index % 3]} review on ${date}.`);
      });
      const hard = index >= 60 && index < 60 + hardEntries.length && n === 0 ? hardEntries[index - 60] : null;
      const middle = middles.length ? middles : [hard?.text || plainMiddle[kind]];
      const noteId = `${id}-N${String(n + 1).padStart(2, '0')}`;
      const writtenDatetime = atTime(date, kind === 3 ? 13 : kind === 4 ? 11 : 8 + kind, (index * 7 + n * 11) % 60);
      const actionRecorded = activeTypes.length > 0 && index % 6 === 5;
      const note = {
        id: noteId, patientId: id, admissionId: admission.id, note_type: typeName,
        author_role: ROLES[kind], author_initials: INITIALS[(index + kind) % INITIALS.length],
        authorRole: ROLES[kind], authorInitials: INITIALS[(index + kind) % INITIALS.length],
        unit: kind === 4 ? 'Care Transitions Office' : unit, written_datetime: writtenDatetime,
        writtenDatetime, date, daysFromDischarge: dayOffset,
        action_recorded: actionRecorded, actionRecorded,
        text: [noteOpening[kind], ...middle, actionRecorded ? 'Care transitions task prepared for review; no contact has been made.' : noteClosing[kind], 'Note signed electronically.'].join(' '),
      };
      patient.notes.push(note);
      noteLabels.push({ noteId, patientId: id, expectedActiveTypes: [...activeTypes], category: hard?.category || (activeTypes.length ? 'active' : 'routine'), evidenceSentences: middles });
    }
    patientLabels.push({ patientId: id, trueBarrierTypes: [...trueTypes], openFollowUpGap: gap });
    return patient;
  });
  const provenance = {
    ...sourceProvenance, asOf: AS_OF, scenarioSeed: 20261010, readerVersion: '2026-10-10.1',
    adaptation: 'Synthetic source demographics and active problems are imported. Admissions, clinical events, dates and notes are authored hospital scenarios. Patient counts are computed from these records.',
    frozenReaderSha256: readerDigest,
    evaluationSetVersion: '2026-10-10.2',
    evaluationHistory: 'Initial 600-note measurement: 49 true positives, 0 false positives, 5 false negatives. Eight contextual notes then added to cover cross-sentence references, educational examples and corrected old quotations. Reader unchanged; updated scores are computed separately.',
  };
  return { rawPatients, noteLabels, patientLabels, provenance };
}

async function writePilot() {
  const readerText = (await readFile(new URL('../dist/pilot-reader.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const digest = createHash('sha256').update(readerText).digest('hex');
  if (digest !== readerDigest) throw new Error('The frozen reader changed. Review and document the change before regenerating the evaluation data.');
  const { rawPatients, noteLabels, patientLabels, provenance } = generatePilot();
  const header = '/** Generated by scripts/generate-pilot-data.js. All patient identities and events are synthetic. */\n';
  await writeFile(new URL('../dist/pilot-data.js', import.meta.url), `${header}export const AS_OF = ${JSON.stringify(AS_OF)};\nexport const provenance = ${JSON.stringify(provenance)};\nexport const rawPatients = ${JSON.stringify(rawPatients, null, 2)};\n`);
  await writeFile(new URL('../dist/pilot-labels.js', import.meta.url), `/** Author answer key; imported only by evaluation, never by the reader or graph builder. */\nexport const readerFreeze = ${JSON.stringify({ version: provenance.readerVersion, sha256: readerDigest, phase: 'Frozen before first labeled evaluation' })};\nexport const noteLabels = ${JSON.stringify(noteLabels, null, 2)};\nexport const patientLabels = ${JSON.stringify(patientLabels, null, 2)};\n`);
  console.log(`Generated ${rawPatients.length} synthetic discharges and ${noteLabels.length} labeled notes.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await writePilot();
