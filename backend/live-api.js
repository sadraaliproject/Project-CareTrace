import { BARRIERS } from "../dist/ontology.js";
import { AS_OF } from "../dist/pilot-data.js";
import { validateFilters } from "./live-graph.js";
import { LIVE_LIMITS } from "./live-store.js";
import {
  runLiveAgent,
  liveSystemPrompt,
  LIVE_PROMPT_VERSION,
  liveAgentTools,
} from "./live-agent.js";

const COOKIE = "careweave_session";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const patientIdPattern = /^P\d{4}$/;
class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, code, message) => {
  throw new ApiError(status, code, message);
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function fields(body, allowed) {
  if (
    !isObject(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))
  )
    fail(400, "invalid_request", "The request contains unsupported fields.");
}
function assertId(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value))
    fail(400, "invalid_id", `Choose a valid ${label}.`);
  return value;
}
async function readBody(request, limit) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    fail(415, "content_type", "Send this request as application/json.");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    fail(413, "request_too_large", "The request is too large.");
  if (!request.body)
    fail(400, "invalid_json", "A JSON request body is required.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        fail(413, "request_too_large", "The request is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(400, "invalid_json", "The request body must contain valid JSON.");
  }
}

function sameOrigin(request, hosted) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (
    fetchSite === "cross-site" ||
    (origin && origin !== new URL(request.url).origin) ||
    (hosted && !origin)
  )
    fail(
      403,
      "origin",
      "Open Careweave directly to make changes in your demo session.",
    );
}

function taskDraft(graph, patientId, barrier) {
  assertId(patientId, patientIdPattern, "patient");
  if (!Object.hasOwn(BARRIERS, barrier))
    fail(400, "invalid_barrier", "Choose one of the four supported barriers.");
  const patient = graph.getPatient(patientId);
  if (!patient) fail(404, "not_found", "This patient was not found.");
  const assertions = patient.barriers.filter((item) => item.type === barrier);
  if (!assertions.length)
    fail(
      409,
      "no_evidence",
      "This patient has no current evidence for that barrier.",
    );
  const evidence = assertions.map((item) => {
    const sourceId = item.documentId || item.note_id;
    const source = graph.source(sourceId);
    if (!source)
      fail(
        409,
        "missing_evidence",
        "The source for this barrier could not be verified.",
      );
    return {
      sourceId,
      patientId,
      quote: item.quote || item.evidence_sentence,
      charSpan: item.char_span ?? null,
      date: item.date,
      noteType: item.note_type,
      confidence: item.confidence,
      sourceKind: item.sourceKind || "note",
    };
  });
  const definition = BARRIERS[barrier];
  return {
    id: crypto.randomUUID(),
    patientId,
    barrier,
    title: `${definition.label}: review support for ${patient.name}`,
    body: `${definition.action}\n\nReview the linked evidence and confirm the patient's current needs before taking any action. This draft is a synthetic demonstration; approval does not contact anyone or arrange services.`,
    owner: definition.owner,
    evidence,
  };
}

