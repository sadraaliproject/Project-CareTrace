const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const TYPE = {
  Patient: { name: "Patient", icon: "◎", color: "mint" },
  Appointment: { name: "Follow-up visit", icon: "↗", color: "sand" },
  Medication: { name: "Medication", icon: "Rx", color: "blue" },
  ClinicalNote: { name: "Clinical note", icon: "≋", color: "lilac" },
  Barrier: { name: "Documented reason", icon: "◈", color: "lilac" },
  Action: { name: "Next step", icon: "✓", color: "mint" },
  FollowUpGap: { name: "Follow-up gap", icon: "!", color: "sand" },
  Admission: { name: "Hospital stay", icon: "▥", color: "blue" },
  Condition: { name: "Condition", icon: "+", color: "blue" },
  LabResult: { name: "Lab result", icon: "⌁", color: "sand" },
};
const HUMAN = {
  transportation: "Needs a way to the visit",
  cost: "Cannot afford medication",
  food: "Not enough food at home",
  health_literacy: "Needs clearer instructions",
};
function detail(n) {
  const p = n.properties || {},
    kind = TYPE[n.type] || TYPE.Condition;
  let title = n.label || n.id,
    sub = "";
  if (n.type === "Patient") {
    title = p.name || title;
    sub = p.age ? `Age ${p.age} · ${p.id || n.id}` : n.id;
  }
  if (n.type === "Appointment") {
    title =
      p.status === "no_show" || p.status === "no-show"
        ? "Follow-up visit missed"
        : p.status === "completed"
          ? "Follow-up completed"
          : "Follow-up scheduled";
    sub = p.clinic || "Clinic appointment";
  }
  if (n.type === "Medication") {
    title = p.name || title;
    sub = p.pickedUp
      ? "Collected from pharmacy"
      : "Not collected from pharmacy";
  }
  if (n.type === "ClinicalNote") {
    title = String(p.note_type || title)
      .replace("Social work and case management note", "Social work note")
      .replace("Post-discharge nurse call note", "Nurse follow-up call");
    sub = p.author_role || p.authorRole || "Open the original note";
  }
  if (n.type === "Barrier") {
    title = HUMAN[p.type] || title;
    sub = "Evidence in the patient record";
  }
  if (n.type === "Action") {
    title =
      {
        transportation: "Arrange a ride",
        cost: "Help with medication cost",
        food: "Connect to food support",
        health_literacy: "Arrange teach-back",
      }[p.type] ||
      p.label ||
      "Prepare a care-team task";
    sub = p.owner || "For human review";
  }
  if (n.type === "FollowUpGap") {
    title = "Follow-up still open";
    sub = "A next step was missed";
  }
  if (n.type === "LabResult") {
    title = p.name || p.display || title;
    sub =
      p.value !== undefined
        ? `${p.value} ${p.unit || p.units || ""}`
        : "Hospital lab result";
  }
  if (n.type === "Admission") {
    title = p.unit || "Hospital admission";
    sub = p.principalDiagnosis || p.principal_diagnosis || "";
  }
  return { title, sub, kind };
}
/** Every displayed connection comes from an API graph edge. Card placement is presentation only. */
export function createWorkspaceGraph(
  host,
  graph,
  { expanded = false, onSelect, focusIds = [], selectedId } = {},
) {
  let alive = true;
  const paint = () => {
    if (!alive || !host.isConnected) return;
    const width = Math.max(280, host.clientWidth),
      mobile = width < 520;
    const all = (graph?.nodes || []).slice(0, 50),
      selected = [],
      wanted = [
        "Patient",
        "Appointment",
        "Medication",
        "FollowUpGap",
        "ClinicalNote",
        "Barrier",
        "Action",
      ];
    if (expanded) selected.push(...all);
    else
      for (const type of wanted) {
        const found = all.filter((n) => n.type === type);
        if (type === "Medication")
          selected.push(found.find((n) => n.properties?.isInsulin) || found[0]);
        else if (["Barrier", "Action"].includes(type))
          selected.push(...found.slice(0, 2));
        else
          selected.push(found.find((n) => focusIds.includes(n.id)) || found[0]);
      }
    const nodes = selected.filter(Boolean),
      ids = new Set(nodes.map((n) => n.id)),
      edges = (graph?.edges || []).filter(
        (e) => ids.has(e.source) && ids.has(e.target),
      ),
      columns = mobile ? 2 : expanded ? 4 : 3,
      gap = mobile ? 18 : 30,
      pad = mobile ? 10 : 20,
      cardWidth = (width - pad * 2 - gap * (columns - 1)) / columns,
      cardHeight = mobile ? 99 : 103,
      pitch = cardHeight + (mobile ? 27 : 38),
      lanes = Array.from({ length: columns }, () => []);
    nodes.forEach((n) => {
      const lane = mobile
        ? n.type === "Patient"
          ? 0
          : ["ClinicalNote", "Barrier", "Action"].includes(n.type)
            ? 1
            : 0
        : expanded
          ? ({
              Patient: 0,
              Admission: 0,
              Condition: 0,
              LabResult: 1,
              Medication: 1,
              Appointment: 1,
              FollowUpGap: 2,
              ClinicalNote: 2,
              Barrier: 3,
              Action: 3,
            }[n.type] ?? 1)
          : n.type === "Patient"
            ? 0
            : ["ClinicalNote", "Barrier", "Action"].includes(n.type)
              ? 2
              : 1;
      lanes[lane].push(n);
    });
    const maxRows = Math.max(...lanes.map((l) => l.length), 1),
      height = Math.max(mobile ? 380 : 380, maxRows * pitch + pad * 2 - 30),
      positions = new Map();
    lanes.forEach((lane, col) =>
      lane.forEach((n, row) =>
        positions.set(n.id, {
          x: pad + col * (cardWidth + gap),
          y: lane.length === 1 ? (height - cardHeight) / 2 : pad + row * pitch,
        }),
      ),
    );
    host.innerHTML = `<div class="care-graph-world" style="height:${height}px"><svg class="care-edges" width="${width}" height="${height}" aria-hidden="true"><defs><marker id="care-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L6 3L0 6" fill="#83a292"/></marker></defs>${edges
      .map((e) => {
        const a = positions.get(e.source),
          b = positions.get(e.target),
          same = Math.abs(a.x - b.x) < 1;
        const ax = same ? a.x + cardWidth : a.x + cardWidth,
          ay = a.y + cardHeight / 2,
          bx = same ? b.x + cardWidth : b.x,
          by = b.y + cardHeight / 2,
          curve = same
            ? `M${ax} ${ay} C${ax + 20} ${ay},${bx + 20} ${by},${bx} ${by}`
            : `M${ax} ${ay} C${ax + gap / 2} ${ay},${bx - gap / 2} ${by},${bx} ${by}`;
        return `<path class="${focusIds.includes(e.id) ? "focused" : ""}" d="${curve}" marker-end="url(#care-arrow)"><title>${escape(e.type.replaceAll("_", " ").toLowerCase())}</title></path>`;
      })
      .join("")}</svg>${nodes
      .map((n) => {
        const { title, sub, kind } = detail(n),
          pos = positions.get(n.id);
        return `<button class="care-node ${kind.color} ${focusIds.includes(n.id) ? "focused" : ""} ${selectedId === n.id ? "selected" : ""}" data-graph-node="${escape(n.id)}" style="left:${pos.x}px;top:${pos.y}px;width:${cardWidth}px;min-height:${cardHeight}px" aria-label="Open ${escape(kind.name)}: ${escape(title)}"><span class="care-node-kind"><i>${kind.icon}</i>${kind.name}</span><strong>${escape(title)}</strong><small>${escape(sub)}</small><span class="node-open">↗</span></button>`;
      })
      .join(
        "",
      )}${!nodes.length ? '<div class="graph-no-data">Select a patient to connect their care story.</div>' : ""}</div>`;
  };
  const select = (e) => {
    const button = e.target.closest("[data-graph-node]");
    if (button) {
      const n = graph.nodes.find((n) => n.id === button.dataset.graphNode);
      onSelect?.(n);
    }
  };
  host.addEventListener("click", select);
  const observer = new ResizeObserver(paint);
  observer.observe(host);
  paint();
  return {
    destroy() {
      alive = false;
      observer.disconnect();
      host.removeEventListener("click", select);
    },
  };
}
