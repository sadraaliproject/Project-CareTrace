// Sites verifies these identity headers at its dispatch boundary. The local
// server binds to loopback and uses an explicit local demo workspace instead.
export function requestAccess(request, settings, storage) {
  if (storage === "sqlite")
    return {
      mode: "local",
      canWrite: true,
      canUsePaidAI: true,
      signInPath: null,
    };
  const id = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  const staff = new Set(
    String(settings.staffEmails || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const allowed = Boolean(id && email && staff.has(email));
  return {
    mode: allowed ? "staff" : "visitor",
    canWrite: allowed,
    canUsePaidAI: allowed,
    signInPath: "/signin-with-chatgpt?return_to=%2F",
  };
}

export function integrationStatus(settings) {
  return {
    gemini: {
      configured: Boolean(settings.geminiApiKey),
      model: settings.geminiModel || "gemini-3.8-flash",
    },
    elevenLabs: {
      configured: Boolean(
        settings.elevenLabsApiKey && settings.elevenLabsVoiceId,
      ),
      model: settings.elevenLabsModel || "eleven_flash_v2_5",
    },
  };
}

export function changesSharedData(path, method) {
  return (
    (path === "/api/seed" && method === "POST") ||
    (path === "/api/tasks" && method === "POST") ||
    (/^\/api\/tasks\/[^/]+$/.test(path) &&
      ["PATCH", "DELETE"].includes(method)) ||
    (/^\/api\/patients\/[^/]+\/documents$/.test(path) && method === "POST")
  );
}
