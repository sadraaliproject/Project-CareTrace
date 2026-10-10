# Careweave

**We discharged them. Let’s help them get back on track.**

Careweave connects missed follow-up visits and medication pickup with the reasons written in hospital notes. Its guided demonstration shows the patient, the evidence, the graph calculation and a next step for the responsible hospital team.

[Open the demonstration](https://careweave-barrier-intelligence.muddyape9.chatgpt.site/)

## Start locally

Install Node.js 24 or newer, open this folder in VS Code, and run:

```sh
npm ci
npm start
```

Open [localhost:4173](http://localhost:4173). No API keys or developer accounts are needed. VS Code's **Careweave: Run and debug** launch configuration also starts the app. The existing `Careweave.code-workspace` opens the project.

## Present it

Nine screens tell one story: disconnected hospital systems → graph construction → note search → note reading → investigation → discharge funnel → answer → discharge-day rewind → Monday work lists.

Engine view starts open. Press **E** to switch to Product view; use **Next**, **Back**, **Pause**, **Replay**, or **Step** to control the presentation. Choose any of 15 prepared questions, inspect a patient, or try **Random patient**. Mark a barrier resolved to update the graph and counts immediately; **Reset** or reloading restores the original records.

See [the presenter guide](DEMO.md), [measured results](docs/ENHANCEMENT_REPORT.md), and [machine-readable metrics](docs/ENHANCEMENT_METRICS.json).

## What actually runs

- An in-memory graph built from 1,000 synthetic adult discharges and 600 clinical notes. The fixed reference date is October 10, 2026.
- Text-only sentence reading with evidence spans, confidence and context checks. A separate authored answer key measures precision, recall, false positives and missed sentences.
- Graph queries that compute counts, primary action groups, dated records and trace ledgers. The inspector shows a Cypher-style explanation of the JavaScript operation; no Neo4j server is running.
- Browser TF-IDF search, barrier term expansion, cosine ranking and centered PCA, including the query vector.
- Prepared question routes and explanation templates authored with a language model during development. They are replayed; there is no model call at request time. Unmatched free text selects a clearly labeled closest prepared question.

The graph counts its extracted facts exactly; imperfect extraction can still omit or misidentify a patient. The demo exposes that distinction. These synthetic measurements and simplified date rules are not clinical validation.

## Verify and rebuild

```sh
npm run check
npm test
npm run verify:pilot
npm run build
node scripts/verify-worker.js
```

`npm run test:pilot` runs only the new graph, reader, search and HTTP tests. `npm test` also retains earlier integration regressions. The tests for earlier APIs explicitly import `backend/archive-server.js`; that server is not started or bundled by the active app.

`node scripts/generate-pilot-data.js` regenerates the fixed synthetic scenarios from the retained source identities. `npm run prepare:pilot` refreshes the prepared routes and reader examples. The reader source digest is pinned to document that it was frozen before evaluation; do not reformat it casually. The evaluation provenance records the subsequent addition of eight context-challenge notes.

## Active source map

| File | Purpose |
|---|---|
| `dist/pilot-app.js`, `pilot.css`, `pilot-graph.js` | Guided interface, graph and inspectable engine |
| `dist/pilot-data.js` | Synthetic discharge rows and note text |
| `dist/pilot-reader.js` | Frozen text-only pattern reader |
| `dist/pilot-labels.js` | Evaluation-only answer key; never used by the reader or graph |
| `dist/pilot-engine.js` | Graph construction, queries, dates, actions, traces and reset |
| `dist/pilot-support.js` | Search, PCA, evaluation and prepared-route selection |
| `dist/prepared/*.json` | Prepared routes, templates and actual reader examples |
| `server.js`, `worker/index.js`, `backend/prototype.js` | Local/hosted serving with an explicit asset allowlist |

The active version does not read environment secrets, contact AI services, persist edits, send messages, book rides, or connect to a hospital. Earlier integration modules, migrations and local database files are preserved, but excluded from the shipped serving path. The prior architecture and demo guides are retained under `docs/PREVIOUS_*` for historical context only.

## Source and hosting

GitHub: [sadraaliproject/Hackathon-26](https://github.com/sadraaliproject/Hackathon-26). The Site builds a small Worker with embedded assets. Historical storage bindings remain intact; this prototype does not read or modify their data. Local `.env` files remain ignored. Public visitors can inspect the demonstration without modifying anyone else's state.
