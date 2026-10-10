export const graphColors = {
  Patient: "#79d4b3",
  Admission: "#71bbc9",
  Condition: "#9ac9e0",
  LabResult: "#e9b66d",
  Medication: "#87b6d7",
  Appointment: "#f0cf8f",
  FollowUpGap: "#e4a25e",
  ClinicalNote: "#b4a0d3",
  Barrier: "#c7afe9",
  Action: "#9bd89c",
};
/** The canvas renders only supplied graph records; it never fabricates a link. */
export function createGraph(
  container,
  graph,
  { onSelect, mode = "discharges" } = {},
) {
  if (!globalThis.cytoscape) {
    container.textContent =
      "Use the fact directory to inspect the hospital graph.";
    return null;
  }
  const ids = new Set(graph.nodes.map((n) => n.id));
  const elements = [
    ...graph.nodes.map((n) => ({
      data: {
        ...n,
        id: String(n.id),
        label: n.label || n.name || n.id,
        color: graphColors[n.type] || "#a6bba4",
        size:
          n.type === "Patient"
            ? 34
            : ["Barrier", "Action"].includes(n.type)
              ? 30
              : 22,
      },
    })),
    ...graph.edges
      .filter((e) => ids.has(e.source || e.from) && ids.has(e.target || e.to))
      .map((e, i) => ({
        data: {
          ...e,
          id: `edge:${e.id || i}`,
          source: e.source || e.from,
          target: e.target || e.to,
        },
      })),
  ];
  const cy = globalThis.cytoscape({
    container,
    elements,
    layout: { name: "preset" },
    minZoom: 0.15,
    maxZoom: 3,
    wheelSensitivity: 0.25,
    style: [
      {
        selector: "node",
        style: {
          label: "data(label)",
          width: "data(size)",
          height: "data(size)",
          "background-color": "data(color)",
          "border-width": 2,
          "border-color": "data(color)",
          "border-opacity": 0.3,
          color: "#d3e6dc",
          "font-size": 12,
          "font-family": "DM Sans, Segoe UI, sans-serif",
          "text-valign": "bottom",
          "text-margin-y": 9,
          "text-wrap": "wrap",
          "text-max-width": 125,
          "text-outline-color": "#102b32",
          "text-outline-width": 2,
          "overlay-opacity": 0,
        },
      },
      {
        selector: 'node[type="ClinicalNote"]',
        style: { shape: "round-rectangle" },
      },
      {
        selector: 'node[type="FollowUpGap"]',
        style: { shape: "diamond", width: 28, height: 28 },
      },
      {
        selector: 'node[type="Action"]',
        style: { shape: "round-rectangle", "text-max-width": 155 },
      },
      {
        selector: "edge",
        style: {
          width: 1.2,
          "line-color": "#87ada1",
          opacity: 0.4,
          "curve-style": "bezier",
          "target-arrow-shape": "triangle",
          "target-arrow-color": "#87ada1",
          "arrow-scale": 0.65,
          label:
            mode === "patient" || mode === "ontology"
              ? (edge) => edge.data("type").toLowerCase().replaceAll("_", " ")
              : "",
          "font-size": 8,
          color: "#9abdaf",
          "text-rotation": "autorotate",
          "text-background-color": "#102b32",
          "text-background-opacity": 1,
          "text-background-padding": 2,
        },
      },
      {
        selector: 'edge[type="LIKELY_TO_RETURN"]',
        style: {
          "line-style": "dashed",
          "line-color": "#eab06b",
          "target-arrow-color": "#eab06b",
          opacity: 0.7,
        },
      },
      {
        selector: "node:selected",
        style: { "border-color": "#efffe5", "border-width": 4 },
      },
      {
        selector: ".tool-hit",
        style: {
          opacity: 1,
          "line-color": "#c2edb0",
          "target-arrow-color": "#c2edb0",
          "border-color": "#fff2c3",
          "border-width": 4,
        },
      },
    ],
  });
  if (mode === "ontology") {
    const positions = {
      Patient: [0, 0],
      Admission: [-260, -170],
      Condition: [-260, -60],
      LabResult: [-260, 70],
      Medication: [-260, 190],
      Appointment: [-260, 310],
      ClinicalNote: [240, -160],
      FollowUpGap: [240, 0],
      Barrier: [240, 170],
      Action: [440, 300],
    };
    cy.nodes().forEach((n) => {
      const [x, y] = positions[n.data("type")] || [0, 0];
      n.position({ x, y });
    });
  } else if (mode === "patient") {
    const groups = {};
    cy.nodes().forEach((n) => (groups[n.data("type")] ||= []).push(n));
    const lanes = {
      Patient: [0, -160],
      Admission: [-220, -220],
      Condition: [220, -260],
      LabResult: [-220, -80],
      Medication: [220, -110],
      Appointment: [220, 95],
      ClinicalNote: [-235, 125],
      FollowUpGap: [0, 40],
      Barrier: [0, 245],
      Action: [120, 420],
    };
    for (const [type, nodes] of Object.entries(groups))
      nodes.forEach((node, index) => {
        const [x, y] = lanes[type] || [0, 0];
        node.position({
          x:
            x +
            (["Barrier", "Action"].includes(type)
              ? (index - (nodes.length - 1) / 2) * 180
              : 0),
          y: y + (["Barrier", "Action"].includes(type) ? 0 : index * 105),
        });
      });
  } else {
    const patients = cy.nodes().filter((n) => n.data("type") === "Patient"),
      patientPositions = new Map();
    patients.forEach((node, i) => {
      const angle = (i * 2 * Math.PI) / Math.max(1, patients.length),
        radius = patients.length > 12 ? 380 : 260;
      const position = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      };
      node.position(position);
      patientPositions.set(node.id(), position);
    });
    const centers = cy
      .nodes()
      .filter((n) => n.data("type") !== "Patient" && !n.data("patientId"));
    centers.forEach((node, i) =>
      node.position({
        x: Math.cos((i * 2 * Math.PI) / Math.max(1, centers.length)) * 120,
        y: Math.sin((i * 2 * Math.PI) / Math.max(1, centers.length)) * 120,
      }),
    );
    const counts = {};
    cy.nodes()
      .filter((n) => n.data("type") !== "Patient" && n.data("patientId"))
      .forEach((node) => {
        const id = node.data("patientId"),
          center = patientPositions.get(id) || { x: 0, y: 0 },
          i = counts[id] || 0;
        counts[id] = i + 1;
        node.position({
          x: center.x + Math.cos(i * 1.4) * 70,
          y: center.y + Math.sin(i * 1.4) * 70,
        });
      });
    cy.style()
      .selector("node")
      .style({ "font-size": 10, "min-zoomed-font-size": 7 })
      .selector(
        'node[type="ClinicalNote"],node[type="LabResult"],node[type="Condition"]',
      )
      .style({ label: "" })
      .update();
  }
  cy.layout({ name: "preset", fit: true, padding: 45 }).run();
  const select = (node) => {
    node.select();
    onSelect?.(node.data());
  };
  cy.on("tap", "node", (event) => select(event.target));
  return {
    destroy: () => cy.destroy(),
    fit: () => cy.fit(cy.elements(), 45),
    zoom: (factor) =>
      cy.zoom({
        level: cy.zoom() * factor,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
      }),
    select: (id) => {
      const node = cy.getElementById(id);
      if (node.length) select(node);
    },
    highlight: (event) => {
      cy.elements().removeClass("tool-hit");
      for (const item of event.nodes || []) {
        const value = typeof item === "string" ? item : item.id || item.type;
        cy.nodes()
          .filter((n) => n.id() === value || n.data("type") === value)
          .addClass("tool-hit");
      }
      for (const item of event.edges || []) {
        const value = typeof item === "string" ? item : item.type;
        cy.edges()
          .filter((e) => e.data("type") === value)
          .addClass("tool-hit");
      }
    },
  };
}
