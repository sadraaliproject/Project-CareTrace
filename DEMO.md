# Careweave: three-minute hospital demonstration

**Opening:** “We are a hospital system. We discharged these patients, and we wrote down why some of them will struggle at home.”

**Closing:** “The answer was already in our own notes. The graph is what lets us ask for it.”

All records are synthetic. The judging snapshot is October 10, 2026. The app considers 1,000 adults discharged from the hospital system in the preceding 90 days; 150 had a diabetes-related admission.

For the newer **Patient handoff** experience with English/Spanish briefs and reviewed audio, use the [optional-service judging route](docs/SPONSOR_SETUP.md#three-minute-judging-route). A local text brief works immediately; Gemini and ElevenLabs require your own account keys and a successful live rehearsal. The public preview protects shared edits behind staff sign-in.

## Before the judges arrive

1. Start the local app with Node 24: `npm install`, then `npm start`. Open [localhost:4173](http://localhost:4173), or press F5 in `Careweave.code-workspace`.
2. Confirm the backend is connected and initialization is complete. A hosted presentation needs its own live query and persistence check.
3. If using OpenAI, set the local key in `.env`, restart and complete a real question. A configured badge alone is not evidence of a successful call. Without a key, describe the labeled deterministic planner accurately.
4. Run Proof challenge. Check three matching SQL counts, source verification, and the current precision and recall. Use the displayed values rather than memorizing a count that may change after a rehearsal note.
5. Open patient **P0412** and check that her original story is present. Reset a local rehearsal only while the server is stopped: `npm run demo:reset -- --confirm`, then restart. Reset archives local state and does not change hosted state.
6. Keep the [60-second backup walkthrough](./docs/hospital-demo-walkthrough.mp4) available. It shows eight captured states from a local deterministic run with synthetic data. State plainly that it is a recorded-state walkthrough, not a continuous recording or a live OpenAI demonstration. The saved event stream is available separately in run history and in `exports/replay-events.json` after baseline export.

## 0:00–0:30 — Search finds the words

Show the two source layers: **Hospital data store** and **Clinical notes**. Ask note search:

> Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?

“Search found passages about the problem. It did not join the discharge date, appointment and pharmacy rows to give us an exact patient count.”

Keep the baseline visible. It uses the same notes as the graph investigation.

## 0:30–1:15 — The agent plans

Ask the agent the same question. Point to the ontology route as it is planned:

**Patient → Admission → FollowUpGap → Barrier → Action**

“First we find the recent discharge. Then we check the follow-up and medication pickup windows. We look for a documented reason and match it to an action our hospital staff can take.”

Do not read database identifiers aloud. The steps should tell a patient story. The canvas shows at most 50 nodes, so people can follow it.

## 1:15–2:00 — Walk one patient and reroute

Open **P0412**, the 67-year-old patient with DKA and admission A1c **11.2%**. She left with new basal insulin and an endocrinology appointment on day 10. The appointment is marked **no-show**, and the outpatient pharmacy says the insulin was **not picked up**.

“The hospital tables tell us she is off track. We checked for a coded social need and found none. Now we turn to what the bedside nurse wrote.”

Show the evidence card: **Bedside nursing note, 2 days before discharge**, with the author role and exact sentence about her daughter bringing her in and having no way to reach the clinic once home.

“The note explains a practical obstacle that the appointment table cannot. Her next step is to book hospital patient transport and offer a video visit. The care transitions nurse owns that action.”

The route highlights actual graph facts. It is not proof of clinical causation.

## 2:00–2:30 — Run the route across the hospital's discharges

Point to **Open follow-up gap with a barrier we can act on** and its exact SQL count. Show the four barrier groups, their hospital actions and their owning roles. Open another patient chosen by a judge and inspect that patient's note or coded row.

Then show the fifth group: patients with an open follow-up gap and **no documented barrier**.

“They get the standard discharge call and a rescheduled visit. We are not assuming everyone needs the same extra help. Missing documentation also does not prove there is no obstacle.”

## 2:30–3:00 — Take a different question

Try the judge's wording, or use:

> Which patients report a cost barrier and never picked up their discharge insulin?

Then, if time permits:

> Who is likely to return?

The latter requires admission A1c above 9%, no completed follow-up visit, new insulin not picked up, and a current reported barrier. Say: **“This is a simplified hackathon rule, not a validated readmission risk model.”**

Close on the displayed **cohort size, extraction precision and recall, and measured time to answer**. Point to **patients we can still reach before day 30** without suggesting a proven effect on outcomes.

The optional [closing slide](./docs/judges-closing.html) records the baseline: **78** patients with a documented barrier, **100% precision and recall on 600 seeded notes**, and **16 patients in that answer before day 30**. Across all open follow-up gaps, including the standard-call group, the separate number before day 30 is 28. Read the actual run timer for time to answer. The perfect seeded score is not independent clinical validation.

“The answer was already in our own notes. The graph is what lets us ask for it.”

## Optional extension: test the evidence

Run **Proof challenge** in front of the judge. It executes the real extractor, runs the same SQL question three times, and checks patient ownership and exact source excerpts.

Try the hard sentences from the brief:

- “Denies transportation concerns. Wife drives.”
- “Transport arranged by SW prior to discharge.”
- “Pt's brother lost his job and cannot afford his own medications.”
- “NPO after midnight, meals held for procedure.”
- “Previously had trouble affording strips, now has assistance in place.”

None should create a current barrier relationship. Ask for a new fictional sentence and show the actual preview. Unknown wording can fail; the displayed evaluation comes from a synthetic, team-authored test set rather than independent clinical validation.

## Optional extension: prepare work and change the evidence

Prepare P0412's transportation task. Inspect the source and proposed action, then approve it. Refresh to show that the review state persists. Explain that approval sends nothing and books nothing.

Add a later **post-discharge nurse call note**:

> Patient states her daughter now drives her to clinic. Transportation is no longer a problem.

Preview it first, then save the explicitly synthetic note. Rerun the original question: P0412 should leave its active-barrier results if no other current barrier remains. The old task requires review because its supporting evidence changed. A saved earlier run remains historical and cannot prepare new work until rerun against current data.

## Optional extension: use the graph to plan staff capacity

Open **Impact Studio**. Set an illustrative budget and capacity, then compare the priority-first and bundle-aware strategies. Select an allocation to inspect the source path.

“This plan can cover more documented support needs within the same assumed budget, but it can also leave higher-priority patients waiting. Costs are illustrative. We are comparing staffing choices, not predicting clinical results.”

## Plain answers to common questions

| Judge asks | Answer |
| --- | --- |
| Why a graph? | It connects our hospital tables to the exact sentence that explains a barrier, and makes that path inspectable for every result. |
| Where does the count come from? | A bound SQL query over current stored hospital records. The language model does not invent it. |
| Is this live AI? | With the configured key, the OpenAI agent uses constrained tools. Without it, the screen labels the deterministic planner. A separate small learned classifier provides topic suggestions. |
| What makes the numbers repeatable? | The same snapshot, validated filters and SQL produce the same count. Three executions are checked in Proof challenge. |
| Why does the gap wait 14 days? | The brief evaluates diabetes-related discharges at least 14 days later, then checks the 14-day visit and three-day pickup windows. |
| Does the fifth group need no help? | It has no documented barrier in these records. Its next step is the standard discharge call and a rescheduled visit. |
| Can this contact a patient? | No. Task review is persisted, but no message, booking or external record update is connected. |
| Is it ready for real hospital records? | No. This is a synthetic prototype requiring clinical evaluation, secure access and approved integrations before real use. |

## Recover cleanly during a demonstration

- **Model error:** show the error and use the explicit deterministic query option. Do not describe a failed call as successful AI reasoning.
- **Unexpected count:** inspect rehearsal notes and the date. Do not alter evidence merely to force a rehearsed number.
- **Changed task:** reload the current version and review its evidence again.
- **Unsupported question:** show the limitation instead of answering a different question silently.
- **Saved run:** label it as replay. It is not a fresh model run or a historical reconstruction of the current graph.
- **Hosted outage:** use the verified local Node app and explain the switch.
