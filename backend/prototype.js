export const PUBLIC_ASSETS = Object.freeze([
  "index.html",
  "story.html",
  "workspace.js",
  "workspace.css",
  "workspace-graph.js",
  "pilot.css",
  "pilot-app.js",
  "pilot-graph.js",
  "pilot-engine.js",
  "pilot-data.js",
  "pilot-reader.js",
  "pilot-labels.js",
  "pilot-support.js",
  "ontology.js",
  "prepared/plans.json",
  "prepared/explanations.json",
  "prepared/reading.json",
]);

export function prototypeResponse(path, method = "GET") {
  if (path.startsWith("/api/")) {
    if (path === "/api/status" && ["GET", "HEAD"].includes(method))
      return Response.json(
        {
          ok: true,
          mode: "guided-prototype",
          synthetic: true,
          asOf: "2026-10-10",
          externalRequests: false,
          persistence: "browser-memory",
          preparedQuestions: 15,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    return Response.json(
      {
        error:
          "This demonstration runs in browser memory. External service and shared editing endpoints are disabled.",
      },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!["GET", "HEAD"].includes(method))
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  return null;
}
