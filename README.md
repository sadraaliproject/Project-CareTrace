# Careweave: hospital transitions

**We are a hospital system. We discharged these patients, and we wrote down why some of them will struggle at home.**

Careweave connects a hospital's own admissions, laboratory results, discharge prescriptions, pharmacy pickup records and appointments to its clinical notes. It finds discharged patients who are off track at home, shows the evidence, and prepares a transitions-of-care action for a person to review.

All records are synthetic. The fixed judging date is **October 10, 2026**. There are **1,000 adults discharged in the preceding 90 days**, including **150 diabetes-related admissions**. Patient identities come from the public Synthea sample; the hospital admission scenarios, dates, notes and operational records are purpose-built synthetic fixtures. The source manifest records the exact inputs and transformations.

The core question is:

> Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?

The answer is an exact database count with a source path for every patient. The graph connects what happened to why it may have happened. A note search can retrieve passages; the database joins them to discharge dates, missed visits and prescriptions that were not picked up.

## Run locally

Requires **Node.js 24 or newer** and npm.

```sh
npm install
npm start
```

Open [http://localhost:4173](http://localhost:4173). The local server uses Node's built-in SQLite database. Its first database request loads the synthetic hospital dataset. Later runs retain notes, reviewed tasks and saved analyses. The hosted build uses the same API with a D1 database.

[GitHub repository](https://github.com/sadraaliproject/Hackathon-26). Open `Careweave.code-workspace` in Visual Studio Code and press **F5** to start the debugger. The configured tasks also run tests, syntax checks, model training and builds.

### Optional live OpenAI agent

Copy `.env.example` to `.env` if needed and set the key locally:

```dotenv
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=4173
```

Restart the server. The key stays on the backend and is ignored by Git. Hosted secrets are configured separately; a local `.env` does not configure the hosted app.

Without a key, a labeled deterministic planner executes the same supported hospital questions against SQL. With a key, the OpenAI Responses agent investigates through constrained graph tools. A configured label does not prove a successful model call: run a complete live question with the intended key before judging. The automatic suite uses mocked model responses for this path.

## Two source layers

**Hospital data store:** admissions and discharges, problem list, admission A1c and inpatient glucose, discharge medications, our outpatient pharmacy pickup records, follow-up appointments, return emergency department visits, and coded social needs.

**Clinical notes:** bedside nursing note; physician progress note; social work and case management note; discharge summary; post-discharge nurse call note. Each diabetes-related admission has three to five notes. Every excerpt retains its note ID, author role, note type and timing relative to discharge. Patient portal messages are outside this pilot.

Roughly one in five patients with a true barrier has a coded social need. For the others, the agent needs to inspect the notes. The seeded extraction labels are stored separately in `ml/hospital-ground-truth.json`; they are supplied to evaluation, never to the extractor or language model.

## What the rules mean

A **diabetes-related admission** is DKA, hyperosmolar hyperglycemic state, severe hypoglycemia, diabetic foot infection, or another admission where insulin was newly started and admission A1c was above 9%.

A **FollowUpGap** is evaluated only once a patient is at least 14 days past a diabetes-related discharge. It is open if either of these is true:

- No completed follow-up visit within 14 days of discharge, including no appointment, a no-show or a cancellation.
- A newly started discharge medication was not picked up within three days of discharge.

The stored gap records its reasons. A day-three pickup satisfies the pickup window; a later pickup does not erase the fact that the window was missed.

**LIKELY_TO_RETURN** is a separate inferred relationship from patient to admission. It requires all four facts: admission A1c above 9%, no completed follow-up visit, new insulin not picked up, and at least one current reported barrier. These are simplified hackathon rules, **not a validated readmission risk model**. The app does not predict a probability or prove the effect of an action.

## Four barriers and the standard call group

| Documented barrier | Behavior it blocks | Hospital action | Owning role |
| --- | --- | --- | --- |
| Transportation, Z59.82 | Attending follow-up | Book hospital patient transport and offer a video visit | Care transitions nurse |
| Cost, Z59.86 | Starting discharge insulin | Review a lower-cost formulation, deliver the first fill to bedside or home, and refer to financial counseling | Outpatient pharmacist |
| Food insecurity, Z59.41 | Eating regularly and taking insulin safely | Dietitian consult and hospital food pharmacy or medically tailored meal referral | Social worker and dietitian |
| Health literacy, Z55.6 | Checking glucose and dosing correctly | Teach-back session, simplified one-page insulin instructions and a 48-hour call | Diabetes educator |
| No documented barrier | Completing follow-up | Standard discharge call and rescheduled visit | Care transitions team |

The last row is a separate group. It means the current records do not document a barrier; it does not establish that no barrier exists. Actions are proposed tasks for review. Approving a task persists a review state and sends nothing.

## Graph and agent architecture

The graph has ten node types: `Patient`, `Admission`, `Condition`, `LabResult`, `Medication`, `Appointment`, `FollowUpGap`, `ClinicalNote`, `Barrier`, and `Action`.

Its nine base relationships are `HAD_ADMISSION`, `HAS_CONDITION`, `HAS_RESULT`, `PRESCRIBED_AT_DISCHARGE`, `HAS_APPOINTMENT`, `HAS_NOTE`, `HAS_GAP`, `REPORTED_BARRIER`, and `ADDRESSED_BY`. `LIKELY_TO_RETURN` is the additional inferred relationship. Barrier relationships retain the exact evidence, source ID, confidence and `note_type`.

The planned reasoning route is **Patient → Admission → FollowUpGap → Barrier → Action**. Those are stages of investigation, not a claim that every adjacent pair has a direct stored relationship: clinical facts and the gap are linked to their patient, as specified by the ontology. The canvas shows the real patient relationships and never more than 50 nodes.

The implementation retains the loader, extractor, typed graph, agent and canvas architecture. The browser uses vanilla JavaScript and Cytoscape. Nodes and relationships are stored in SQLite locally or D1 when hosted. This is a SQL-backed property graph. Exact counts come from bound SQL queries.

Graph tools reject unsupported relationships and paths. The agent has a 12-hop per-patient limit, and saved event streams can be replayed. Live UI steps are paced for readability. A saved run is historical evidence of an earlier execution; it cannot authorize new work against changed source data.

## Judge extensions

**Proof challenge** runs the actual extractor against difficult sentences, executes the SQL question three times and verifies source ownership and exact excerpts. It reports precision and recall against the regenerated hospital seed. Judges can submit their own fictional sentence to preview the result. A custom sentence has no predefined expected answer.

**Impact Studio** compares two deterministic ways to use a limited hospital support budget and staff capacity. Each proposed allocation links to evidence. The costs are illustrative, the plan is hypothetical, and greater support coverage can leave higher-priority patients waiting. It does not predict clinical outcomes or automatically change records.

Adding a later synthetic note updates current barriers and the graph. Any draft whose evidence changed requires review. That is useful for demonstrating why source provenance matters after the initial answer.

## API and verification

The shared API exposes status, initialization, patients, graph inspection, source retrieval, questions, search, extraction, evaluation, simulation, reviewed tasks and saved runs. Main routes:

| Route | Purpose |
| --- | --- |
| `GET /api/status` | Storage and model configuration, synthetic snapshot |
| `GET /api/bootstrap` | Current patients, counts, ontology, tasks and runs |
| `GET /api/seed`, `POST /api/seed` | Initialization progress and idempotent batches |
| `POST /api/search` | Passages from the same clinical notes without a SQL cohort count |
| `POST /api/query` | Supported deterministic plan and exact SQL result |
| `POST /api/agent` | Bounded graph investigation; optional streamed events |
| `GET /api/graph` | Ontology, patient or cohort graph; the interface requests at most 50 nodes |
| `GET /api/graph/expand/:id` | Validated one-hop graph inspection |
| `GET /api/documents/:id` | Authoritative clinical note or coded source row |
| `POST /api/patients/:id/documents` | Add a dated note explicitly marked synthetic |
| `POST /api/extract` | Context extraction and optional model preview |
| `GET /api/ml/metrics` | Local classifier evaluation and separate extraction metrics |
| `POST /api/proof` | Adversarial checks, three SQL executions and source verification |
| `POST /api/simulate` | Read-only resource comparison |
| `GET`, `POST`, `PATCH /api/tasks` | Versioned human-review workflow; item ID required for updates |
| `GET /api/runs`, `GET /api/runs/:id` | Historical analyses and replayable events |
| `GET /api/export` | Current synthetic records and a bounded graph export |

```sh
npm run check
npm test
npm run build
node scripts/verify-worker.js
```

The checks include hospital wording, extraction hard cases, date boundaries, source ownership, exact count repeatability, concurrent writes, task review, and the actual bundled Worker. Worker verification enables foreign keys, limits a request to 50 SQL statements and a statement to 100 bound parameters, injects a database failure, and checks atomic rollback and safe seed retries. Live hosting and an actual OpenAI call require separate verification.

`npm run export-data` writes the reproducible baseline records, ontology, graph and evaluation under `exports/`. It also executes the deterministic investigation against a fresh in-memory database and saves its real SQL trace and `replay-events.json`. These exports do not include later database edits. To reset a local rehearsal, stop the server first, then use `npm run demo:reset -- --confirm`; the script archives the database before the next start seeds a fresh one. It does not reset the hosted database.

Read [DEMO.md](./DEMO.md) for the three-minute judging script, open [the closing slide](./docs/judges-closing.html) in a browser, and see [CHANGELOG_HOSPITAL.md](./CHANGELOG_HOSPITAL.md) for the file-by-file change record and limitations.

The [60-second backup walkthrough](./docs/hospital-demo-walkthrough.mp4) presents eight actual captured UI states, held for 7.5 seconds each. It is a silent recorded-state walkthrough of the local deterministic execution with synthetic data, **not a continuous screen recording or a live OpenAI session**. That disclosure appears throughout the video. The [capture manifest](./docs/video-manifest.json) records the captions, source filenames and durations. To make a new version, rehearse the same states in the current app, capture them and assemble the listed sequence; the video is an explanation of observed states, not evidence of real-time model performance.

## Prototype boundaries

Use synthetic records only. This demonstration has no clinical validation, production access controls, live hospital integration, or connected scheduling and communication services. It does not diagnose, prescribe, send a message, book transport or modify an electronic health record. Production use would require clinical evaluation, approved integrations, data governance and security controls.
