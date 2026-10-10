const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );

const dateLabel = (value) => {
  if (!value) return "Date not recorded";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? "Date not recorded"
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
};

const button = (
  text,
  command,
  { disabled = false, className = "", attributes = "" } = {},
) =>
  `<button type="button" class="btn ${className}" data-cmd="studio-${command}" ${disabled ? "disabled" : ""} ${attributes}>${text}</button>`;

const canSpeak = () =>
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  "SpeechSynthesisUtterance" in window;

export function createCareStudio({ api, toast, onGraph, onPatient, rerender }) {
  const state = {
    patientId: "P0412",
    language: "en",
    engine: "local",
    patients: [],
    status: {},
    brief: null,
    reviewed: false,
    loading: false,
    audioLoading: false,
    audioUrl: null,
    error: "",
    speaking: false,
    active: false,
    checking: false,
    audioPlaying: false,
  };
  let sequence = 0;
  let audioRequest;
  let utterance;
  let playback;

  function draw(focusId) {
    if (!state.active) return;
    rerender();
    if (focusId)
      document.getElementById(focusId)?.focus({ preventScroll: true });
  }

  function stopMedia() {
    if (utterance && canSpeak()) window.speechSynthesis.cancel();
    utterance = null;
    state.speaking = false;
    audioRequest?.abort();
    audioRequest = null;
    playback?.pause();
    playback = null;
    state.audioPlaying = false;
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = null;
    state.audioLoading = false;
  }

  function clearBrief() {
    sequence += 1;
    stopMedia();
    state.brief = null;
    state.reviewed = false;
    state.loading = false;
    state.checking = false;
    state.error = "";
  }

  function readiness() {
    const integrations = state.status.integrations || {};
    const paid = Boolean(state.status.access?.canUsePaidAI);
    return {
      gemini: Boolean(integrations.gemini?.configured),
      elevenLabs: Boolean(integrations.elevenLabs?.configured),
      paid,
    };
  }

  function evidenceHtml(brief) {
    return `<aside class="studio-evidence" aria-labelledby="studio-evidence-title">
      <div class="studio-section-top"><div><div class="eyebrow">FOLLOW THE EVIDENCE</div><h2 id="studio-evidence-title">Why these next steps?</h2></div><span class="studio-count">${brief.evidence.length}</span></div>
      <p>Every numbered source below is tied to this fictional patient. Open the graph to inspect the connections.</p>
      ${button("Explore patient graph ↗", "graph", { className: "secondary studio-wide" })}
      <div class="studio-sources">${
        brief.evidence
          .map(
            (
              source,
              index,
            ) => `<article class="studio-source" id="studio-source-${index}" tabindex="-1">
        <header><span class="studio-source-number">${index + 1}</span><div><b>${escapeHtml(source.label || source.kind)}</b><small>${escapeHtml(dateLabel(source.date))} · ${escapeHtml(source.sourceId || source.id)}</small></div></header>
        ${source.kind === "note" ? `<blockquote>${escapeHtml(source.quote)}</blockquote>` : `<p class="studio-record-fact">${escapeHtml(source.quote)}</p>`}
        <span class="studio-source-kind">${source.kind === "note" ? "Exact note excerpt" : "Fact from hospital records"}</span>
      </article>`,
          )
          .join("") ||
        '<div class="studio-note">No source excerpts are available for this brief.</div>'
      }</div>
      <div class="studio-note">The graph connects hospital facts, recorded reasons, and approved next steps. A new note means this brief needs a fresh review.</div>
    </aside>`;
  }

  function briefHtml() {
    const brief = state.brief;
    if (!brief) {
      return `<div class="studio-empty"><div class="studio-empty-mark" aria-hidden="true">↗</div><div class="eyebrow">A HANDOFF THAT MAKES SENSE</div><h2>Turn a recorded reason<br>into a clear next step.</h2><p>Choose a patient and prepare a brief. You can follow each step back to its evidence, review the exact words, then hear them aloud.</p><div class="studio-empty-trail" aria-label="Brief workflow"><span>Patient evidence</span><i aria-hidden="true">→</i><span>Clear next steps</span><i aria-hidden="true">→</i><span>Reviewed audio</span></div><p class="studio-empty-footnote">Local briefs work now. Gemini and ElevenLabs become available after the owner connects their accounts.</p></div>`;
    }
    const ready = readiness();
    const sourceIndexes = new Map(
      brief.evidence.map((source, index) => [source.id, index]),
    );
    const isSpanish = brief.language === "es";
    const voiceReason = !ready.elevenLabs
      ? "ElevenLabs is not connected. Device voice is available when your browser supports it."
      : !ready.paid
        ? "ElevenLabs audio is available to signed-in staff. You can use device voice in this preview."
        : "ElevenLabs reads only the reviewed brief. Audio is generated when you choose it.";
    return `<div class="studio-result-grid"><section class="studio-brief" aria-labelledby="studio-brief-title">
      <div class="studio-brief-header"><div><div class="eyebrow">${escapeHtml(brief.patientId)} · FICTIONAL PATIENT</div><h2 id="studio-brief-title" tabindex="-1">${escapeHtml(brief.patientName)}</h2></div><span class="pill ${brief.engine === "gemini" ? "purple" : "green"}">${brief.engine === "gemini" ? "Gemini prioritized" : "Local brief"}</span></div>
      <div class="studio-brief-intro"><span>${isSpanish ? "SUS PRÓXIMOS PASOS" : "YOUR NEXT STEPS"}</span><p>${isSpanish ? "Un plan claro para hablar con su equipo de atención." : "A clear plan to discuss with your care team."}</p></div>
      <ol class="studio-steps" lang="${isSpanish ? "es" : "en"}">${
        brief.items
          .map(
            (item, index) =>
              `<li><span class="studio-step-number" aria-hidden="true">${index + 1}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.text)}</p><div class="studio-source-links" aria-label="Supporting evidence">${item.evidenceIds
                .filter((id) => sourceIndexes.has(id))
                .map((id) =>
                  button(`Source ${sourceIndexes.get(id) + 1} ↗`, "source", {
                    className: "small",
                    attributes: `data-source-index="${sourceIndexes.get(id)}" aria-label="Read source ${sourceIndexes.get(id) + 1}"`,
                  }),
                )
                .join("")}</div></div></li>`,
          )
          .join("") ||
        "<li><p>No eligible next steps were found in the current evidence.</p></li>"
      }</ol>
      <div class="studio-teachback" lang="${isSpanish ? "es" : "en"}"><span aria-hidden="true">“</span><div><h3>${isSpanish ? "Con sus propias palabras" : "In your own words"}</h3><p>${escapeHtml(brief.teachBackQuestion)}</p><small>${isSpanish ? "Una pregunta para conversar, no una prueba." : "A conversation starter, not a test."}</small></div></div>
      <details class="studio-transcript"><summary>Read the exact audio script</summary><p lang="${isSpanish ? "es" : "en"}">${escapeHtml(brief.transcript)}</p></details>
      <div class="studio-review ${state.reviewed ? "is-reviewed" : ""}"><label for="studio-reviewed"><input id="studio-reviewed" type="checkbox" ${state.reviewed ? "checked" : ""}><span><b>I reviewed this brief and its evidence.</b><small>This review applies to this version only. Nothing is sent to a patient.</small></span></label></div>
      <div class="studio-audio-section"><div class="studio-section-top"><div><div class="eyebrow">THE SAME WORDS, HEARD ALOUD</div><h3>Listen before sharing</h3></div>${state.audioUrl ? '<span class="pill green">ElevenLabs audio ready</span>' : ""}</div>
        <div class="studio-audio-actions">${button(state.audioLoading ? "Creating audio…" : "Create ElevenLabs audio", "audio", { className: "primary", disabled: !state.reviewed || !ready.elevenLabs || !ready.paid || state.audioLoading || state.checking })}${button(state.speaking ? "Stop device voice" : "Listen with device voice", "device-voice", { disabled: !state.reviewed || !canSpeak() || state.audioLoading || state.checking })}</div>
        <p class="studio-help">${escapeHtml(voiceReason)} Device voice uses your browser’s speech service and is separate from ElevenLabs.</p>
        ${!state.reviewed ? '<div class="studio-review-hint">Review the evidence and check the box above to unlock listening and downloads.</div>' : ""}
        ${!canSpeak() ? '<div class="studio-note">Device voice is not supported in this browser. The full text remains available.</div>' : ""}
        ${state.audioUrl ? `<div class="studio-player">${button(state.audioPlaying ? "Pause recording" : "Play reviewed recording ▶", "play-audio", { disabled: state.checking, className: "secondary" })}<small>${state.audioPlaying ? "Playing the exact reviewed brief." : "Evidence is checked again before playback."}</small></div>` : ""}
        <div class="studio-downloads">${button("Download reviewed text ↓", "download-text", { disabled: !state.reviewed || state.checking, className: "text-btn" })}${state.audioUrl ? button("Download MP3 ↓", "download-audio", { disabled: !state.reviewed || state.checking, className: "text-btn" }) : ""}${button("Patient details →", "patient", { className: "text-btn" })}</div>
      </div>
    </section>${evidenceHtml(brief)}</div>`;
  }

  function setupHtml() {
    const ready = readiness();
    const statusLabel = (configured) =>
      configured ? "Key configured · live call needed" : "Not connected";
    return `<details class="studio-setup"><summary><span>Demo readiness</span><small>What works now and what needs an account</small></summary><div class="studio-setup-grid"><section><span class="studio-setup-dot is-ready" aria-hidden="true"></span><h3>Ready now</h3><p>Evidence-linked English and Spanish briefs, graph inspection, reviewed text downloads, and device voice when supported.</p></section><section><span class="studio-setup-dot ${ready.gemini ? "is-ready" : ""}" aria-hidden="true"></span><h3>Gemini <small>${state.brief?.engine === "gemini" ? "Live call succeeded for this brief" : statusLabel(ready.gemini)}</small></h3><p>Prioritizes verified next steps using the patient’s recorded reasons. All steps and their evidence stay in the brief.</p><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Owner: create a Gemini key ↗</a></section><section><span class="studio-setup-dot ${ready.elevenLabs ? "is-ready" : ""}" aria-hidden="true"></span><h3>ElevenLabs <small>${state.audioUrl ? "Live call succeeded for this audio" : statusLabel(ready.elevenLabs)}</small></h3><p>Turns the exact reviewed brief into downloadable audio. Device voice does not use ElevenLabs.</p><a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">Owner: open ElevenLabs settings ↗</a></section></div><p class="studio-setup-footnote">An account key must be configured securely by the owner. A configured key is not proof of a successful live call. This screen labels the service actually used.</p></details>`;
  }

  function render({ patients = [], status = {} }) {
    state.active = true;
    state.patients = patients;
    state.status = status;
    const ready = readiness();
    if (state.engine === "gemini" && (!ready.gemini || !ready.paid)) {
      clearBrief();
      state.engine = "local";
    }
    if (
      patients.length &&
      !patients.some((patient) => patient.id === state.patientId)
    ) {
      clearBrief();
      state.patientId = patients[0].id;
    }
    const access = state.status.access || {};
    const staffNote =
      !ready.paid && (ready.gemini || ready.elevenLabs)
        ? `<div class="studio-access-note">You’re exploring a visitor preview. Live AI and shared changes are for signed-in staff.${access.signInPath ? ` <a href="${escapeHtml(access.signInPath)}" target="_top">Staff sign in →</a>` : ""}</div>`
        : "";
    return `<div class="studio-view"><div class="page-heading"><div><div class="eyebrow">FROM EVIDENCE TO UNDERSTANDING</div><h1>The next step.<br><span>In words people understand.</span></h1><p class="subtitle">Prepare a patient handoff grounded in the hospital’s own evidence. Read it, inspect the graph, then listen to the exact words you reviewed.</p></div><div class="studio-hero-note"><span aria-hidden="true">◉</span><b>One evidence trail.</b><span>Written or spoken.<br>Always reviewable.</span></div></div>
      <div class="studio-process" aria-label="Three steps to a reviewed brief"><span><b>01</b> Prepare from evidence</span><i aria-hidden="true">→</i><span><b>02</b> Review the next steps</span><i aria-hidden="true">→</i><span><b>03</b> Listen or download</span></div>
      <section class="studio-controls" aria-label="Prepare a patient handoff"><div class="studio-field studio-patient-field"><label for="studio-patient">Fictional patient</label><select id="studio-patient" ${!patients.length ? "disabled" : ""}>${patients.map((patient) => `<option value="${escapeHtml(patient.id)}" ${patient.id === state.patientId ? "selected" : ""}>${escapeHtml(patient.name)} · ${escapeHtml(patient.id)}</option>`).join("") || '<option value="">No patients loaded</option>'}</select></div><div class="studio-field"><label for="studio-language">Brief language</label><select id="studio-language"><option value="en" ${state.language === "en" ? "selected" : ""}>English</option><option value="es" ${state.language === "es" ? "selected" : ""}>Español</option></select></div><div class="studio-field"><label for="studio-engine">How to prepare it</label><select id="studio-engine"><option value="local" ${state.engine === "local" ? "selected" : ""}>Local · approved text</option><option value="gemini" ${state.engine === "gemini" ? "selected" : ""} ${!ready.gemini || !ready.paid ? "disabled" : ""}>Gemini · ${!ready.gemini ? "not connected" : !ready.paid ? "staff access needed" : "prioritize next steps"}</option></select></div>${button(state.loading ? "Preparing brief…" : state.brief ? "Refresh brief ↗" : "Prepare brief ↗", "generate", { className: "primary", disabled: !patients.length || state.loading })}</section>
      ${staffNote}${state.error ? `<div class="studio-error" role="alert"><b>The brief needs your attention.</b><span>${escapeHtml(state.error)}</span></div>` : ""}
      <div class="studio-live-status" role="status" aria-live="polite">${state.loading ? "Preparing a brief from current patient evidence…" : state.checking ? "Checking that the patient evidence is still current…" : state.audioLoading ? "Creating ElevenLabs audio from the reviewed text…" : state.speaking ? "Device voice is reading the reviewed brief." : ""}</div>
      ${briefHtml()}${setupHtml()}</div>`;
  }

  async function verifyCurrentBrief() {
    if (!state.brief || !state.reviewed || state.checking) return false;
    const brief = state.brief;
    const requestSequence = sequence;
    state.checking = true;
    state.error = "";
    draw();
    try {
      const latest = await api("/api/care-brief", {
        patientId: brief.patientId,
        language: brief.language,
        useGemini: false,
      });
      if (requestSequence !== sequence || !state.active || !state.reviewed)
        return false;
      if (latest.revision !== brief.revision) {
        clearBrief();
        state.error =
          "Patient evidence changed. Prepare a fresh brief and review it before listening or downloading.";
        draw();
        return false;
      }
      return true;
    } catch (error) {
      if (requestSequence === sequence && state.active)
        state.error =
          "Current evidence could not be checked. Reconnect and try again before listening or downloading.";
      return false;
    } finally {
      if (requestSequence === sequence && state.active) {
        state.checking = false;
        draw();
      }
    }
  }

  async function generate() {
    if (state.loading || !state.patientId) return;
    clearBrief();
    state.loading = true;
    const requestSequence = sequence;
    const input = {
      patientId: state.patientId,
      language: state.language,
      useGemini: state.engine === "gemini",
    };
    draw();
    try {
      const brief = await api("/api/care-brief", input);
      if (requestSequence !== sequence || !state.active) return;
      if (
        !brief ||
        brief.patientId !== input.patientId ||
        brief.language !== input.language ||
        !Array.isArray(brief.items) ||
        !Array.isArray(brief.evidence) ||
        !Array.isArray(brief.planIds) ||
        typeof brief.transcript !== "string" ||
        typeof brief.revision !== "string" ||
        !brief.items.every((item) => Array.isArray(item.evidenceIds))
      ) {
        throw new Error(
          "The brief could not be verified. Please prepare it again.",
        );
      }
      state.brief = brief;
      toast(
        "Brief prepared. Review the evidence before listening or downloading.",
      );
    } catch (error) {
      if (requestSequence === sequence && state.active)
        state.error =
          error.message || "The brief could not be prepared. Please try again.";
    } finally {
      if (requestSequence === sequence && state.active) {
        state.loading = false;
        draw("studio-brief-title");
      }
    }
  }

  async function createAudio() {
    const ready = readiness();
    if (
      !state.brief ||
      !state.reviewed ||
      state.audioLoading ||
      state.checking ||
      !ready.elevenLabs ||
      !ready.paid
    )
      return;
    stopMedia();
    state.audioLoading = true;
    state.error = "";
    const requestSequence = sequence;
    const brief = state.brief;
    const controller = new AbortController();
    audioRequest = controller;
    draw();
    try {
      const response = await fetch("/api/care-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          patientId: brief.patientId,
          language: brief.language,
          revision: brief.revision,
          planIds: brief.planIds,
          reviewed: true,
        }),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        if (
          response.status === 409 &&
          requestSequence === sequence &&
          state.active
        ) {
          clearBrief();
          state.error =
            "Patient evidence changed. Prepare a fresh brief and review it before creating audio.";
          draw();
          return;
        }
        throw new Error(
          problem.error || "Audio could not be created. Please try again.",
        );
      }
      if (
        !response.headers.get("Content-Type")?.toLowerCase().includes("audio/")
      ) {
        throw new Error(
          "The audio service did not return a playable recording.",
        );
      }
      const audio = await response.blob();
      if (
        requestSequence !== sequence ||
        !state.active ||
        !state.reviewed ||
        controller.signal.aborted
      )
        return;
      if (!audio.size)
        throw new Error("The audio recording was empty. Please try again.");
      state.audioUrl = URL.createObjectURL(audio);
      toast(
        "ElevenLabs audio is ready. Press play when you’re ready to listen.",
      );
    } catch (error) {
      if (
        error.name !== "AbortError" &&
        requestSequence === sequence &&
        state.active
      )
        state.error = error.message || "Audio could not be created.";
    } finally {
      if (
        requestSequence === sequence &&
        state.active &&
        audioRequest === controller
      ) {
        audioRequest = null;
        state.audioLoading = false;
        draw();
      }
    }
  }

  async function deviceVoice() {
    if (!state.brief || !state.reviewed || !canSpeak()) return;
    if (state.speaking) {
      window.speechSynthesis.cancel();
      utterance = null;
      state.speaking = false;
      draw();
      return;
    }
    if (!(await verifyCurrentBrief())) return;
    playback?.pause();
    state.audioPlaying = false;
    const speech = new SpeechSynthesisUtterance(state.brief.transcript);
    speech.lang = state.brief.language === "es" ? "es-US" : "en-US";
    speech.rate = 0.92;
    const voices = window.speechSynthesis.getVoices();
    const matchingVoice = voices.find((voice) =>
      voice.lang.toLowerCase().startsWith(state.brief.language),
    );
    if (!matchingVoice) {
      state.error = `${state.brief.language === "es" ? "A Spanish" : "An English"} device voice is not available yet. Try again after your browser loads its voices, use another browser, or download the reviewed text.`;
      draw();
      return;
    }
    speech.voice = matchingVoice;
    utterance = speech;
    state.error = "";
    state.speaking = true;
    const finish = (event) => {
      if (utterance !== speech || !state.active) return;
      utterance = null;
      state.speaking = false;
      if (
        event.type === "error" &&
        !["canceled", "interrupted"].includes(event.error)
      )
        state.error =
          "Device voice could not play. Try another browser or use the reviewed text download.";
      draw();
    };
    speech.onend = finish;
    speech.onerror = finish;
    try {
      window.speechSynthesis.speak(speech);
    } catch {
      utterance = null;
      state.speaking = false;
      state.error =
        "Device voice could not start. Use the reviewed text or try another browser.";
    }
    draw();
  }

  async function playAudio() {
    if (!state.audioUrl || !state.reviewed) return;
    if (state.audioPlaying) {
      playback?.pause();
      state.audioPlaying = false;
      draw();
      return;
    }
    if (!(await verifyCurrentBrief())) return;
    if (utterance && canSpeak()) window.speechSynthesis.cancel();
    utterance = null;
    state.speaking = false;
    const audioUrl = state.audioUrl;
    if (!playback) {
      playback = new Audio(audioUrl);
      playback.onended = () => {
        if (state.audioUrl === audioUrl && state.active) {
          state.audioPlaying = false;
          draw();
        }
      };
      playback.onerror = () => {
        if (state.audioUrl === audioUrl && state.active) {
          state.audioPlaying = false;
          state.error =
            "The recording could not be played. Download the MP3 or create it again.";
          draw();
        }
      };
    }
    try {
      await playback.play();
      if (state.audioUrl === audioUrl && state.active)
        state.audioPlaying = true;
    } catch {
      if (state.audioUrl === audioUrl && state.active)
        state.error =
          "Playback could not start. Try Play again or download the MP3.";
    }
    draw();
  }

  function download(url, filename) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  async function downloadText() {
    if (!state.brief || !state.reviewed) return;
    if (!(await verifyCurrentBrief())) return;
    const brief = state.brief;
    const contents = [
      "CAREWEAVE — REVIEWED DEMO HANDOFF",
      "Fictional patient. Prepared for a care-team conversation.",
      `${brief.patientName} (${brief.patientId})`,
      `Language: ${brief.language}`,
      `Evidence version: ${brief.revision}`,
      "",
      brief.transcript,
      "",
      "EVIDENCE",
      ...brief.evidence.map(
        (source, index) =>
          `${index + 1}. ${source.label || source.kind} (${source.sourceId || source.id}; ${source.date || "date not recorded"})\n${source.quote}`,
      ),
      "",
      "No calls, messages, medication changes, or bookings were sent.",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([contents], { type: "text/plain;charset=utf-8" }),
    );
    download(
      url,
      `careweave-${brief.patientId}-${brief.language}-reviewed.txt`,
    );
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function handleClick(command, element) {
    if (!command.startsWith("studio-")) return false;
    switch (command) {
      case "studio-generate":
        await generate();
        break;
      case "studio-audio":
        await createAudio();
        break;
      case "studio-device-voice":
        await deviceVoice();
        break;
      case "studio-play-audio":
        await playAudio();
        break;
      case "studio-download-text":
        await downloadText();
        break;
      case "studio-download-audio":
        if (
          state.reviewed &&
          state.audioUrl &&
          state.brief &&
          (await verifyCurrentBrief())
        )
          download(
            state.audioUrl,
            `careweave-${state.brief.patientId}-${state.brief.language}.mp3`,
          );
        break;
      case "studio-graph":
        await onGraph(state.patientId);
        break;
      case "studio-patient":
        await onPatient(state.patientId);
        break;
      case "studio-source": {
        const index = Number(element?.dataset.sourceIndex);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= (state.brief?.evidence.length || 0)
        )
          break;
        const evidenceCard = document.getElementById(`studio-source-${index}`);
        evidenceCard?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
          block: "center",
        });
        evidenceCard?.focus({ preventScroll: true });
        break;
      }
      default:
        return false;
    }
    return true;
  }

  function handleChange(event) {
    const target = event.target;
    switch (target?.id) {
      case "studio-patient":
        if (!state.patients.some((patient) => patient.id === target.value))
          return true;
        clearBrief();
        state.patientId = target.value;
        break;
      case "studio-language":
        if (!["en", "es"].includes(target.value)) return true;
        clearBrief();
        state.language = target.value;
        break;
      case "studio-engine":
        if (
          !["local", "gemini"].includes(target.value) ||
          (target.value === "gemini" &&
            (!readiness().gemini || !readiness().paid))
        )
          return true;
        clearBrief();
        state.engine = target.value;
        break;
      case "studio-reviewed":
        if (!state.brief) return true;
        state.reviewed = Boolean(target.checked);
        if (!state.reviewed) {
          sequence += 1;
          stopMedia();
          state.checking = false;
        }
        break;
      default:
        return false;
    }
    draw(target.id);
    return true;
  }

  return {
    render,
    handleClick,
    handleChange,
    open(patientId) {
      clearBrief();
      if (patientId) state.patientId = patientId;
    },
    invalidate() {
      clearBrief();
    },
    dispose() {
      sequence += 1;
      state.active = false;
      stopMedia();
      state.reviewed = false;
      state.loading = false;
      state.checking = false;
    },
  };
}