export function createLiveApi({
  graph,
  store,
  config = () => ({}),
  agent = runLiveAgent,
  now = Date.now,
} = {}) {
  if (!graph || !store)
    throw new Error("The graph and durable store are required.");
  const limits = store.limits || LIVE_LIMITS;
  return async function handleLiveRequest(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/v1/")) return null;
    const headers = new Headers({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    const respond = (value, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    try {
      const settings = config() || {};
      const method = request.method;
      if (!["GET", "POST", "PATCH"].includes(method))
        fail(405, "method", "This method is not supported.");
      if (method !== "GET") sameOrigin(request, settings.hosted);
      let sessionId = request.headers
        .get("cookie")
        ?.split(";")
        .map((item) => item.trim())
        .find((item) => item.startsWith(`${COOKIE}=`))
        ?.slice(COOKIE.length + 1);
      if (
        !sessionId ||
        !uuid.test(sessionId) ||
        !(await store.hasSession(sessionId, now()))
      ) {
        sessionId = crypto.randomUUID();
        headers.set(
          "set-cookie",
          `${COOKIE}=${sessionId}; Path=/api/v1; HttpOnly; SameSite=Strict; Max-Age=${limits.sessionDays * 86400}${url.protocol === "https:" ? "; Secure" : ""}`,
        );
      }
      await store.session(sessionId, now());
      const route = url.pathname.slice("/api/v1".length);
      if (route === "/status" && method === "GET")
        return respond({
          ok: true,
          mode: settings.apiKey ? "openai" : "rules",
          aiConfigured: Boolean(settings.apiKey),
          storage: { kind: store.kind, persistent: store.persistent },
          promptVersion: LIVE_PROMPT_VERSION,
          limits,
          synthetic: true,
          asOf: AS_OF,
        });
      if (route === "/overview" && method === "GET")
        return respond(graph.overview());
      if (route === "/agent" && method === "GET")
        return respond({
          prompt: liveSystemPrompt,
          version: LIVE_PROMPT_VERSION,
          tools: liveAgentTools,
        });
      if (route === "/runs" && method === "GET")
        return respond({ runs: await store.listRuns(sessionId) });
      const runMatch = route.match(/^\/runs\/([^/]+)$/);
      if (runMatch && method === "GET") {
        assertId(runMatch[1], uuid, "saved investigation");
        const result = await store.getRun(sessionId, runMatch[1]);
        if (!result)
          fail(
            404,
            "not_found",
            "This investigation was not found in your session.",
          );
        return respond(result);
      }
      const patientMatch = route.match(/^\/patients\/([^/]+)$/);
      if (patientMatch && method === "GET") {
        const id = assertId(patientMatch[1], patientIdPattern, "patient");
        const asOf = url.searchParams.get("asOf") || AS_OF;
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
          !Number.isFinite(Date.parse(asOf)) ||
          new Date(asOf).toISOString().slice(0, 10) !== asOf ||
          asOf > AS_OF ||
          asOf < "2025-01-01"
        )
          fail(
            400,
            "invalid_date",
            "Choose a valid date on or before the demo's reference date.",
          );
        if (!graph.getPatient(id))
          fail(404, "not_found", "This patient was not found.");
        const patientGraph = graph.patientGraph(id, { asOf });
        return respond({
          patient: patientGraph.patient || graph.getPatient(id, { asOf }),
          graph: patientGraph,
          asOf,
        });
      }
      const sourceMatch = route.match(/^\/sources\/([^/]+)$/);
      if (sourceMatch && method === "GET") {
        let decoded;
        try {
          decoded = decodeURIComponent(sourceMatch[1]);
        } catch {
          fail(400, "invalid_id", "Choose a valid source.");
        }
        const id = assertId(decoded, /^[A-Za-z0-9:._-]{1,100}$/, "source");
        const source = graph.source(id);
        if (!source) fail(404, "not_found", "This source was not found.");
        return respond(source);
      }
      if (route === "/tasks" && method === "GET")
        return respond({ tasks: await store.listTasks(sessionId) });
      if (route === "/tasks" && method === "POST") {
        const body = await readBody(request, limits.requestBytes);
        fields(body, ["patientId", "barrier"]);
        const result = await store.createTask(
          sessionId,
          taskDraft(graph, body.patientId, body.barrier),
          now(),
        );
        if (result.limitReached)
          fail(
            429,
            "task_limit",
            "This demo session has reached its task limit.",
          );
        return respond(result, result.created ? 201 : 200);
      }
      const taskMatch = route.match(/^\/tasks\/([^/]+)$/);
      if (taskMatch && method === "PATCH") {
        assertId(taskMatch[1], uuid, "task");
        const body = await readBody(request, limits.requestBytes);
        fields(body, ["status"]);
        if (!["draft", "approved", "completed"].includes(body.status))
          fail(400, "invalid_status", "Choose draft, approved, or completed.");
        const result = await store.updateTask(
          sessionId,
          taskMatch[1],
          body.status,
          now(),
        );
        if (result.error === "not_found")
          fail(404, "not_found", "This task was not found in your session.");
        if (result.error === "invalid_transition")
          fail(
            409,
            "invalid_transition",
            "A draft needs approval before completion. Completed tasks cannot be reopened.",
          );
        if (result.error)
          fail(
            409,
            "conflict",
            "This task changed. Reload it before trying again.",
          );
        return respond(result);
      }
      if (route === "/what-if" && method === "POST") {
        const body = await readBody(request, limits.requestBytes);
        fields(body, ["patientId", "barrier", "filters"]);
        taskDraft(graph, body.patientId, body.barrier);
        try {
          return respond(graph.whatIf(body));
        } catch {
          fail(
            400,
            "invalid_simulation",
            "These simulation filters are not supported.",
          );
        }
      }
      if (route === "/investigate" && method === "POST") {
        const body = await readBody(request, limits.requestBytes);
        fields(body, ["question", "previousFilters", "mode"]);
        if (
          typeof body.question !== "string" ||
          body.question.trim().length < 3 ||
          body.question.length > limits.maxQuestionCharacters
        )
          fail(
            400,
            "invalid_question",
            `Ask a question using 3–${limits.maxQuestionCharacters} characters.`,
          );
        if (body.mode !== undefined && !["auto", "rules"].includes(body.mode))
          fail(400, "invalid_mode", "Choose auto or rules mode.");
        if (
          body.previousFilters !== undefined &&
          !isObject(body.previousFilters)
        )
          fail(400, "invalid_filters", "Previous filters must be an object.");
        if (body.previousFilters !== undefined) {
          try {
            validateFilters(body.previousFilters, graph.describe().units);
          } catch {
            fail(
              400,
              "invalid_filters",
              "These previous filters are not supported.",
            );
          }
        }
        const apiKey = body.mode === "rules" ? null : settings.apiKey;
        const runId = crypto.randomUUID();
        if (!(await store.reserveRun(sessionId, runId, Boolean(apiKey), now())))
          fail(
            429,
            "run_limit",
            "The demonstration's investigation budget has been reached. Please try again later.",
          );
        const abort = new AbortController();
        const onAbort = () => abort.abort(request.signal.reason);
        request.signal.addEventListener("abort", onAbort, { once: true });
        if (request.signal.aborted) onAbort();
        const encoder = new TextEncoder();
        let disconnected = false,
          timer;
        const stream = new ReadableStream({
          start(controller) {
            const send = (event, value) => {
              if (disconnected) return;
              try {
                controller.enqueue(
                  encoder.encode(
                    `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
                  ),
                );
              } catch {
                disconnected = true;
                abort.abort();
              }
            };
            void (async () => {
              try {
                const timeout = new Promise((_, reject) => {
                  timer = setTimeout(() => {
                    abort.abort();
                    reject(
                      new ApiError(
                        504,
                        "timeout",
                        "The investigation took too long. Please try again.",
                      ),
                    );
                  }, limits.runTimeoutMs);
                });
                const result = await Promise.race([
                  agent({
                    question: body.question.trim(),
                    previousFilters: body.previousFilters,
                    graph,
                    apiKey,
                    model: settings.model,
                    fetchImpl: settings.fetchImpl,
                    signal: abort.signal,
                    onEvent: (event) => send("step", event),
                  }),
                  timeout,
                ]);
                if (!disconnected && !abort.signal.aborted) {
                  const saved = await store.saveRun(
                    sessionId,
                    runId,
                    body.question.trim(),
                    {
                      ...result,
                      question: body.question.trim(),
                      datasetVersion: `${AS_OF}.hospital-demo`,
                    },
                    now(),
                  );
                  send("result", saved);
                }
              } catch (error) {
                if (!disconnected)
                  send("error", {
                    error: {
                      code:
                        error instanceof ApiError
                          ? error.code
                          : "investigation_failed",
                      message:
                        error instanceof ApiError
                          ? error.message
                          : "The investigation could not finish. Try again or choose rules mode.",
                    },
                  });
              } finally {
                clearTimeout(timer);
                request.signal.removeEventListener("abort", onAbort);
                if (!disconnected) {
                  disconnected = true;
                  try {
                    controller.close();
                  } catch {}
                }
              }
            })();
          },
          cancel() {
            disconnected = true;
            abort.abort();
            clearTimeout(timer);
            request.signal.removeEventListener("abort", onAbort);
          },
        });
        headers.set("content-type", "text/event-stream; charset=utf-8");
        headers.set("x-accel-buffering", "no");
        return new Response(stream, { headers });
      }
      fail(404, "not_found", "This API route was not found.");
    } catch (error) {
      if (error instanceof ApiError)
        return respond(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      return respond(
        {
          error: {
            code: "storage_unavailable",
            message:
              "The saved workspace is temporarily unavailable. Please try again.",
          },
        },
        503,
      );
    }
  };
}
