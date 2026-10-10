const COLORS = {
  Patient: "#96e2bd",
  Admission: "#91c9d4",
  Condition: "#9db7d6",
  LabResult: "#efd493",
  Medication: "#7dbad2",
  Appointment: "#e4bd86",
  FollowUpGap: "#f2a878",
  ClinicalNote: "#bca5e7",
  Barrier: "#d5bbf0",
  Action: "#96d8a9",
};
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const shorten = (s, n = 21) =>
  String(s || "").length > n
    ? String(s).slice(0, n - 1) + "…"
    : String(s || "");
let canvasSequence = 0;

/** Compact cards keep labels inside a measured column, never beneath the next row. */
export function layoutPilotNodes(nodes, width, height) {
  const mobile = width < 480;
  const columns = mobile ? 2 : 4;
  const padding = mobile ? 8 : 10;
  const gutter = mobile ? 18 : 20;
  const cardWidth = (width - padding * 2 - gutter * (columns - 1)) / columns;
  const cardHeight = mobile ? 44 : 24;
  const pitch = mobile ? 50 : 28;
  const laneFor = mobile
    ? {
        Patient: 0,
        Admission: 0,
        Condition: 0,
        LabResult: 0,
        Medication: 0,
        Appointment: 0,
        FollowUpGap: 1,
        ClinicalNote: 1,
        Barrier: 1,
        Action: 1,
      }
    : {
        Patient: 0,
        Admission: 1,
        Condition: 1,
        LabResult: 1,
        Medication: 1,
        Appointment: 1,
        FollowUpGap: 2,
        ClinicalNote: 2,
        Barrier: 3,
        Action: 3,
      };
  let lanes = Array.from({ length: columns }, () => []);
  nodes.forEach((node) => lanes[laneFor[node.type] ?? 1].push(node));
  // Assembly snapshots can contain many nodes of one type. Balance those snapshots.
  if (
    Math.max(...lanes.map((lane) => lane.length)) >
    Math.ceil(nodes.length / columns) + (mobile ? 4 : 3)
  ) {
    lanes = Array.from({ length: columns }, () => []);
    const rows = Math.ceil(nodes.length / columns);
    nodes.forEach((node, index) => lanes[Math.floor(index / rows)].push(node));
  }
  const mostRows = Math.max(1, ...lanes.map((lane) => lane.length));
  const contentHeight = Math.max(
    height,
    padding * 2 + cardHeight + (mostRows - 1) * pitch,
  );
  const positions = new Map();
  lanes.forEach((lane, column) => {
    const laneHeight = cardHeight + Math.max(0, lane.length - 1) * pitch;
    const start = mobile
      ? padding
      : Math.max(padding, (contentHeight - laneHeight) / 2);
    lane.forEach((node, row) =>
      positions.set(node.id, {
        x: padding + column * (cardWidth + gutter),
        y: start + row * pitch,
        width: cardWidth,
        height: cardHeight,
      }),
    );
  });
  return {
    positions,
    width,
    height: contentHeight,
    cardWidth,
    cardHeight,
    mobile,
    fontSize: mobile ? 11 : 13,
  };
}
/** Draw only supplied records. Layout is presentation; links and properties are graph facts. */
export function createPilotCanvas(container, initial, options = {}) {
  let data = initial,
    current = options,
    active = true;
  const canvasId = `pilot-${++canvasSequence}`;
  container.style.overflowX = "hidden";
  container.style.overflowY = "auto";
  let resizeFrame = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(draw);
  });
  observer.observe(container);
  function draw() {
    if (!active || !container.isConnected) return;
    const w = Math.max(240, container.clientWidth || 320),
      h = Math.max(180, container.clientHeight);
    const nodes = (data?.nodes || []).slice(0, 50),
      ids = new Set(nodes.map((n) => n.id));
    const edges = (data?.edges || []).filter(
      (e) => ids.has(e.source) && ids.has(e.target),
    );
    const visited = current.visited || [],
      highlight = new Set(current.highlight || []);
    const layout = layoutPilotNodes(nodes, w, h);
    const placement = layout.positions;
    const visitedEdgeIds = new Set(current.visitedEdges || []);
    const markerId = `${canvasId}-arrow`;
    container.innerHTML = `<svg class="knowledge-svg" style="height:${layout.height}px;width:100%;min-height:100%" viewBox="0 0 ${w} ${layout.height}" role="img" aria-label="${escape(current.title || "Patient knowledge graph")}"><defs><marker id="${markerId}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#789c96"/></marker>${nodes.map((node, index) => `<clipPath id="${canvasId}-label-${index}"><rect x="28" y="0" width="${Math.max(8, layout.cardWidth - 49)}" height="${layout.cardHeight}"/></clipPath>`).join("")}</defs>${edges
      .map((e, i) => {
        const a = placement.get(e.source),
          b = placement.get(e.target),
          lit = highlight.has(e.id),
          seen = visitedEdgeIds.has(e.id),
          same = Math.abs(a.x - b.x) < 10;
        const aY = a.y + a.height / 2,
          bY = b.y + b.height / 2;
        const forward = b.x > a.x;
        const aX = same || forward ? a.x + a.width : a.x;
        const bX = same ? b.x + b.width : forward ? b.x : b.x + b.width;
        const bend = same ? Math.min(w - 2, aX + 14) : (aX + bX) / 2;
        const path = `M ${aX} ${aY} C ${bend} ${aY},${bend} ${bY},${bX} ${bY}`;
        return `<g class="graph-edge ${lit ? "active" : ""} ${seen ? "visited" : ""} ${e.resolved ? "resolved" : ""}"><title>${escape(e.type)} · ${escape(e.source)} → ${escape(e.target)}</title><path d="${path}" marker-end="url(#${markerId})"/></g>`;
      })
      .join("")}${nodes
      .map((n, index) => {
        const p = placement.get(n.id),
          lit = highlight.has(n.id),
          order = visited.indexOf(n.id),
          c = COLORS[n.type] || "#aac4ba";
        const fullLabel = String(n.label || n.id).replace(/\s+/g, " ");
        const label = shorten(
          fullLabel,
          Math.max(8, Math.floor((p.width - 49) / (layout.fontSize * 0.52))),
        );
        const middle = p.height / 2;
        return `<g tabindex="0" role="button" aria-label="Open ${escape(n.type)} ${escape(fullLabel)}" class="graph-node ${lit ? "active" : ""} ${order >= 0 ? "visited" : ""}" data-node="${escape(n.id)}" transform="translate(${p.x},${p.y})"><title>${escape(fullLabel)} · ${escape(n.type)} · ${escape(n.id)}</title><rect width="${p.width}" height="${p.height}" rx="6" fill="${lit ? "#235246" : "#123b34"}" stroke="${lit || order >= 0 ? c : "#31584d"}" stroke-width="${lit ? 1.8 : 1}"/><rect class="halo" width="${p.width}" height="${p.height}" rx="6" fill="${c}"/><rect x="5" y="${middle - 8}" width="17" height="16" rx="${n.type === "Patient" ? 8 : 4}" fill="${c}"/><text class="node-glyph" text-anchor="middle" x="13.5" y="${middle + 3.5}" style="font-size:${n.type === "Medication" ? 9 : 10}px">${escape({ Patient: "P", Admission: "A", Condition: "C", LabResult: "L", Medication: "Rx", Appointment: "↗", FollowUpGap: "!", ClinicalNote: "≋", Barrier: "B", Action: "✓" }[n.type] || "·")}</text><text class="node-label" x="28" y="${middle + 4.4}" text-anchor="start" clip-path="url(#${canvasId}-label-${index})" style="font-size:${layout.fontSize}px;stroke:none">${escape(label)}</text>${order >= 0 ? `<g transform="translate(${p.width - 10},${middle})"><circle r="7.5" fill="#163e39" stroke="#95dec3"/><text class="trail-number" text-anchor="middle" y="3" style="font-size:8px">${order + 1}</text></g>` : ""}</g>`;
      })
      .join(
        "",
      )}${!nodes.length ? `<text x="${w / 2}" y="${h / 2}" class="graph-empty" text-anchor="middle">No facts existed at this point in time.</text>` : ""}</svg>`;
  }
  container.addEventListener("click", select);
  container.addEventListener("keydown", key);
  function select(e) {
    const el = e.target.closest("[data-node]");
    if (el) {
      const n = (data.nodes || []).find((x) => x.id === el.dataset.node);
      current.onSelect?.(n);
    }
  }
  function key(e) {
    if (e.key === "Enter" || e.key === " ") {
      if (e.target.closest("[data-node]")) {
        e.preventDefault();
        select(e);
      }
    }
  }
  draw();
  return {
    update(next, opts = {}) {
      data = next;
      current = { ...current, ...opts };
      draw();
    },
    destroy() {
      active = false;
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      container.removeEventListener("click", select);
      container.removeEventListener("keydown", key);
    },
  };
}
export { COLORS as pilotGraphColors };
