# Careweave presenter guide

The central story: **the hospital already wrote down the reason. Careweave connects it to missed care and prepares a next step.**

## Before judging

- Open the public workspace. Confirm its status badge: **Rules engine** without a key, **OpenAI agent** only after a key is configured. Never describe rules mode as a live model.
- Open the original guided story if you want a paced visual explanation.
- The demonstration uses a fixed reference date and fictional patients. A task approval affects your demonstration queue only.

## 1. Start with one person

"Mavis left the hospital. The clinic sees a missed visit. The pharmacy sees medicine not picked up. The bedside nurse had already recorded that she could not get a ride. Those systems need to tell one story."

Open the featured patient, select the nursing note, and point to the exact quoted sentence. The graph connects the visit and medicine facts through the patient to the barrier and responsible care-team role.

## 2. Ask across the hospital

Ask: **Which discharged patients have a follow-up gap and a documented barrier?**

The current graph computes **26** patients. The broader funnel is 1,000 discharges → 150 diabetes-related admissions → 60 follow-up gaps → 26 with detected barriers. The separate answer key contains 27; the note reader misses one. Exact graph counts do not imply perfect extraction.

Try a supported variation:

- Who has a transportation barrier and missed follow-up?
- Who cannot afford their discharge insulin?
- Of those, how many are age 65 or older?
- Which patients have both cost and transportation barriers?

The workspace shows the filters it actually used. Open the tool trace to show operations after they execute. Model mode chooses the tool calls; rules mode parses supported fields directly. The agent prompt and tool definitions are inspectable from the workspace.

## 3. Show the earlier opportunity

Open a qualifying patient and rewind to discharge day. The dated records change, while future outcomes remain unavailable. The purpose is to show what the team could have known then, not to assert that an action would certainly prevent a later event.

## 4. Finish with work ready for review

Prepare the care task for the current barrier. Show the proposed action, accountable role, and exact evidence. Approve it in the demo, then reload the page to demonstrate server persistence. Nothing is sent to a real patient or hospital.

A what-if calculation temporarily removes one barrier for its query. It shows how the group and suggested action would change. It is a software simulation, not a prediction of clinical outcomes.

## Questions to expect

**Why a graph?** It joins the patient, dated visit and medication facts, notes, barriers, and responsible actions. A source can be inspected and a count recomputed from the same filters.

**Is this real AI?** When configured, the server runs a real OpenAI function-calling loop. Without a key it clearly uses rules mode. The original guided story uses prepared routes. The note extractor is a frozen text-pattern reader with measured errors.

**Is anything saved?** Investigations and task states are saved in SQLite locally and D1 on the hosted app. Each browser has its own server session; the source data and other visitors' work remain separate.

**Can the AI act by itself?** Its tools read and calculate. Preparing and approving a demonstration task are explicit user actions. It cannot contact anyone, book transport, or change medical care.

**What still needs validation?** Real OpenAI account connectivity once a key is added, performance on varied questions with the chosen model, and any clinical or hospital use beyond this fictional demonstration.
