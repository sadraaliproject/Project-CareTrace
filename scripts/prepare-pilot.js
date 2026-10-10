import { mkdir, writeFile } from "node:fs/promises";
import { rawPatients } from "../dist/pilot-data.js";
import { readNote } from "../dist/pilot-reader.js";
import { createPilotGraph } from "../dist/pilot-engine.js";
import { noteLabels } from "../dist/pilot-labels.js";
import { ontology } from "../dist/ontology.js";

const hop = (from, edge, to, thought) => ({ from, edge, to, thought });
const admissions = hop(
  "Patient",
  "HAD_ADMISSION",
  "Admission",
  "Start with the discharge record so the time window and hospital unit are explicit.",
);
const condition = hop(
  "Patient",
  "HAS_CONDITION",
  "Condition",
  "Confirm that this admission was related to diabetes.",
);
const gaps = hop(
  "Patient",
  "HAS_GAP",
  "FollowUpGap",
  "Check the dated follow-up rule; a concerning note alone does not establish a missed step.",
);
const appointments = hop(
  "Patient",
  "HAS_APPOINTMENT",
  "Appointment",
  "Read the appointment row to separate a scheduled visit from a completed or missed visit.",
);
const medication = hop(
  "Patient",
  "PRESCRIBED_AT_DISCHARGE",
  "Medication",
  "Join the new discharge medicine to its dated pharmacy pickup record.",
);
const labs = hop(
  "Patient",
  "HAS_RESULT",
  "LabResult",
  "Read the admission A1c value before applying the review-priority rule.",
);
const notes = hop(
  "Patient",
  "HAS_NOTE",
  "ClinicalNote",
  "Read the original note and keep the exact sentence, author, time and character span.",
);
const barrier = hop(
  "Patient",
  "REPORTED_BARRIER",
  "Barrier",
  "First inspect the coded need. If no row exists, follow the note-derived evidence and distinguish current from resolved language.",
);
const action = hop(
  "Barrier",
  "ADDRESSED_BY",
  "Action",
  "Map each current barrier to a hospital-owned action and accountable role.",
);
const inferred = hop(
  "Patient",
  "LIKELY_TO_RETURN",
  "Admission",
  "Apply the stated review-priority rule to observed facts; this is not a validated prediction.",
);
const definitions = [
  [
    "main",
    "Who needs help?",
    "Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?",
    "patients",
    [
      admissions,
      condition,
      appointments,
      medication,
      gaps,
      barrier,
      notes,
      action,
    ],
    "help action diabetes barriers",
  ],
  [
    "cost",
    "Insulin and cost",
    "Which patients report a cost barrier and never picked up their discharge insulin?",
    "patients",
    [admissions, medication, barrier, notes, action],
    "cost afford insulin money pickup",
  ],
  [
    "return-risk",
    "Return review",
    "Who is likely to return?",
    "patients",
    [
      admissions,
      labs,
      appointments,
      medication,
      barrier,
      notes,
      inferred,
      action,
    ],
    "return risk review",
  ],
  [
    "units",
    "Hospital units",
    "Which unit discharged the most patients with an unaddressed barrier?",
    "units",
    [admissions, barrier],
    "units wards rank hospital",
  ],
  [
    "before-discharge",
    "Known before discharge",
    "Which barriers were documented before discharge with no action recorded, grouped by note type?",
    "noteTypes",
    [admissions, barrier, notes, action],
    "before discharge earlier unaddressed note types",
  ],
  [
    "ed-returns",
    "Emergency returns",
    "Who returned to the emergency department after a missed follow-up, and how many days later?",
    "returns",
    [admissions, appointments, gaps],
    "emergency ED return after missed visit",
  ],
  [
    "transportation",
    "Getting to the visit",
    "Which patients with an open follow-up gap need transportation help?",
    "patients",
    [admissions, gaps, appointments, barrier, notes, action],
    "transportation transport ride bus visit",
  ],
  [
    "food",
    "Food and safe recovery",
    "Which patients with an open follow-up gap have a current food barrier?",
    "patients",
    [admissions, gaps, barrier, notes, action],
    "food meals groceries hungry",
  ],
  [
    "health-literacy",
    "Understanding instructions",
    "Which patients with an open follow-up gap need help understanding their diabetes instructions?",
    "patients",
    [admissions, gaps, medication, barrier, notes, action],
    "literacy understand instructions dosing dose",
  ],
  [
    "dual",
    "Two barriers",
    "Which patients with an open follow-up gap have two current barriers, and which action comes first?",
    "patients",
    [admissions, gaps, appointments, medication, barrier, notes, action],
    "dual two multiple first primary",
  ],
  [
    "within30",
    "Still within 30 days",
    "Which patients with an open gap and a current barrier are still within the first 30 days after discharge?",
    "patients",
    [admissions, gaps, barrier, notes, action],
    "30 days window remaining",
  ],
  [
    "standard",
    "Standard follow-up",
    "Which patients have an open follow-up gap but no current documented barrier?",
    "patients",
    [admissions, gaps, barrier, notes],
    "standard routine no barrier",
  ],
  [
    "uncoded",
    "Hidden in notes",
    "Which patients with an open gap have a barrier documented in notes but no coded social need?",
    "patients",
    [admissions, gaps, barrier, notes, action],
    "uncoded hidden notes tables code",
  ],
  [
    "no-pickup",
    "Medicine not collected",
    "Which diabetes patients have not picked up a newly started discharge medication?",
    "patients",
    [admissions, condition, medication],
    "medication pickup collected new medicine",
  ],
  [
    "all",
    "All discharges",
    "Show all hospital discharges in the last 90 days.",
    "patients",
    [admissions],
    "all discharges hospital 90 days",
  ],
];
const plans = definitions.map(
  ([id, label, question, shape, route, keywords]) => ({
    id,
    label,
    question,
    shape,
    filters: { id },
    route,
    keywords,
  }),
);
for (const plan of plans)
  for (const step of plan.route)
    if (
      !ontology.paths.some(
        (path) => path.join("|") === [step.from, step.edge, step.to].join("|"),
      )
    )
      throw new Error(`Undeclared route ${plan.id}`);
