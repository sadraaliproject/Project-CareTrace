# Careweave: judge walkthrough

**Pitch:** “Careweave finds the practical reason care is missing, shows the evidence, and prepares the next step for a person to approve.”

The central proof is a live state change: **82 → 81 patients**, an updated evidence graph, and a task whose previous approval becomes stale. Allow four minutes for the core workflow and another minute for the ML lab or an unexpected question.

## Before presenting

1. Install dependencies and start with Node 24: `npm install`, then `npm start`. Open [http://localhost:4173](http://localhost:4173), or open `Careweave.code-workspace` in VS Code and press **F5**.
2. Confirm **Backend connected**, the correct storage backend, and **1,000 fictional patients**. A fresh baseline has **3,000 documents, 4,797 nodes, and 6,632 edges**. The canvas shows a labeled sample, not every stored node at once.
3. For live generative AI, add `OPENAI_API_KEY` to local `.env`, restart, and run a complete question yourself. Inspect actual tool events. An **OpenAI configured** label is configuration, not proof of a working call. Integration tests use mocked model responses; verify your live key before judging.
4. Without a key, present the labeled local baseline honestly. SQL cohorts, the graph, trained local ML, note ingestion, and persistent tasks work without OpenAI.
5. Start from a clean database so the counts apply. Stop the server before `npm run demo:reset -- --confirm`; it archives the local database in `data/`. Restart to seed the original population. This does not reset hosted D1 data.
6. If presenting a hosted URL, verify its `/api/status`, query, graph, and persistence separately. Local tests do not establish external hosting success.

Patient stories are anchored to **October 10, 2026**. Use only fictional notes. No messages or bookings will be sent.

## 0:00–0:30 — Show the problem and the graph

Start in **Care graph**, with connected patients, documents, barriers, care gaps, and interventions visible.

“A diagnosis code can tell us what condition a patient has. It often does not tell us why their follow-up keeps getting missed. That explanation might be in a phone conversation. We connect the evidence to the care gap so a coordinator can investigate and act.”

“These are 1,000 fictional patients. This canvas is a labeled view of a larger stored graph; the totals come from the database.”

Switch briefly to the ontology view if useful. Explain **Patient → Document → Barrier → Intervention**, alongside **Patient → CareGap**. Keep the explanation focused on the patient story.

## 0:30–1:15 — Ask a question and inspect its evidence

Run:

> Find diabetic patients who are overdue for an A1c test and have transportation barriers.

On a fresh database, the cohort contains **82 patients**. Point to the interpreted filters and fingerprint.

“The backend executes a structured SQL query to compute this number. The language model can investigate using bounded tools, but it does not invent the count.”

If OpenAI is active, show actual `get_ontology`, `query_patients`, graph/evidence retrieval, and `build_cohort` events. Do not describe deterministic events as model decisions. A supported query must be finalized before presenting a complete result.

Find **Maya Bennett · P0412** in the patient selector or cohort. Open her patient graph and source evidence. Her baseline scoped graph has **9 connected nodes and 9 edges**, including the overdue A1c gap, call document, transportation barrier, and an intervention option.

Read the original quote:

> I have no transportation to my appointments.

“Maya's structured record lacks a barrier flag. Her transcript connects missing care to a stated transportation problem. This is evidence of her reported obstacle, not proof of causation or a medical diagnosis.”

## 1:15–1:55 — Turn the result into reviewable work

Open Maya's details and select **Prepare draft**. Visit **Care queue** and inspect the draft, source document ID, and task version. Edit a line if useful, then approve it.

“The output is a care-coordination task with a patient, a care need, an exact source, and a proposed next step. A person reviews the evidence and decides what to do.”

“Approval is persisted in the database. In this demonstration it sends nothing and books nothing.”

Show the **Approved** filter. A refresh retains the task. Do not mark it complete yet: the next step demonstrates why approval must be revisited when evidence changes.

## 1:55–2:50 — Change the story live

Open **Live note lab**. Select **Maya Bennett · P0412**, date **2026-10-10**, source **Care coordinator call**. Enter or use the resolved example:

> Patient: My daughter now drives me to appointments. Transportation is no longer a problem.

Select **Preview extraction**. Point out the resolved assertion and distinguish it from the local ML topic suggestion. The classifier can identify transportation language; context rules determine whether a current barrier is supported.

Select **Add note & update graph**. This saves a new synthetic source in the database and updates the patient's assertions and graph.

“The evidence changed. Transportation is still mentioned, but the current claim is that the obstacle has been resolved.”

Rerun the original question. Its count changes from **82 to 81**. Maya is excluded from the active-barrier cohort. Open her patient view to inspect the new source and resolved edge.

Return to **Care queue → Evidence changed**. Maya's previously approved task now requires review. Revalidation cannot approve a resolved transportation barrier.

“Our earlier task is no longer supported by the latest evidence. The workflow catches that change instead of continuing with an outdated recommendation.”

## 2:50–3:20 — Prove the history is real

Open **Run history** and replay the original analysis. Its saved result still contains **82** patients. Replay restores the old result and tool events; the graph beside it reflects current data and is labeled that way.

“This is the earlier execution, preserved for inspection. A new execution sees the updated source and returns 81. The saved result and live graph have different purposes.”

Do not describe replay as a new model run or a historical graph reconstruction.

## 3:20–4:00 — Take an unscripted follow-up

Invite the judge to change a supported condition:

- “What about cost barriers?”
- “Show diabetic patients with a care gap who have both cost and transportation barriers.”
- “Of those, show patients aged 65 and older.”
- “Show patients with resolved transportation barriers.”

Read the interpreted filters before discussing the answer. The model can vary tool choices and wording when configured; SQL and source retrieval still supply the facts. An unsupported question should get an explicit limitation. Do not silently recast a question about an unsupported diagnosis, insurance type, outcome, or custom lab threshold as a supported result.

End with: “The result is a connected unit of work: patient, care gap, current evidence, and a next step that a person can review. When the evidence changes, the work changes with it.”

## Judge extension: make the graph earn its place

Open **Impact studio** and select **Try a tight $350 budget**. On a fresh dataset, the priority-first baseline fully covers five patients' documented support needs; the bundle-aware heuristic covers 20. Switch the graph between the two strategies, select a patient, and inspect the exact evidence supporting that allocation.

Explain the tradeoff aloud: “This strategy buys more complete support coverage, but it selects a lower average synthetic priority. The warning shows who remains without support. These are illustrative program costs, not predicted medical outcomes or proven savings.” The algorithm reads current database evidence and has no authority to enroll anyone or resolve a barrier.

Open **Proof challenge** and run the live checks. Show the 14 expected-versus-observed cases, two database query fingerprints, and source verification. Ask a judge for a fictional sentence, or try:

> Transportation is resolved and I cannot afford the medication copay.

Transportation should be resolved while medication cost remains active. Then try:

> My sister cannot afford her medication, but I have no transportation to my appointments.

The family member's medication cost should not become the patient's barrier. The custom preview has no predefined expected label and never writes a note. The fixed challenge set is deliberately small; unfamiliar language can still fail. Export the proof packet for the technical discussion.

## Optional one-minute extension: show the real ML

Open **Evidence lab** and its local model evaluation. The included multinomial Naive Bayes artifact learns unigram and bigram features from **100 training examples** and is evaluated on **40 held-out examples**.

“Our small local model gets **72.5% held-out accuracy** and **0.713 macro F1** on this synthetic corpus. Here are the errors and confusion matrix. Test examples were withheld from training, but the same team authored both sets, so this is not independent clinical validation.”

Try a direct barrier, a family-only statement, and a resolved statement. Topic scores are uncalibrated suggestions. Rule-supported, patient-specific source assertions determine graph facts; the classifier does not turn every transportation mention into a barrier.

For an operational extension, use **Cohort workbench** to vary available outreach slots. The worklist follows a transparent heuristic. Do not claim proven patient benefit, savings, or clinical risk prediction.

## Short answers for judges

| Question | Honest answer |
| --- | --- |
| Why not upload records to ChatGPT? | A general assistant may answer similar questions. This demo adds a persisted typed graph, exact structured counts, source-level evidence, temporal updates, versioned tasks, and saved executions in one flow. Better accuracy would require comparative evaluation. |
| Is this actually AI? | There is an optional OpenAI tool-calling agent and a locally trained classifier. Without a key, question planning uses a labeled deterministic parser. Context rules and SQL remain separate from both models. |
| Is the graph real? | Typed nodes and edges are stored in local SQLite or the hosted D1 adapter. Cytoscape renders and expands those relationships. It is not Neo4j or Cypher. |
| How do changed circumstances work? | A later dated patient assertion updates the barrier and graph. Affected tasks require review; saved runs preserve original results. These synthetic rule checks are not universal clinical NLP. |
| Does approval contact anyone? | No. It records a simulated review state. No messaging, referral, ride booking, or EHR write is connected. |
| Did you prove improved outcomes? | No. This is a fictional operational workflow. Clinical effectiveness requires separate real-world evaluation. |
| What defines a care gap? | For this demo: diabetes and an A1c older than 365 days or above 9%. Missing-test queries select the overdue subset. This is not a clinical guideline. |
| Is it ready for real patient data? | No. Production access controls, clinical validation, approved integrations, and privacy/compliance review are not implemented. Use synthetic data only. |

## Recovery during a presentation

- **Missing key or model error:** show the error honestly and use the explicit deterministic query endpoint or supported local mode. SQL, graph, local ML, and persisted workflows remain available.
- **Count already 81:** a resolution note may remain from rehearsal. Inspect Maya's sources. Reset before the next presentation; do not overwrite evidence during the explanation to force a count.
- **Task already exists:** open it in the queue. Duplicate open tasks for one patient and barrier are rejected intentionally.
- **Version conflict:** reload the task and review its latest evidence before saving.
- **Sampled graph:** point to displayed versus stored totals, then select the patient view for a focused complete evidence path.
- **Hosted backend unavailable:** use the local Node app. A static preview is not proof of database persistence or a successful model run.
