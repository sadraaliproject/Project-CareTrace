# CareTrace

**Find the missed care. Understand the reason. Prepare the next step.**

CareTrace connects dated hospital records and nursing notes in an inspectable patient graph. The workspace turns a question into a counted group of patients, exact evidence, and a care-team task ready for human review.

[Open CareTrace](https://caretrace.us/) · [GitHub](https://github.com/sadraaliproject/Hackathon-26)

## Start locally

Use Node.js 24 or newer:

```sh
npm ci
npm start
```

Open [localhost:4173](http://localhost:4173). VS Code's **CareTrace: Run and debug** configuration also starts the workspace. A local SQLite database is initialized at `data/careweave-live.sqlite`; it is ignored by Git.

The app works immediately in **rules mode**. For real model-driven investigations, copy `.env.example` to `.env`, add `OPENAI_API_KEY`, and keep the key local. Restart the local server after adding or changing the key. `OPENAI_MODEL` selects the model; the default is `gpt-4.1-mini`. The public Site has separate server secrets and does not receive local `.env` values automatically.

## A three-minute demonstration

1. Start with Mavis: the missed visit and medicine pickup are visible, but the reason is in a bedside note.
2. Ask **Which discharged patients have a follow-up gap and a documented barrier?** The backend computes the group and shows the filters and actual tool results.
3. Open a patient. Follow the graph to the original sentence, its author, and its date. Compare today with discharge day.
4. Try a different question or narrow the result by age or hospital unit. Inspect the actual agent prompt and available tools.
5. Prepare a care task, review its evidence, and approve it in the demo queue. Reload: the task and investigation remain in this browser's server session.

The earlier nine-screen presentation is preserved at [Guided story](https://caretrace.us/story.html). It is labeled as a prepared presentation; its browser-local simulations do not change the live workspace.

## What runs on the backend

- **Graph service:** builds the hospital evidence graph from the versioned synthetic dataset and executes validated, composable filters. The backend computes exact counts and stable result fingerprints.
- **OpenAI agent:** uses the Responses API with strict function schemas, bounded tool calls, timeouts, and an inspectable versioned system prompt. It queries the graph, inspects patients, reads sources, and can request a reversible what-if calculation. Source text is treated as evidence, never as instructions.
- **Rules mode:** a separate, honestly labeled parser handles supported questions without a key. It does not silently call a prepared answer "AI". Unsupported questions return a useful error; model failures do not silently become successful AI results.
- **Evidence:** exact note spans and source IDs accompany the result. The server composes the factual answer from executed tools so generated wording cannot replace the calculated count.
- **Durability:** SQLite locally and D1 on the public Site store investigations, review tasks, and usage reservations. The synthetic source dataset remains immutable and versioned in Git. Graph calculations run in server memory over that dataset; no Neo4j service is claimed.
- **Visitor isolation:** an opaque HttpOnly session cookie separates each visitor's saved work. Viewing or trying the public demo does not edit the source or another visitor's queue. This is browser-session persistence, not cross-device staff identity.
- **Review workflow:** draft → approved → completed. These are demonstration task states; no message is sent, no ride is booked, and no clinical record is changed.

The live workspace uses a versioned text-pattern reader with regression fixes for explicit resolutions and separate clauses. The guided story retains its original frozen reader. Both measure 89.09% precision and 90.74% recall on the independent synthetic note labels; a model investigation does not make extraction clinically validated. The fixed reference date is October 10, 2026; all 1,000 people and 600 notes are fictional.

## Verify

```sh
npm run check
npm test
npm run verify:pilot
npm run build
node scripts/verify-worker.js
```

The tests cover graph filters, source references, real function-call orchestration with a mocked OpenAI transport, session separation, task transitions, durable storage, and HTTP behavior. The Worker check runs the production bundle against a SQLite-backed D1 adapter and the actual migrations. Mocked model tests do not establish account access or real model behavior; a live smoke test is required after adding a key.

The new migration is additive. Older migration history and earlier integration regressions are retained. Current source uses hospital and care-team language; the audit reports immutable historical exceptions explicitly.

## Key files

| Area                               | Files                                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Workspace                          | `dist/workspace.js`, `workspace.css`, `workspace-graph.js`                                           |
| HTTP integration                   | `server.js`, `worker/index.js`, `backend/live-api.js`                                                |
| Agent and prompt                   | `backend/live-agent.js`, `backend/prompts/investigator.js`                                           |
| Graph tools                        | `backend/live-graph.js`                                                                              |
| Persistence                        | `backend/live-store.js`, `backend/live-sqlite.js`, `db/schema.js`, `drizzle/0002_live_workspace.sql` |
| Guided story                       | `dist/story.html`, `pilot-app.js`, `pilot.css`, `pilot-engine.js`                                    |
| Synthetic data and measured reader | `dist/pilot-data.js`, `pilot-reader.js`, `pilot-labels.js`                                           |

Read [the presenter guide](DEMO.md), [the release checklist](docs/RELEASE_CHECKLIST.md), [the agent architecture](docs/LIVE_WORKSPACE.md), and [the guided story extraction measurements](docs/ENHANCEMENT_REPORT.md). Earlier integrations under `backend/agent.js`, `backend/api.js`, and the archived server are retained for reference and regression checks, but are not the active workspace API.

## Reviewed task audio

Approved or completed tasks offer an exact-text preview and ElevenLabs MP3 generation. Configure ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and optional ELEVENLABS_MODEL (default eleven_flash_v2_5) in the ignored local .env or protected Sites runtime settings. Restart locally or redeploy after changes. Audio reads the server-owned care-team task verbatim; it is not a patient instruction, clinical translation, booking or patient contact. Only session-owned reviewed tasks are eligible. Requests share the durable AI budget (12 per session/hour and 50 globally/day), have a 25-second service timeout and a 2 MB audio cap. Playback/download is browser-local and closing the dialog releases the audio. The earlier care studio remains archived.

## Evidence-linked Gemini care brief

Set GEMINI_API_KEY in the ignored .env or protected Sites runtime settings; GEMINI_MODEL defaults to gemini-3.1-flash-lite. Open a patient’s next step and choose **Prepare Gemini care brief**. Gemini orders existing, evidence-linked barrier support, missed-visit and medication-pickup steps. The server accepts every permitted ID exactly once and preserves the original action wording and individual source links. Unsupported output is rejected. Inspect the actual instructions in the brief, then prepare individual tasks for human review. Gemini does not calculate patient counts or automatically approve tasks. Requests share the durable AI budget and have a 25-second timeout.