const explanations = Object.fromEntries(
  plans.map((plan) => [
    plan.id,
    {
      summary:
        plan.shape === "units"
          ? "{count} patients are grouped by their discharging unit."
          : plan.shape === "noteTypes"
            ? "{count} patients had an earlier documented barrier without a recorded action."
            : plan.shape === "returns"
              ? "{count} patients returned after a missed follow-up."
              : "{count} patients match this question.",
      evidence:
        "Every displayed patient and count comes from the current graph. Select a patient to inspect the dated evidence.",
      primary: "{barrier} is the first action because {reason}",
      action: "{owner}: {action}",
    },
  ]),
);
const graph = createPilotGraph(rawPatients);
const noteMap = new Map(
  rawPatients.flatMap((patient) =>
    patient.notes.map((note) => [note.id, { ...note, patientId: patient.id }]),
  ),
);
const featured = graph.patients.find(
  (patient) => patient.id === graph.featuredId,
);
const noteId = featured.barriers.find(
  (b) => b.type === "transportation",
)?.note_id;
const selected = [
  {
    noteId,
    kind: "featured",
    label: "A current problem hidden in the bedside note",
  },
];
for (const [category, label] of [
  ["negation", "The patient says the problem is absent"],
  ["resolved", "The problem has already ended"],
  ["third_party", "The note describes someone else"],
]) {
  const labelRow = noteLabels.find((row) => row.category === category);
  if (labelRow)
    selected.push({ noteId: labelRow.noteId, kind: category, label });
}
const reading = selected.map((item) => {
  const note = noteMap.get(item.noteId);
  if (!note) throw new Error(`Prepared note missing: ${item.noteId}`);
  return { ...item, patientId: note.patientId, note, ...readNote(note) };
});
await mkdir("dist/prepared", { recursive: true });
for (const [name, value] of Object.entries({ plans, explanations, reading }))
  await writeFile(
    `dist/prepared/${name}.json`,
    JSON.stringify(value, null, 2) + "\n",
  );
console.log(
  `Prepared ${plans.length} ontology-valid routes and ${reading.length} actual note readings. No patient counts stored in plans or explanations.`,
);
