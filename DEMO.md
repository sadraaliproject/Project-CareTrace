# Careweave: three-minute demonstration

## Set up

1. Run `npm start` and open `http://localhost:4173`.
2. Verify that the interface reports 1,000 synthetic patients and shows its active planning mode. Use the deterministic mode if no API key is configured.
3. Run the transportation and missing-A1c question once to confirm the application is ready. Do not memorize or invent a count; point to the live count produced by the engine.
4. Confirm the Workbench, Care queue, and Evidence lab views open. Remove any unwanted pending drafts individually from the Care queue before presenting.

## 0:00–0:25 — The problem

“A patient can miss essential follow-up for a reason that never appears in a diagnosis code. They may have lost their ride, be unable to afford a service, or struggle to understand the instructions. That reason can be buried in a phone note. Careweave finds evidence of the barrier and turns it into a next step a care coordinator can review.”

“Everything you will see today is fictional. We generated 1,000 patients so we can show the full workflow safely.”

## 0:25–1:10 — Find a cohort and prove it

Enter:

> Find diabetic patients missing an A1c test because they cannot get transportation.

Point to the live result count and the interpreted filters. Explain: “This number comes from executing these filters over the dataset. It is not a number written by the language model.”

Open one returned patient. Show the missing care item, the current transportation barrier, and the exact fictional source note or phone transcript supporting it.

“A coordinator can inspect why this person was included and return to the original evidence.”

## 1:10–1:40 — The distinctive moment

Open **Evidence lab** and inspect a resolved or negated transportation statement, such as a person saying they no longer need transportation help. To inspect source chronology, return to the Workbench, use **What changed?**, open a returned patient, and show **What changed over time** in their details.

“A mention of a problem is not always a current problem. Our demo makes that difference visible, including the source and time of the evidence. The rules are bounded and inspectable; uncertain cases still need a person.”

Return to the transportation + A1c cohort and change **Available outreach slots** in the capacity planner. Show the number of drafts that can be prepared from the eligible patients in priority order. Do not describe the heuristic as proven clinical benefit or saved cost.

## 1:40–2:15 — Turn the finding into work

Open a returned patient and select **Prepare draft**. Open **Care queue**, review the proposed outreach and source evidence, and show its **Human review required** status.

“Careweave prepares a reviewable task. A human verifies the evidence and decides what to do. In this demo, approving the task updates a local queue; it does not send outreach or book transportation.”

Select **Approve draft**, then open the queue’s **Approved** filter to show the persisted state. Refresh only if time allows, to demonstrate browser-local persistence.

## 2:15–3:00 — Take a live follow-up

Invite the judge to vary the supported question. Good starting examples are:

- “What about cost barriers?”
- “Show diabetic patients with a care gap who have both cost and transportation barriers.”
- “Of those, show patients aged 65 and older.”

Check the displayed interpretation before describing the answer. If a phrase is unsupported, acknowledge it and use the available structured controls or supported wording. If OpenAI planning is configured, explain that it interprets the question while the local engine still computes the cohort.

Close with: “The unit of value is a verified care-coordination task: a patient, a care gap, evidence of the barrier, and a next step a human can approve.”

## Honest answers to likely questions

**Why not upload the records to a general-purpose chatbot?**

“A chatbot may answer similar questions. What we demonstrate here is a connected workflow: a structured query determines the count, each inclusion can be traced to a source, temporal evidence is visible, and a result can become a reviewable task. We would need a measured evaluation to claim better accuracy than another system.”

**Is this really using AI?**

“The prototype has two question-planning modes. The optional OpenAI route converts language into a structured plan. The offline mode uses a labeled deterministic parser. Evidence extraction currently uses explicit rules. We kept execution and evidence inspectable so the demo remains reproducible.”

**Is the graph Neo4j?**

“This version uses a typed in-memory graph. It proves the workflow without requiring a graph database service. Neo4j or another persistent store would be an implementation choice for a larger deployment.”

**Did you improve health outcomes?**

“We have not measured clinical outcomes. This is a synthetic workflow demonstration. Real-world claims would require clinical and operational evaluation.”

**Does approval send anything?**

“No. It records a local review state. There is no live patient messaging, referral, booking, or EHR write.”

## Reproducibility checks before presenting

- Repeat the same question with the same displayed filters and verify the same cohort count.
- Open a returned patient and confirm the shown quote supports the included barrier.
- Inspect a resolved or negated transportation example and confirm that its status is visible.
- Prepare and approve a task, then verify the queue state after a refresh.
- Ask one changed question live and inspect the filter plan before discussing the new result.
- Confirm the planning-mode label matches the actual setup and no real patient data or secrets are visible.
