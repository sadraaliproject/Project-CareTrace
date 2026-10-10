# Optional services and judging setup

> Archived setup for the earlier care-brief implementation. The current workspace uses the OpenAI investigation agent described in [README](../README.md) and [LIVE_WORKSPACE](LIVE_WORKSPACE.md). The current workspace now supports Gemini to order verified care-team steps through the patient’s **Prepare Gemini care brief** button. The earlier staff-sign-in flow remains archived. The current workspace now supports ElevenLabs for reading approved care-team tasks, with exact text preview and explicit generation. Follow the current README for that feature; the sections below describe the earlier care studio.

Careweave's graph, exact SQL counts, source evidence and English/Spanish care briefs work with the synthetic local dataset. Device speech is available when the browser has a compatible voice. Gemini and ElevenLabs are optional live services; an API key or a green configuration indicator alone does not establish a successful live call.

## What fits the project

The [Hacklanta prize page](https://www.mlh.com/events/hacklanta-db/prizes) lists the following opportunities. These are project mappings, not confirmed contest eligibility. Check the event's current submission rules and demonstrate actual service use before selecting a category.

| Category                                    | Careweave use                                                     | Current boundary                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Best Use of Gemini API                      | Order existing care actions using the patient's verified evidence | Optional integration; live verification requires a configured key and a successful request                  |
| Best Use of ElevenLabs                      | Read the exact reviewed care brief aloud                          | Optional integration; live verification requires a configured key, permitted voice and a successful request |
| DEV Writing Challenge                       | Explain how the graph connects hospital tables to clinical notes  | [Article draft](./DEV_ARTICLE_DRAFT.md) only; not published or submitted                                    |
| Best Use of Auth0                           | No integration in this build                                      | Staff writes use the hosting platform's verified sign-in, not Auth0                                         |
| Tiger Data, Solana, Vultr, GoDaddy Registry | No integration in this build                                      | Adding another database, transaction network, host or domain was unnecessary for this workflow              |

More logos are not evidence of a better solution. The demonstration should explain what a service does, what is locally computed and what was actually tested.

## Add keys locally

1. The account owner personally signs in, accepts the service terms and creates each key. Review quotas and pricing before choosing a paid option. This setup does not create accounts or authorize purchases.
2. If `.env` does not exist, copy `.env.example` to `.env`. If it already exists, add only the missing settings; do not overwrite it.
3. Enter keys in the local `.env` file. Never paste them into chat, frontend code, screenshots, a Git commit or an article. `.env` is ignored by Git.
4. Restart the local server and test each enabled service. Leave keys empty to continue using the local brief. Start the local demonstration at [127.0.0.1:4173](http://127.0.0.1:4173).

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL=eleven_flash_v2_5
CAREWEAVE_STAFF_EMAILS=
```

Get a Gemini key through [Google AI Studio](https://aistudio.google.com/apikey) and follow [Google's API-key instructions](https://ai.google.dev/gemini-api/docs/api-key). Gemini receives the permitted action choices and their evidence. Its structured answer is validated before use; it cannot supply new medication instructions or replace the SQL count. See [structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output).

Create an ElevenLabs key in your [ElevenLabs account](https://elevenlabs.io/app/settings/api-keys). Select an available voice and copy its ID to `ELEVENLABS_VOICE_ID`. The backend sends the exact reviewed brief to the [text-to-speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), using `eleven_flash_v2_5` unless changed. Playback remains an explicit user action. The displayed transcript stays available. Device speech is labeled separately and does not demonstrate ElevenLabs use.

## Configure the hosted demonstration separately

A local `.env` file does not configure the published website. Add the same optional service settings through the site's runtime-secret settings. Do not put keys in the site source or public asset files. Restart or redeploy as required by the hosting settings, then repeat the live checks on the published URL.

For staff writes, set `CAREWEAVE_STAFF_EMAILS` to the owner's verified sign-in email, or an explicit comma-separated set of trusted staff emails. Hosted approval and evidence changes require a verified sign-in matching this allowlist. Public viewing does not grant staff access. Do not include a wildcard. Local loopback mode is for the synthetic rehearsal, not a public staff-authentication system.

## Verify before presenting

- Run `npm run check`, `npm test`, `npm run build`, and `node scripts/verify-worker.js`.
- Automatic service tests use simulated HTTP responses. They exercise request shapes, validation and failures; they do not prove credentials, model access, quotas or speech quality.
- Run a real Gemini request with your intended account. Confirm the app reports the actual service used and each selected action still links to valid evidence.
- Generate ElevenLabs audio from a reviewed brief. Listen to the entire clip and compare it to the visible text, especially names, numbers and Spanish pronunciation. Verify an unavailable voice or rejected key produces a clear error.
- Check public viewing and staff-only writes separately. Test denial while signed out, then test a staff action with the permitted account.
- Add a later synthetic note and verify the old brief or approval is no longer usable without review. Do not present earlier audio as a current approved brief.

Until those service calls succeed, describe the integration as implemented with live verification pending. The demonstration uses synthetic records only and does not send messages, schedule visits or change medication orders.

## Three-minute judging route

| Time      | Show                                                                                       | Explain                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | Search the clinical notes with the main question below                                     | Search finds passages. It does not compute the hospital-wide answer.                                                                                           |
| 0:30–1:00 | Run the graph investigation with the same question                                         | The fresh synthetic baseline returns **78** patients. The exact count comes from SQL; modified rehearsal data can change it.                                   |
| 1:00–1:35 | Open **P0412**, then her evidence graph and bedside nursing note                           | The missed visit and uncollected insulin connect to a documented transport barrier, even without a coded social need.                                          |
| 1:35–2:10 | Open her care brief, inspect its evidence and switch to Spanish                            | A patient-friendly handoff preserves the known facts and permitted next steps. Identify local text versus a successful Gemini action-ordering call accurately. |
| 2:10–2:30 | Review the brief and play its audio                                                        | The audible message matches the reviewed text. Identify ElevenLabs or device speech accurately. Nothing is sent to a patient.                                  |
| 2:30–3:00 | Preview a resolved transport sentence; for the prepared staff rehearsal, save it and rerun | New evidence changes the current answer and invalidates outdated work. The graph is a record of what supports today's action.                                  |

Main question:

> Which patients discharged after a diabetes-related admission have an open follow-up gap and a documented barrier we can act on, and what is the right action for each?

Later synthetic note for the prepared rehearsal:

> Patient states her daughter now drives her to clinic. Transportation is no longer a problem.

Do this last: it changes the current dataset. On a fresh local rehearsal, stop the server before using `npm run demo:reset -- --confirm`, then restart. The reset archives local state and does not reset the published website.

Close with: **“The answer was already in our own notes. The graph is what lets us ask for it.”**
