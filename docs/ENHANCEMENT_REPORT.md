# Enhancement verification report

Reference date: 2026-10-10. Generated from the committed data and current graph by `npm run verify:pilot`.

## Funnel and action groups

1000 discharges → 150 diabetes admissions → 60 open follow-up gaps → **26 with a detected current barrier**. 34 receive the standard follow-up call.

| Primary barrier | Patients | Accountable role |
|---|---:|---|
| Transportation | 8 | Care transitions nurse |
| Cost | 11 | Outpatient pharmacist |
| Food insecurity | 4 | Social worker and dietitian |
| Health literacy | 3 | Diabetes educator |

8 + 11 + 4 + 3 = 26. Each patient appears in one primary group; additional needs remain visible. 19 of 26 are within the first 30 days.

## Note reader evaluation

Each note/type pair is compared with a separate authored answer key. This is a synthetic development evaluation, not clinical validation. The reader was frozen before the initial measurement; eight additional context-challenge notes were then added. The provenance records both measurements.

| Type | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| Overall | 49 | 6 | 5 | 89.09% | 90.74% |
| Transportation | 17 | 2 | 1 | 89.47% | 94.44% |
| Cost | 22 | 2 | 1 | 91.67% | 95.65% |
| Food insecurity | 6 | 1 | 2 | 85.71% | 75.00% |
| Health literacy | 4 | 1 | 1 | 80.00% | 80.00% |

Inspect a false positive: P0101-N01; a false negative: P0006-N01. The screen provides the complete note and the reader's decision.

## Note search compared with the graph

Main prepared question: “Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?”

| Method | Correct unique patients | Incorrect unique patients | Total returned patients | Notes not selected |
|---|---:|---:|---:|---:|
| TF-IDF, k=5 notes | 1 | 4 | 5 | 595 |
| TF-IDF, k=20 notes | 7 | 12 | 19 | 580 |
| Graph query | 26 | 0 | 26 | All 600 read during construction |

The separate answer key contains 27 qualifying patients. The graph counts its extracted state exactly but misses 1 labeled patient (P0025). An exact graph count does not make extraction perfect. Search ranks notes by actual cosine similarity; the two-dimensional map is a centered PCA projection, including the query point. Search never joins the dated visit and medicine tables.

## Featured patient and earlier opportunity

P0001, day 14, 16 days remaining in the 30-day window. Selected by the documented clinical/data rules, not by a fixed ID.

Evidence: P0001-N01, Bedside nursing note, 2026-09-24T08:00:00-04:00; Inpatient nurse AM; 4 West Medical.

> At the bedside, pt has no reliable ride to the Endocrinology Clinic visit.

Discharge: 2026-09-26T15:30:00-04:00. The note span is [67,141]. Rewinding restricts records and status to facts known at that date.

19/26 detected patients had the barrier documented before discharge. 21/26 would be missed by looking only at coded social needs.

## Scope and verification

The active app is a browser-memory demonstration with 15 prepared question routes. Plans and explanations were authored with a language model during development; request-time work uses graph traversal, pattern reading, TF-IDF, PCA and date rules. Cypher-style text explains the actual JavaScript operation; Neo4j is not required or running. Actual call durations are measured.

No live model integrations, audio generation, staff authentication, hospital connections, external messages, or persistent shared edits are active in this version. Those are excluded by the new brief's runtime constraint. Existing integration source and regression tests remain available for future work, outside the shipped asset allowlist and serving path. The return flag and follow-up rules are simplified demonstration rules.

Automated verification covers all 15 query routes, ontology and source references, graph totals, date visibility, primary groups, real extraction errors, search ranking, resolution/reset, HTTP serving and disabled integrations. Browser layout and interaction observations are recorded separately in `docs/UI_VERIFICATION.md`.
