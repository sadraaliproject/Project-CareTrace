# Careweave presenter guide

Open the app before presenting. The date is fixed to October 10, 2026, so every run uses the same dated evidence. The **Prototype · synthetic patients** chip explains prepared routes, actual calculations and measured limitations.

1. **One patient:** “We discharged them. Let’s help them get back on track.” Point to the missed visit, uncollected insulin and bedside note. Let the graph connect them.
2. **Build the graph:** Watch rows and notes become source-linked nodes and edges. Open the inspector to show actual records and counts.
3. **What search finds:** Show the closest five notes, then move to 20. Similar text alone cannot check a missed visit or medication pickup. The dot map uses real TF-IDF vectors and PCA.
4. **Read the note:** Highlight the current difficulty. Open the negated and resolved examples. Inspect one real false positive and one missed sentence.
5. **The investigation:** Follow the planned route and actual trace. Pause at the empty coded-needs lookup. Show how the path continues into the clinical note.
6. **Every discharge:** Narrow 1,000 discharges through diabetes and open follow-up gaps to the detected barrier group. Counts come from the graph.
7. **The answer:** Explain the one-primary-group rule, additional needs and standard follow-up list. Open the search comparison and the measured evaluation.
8. **Discharge-day rewind:** Jump back to discharge day. The note was already present, while later outcomes were not. Return to today to reveal the missed steps.
9. **Monday morning:** Show the work grouped by responsible team, with the least time remaining first. Inspect a patient, mark the barrier resolved and show the new count. Reset after the example.

For another route, choose **Hospital units**, **Known before discharge**, or **Emergency returns**. Each changes both the route and answer shape. Free text selects the closest prepared question; it does not invoke a model.

Use **E** to switch between the care-team interface and the engine. **Pause**, **Replay**, and **Step** let judges inspect details. **Back** and **Next** move between screens. The compact mobile layout keeps the graph first and puts engine details in a bottom sheet.

Be precise when asked about AI: the plans and explanation templates were authored with a language model ahead of time. The prototype reads notes with inspectable text patterns, and the graph computes each answer. The reader's measured errors are visible. No external call or care action is sent.
