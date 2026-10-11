# CareTrace release checklist

Audit date: October 10, 2026. Scope: the live workspace, its backend, production Worker, synthetic graph, AI connections, persistence and preserved guided story.

The audited build is ready for a hackathon demonstration: **195 automated tests pass**, the production bundle passes its database and HTTP checks, and bounded live OpenAI, Gemini and ElevenLabs requests succeed. Known extraction mistakes remain visible. These results establish the tested behavior of this build; they do not establish clinical readiness or guarantee every possible input will work.

Public address: [CareTrace](https://caretrace.us/). Source: [GitHub](https://github.com/sadraaliproject/Hackathon-26). Publication and the final production smoke result accompany the delivery.

## Verified release checks

| Check                        | Result                   | Evidence and scope                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branding                     | Pass                     | CareTrace titles, wordmarks, dialogs, narration, export names, project documentation and Sites title. Existing database/cookie identifiers remain stable so saved work survives.                                                           |
| Automated regressions        | Pass                     | 195 tests, zero failures, skips or cancellations; includes retained earlier implementations and the active app.                                                                                                                            |
| Syntax and source wording    | Pass                     | 75 JavaScript modules checked. Applied migration history remains immutable; three historical wording exceptions in two pinned files are reported separately.                                                                               |
| Production package           | Pass                     | 17 allowed browser assets; production Worker executes a streamed 26-person query, D1 migrations, durable approval and visitor isolation.                                                                                                   |
| Graph and query calculations | Pass                     | 1,000 discharges → 150 diabetes admissions → 60 open gaps → 26 with a detected barrier; 19 within 30 days. Primary groups sum to 26.                                                                                                       |
| Sources and historical view  | Pass                     | Exact spans, valid same-patient sources, historical appointment/pickup/admission masking, unavailable future sources rejected, dates validated. Browser confirmed a scheduled visit at discharge and a missed visit today.                 |
| Bounded OpenAI investigation | Pass                     | Live gpt-4.1-mini request returned 26, then a continuation returned 19; four executed tool calls inspected. Mocked transport checks malformed tools, invented sources, source instructions, cancellation and service failures.             |
| Gemini care brief            | Pass                     | Live Gemini-3.1-Flash-Lite ordered three documented steps with source links. Server validates every permitted step exactly once and preserves action text. All 1,000 patients scanned for valid care-brief evidence.                       |
| ElevenLabs audio             | Pass                     | Live MP3 loaded with readyState 4, duration 34.88 seconds and no media error. Preview starts with CareTrace and matches the approved server-owned task. Review, session ownership, timeout and response limits tested.                     |
| Draft and review queue       | Pass                     | Prepare → approve → complete verified in the browser; completion survived reload. Duplicate preparation, invalid transitions, concurrency and session isolation tested.                                                                    |
| Local durability             | Pass                     | Actual SQLite server restart tests preserve tasks and investigations. Database checks use the real D1 SQL adapter and migrations.                                                                                                          |
| Browser timing and errors    | Pass                     | 25 tests execute the actual workspace handlers: reversed responses, modal dismissal, stale history, filtering, timeout/cancel recovery and export payload.                                                                                 |
| Guided story and keyboard    | Pass                     | All nine screens rendered without captured JavaScript errors. Tab containment, Escape, focus restoration across animation and native Space behavior checked.                                                                               |
| Mobile layout                | Pass                     | Overview and queue checked at a 390-pixel viewport; document width equals available width, with no horizontal overflow. Navigation and dialog dismissal work.                                                                              |
| Secrets and request controls | Pass                     | Keys stay on the server. Private files return 404; mutation origin checks, cookie isolation, input limits and durable AI budgets covered. No new audience or permissions.                                                                  |
| Dependencies                 | Pass                     | Full and production-only npm audits report zero known vulnerabilities. Scoped esbuild override verified with both transforms, the TypeScript loader, disposable 21-table schema generation and the production build.                       |
| Evidence export              | Partial browser coverage | Production handler generates valid JSON with the exact result, filters, citations and CareTrace filename, then releases its temporary URL. The browser showed the download notice; the in-app automation could not confirm the saved file. |

## Bugs corrected in this release

- Patient, date and history requests now discard obsolete responses, including patient loading after an investigation. Saved investigations open after the current question finishes or is stopped, preventing one question from appearing beside another question's answer.
- Closing or replacing a source, comparison or audio dialog keeps it closed. Background task updates still refresh the queue without taking over the current dialog.
- Investigation timeout reports a usable retry message; cancellation remains distinct.
- Group filtering selects a patient from the visible group, clears unrelated actionable details and resets when reopening an investigation.
- Historical source links carry the selected date and hide facts unavailable then. Earlier-than-admission dates return no patient.
- Explicit barrier resolutions supersede older active evidence. Independent clauses retain their own negation and subject context.
- A simulated resolution must match the requested patient and single barrier. The agent cannot substitute another barrier.
- Multi-barrier source citations match the question. Unsupported inverse/completed-care questions are refused instead of silently returning the opposite group.
- Guided-story dialogs contain keyboard focus and restore it after animation replaces the triggering control.
- A vulnerable indirect development dependency was replaced without changing applied migration history.

## Accuracy and operating limits

The active reader `2026-10-10.2` and frozen guided reader both measure **49 true positives, 6 false positives and 5 false negatives** on the independent synthetic note labels: **89.09% precision and 90.74% recall**. Counts are exact for the extracted graph. The separate main-group answer key contains 27 people, while extraction finds 26: P0025 remains missed. P0024's additional food difficulty is also missed; six context false positives remain outside the main gap cohort.

The active reader uses text patterns. The separately trained Naive Bayes model is an archived evaluation component. OpenAI chooses graph tools; Gemini orders permitted steps; ElevenLabs reads reviewed text. No AI service establishes clinical outcomes.

The snapshot is fixed at October 10, 2026. All records are fictional. Approval/completion are demo states and do not contact anyone, book transport, create orders or change hospital records. Saved work belongs to a browser cookie and expires after 30 days; clearing cookies or changing browsers creates a different workspace. Model requests share limits of 12 per session/hour and 50 globally/day, so an exhausted service budget can prevent another live request while the original evidence stays available.

## Founder priorities after the demonstration

1. Validate the workflow with care transitions nurses and outpatient pharmacists: can they understand the evidence and prepare the right next step without coaching?
2. Improve extraction against a separately held evaluation set, concentrating on the documented false positives and missed cases. Preserve the current baseline so improvement is measurable.
3. Before real hospital use, establish staff identity, roles, shared work ownership, clinical review and approved data handling. Browser-session isolation is sufficient for this fictional demonstration only.
4. Add operational monitoring, backup/restore rehearsal and sustained load testing before promising reliability at scale. The present audit does not include a penetration test or a long-running concurrency test.
5. Rehearse the three-minute demo with a fresh browser session and a fallback through the prepared guided story. Check service budgets before presenting; only the root caretrace.us address is connected, not www.

## Reproduce the checks

Use Node.js 24 or newer, then run `npm ci`, `npm run check`, `npm test`, `npm run build`, `node scripts/verify-worker.js`, `npm audit`, and `npm audit --omit=dev`. Live AI checks require the already configured local/server secrets; do not put keys in source or browser code. `npm run verify:pilot` regenerates the preserved guided-story measurements rather than measuring the active reader; active reader measurements are asserted independently in `tests/live-reader.test.js`.

## October 11 question handling update

- Passed all 198 automated tests, including ordinary missed-appointment wording, completed visits, medication pickup and editable clarification/retry behavior.
- Verified the production Worker bundle and D1 workflow.
- A bounded live OpenAI request for “who didnt come?” returned 60 fictional patients and cited a matching appointment source.
- Added explicit appointment status, medication pickup and patient name/ID filters. The graph computes counts and verifies cited sources. Questions remain limited to available records and supported analysis.
