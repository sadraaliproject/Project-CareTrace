# CareTrace: the reason for a missed visit was already in the hospital's notes

**Unpublished draft.** This file has not been posted to DEV or submitted to a challenge. Before publishing, replace the verification checklist at the end with observations from the final build, include screenshots from that build, and confirm the event's current submission rules. Do not insert API keys or personal account details.

## The problem we chose

A missed follow-up appointment tells a hospital that something went wrong. It rarely explains why. That explanation may be in a bedside nursing note: the patient's daughter drove her to the hospital, but she has no way to return to the clinic.

CareTrace connects the hospital's own records to those notes. The question is practical: after a diabetes-related admission, who has an open follow-up gap, what documented obstacle can the hospital help with, and who should take the next step?

The prototype uses only synthetic data: 1,000 discharged adults, including 150 diabetes-related admissions, and 600 clinical notes. Public Synthea identities anchor the dataset; purpose-built hospital scenarios add the discharge dates, appointments, pharmacy pickup records and notes. The fixed demonstration date is October 10, 2026.

## Why the graph matters

We keep two visible source layers: hospital tables and clinical notes. Ten graph node types connect a patient to their admission, test results, discharge prescriptions, appointments, follow-up gap, notes, documented barriers and possible actions.

A search retrieves words. CareTrace also joins facts. A patient enters the main answer only when the stored dates and statuses satisfy the follow-up rule and a current documented barrier is present. A bound SQL query supplies the count; a language model does not estimate it. The unmodified synthetic baseline yields 78 patients for the main question.

Every accepted barrier points back to an exact sentence or coded social-need row. The graph lets a judge select a patient and inspect that path. The canvas is limited to 50 nodes at a time so the explanation remains readable.

## A concrete patient story

P0412 is a fictional 67-year-old woman discharged after diabetic ketoacidosis. Her appointment on day 10 is a no-show, and the hospital's outpatient pharmacy has no pickup for her new insulin. There is no coded social need. A bedside nursing note from two days before discharge records the transportation problem.

The proposed action is for the care transitions nurse to arrange hospital transport and offer a video visit. CareTrace prepares the next step for human review. It does not make the booking or contact the patient.

## Making the next step understandable

The care brief presents the facts and permitted next steps in English or Spanish. A visible transcript remains available when audio is played. Reviewing the exact text matters: a polished voice should not make unsupported instructions sound authoritative.

The optional Gemini integration orders existing, evidence-linked actions through structured output. Application checks constrain the result to permitted choices. It cannot create medication doses or alter the database count. The optional ElevenLabs integration reads the reviewed text aloud. Local text and device speech are separate options and must be identified as such during a demonstration.

At the time of this draft, real Gemini and ElevenLabs calls still require account setup, keys and live verification. Simulated API tests are useful engineering checks, but are not a substitute for testing the actual account, model, voice and pronunciation.

## The difficult part is changed evidence

“No transportation” and “transportation is no longer a problem” must lead to different results. Historical problems, another person's difficulties, and arrangements that already solved a problem must not create a current barrier.

The demonstration can add a later synthetic nurse-call note saying that P0412's daughter now drives her to clinic. The current evidence changes, and work prepared from the earlier evidence requires review again. Historical runs remain available as historical runs; they do not authorize new work against changed facts.

## What we can demonstrate, and what remains a prototype

The verification suite covers date rules, hard language cases, exact source matches, repeatable SQL queries, changes to evidence and review state, plus the packaged hosted backend. Extraction is evaluated against separately stored, developer-authored synthetic answers. Strong results on that seed do not establish clinical performance.

The application stores data in SQLite locally and D1 when hosted. It uses a SQL-backed property graph and a browser canvas. Hosted staff changes are restricted through the site's verified sign-in and an explicit staff email allowlist; this build does not use Auth0. No electronic health record, scheduling service or messaging service is connected.

Our goal is to make the reasoning inspectable and the next step useful: **the answer was already in our own notes; the graph lets us ask for it.**

## Before publishing this draft

- Add the final commit and actual check results after running the finished build.
- Record whether Gemini and ElevenLabs were tested live. If not, retain the setup-pending disclosure.
- Include a current screenshot of the graph and reviewed brief; describe any recorded replay as a replay.
- Link the public demo only after checking that a signed-out visitor can open it. Link the code only if readers have access.
- Review the [Hacklanta prize page](https://www.mlh.com/events/hacklanta-db/prizes) and publish through the author's own DEV account only when the author chooses to submit.

Technical references: [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output), [ElevenLabs text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), and the project's [demonstration script](../DEMO.md).
