# Hospital system change record

This change rebuilds the pilot around the hospital's own discharged patients and source records. It retains the loader, extractor, graph, agent, canvas and review workflow. The earlier synthetic snapshot is replaced rather than relabeled.

## File-by-file changes

| File | Change |
| --- | --- |
| `dist/ontology.js` | Defines the ten hospital node types, nine base relationships, additional inferred relationship, five note types, and four hospital actions with owning roles. |
| `dist/hospital-data.js` | Stores the selected Synthea identities and transformed hospital scenarios, with source provenance. |
| `scripts/import-hospital-source.py` | Downloads the official Synthea sample, reads only explicitly selected fields, selects 1,000 living adults, and records the archive digest. |
| `scripts/generate-hospital-data.js` | Generates the index admissions, 150 diabetes-related admission scenarios, hospital tables, three to five notes per relevant admission, hard sentences and separate expected labels. |
| `ml/hospital-ground-truth.json` | Stores expected extraction labels separately from the extractor, including negation, resolution, family-only statements, historical barriers and clinical look-alikes. |
| `dist/engine.js` | Implements hospital date-window rules, current barrier extraction, hospital question planning, graph creation, exact in-memory reference results and drafts. |
| `backend/schema.sql` | Defines the hospital source tables and the persistent graph, assertions and workflow tables for SQLite. |
| `db/schema.js` | Mirrors the hospital database definition for migration tooling. |
| `backend/sqlite.js` | Initializes native SQLite with foreign keys and atomic writes and applies the hospital snapshot transition when needed. |
| `backend/d1.js` | Retains the hosted adapter contract with consistent formatting; the same repository runs against D1. |
| `drizzle/0001_hospital_system.sql` | Removes the earlier synthetic schema and creates the hospital source and workflow tables. |
| `drizzle/meta/_journal.json` | Appends the hospital migration after the already applied initial migration. |
| `backend/repository.js` | Persists hospital source layers, executes parameterized counts, retrieves owned evidence, builds source-linked graphs and protects concurrent note and task changes. |
| `planner.js` | Restricts question plans to hospital admission, follow-up, medication pickup and documented barrier predicates. |
| `backend/agent.js` | Investigates the hospital graph, records source visits and rerouting, validates paths and constrains each patient's exploration. |
| `backend/api.js` | Serves the rebuilt hospital workflow and the clinical-note search baseline through the shared local/hosted API. |
| `backend/proof.js` | Runs difficult hospital sentences, three identical SQL executions, patient-specific source checks and the new extraction evaluation. |
| `backend/insights.js` | Uses hospital support actions and current clinical evidence in the optional staff-capacity comparison. |
| `backend/ml.js` | Keeps the learned classifier and optional model preview separate from current graph assertions; uses hospital note context. |
| `ml/corpus.json` | Replaces the classifier examples with synthetic hospital language. |
| `ml/model.json` | Stores the model trained on the regenerated classifier corpus. |
| `ml/evaluation.json` | Stores the corresponding held-out classifier evaluation, separately from seed-based extraction precision and recall. |
| `dist/index.html` | Introduces the hospital system, states the synthetic-data boundary and loads the browser interface. |
| `dist/app.js` | Presents two source layers, baseline search, planned route, patient walk, source evidence, five result groups, exact counts and judge extensions in plain language. |
| `dist/graph.js` | Renders hospital ontology and patient paths, with readable evidence relationships and a 50-node display limit. |
| `dist/styles.css` | Styles the hospital source layers, patient story, readable graph and judge-facing controls. |
| `scripts/build-worker.js` | Packages the additional hospital data and ontology modules with the shared Worker API and frontend. |
| `scripts/check.js` | Checks authored JavaScript and invokes the hospital wording audit. |
| `scripts/audit-language.js` | Scans authored files and filenames, normalizes identifiers and punctuation, and rejects prohibited wording. Dependencies, generated dependency bundles, private state and Git history are outside this source audit. |
| `scripts/verify-worker.js` | Exercises the actual bundled Worker with foreign keys, strict SQL limits, transactional failure injection, seed retries, hospital questions, source checks, simulation and task invalidation. |
| `scripts/export-data.js` | Exports the new baseline hospital records, ontology, graph, query trace and truth-based evaluation. |
| `tests/engine.test.js` | Covers extraction hard cases, temporal rules and hospital graph semantics. |
| `tests/acceptance.test.js` | Tests the three judging questions, fifth group, age constraints and owned source paths. |
| `tests/hospital-contract.test.js` | Independently checks the 1,000-adult/150-admission contract, note types, ontology, P0412 story, three exact SQL runs, evidence ownership and separate truth file. |
| `tests/repository.test.js` | Tests hospital persistence, SQL scope, graph inspection, source updates and review state. |
| `tests/agent.test.js` | Tests constrained tool execution and model failure paths. |
| `tests/api-workflow.test.js` | Tests the shared HTTP hospital workflow. |
| `tests/concurrency.test.js` | Exercises independent repository instances to detect stale source and task writes. |
| `tests/proof.test.js` | Checks real extractor results, repeated SQL answers and proof source validation. |
| `tests/insights.test.js` | Checks budget/capacity bounds, current evidence and reproducible resource allocations. |
| `tests/ml.test.js` | Checks the regenerated learned classifier and constrained extraction preview. |
| `tests/server.test.js` | Checks local server routes, supported hospital plans and model configuration handling. |
| `README.md` | Documents the hospital story, sources, exact rules, architecture, setup, verification and prototype limits. |
| `DEMO.md` | Gives the five timed judging beats, patient story, plain answers and honest recovery paths. |
| `docs/judges-closing.html` | Adds a standalone, printable closing slide with measured baseline counts and seeded precision/recall; answer time is explicitly measured live. |
| `docs/hospital-demo-walkthrough.mp4` | Adds a silent 60-second backup assembled from eight actual captured UI states, with persistent disclosure that it is not a continuous recording or live model session. |
| `docs/video-manifest.json` | Records the backup's source capture filenames, captions, frame durations and execution mode. |
| `CHANGELOG_HOSPITAL.md` | Records the implementation mapping and remaining limitations. |

