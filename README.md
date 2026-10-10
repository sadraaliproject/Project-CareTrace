# Careweave

**Find the reason care is missing. Prepare the next step.**

Careweave is a working hackathon prototype for exploring diabetes care gaps across 1,000 fictional patients. Ask a cohort question, inspect the exact source evidence, and prepare a care-coordination task for human review.

The demo is about finding practical barriers hidden in notes and phone transcripts. The graph supports the workflow behind the scenes; the interface begins with the patient problem.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
npm start
```

Open [http://localhost:4173](http://localhost:4173). Run the automated checks with:

```sh
npm test
```

The core demo runs without an API key. Patient generation, evidence extraction, cohort queries, and task drafting execute locally in the browser. The optional server route can use OpenAI to translate a natural-language question into a structured query plan. The local engine validates and executes the plan against the same dataset.

### Optional language-model planning

Copy `.env.example` to `.env`, add an API key, and restart the local server. Never place secrets in the static frontend or commit `.env`.

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=4173
```

The optional model is a question planner. It does not supply patient counts or replace the evidence rules. If the model is unavailable, the application uses the labeled deterministic parser. The static hosted demo also uses that parser. This distinction is visible in the product and should be stated during judging.

### Export the reproducible artifacts

```sh
npm run export-data
```

This creates a local `exports/` directory containing the synthetic patient population, ontology, evidence graph, extraction evaluation, and the demo query's structured plan, result IDs, source trace, and fingerprint. These generated files are ignored by Git. The evaluation uses synthetic, template-derived examples; its scores are demonstration checks, not independent clinical accuracy measurements.

## What works

- A reproducible, locally generated population of 1,000 synthetic patients, with structured diabetes care gaps and fictional source documents.
- A typed in-memory evidence graph linking patients, gaps, barriers, and source records.
- Rule-based extraction that distinguishes supported current barriers from resolved or negated mentions within its supported patterns.
- Structured cohort execution for supported questions, with exact counts and patient-level evidence.
- A temporal barrier view that makes changing circumstances inspectable.
- Capacity-aware prioritization for exploring how a limited number of outreach slots changes the proposed worklist.
- An evidence lab for inspecting challenging language and extraction decisions.
- A browser-local queue of draft care-coordination tasks and a human approval step.

The optional OpenAI planner broadens question interpretation. All supported paths still produce structured filters and local execution, so the result can be inspected instead of relying on an uncheckable narrative.

## Reproduce the demonstration

Follow [DEMO.md](./DEMO.md) for a three-minute pitch, live follow-up questions, and evidence checks. Start with:

> Find diabetic patients missing an A1c test because they cannot get transportation.

The most useful proof is to open a result, trace its barrier to a source document, inspect a resolved-barrier example, and prepare a task. A repeated query should return the same count against the same data and filter plan.

## What makes it distinctive

**Evidence has a timeline.** A past statement about transportation is not automatically treated as a present obstacle. The demo exposes the status and source behind the decision.

**Capacity is part of the workflow.** An organization can inspect a limited outreach worklist instead of receiving an unbounded list of recommendations. Prioritization is a transparent demo heuristic, not a clinically validated risk score.

**A result can become reviewable work.** Drafts retain the patient, reason, and evidence context and require a human approval step. This makes the handoff visible and testable.

These are implemented workflow properties, not a claim that general-purpose chat tools cannot answer similar questions. The benefit to demonstrate is repeatable structured execution, source traceability, and the connected review process.

## Prototype boundaries

All records and people are fictional. The synthetic generator is custom; it is not Synthea, an EHR export, or a representative clinical population. This application has no clinical validation and is not a medical decision system.

The graph is in memory, not Neo4j. Extraction uses explicit language rules, not a trained clinical NLP model. The deterministic question parser supports a bounded vocabulary and can miss wording outside those rules. Current and resolved classifications are only as reliable as the demonstrated patterns and source chronology. Ambiguous evidence requires human review.

Care-gap definitions, ranking, program suggestions, and draft language are illustrative. The diabetes gap rule is an A1c older than 365 days or an A1c above 9%; missing-test questions select the overdue-test subset. A medication refill delay is a separate filter. These are demo definitions, not clinical guidelines. Recommendations do not establish patient eligibility, medical necessity, coverage, transportation availability, or suitability for any real service. Approval records the review state locally; it does not contact a patient, book a ride, submit a referral, or send data to an outside care team.

The task queue uses browser `localStorage`. It is specific to that browser and origin, has no multi-user synchronization or audit-grade persistence, and is not suitable for protected health information. Clearing browser site data removes local tasks. There is no authentication, authorization, EHR integration, or production privacy/compliance claim.

## Before any real-world pilot

A real deployment would require agreed clinical definitions, access controls, consent and data-governance review, security engineering, source-system integration, robust temporal and negation evaluation, an auditable task system, and validation with the intended care team. The prototype intentionally focuses on the demonstrable synthetic workflow.