## Mapping decisions and limits

- The brief lists ten node types and nine base relationships, then specifies `LIKELY_TO_RETURN` separately. The implementation uses those exact ten nodes, nine base relationships and one additional inferred relationship. It adds no extra node type for a return visit.
- The planned route names investigation stages. Stored relationships follow the brief's patient-centered edge table; the interface does not fabricate a direct Admission-to-FollowUpGap relationship.
- Synthea supplies synthetic identities, demographics and coded existing problems. The recent index admissions, diabetes scenarios, clinical notes and operational hospital records are regenerated demonstration fixtures. Source provenance distinguishes imported facts from generated scenarios.
- The earlier clinical rules, example sentences and actions are discarded. They have no role in the current hospital answers.
- Search returns passages from the same notes. It does not claim a joined count or a verified cause. The exact answer comes from the validated structured query.
- Precision and recall use a separate regenerated seed truth file. The optional topic classifier has a different held-out evaluation. Neither is independent clinical validation.
- OpenAI execution still requires a working backend key and a successful live-call check. Automatic model integration tests cannot establish the user's account access or network availability.
- Human approval persists a review state. There is no connected patient communication, booking or hospital-system write.

## Verified baseline

The integrated automatic suite passed **73 tests**. The independently checked hospital contract includes 1,000 distinct adult Synthea identities, 150 diabetes-related admissions, 600 notes across all five note types, the P0412 story, exact source ownership, the five difficult sentence categories, direct schema migration, three distinct graph walks, and three identical database counts.

On a fresh snapshot the main answer is **78 patients**, of whom **16** are before day 30. A separate **51** have an open follow-up gap with no documented barrier. Across all open follow-up gaps, including that standard-call group, **28** patients are before day 30. The dataset contains **4,487 graph nodes and 3,625 relationships**.

Extraction against all 600 seed notes measured **127 true positives, zero false positives and zero false negatives**: precision and recall are 100% on this authored set, with all **60 intentional hard cases** passing. Per-type true positives are 39 transportation, 26 cost, 37 food insecurity and 25 health literacy; each has zero false positives and false negatives. This limited seeded result does not establish performance on unfamiliar clinical text.

The bundled Worker check verified atomic failure rollback, idempotent loading, source isolation, all three judging questions, the resource comparison and persisted task review. A later transportation-resolution note changed the headline count from **78 to 77** and invalidated the earlier task's approval. The maximum was **40 SQL statements per request**, including a **16-statement seed batch**, within the tested 50-statement limit. These are local checks of the deployable artifact; hosted runtime and live model access are separate checks.

## Explicit historical exception

The active hospital schema, records, prompts and interface use the new terminology. **The brief's literal zero-occurrence requirement across the entire repository is not fully met**, because two immutable files record a migration already applied to the hosted database:

- `drizzle/0000_broad_proemial_gods.sql`, line 74.
- `drizzle/meta/0000_snapshot.json`, lines 490 and 491.

Those three lines preserve one obsolete column identifier solely in the applied history. The subsequent hospital migration removes the earlier table. No current field or record carries that data forward.

The hosting workflow requires applied migrations and their snapshots to remain immutable. Rewriting them to conceal the old identifier would break the deployment history. The wording audit therefore reports the three historical findings openly, pins both files to their original SHA-256 content digests (with canonical LF line endings), and fails if either file changes or disappears. Any prohibited wording introduced elsewhere remains a failing check. A successful current-source check must not be described as a clean whole-repository result.

This is the only terminology mapping exception. The imported Synthea versus generated hospital data distinction and the live OpenAI prerequisite are documented above rather than disguised as implemented integrations.
