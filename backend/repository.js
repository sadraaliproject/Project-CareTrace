import {
  AS_OF,
  BARRIERS,
  NOTE_TYPES,
  ontology,
  patients as seedPatients,
  reconcileBarriers,
  makeDraft,
  buildGraph,
  preparePatient,
  daysBetween,
} from "../dist/engine.js";
import { validatePlan, defaultPlan } from "../planner.js";

export const SCHEMA_VERSION = 2;
const json = (value) => JSON.stringify(value);
const now = () => new Date().toISOString();
const uid = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const error = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const clamp = (value, fallback, max) =>
  Number.isInteger(Number(value)) && Number(value) > 0
    ? Math.min(Number(value), max)
    : fallback;
const placeholders = (values) => values.map(() => "?").join(",");
const statement = (sql, params = []) => ({ sql, params });
const changes = (result) =>
  Number(result?.changes ?? result?.meta?.changes ?? 0);
const hash = (value) => {
  let h = 2166136261;
  for (const c of value) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
};
const auditStatement = (action, entityId, details = {}) =>
  statement(
    "INSERT INTO audit(id,action,entity_id,json,created_at) VALUES(?,?,?,?,?)",
    [uid("audit"), action, entityId, json(details), now()],
  );
function compactInserts(statements, insertOnly = false) {
  const groups = new Map();
  for (const item of statements) {
    const match = item.sql.match(
      /^INSERT(?: OR (?:IGNORE|REPLACE))? INTO (\w+)\(([^)]+)\) VALUES\(/,
    );
    if (!match) throw new Error("Only row inserts can be compacted.");
    const [, table, columns] = match,
      key = `${table}(${columns})`;
    if (!groups.has(key)) groups.set(key, { table, columns, rows: [] });
    groups.get(key).rows.push(item.params);
  }
  return [...groups.values()].map(({ table, columns, rows }) =>
    statement(
      `INSERT ${insertOnly ? "OR IGNORE " : "OR REPLACE "}INTO ${table}(${columns}) SELECT ${columns
        .split(",")
        .map((_, index) => `json_extract(value,'$[${index}]')`)
        .join(",")} FROM json_each(?)`,
      [json(rows)],
    ),
  );
}
const insulinMissing = (p) =>
  p.medications.some((m) => m.newStart && m.isInsulin && !m.pickedUp);
function patientRow(p) {
  return statement(
    "INSERT INTO patients(id,name,age,sex,diabetes_admission,followup_gap,insulin_not_picked_up,likely_to_return,days_since_discharge,priority,json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    [
      p.id,
      p.name,
      p.age,
      p.sex,
      +p.admission.diabetesRelated,
      +p.followUpGap.open,
      +insulinMissing(p),
      +p.likelyToReturn,
      p.daysSinceDischarge,
      p.priority,
      json(p),
    ],
  );
}
function documentStatement(note, patientId) {
  return statement(
    "INSERT INTO notes(id,patient_id,note_type,date,text,json,created_at) VALUES(?,?,?,?,?,?,?)",
    [
      note.id,
      patientId,
      note.note_type,
      note.date,
      note.text,
      json({ ...note, patientId, synthetic: true }),
      now(),
    ],
  );
}
function structuredRows(p) {
  const rows = [
    statement(
      "INSERT INTO admissions(id,patient_id,admit_date,discharge_date,principal_diagnosis,json) VALUES(?,?,?,?,?,?)",
      [
        p.admission.id,
        p.id,
        p.admission.admitDate,
        p.admission.dischargeDate,
        p.admission.principalDiagnosis,
        json(p.admission),
      ],
    ),
    statement(
      "INSERT INTO conditions(id,patient_id,code,display,json) VALUES(?,?,?,?,?)",
      [
        p.condition.id,
        p.id,
        p.condition.code,
        p.condition.display,
        json(p.condition),
      ],
    ),
  ];
  for (const r of p.labs)
    rows.push(
      statement(
        "INSERT INTO lab_results(id,patient_id,code,value,date,json) VALUES(?,?,?,?,?,?)",
        [r.id, p.id, r.code, r.value, r.date, json(r)],
      ),
    );
  for (const r of p.medications)
    rows.push(
      statement(
        "INSERT INTO medications(id,patient_id,name,new_start,is_insulin,prescribed_date,json) VALUES(?,?,?,?,?,?,?)",
        [
          r.id,
          p.id,
          r.name,
          +r.newStart,
          +r.isInsulin,
          r.prescribedDate,
          json(r),
        ],
      ),
    );
  for (const r of p.medications)
    rows.push(
      statement(
        "INSERT INTO pharmacy_pickups(id,patient_id,medication_id,picked_up,pickup_date,json) VALUES(?,?,?,?,?,?)",
        [
          `${r.id}:pickup`,
          p.id,
          r.id,
          +r.pickedUp,
          r.pickupDate || null,
          json({
            medicationId: r.id,
            pickedUp: r.pickedUp,
            pickupDate: r.pickupDate || null,
          }),
        ],
      ),
    );
  for (const r of p.appointments)
    rows.push(
      statement(
        "INSERT INTO appointments(id,patient_id,date,status,json) VALUES(?,?,?,?,?)",
        [r.id, p.id, r.date, r.status, json(r)],
      ),
    );
  for (const r of p.emergencyVisits || [])
    rows.push(
      statement(
        "INSERT INTO emergency_department_visits(id,patient_id,date,reason,json) VALUES(?,?,?,?,?)",
        [r.id, p.id, r.date, r.reason, json(r)],
      ),
    );
  for (const r of p.socialNeeds)
    rows.push(
      statement(
        "INSERT INTO social_needs(id,patient_id,type,code,date,json) VALUES(?,?,?,?,?,?)",
        [r.id, p.id, r.type, r.code, r.date, json({ ...r, patientId: p.id })],
      ),
    );
  return rows;
}
function assertionStatements(p) {
  return p.barriers.map((b) =>
    statement(
      "INSERT INTO assertions(patient_id,type,status,document_id,quote,date,json) VALUES(?,?,?,?,?,?,?)",
      [p.id, b.type, "active", b.documentId, b.quote, b.date, json(b)],
    ),
  );
}
function graphStatements(patients) {
  const graph = buildGraph(patients),
    nodes = graph.nodes.map((n) =>
      statement(
        "INSERT INTO graph_nodes(id,type,patient_id,json) VALUES(?,?,?,?)",
        [n.id, n.type, n.patientId || null, json(n)],
      ),
    );
  const edges = graph.edges.map((e) => {
    const source = e.source || e.from,
      target = e.target || e.to;
    return statement(
      "INSERT INTO graph_edges(id,source,target,type,patient_id,status,document_id,json) VALUES(?,?,?,?,?,?,?,?)",
      [
        e.id,
        source,
        target,
        e.type,
        e.patientId || null,
        e.status || null,
        e.documentId || null,
        json({ ...e, source, target, from: source, to: target }),
      ],
    );
  });
  return [...nodes, ...edges];
}
const patientGraphStatements = (p) => graphStatements([p]);
function basePredicate(plan) {
  const clauses = [],
    params = [];
  if (plan.diabetesAdmissionOnly) clauses.push("p.diabetes_admission=1");
  if (plan.gapOnly) clauses.push("p.followup_gap=1");
  if (plan.insulinNotPickedUp) clauses.push("p.insulin_not_picked_up=1");
  if (plan.likelyToReturn) clauses.push("p.likely_to_return=1");
  if (plan.within30)
    clauses.push("p.days_since_discharge >= 0 AND p.days_since_discharge < 30");
  for (const [key, op] of [
    ["ageMin", ">="],
    ["ageMax", "<="],
  ])
    if (plan[key] !== null) {
      clauses.push(`p.age ${op} ?`);
      params.push(plan[key]);
    }
  return {
    sql: clauses.length ? clauses.map((c) => `(${c})`).join(" AND ") : "1=1",
    params,
  };
}
function barrierPredicate(plan) {
  if (plan.barrierPresence === "absent")
    return {
      sql: "NOT EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=p.id)",
      params: [],
    };
  if (!plan.barriers.length)
    return {
      sql:
        plan.barrierPresence === "any"
          ? "1=1"
          : "EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=p.id)",
      params: [],
    };
  const filter = `a.patient_id=p.id AND a.type IN (${placeholders(plan.barriers)})`;
  return plan.barrierMode === "all"
    ? {
        sql: `(SELECT COUNT(DISTINCT a.type) FROM assertions a WHERE ${filter})=?`,
        params: [...plan.barriers, plan.barriers.length],
      }
    : {
        sql: `EXISTS(SELECT 1 FROM assertions a WHERE ${filter})`,
        params: [...plan.barriers],
      };
}
function taskObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    patientId: row.patient_id,
    barrier: row.barrier,
    title: row.title,
    body: row.body,
    status: row.status,
    version: row.version,
    evidence: JSON.parse(row.evidence_json),
    reason: row.reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    simulated: true,
    sent: false,
  };
}
function validateTaskEvidence(patient, type) {
  if (type === "standard") {
    if (!patient.followUpGap.open || patient.barriers.length)
      throw error(
        "Standard contact requires a follow-up gap with no documented barrier.",
        409,
      );
    return {
      draft: {
        title: "Hospital follow-up contact",
        body: `Care transitions nurse: call ${patient.name} (${patient.id}), review the discharge plan and reschedule hospital follow-up. No barrier was documented; ask about support needs rather than assuming a cause. Human approval required. This draft sends nothing.`,
      },
      evidence: {
        patientId: patient.id,
        admissionId: patient.admission.id,
        barrier: "standard",
        gapReasons: patient.followUpGap.reasons,
        owner: "Care transitions nurse",
      },
    };
  }
  const draft = makeDraft(patient, type),
    assertion = patient.barriers.find((b) => b.type === type);
  if (!assertion)
    throw error("This patient has no current evidence for that barrier.", 409);
  const source =
    patient.notes.find((n) => n.id === assertion.documentId) ||
    patient.socialNeeds.find((n) => n.id === assertion.documentId);
  if (
    !source ||
    !(source.text || source.display || "").includes(assertion.quote)
  )
    throw error(
      "The current evidence cannot be verified against its source.",
      409,
    );
  return {
    draft,
    evidence: {
      ...assertion,
      patientId: patient.id,
      gapReasons: patient.followUpGap.reasons,
      owner: BARRIERS[type].owner,
    },
  };
}
function patientConnectedGraph(nodes, edges) {
  const neighbors = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!neighbors.has(e.source) || !neighbors.has(e.target)) continue;
    neighbors.get(e.source).push(e.target);
    neighbors.get(e.target).push(e.source);
  }
  const frontier = nodes.filter((n) => n.type === "Patient").map((n) => n.id),
    connected = new Set(frontier);
  for (let i = 0; i < frontier.length; i++)
    for (const n of neighbors.get(frontier[i]) || [])
      if (!connected.has(n)) {
        connected.add(n);
        frontier.push(n);
      }
  return {
    nodes: nodes.filter((n) => connected.has(n.id)),
    edges: edges.filter(
      (e) => connected.has(e.source) && connected.has(e.target),
    ),
  };
}
export function createRepository(adapter) {
  const { all, get, run, batch } = adapter;
  let writeTail = Promise.resolve();
  const serialize = (operation) => {
    const next = writeTail.then(operation);
    writeTail = next.catch(() => {});
    return next;
  };
  const repository = {
    async seedStatus() {
      const row = await get("SELECT COUNT(*) AS count FROM patients"),
        marker = await get(
          "SELECT value FROM metadata WHERE key='seed_complete'",
        );
      return {
        complete:
          row.count === seedPatients.length &&
          marker?.value === String(SCHEMA_VERSION),
        count: row.count,
        total: seedPatients.length,
        schemaVersion: SCHEMA_VERSION,
      };
    },
    async seedPatientBatch({ offset = 0, limit = 25 } = {}) {
      const start = Math.max(0, Number(offset) || 0),
        size = clamp(limit, 25, 50),
        selected = seedPatients.slice(start, start + size);
      if (!selected.length)
        return {
          ...(await repository.seedStatus()),
          offset: start,
          nextOffset: start,
          inserted: 0,
        };
      const existing = new Set(
          (
            await all(
              `SELECT id FROM patients WHERE id IN (${placeholders(selected)})`,
              selected.map((p) => p.id),
            )
          ).map((p) => p.id),
        ),
        fresh = selected.filter((p) => !existing.has(p.id));
      const rows = fresh.flatMap((p) => [
          patientRow(p),
          ...structuredRows(p),
          ...p.notes.map((n) => documentStatement(n, p.id)),
          ...assertionStatements(p),
        ]),
        graphs = graphStatements(fresh);
      await batch([
        ...compactInserts(rows, true),
        ...compactInserts(
          graphs.filter((s) => s.sql.includes("graph_nodes")),
          true,
        ),
        ...compactInserts(
          graphs.filter((s) => s.sql.includes("graph_edges")),
          true,
        ),
      ]);
      const count = (await get("SELECT COUNT(*) AS count FROM patients")).count;
      if (count === seedPatients.length)
        await run(
          "INSERT OR REPLACE INTO metadata(key,value) VALUES('seed_complete',?)",
          [String(SCHEMA_VERSION)],
        );
      await run(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version',?)",
        [String(SCHEMA_VERSION)],
      );
      return {
        complete: count === seedPatients.length,
        count,
        total: seedPatients.length,
        offset: start,
        nextOffset: Math.min(start + size, seedPatients.length),
        inserted: fresh.length,
        schemaVersion: SCHEMA_VERSION,
      };
    },
    async seed() {
      if ((await repository.seedStatus()).complete)
        return repository.seedStatus();
      for (let offset = 0; offset < seedPatients.length; offset += 25)
        await repository.seedPatientBatch({ offset, limit: 25 });
      return repository.seedStatus();
    },
    async metrics() {
      const p = await get(
        `SELECT COUNT(*) AS discharges,SUM(diabetes_admission) AS diabetesAdmissions,SUM(followup_gap) AS followUpGaps,SUM(likely_to_return) AS likelyToReturn,SUM(CASE WHEN followup_gap=1 AND EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=patients.id) THEN 1 ELSE 0 END) AS actionable,SUM(CASE WHEN followup_gap=1 AND NOT EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=patients.id) THEN 1 ELSE 0 END) AS standardCall FROM patients`,
      );
      const totals = await get(
        "SELECT (SELECT COUNT(*) FROM notes) AS notes,(SELECT COUNT(*) FROM assertions) AS evidence,(SELECT COUNT(*) FROM graph_nodes) AS nodes,(SELECT COUNT(*) FROM graph_edges) AS edges,(SELECT COUNT(*) FROM tasks) AS tasks,(SELECT COUNT(*) FROM runs) AS runs",
      );
      return {
        ...p,
        ...totals,
        graph: { nodes: totals.nodes, edges: totals.edges },
        asOf: AS_OF,
        synthetic: true,
        storage: "SQL property graph",
      };
    },
    async getPatient(id) {
      const row = await get("SELECT json FROM patients WHERE id=?", [id]);
      if (!row) throw error("Patient not found.", 404);
      return JSON.parse(row.json);
    },
    async listPatients({ search = "", limit = 1000, offset = 0 } = {}) {
      const pattern = `%${String(search).replace(/[\\%_]/g, "\\$&")}%`,
        where = "id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'";
      const rows = await all(
          `SELECT json FROM patients WHERE ${where} ORDER BY priority DESC,id LIMIT ? OFFSET ?`,
          [
            pattern,
            pattern,
            clamp(limit, 1000, 1000),
            Math.max(0, Number(offset) || 0),
          ],
        ),
        count = (
          await get(`SELECT COUNT(*) AS count FROM patients WHERE ${where}`, [
            pattern,
            pattern,
          ])
        ).count;
      return {
        patients: rows.map((r) => JSON.parse(r.json)),
        count,
        limit: clamp(limit, 1000, 1000),
        offset: Math.max(0, Number(offset) || 0),
      };
    },
    async getSocialNeeds(patientId) {
      return (
        await all(
          "SELECT json FROM social_needs WHERE patient_id=? ORDER BY date,id",
          [patientId],
        )
      ).map((row) => JSON.parse(row.json));
    },
    async getDocument(id) {
      const row = await get(
        "SELECT json FROM notes WHERE id=? UNION ALL SELECT json FROM social_needs WHERE id=? LIMIT 1",
        [id, id],
      );
      if (!row) throw error("Source note or coded need not found.", 404);
      const source = JSON.parse(row.json);
      return {
        ...source,
        text: source.text || source.display,
        note_type: source.note_type || "Coded social need",
      };
    },
    async getDocuments(ids) {
      if (
        !Array.isArray(ids) ||
        ids.length > 1000 ||
        ids.some((id) => typeof id !== "string")
      )
        throw error("Provide at most 1,000 source IDs.");
      const rows = await all(
        "SELECT json FROM notes WHERE id IN (SELECT value FROM json_each(?)) UNION ALL SELECT json FROM social_needs WHERE id IN (SELECT value FROM json_each(?))",
        [json(ids), json(ids)],
      );
      return rows.map((r) => {
        const s = JSON.parse(r.json);
        return {
          ...s,
          text: s.text || s.display,
          note_type: s.note_type || "Coded social need",
        };
      });
    },
    async searchNotes(question) {
      if (
        typeof question !== "string" ||
        question.trim().length < 3 ||
        question.length > 1500
      )
        throw error("Enter a question between 3 and 1,500 characters.");
      const terms = [
        ...new Set(question.toLowerCase().match(/[a-z]{4,}/g) || []),
      ]
        .filter(
          (w) =>
            ![
              "find",
              "patients",
              "with",
              "which",
              "have",
              "their",
              "hospital",
              "follow",
              "after",
              "from",
              "diabetes",
              "show",
            ].includes(w),
        )
        .slice(0, 12);
      const rows = await all("SELECT json FROM notes");
      const passages = rows
        .map((r) => JSON.parse(r.json))
        .map((n) => ({
          ...n,
          score: terms.reduce(
            (s, t) => s + (n.text.toLowerCase().includes(t) ? 1 : 0),
            0,
          ),
        }))
        .filter((n) => n.score > 0)
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, 6)
        .map(({ score, ...n }) => ({ ...n, documentId: n.id }));
      return {
        question,
        passages,
        method: "Keyword retrieval over clinical note text only",
        limitation:
          "A retrieved passage does not establish an exact patient count, current barrier, or complete follow-up plan.",
      };
    },
    async query(input = {}) {
      const plan = {
        ...defaultPlan(),
        ...input,
        barriers: [...(input.barriers || [])],
      };
      if (!validatePlan(plan))
        throw error("Invalid or unsupported hospital cohort plan.");
      const base = basePredicate(plan),
        barrier = barrierPredicate(plan),
        where = `${base.sql} AND (${barrier.sql})`,
        params = [...base.params, ...barrier.params];
      const sql = `SELECT p.json FROM patients p WHERE ${where} ORDER BY p.${plan.sort === "age" ? "age" : "priority"} DESC,p.id`,
        matching = (await all(sql, params)).map((r) => JSON.parse(r.json));
      const baseCount = (
        await get(
          `SELECT COUNT(*) AS count FROM patients p WHERE ${base.sql}`,
          base.params,
        )
      ).count;
      const groupRows = await all(
        `SELECT a.type,COUNT(DISTINCT a.patient_id) AS count FROM assertions a WHERE a.patient_id IN (SELECT p.id FROM patients p WHERE ${where}) GROUP BY a.type`,
        params,
      );
      const groups = Object.entries(BARRIERS).map(([type, info]) => ({
        type,
        label: info.label,
        action: info.action,
        owner: info.owner,
        count: groupRows.find((g) => g.type === type)?.count || 0,
      }));
      const standardCount = (
        await get(
          `SELECT COUNT(*) AS count FROM patients p WHERE ${base.sql} AND p.followup_gap=1 AND NOT EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=p.id)`,
          base.params,
        )
      ).count;
      groups.push({
        type: "standard",
        label: "No documented barrier",
        action: "Standard hospital follow-up call and rescheduling",
        owner: "Care transitions nurse",
        count:
          plan.barrierPresence === "absent" ? matching.length : standardCount,
        separateDischarges: plan.barrierPresence !== "absent",
      });
      const fingerprint = hash(
        json({
          ...plan,
          barriers: [...plan.barriers].sort(),
          ids: matching.map((p) => p.id),
          asOf: AS_OF,
        }),
      );
      const events = [
        {
          tool: "query_patients",
          say: `Structured hospital records identified ${baseCount} patients before the barrier filter.`,
          found: baseCount,
          nodes: ["Patient", "Admission", "Appointment", "Medication"],
          edges: [
            "HAD_ADMISSION",
            "HAS_APPOINTMENT",
            "PRESCRIBED_AT_DISCHARGE",
          ],
          evidence: [],
        },
        {
          tool: "build_cohort",
          say: `Joined source-backed current barriers and counted ${matching.length} distinct patients.`,
          found: matching.length,
          nodes: ["ClinicalNote", "Barrier"],
          edges: ["HAS_NOTE", "REPORTED_BARRIER"],
          evidence: matching.slice(0, 3).flatMap((p) => p.barriers),
        },
      ].map((e, i) => ({ step: i + 1, ...e }));
      return {
        patients: plan.limit ? matching.slice(0, plan.limit) : matching,
        count: matching.length,
        within30Count: matching.filter(
          (patient) =>
            patient.daysSinceDischarge >= 0 && patient.daysSinceDischarge < 30,
        ).length,
        groups,
        fingerprint,
        events,
        sql: { text: sql, parameters: params },
        asOf: AS_OF,
      };
    },
    async getGraph({
      patientIds,
      patientId,
      mode = "discharges",
      limit = 420,
    } = {}) {
      if (mode === "ontology") {
        const counts = await all(
          "SELECT type,COUNT(*) AS count FROM graph_nodes GROUP BY type",
        );
        const relationships = ontology.paths || ontology.allowedPaths || [];
        const nodes = ontology.nodeTypes.map((type) => ({
          id: `ontology:${type}`,
          type,
          label: type,
          count: counts.find((c) => c.type === type)?.count || 0,
          schemaNode: true,
        }));
        const edges = relationships.map(([from, type, to]) => ({
          id: type,
          source: `ontology:${from}`,
          target: `ontology:${to}`,
          from: `ontology:${from}`,
          to: `ontology:${to}`,
          type,
          inferred: ontology.inferredRelationships.includes(type),
        }));
        return {
          nodes,
          edges,
          totalNodes: nodes.length,
          totalEdges: edges.length,
          truncated: false,
          mode,
          ontology,
          asOf: AS_OF,
        };
      }
      const maxNodes = clamp(limit, 420, 8000);
      if (
        patientIds !== undefined &&
        (!Array.isArray(patientIds) ||
          patientIds.length > 1000 ||
          patientIds.some((id) => typeof id !== "string"))
      )
        throw error("Graph patient IDs must be an array of at most 1,000 IDs.");
      const ids = patientId
        ? [patientId]
        : ["cohort", "patient"].includes(mode)
          ? patientIds || []
          : patientIds?.length
            ? patientIds
            : undefined;
      if (
        ids &&
        (!Array.isArray(ids) ||
          ids.length > 1000 ||
          ids.some((id) => typeof id !== "string"))
      )
        throw error("Graph patient IDs must be an array of at most 1,000 IDs.");
      const filter = ids
        ? "patient_id IN (SELECT value FROM json_each(?))"
        : "1=1";
      if (ids) {
        const nodeRows = await all(
          `SELECT json FROM graph_nodes WHERE patient_id IS NULL OR (${filter}) ORDER BY patient_id,id`,
          [json(ids)],
        );
        const edgeRows = await all(
          `SELECT json FROM graph_edges WHERE patient_id IS NULL OR (${filter}) ORDER BY id`,
          [json(ids)],
        );
        const complete = patientConnectedGraph(
          nodeRows.map((row) => JSON.parse(row.json)),
          edgeRows.map((row) => JSON.parse(row.json)),
        );
        const totalNodes = complete.nodes.length,
          totalEdges = complete.edges.length;
        const fullPatients = complete.nodes.filter(
          (node) => node.type === "Patient",
        );
        let graph = complete;
        if (totalNodes > maxNodes) {
          const selectedIds = new Set(
            fullPatients
              .sort(
                (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
              )
              .slice(0, Math.max(1, Math.floor((maxNodes - 9) / 7)))
              .map((node) => node.id),
          );
          const nodes = complete.nodes
            .filter((node) =>
              node.type === "Patient"
                ? selectedIds.has(node.id)
                : !node.patientId || selectedIds.has(node.patientId),
            )
            .slice(0, maxNodes);
          const visible = new Set(nodes.map((node) => node.id));
          graph = patientConnectedGraph(
            nodes,
            complete.edges.filter(
              (edge) => visible.has(edge.source) && visible.has(edge.target),
            ),
          );
        }
        return {
          ...graph,
          totalNodes,
          totalEdges,
          truncated: graph.nodes.length < totalNodes,
          samplePatientCount: graph.nodes.filter(
            (node) => node.type === "Patient",
          ).length,
          patientCount: fullPatients.length,
          mode,
          ontology,
          asOf: AS_OF,
        };
      }
      const totalNodes = (
        await get(
          `SELECT COUNT(*) AS count FROM graph_nodes WHERE patient_id IS NULL OR (${filter})`,
          ids ? [json(ids)] : [],
        )
      ).count;
      const totalEdges = (
        await get(
          `SELECT COUNT(*) AS count FROM graph_edges WHERE patient_id IS NULL OR (${filter})`,
          ids ? [json(ids)] : [],
        )
      ).count;
      let selectedIds = ids;
      if (totalNodes > maxNodes) {
        // Keep complete patient/source neighborhoods rather than dropping every document
        // when a large discharges is visualized. Counts still describe the whole cohort.
        const count = Math.max(1, Math.floor((maxNodes - 9) / 7));
        const selected = await all(
          `SELECT id FROM patients ${ids ? "WHERE id IN (SELECT value FROM json_each(?))" : ""} ORDER BY priority DESC,id LIMIT ?`,
          [...(ids ? [json(ids)] : []), count],
        );
        selectedIds = selected.map((p) => p.id);
      }
      const sampleFilter = selectedIds
        ? "patient_id IN (SELECT value FROM json_each(?))"
        : "1=1";
      const rows = await all(
        `SELECT json FROM graph_nodes WHERE patient_id IS NULL OR (${sampleFilter}) ORDER BY CASE WHEN patient_id IS NULL THEN 0 ELSE 1 END,patient_id,id`,
        selectedIds ? [json(selectedIds)] : [],
      );
      const nodes = rows.slice(0, maxNodes).map((row) => JSON.parse(row.json)),
        visible = new Set(nodes.map((n) => n.id));
      const edgeRows = await all(
        `SELECT json FROM graph_edges WHERE patient_id IS NULL OR (${sampleFilter}) ORDER BY id`,
        selectedIds ? [json(selectedIds)] : [],
      );
      const edges = edgeRows
        .map((row) => JSON.parse(row.json))
        .filter((e) => visible.has(e.source) && visible.has(e.target));
      return {
        nodes,
        edges,
        totalNodes,
        totalEdges,
        truncated: nodes.length < totalNodes,
        samplePatientCount: nodes.filter((n) => n.type === "Patient").length,
        patientCount:
          ids?.length ??
          (await get("SELECT COUNT(*) AS count FROM patients")).count,
        mode,
        ontology,
        asOf: AS_OF,
      };
    },
    async expandNode(id, edgeType) {
      const row = await get("SELECT json FROM graph_nodes WHERE id=?", [id]);
      if (!row) throw error("Graph node not found.", 404);
      if (
        edgeType &&
        ![
          ...ontology.relationships,
          ...ontology.inferredRelationships,
        ].includes(edgeType)
      )
        throw error(
          "Traversal relationship is outside the permitted ontology.",
        );
      const filter = `(source=? OR target=?)${edgeType ? " AND type=?" : ""}`,
        params = [id, id, ...(edgeType ? [edgeType] : [])];
      const totalEdges = (
        await get(
          `SELECT COUNT(*) AS count FROM graph_edges WHERE ${filter}`,
          params,
        )
      ).count;
      const edges = (
        await all(
          `SELECT json FROM graph_edges WHERE ${filter} ORDER BY id LIMIT 49`,
          params,
        )
      ).map((r) => JSON.parse(r.json));
      const ids = [
        ...new Set([id, ...edges.flatMap((e) => [e.source, e.target])]),
      ];
      const nodes = [];
      // Bound parameter count for both native SQLite and hosted D1.
      for (let start = 0; start < ids.length; start += 80) {
        const page = ids.slice(start, start + 80);
        nodes.push(
          ...(
            await all(
              `SELECT json FROM graph_nodes WHERE id IN (${placeholders(page)})`,
              page,
            )
          ).map((r) => JSON.parse(r.json)),
        );
      }
      const byId = new Map(nodes.map((node) => [node.id, node]));
      const validEdges = edges.filter((edge) =>
        ontology.paths.some(
          ([source, type, target]) =>
            type === edge.type &&
            byId.get(edge.source)?.type === source &&
            byId.get(edge.target)?.type === target,
        ),
      );
      return {
        nodes,
        edges: validEdges,
        center: id,
        edgeType: edgeType || null,
        totalNodes: nodes.length,
        totalEdges,
        truncated: totalEdges > edges.length,
        ontology,
        asOf: AS_OF,
      };
    },
    async listTasks() {
      return (
        await all("SELECT * FROM tasks ORDER BY created_at DESC,id DESC")
      ).map(taskObject);
    },
    async getTask(id) {
      const task = taskObject(
        await get("SELECT * FROM tasks WHERE id=?", [id]),
      );
      if (!task) throw error("Care-coordination task not found.", 404);
      return task;
    },
    createTask({ patientId, barrier, title, body }) {
      return serialize(async () => {
        if (barrier !== "standard" && !BARRIERS[barrier])
          throw error("Select a supported barrier.");
        const patient = await repository.getPatient(patientId);
        let verified;
        try {
          verified = validateTaskEvidence(patient, barrier);
        } catch (e) {
          throw error(e.message, 409);
        }
        const existing = await get(
          "SELECT id FROM tasks WHERE patient_id=? AND barrier=? AND status IN ('pending','approved','needs_review')",
          [patientId, barrier],
        );
        if (existing)
          throw error(
            "A current care-coordination task already exists for this patient and barrier.",
            409,
          );
        if (
          title !== undefined &&
          (typeof title !== "string" || !title.trim() || title.length > 200)
        )
          throw error("Task title must contain 1–200 characters.");
        if (
          body !== undefined &&
          (typeof body !== "string" || !body.trim() || body.length > 12000)
        )
          throw error("Task draft must contain 1–12,000 characters.");
        const id = uid("task"),
          timestamp = now();
        try {
          await batch([
            statement(
              "INSERT INTO tasks(id,patient_id,barrier,title,body,status,version,evidence_json,created_at,updated_at) VALUES(?,?,?,CASE WHEN (SELECT json FROM patients WHERE id=?)=? THEN ? ELSE NULL END,?,?,?,?,?,?)",
              [
                id,
                patientId,
                barrier,
                patientId,
                json(patient),
                title?.trim() || verified.draft.title,
                body?.trim() || verified.draft.body,
                "pending",
                1,
                json(verified.evidence),
                timestamp,
                timestamp,
              ],
            ),
            auditStatement("task.created", id, {
              patientId,
              barrier,
              documentId: verified.evidence.documentId,
              simulated: true,
            }),
          ]);
        } catch (cause) {
          if (
            /NOT NULL constraint failed: tasks\.title|UNIQUE constraint failed: tasks\.patient_id/i.test(
              cause.message,
            )
          )
            throw error(
              "This patient or task changed while the draft was prepared. Refresh and try again.",
              409,
            );
          throw cause;
        }
        return repository.getTask(id);
      });
    },
    updateTask(id, update = {}) {
      return serialize(async () => {
        const task = await repository.getTask(id);
        if (!Number.isInteger(update.version))
          throw error(
            "Provide the task version to prevent overwriting another reviewer’s changes.",
            409,
          );
        if (update.version !== task.version)
          throw error(
            "This task changed since you opened it. Refresh it before saving.",
            409,
          );
        const status = update.status || task.status;
        const transitions = {
          pending: ["pending", "approved", "cancelled"],
          approved: ["approved", "completed", "cancelled"],
          needs_review: ["needs_review", "pending", "cancelled"],
          completed: [],
          cancelled: [],
        };
        if (!transitions[task.status]?.includes(status))
          throw error(`Cannot change a ${task.status} task to ${status}.`, 409);
        if (
          ["approved", "completed"].includes(task.status) &&
          (update.title !== undefined || update.body !== undefined)
        )
          throw error(
            "Approved drafts cannot be edited. Cancel and prepare a new draft for review.",
            409,
          );
        let title = update.title === undefined ? task.title : update.title,
          body = update.body === undefined ? task.body : update.body;
        if (
          typeof title !== "string" ||
          !title.trim() ||
          title.length > 200 ||
          typeof body !== "string" ||
          !body.trim() ||
          body.length > 12000
        )
          throw error(
            "Provide a title of 1–200 characters and draft of 1–12,000 characters.",
          );
        let evidence = task.evidence;
        if (!["cancelled", "needs_review"].includes(status)) {
          let verified;
          try {
            verified = validateTaskEvidence(
              await repository.getPatient(task.patientId),
              task.barrier,
            );
          } catch (e) {
            throw error(`Evidence review failed: ${e.message}`, 409);
          }
          if (
            ["approved", "completed"].includes(status) &&
            json(verified.evidence) !== json(task.evidence)
          )
            throw error(
              "Source evidence changed. Revalidate the draft before approval.",
              409,
            );
          evidence = verified.evidence;
          if (task.status === "needs_review" && status === "pending") {
            if (update.title === undefined) title = verified.draft.title;
            if (update.body === undefined) body = verified.draft.body;
          }
        }
        const result = await run(
          "UPDATE tasks SET title=?,body=?,status=?,version=version+1,evidence_json=?,reason=?,updated_at=? WHERE id=? AND version=?",
          [
            title.trim(),
            body.trim(),
            status,
            json(evidence),
            status === "needs_review" ? task.reason : null,
            now(),
            id,
            task.version,
          ],
        );
        if (!changes(result))
          throw error(
            "This task changed during review. Refresh before trying again.",
            409,
          );
        const audit = auditStatement(
          `task.${status === task.status ? "edited" : status}`,
          id,
          {
            version: task.version + 1,
            patientId: task.patientId,
            simulated: true,
          },
        );
        await run(audit.sql, audit.params);
        return repository.getTask(id);
      });
    },
    async removeTask(id, version) {
      const current = await repository.getTask(id);
      return repository.updateTask(id, {
        status: "cancelled",
        version: version ?? current.version,
      });
    },
    addDocument(patientId, input) {
      return serialize(async () => {
        if (input?.synthetic !== true)
          throw error(
            "Only explicitly synthetic documents may be added to this demonstration.",
          );
        if (
          typeof input.text !== "string" ||
          input.text.trim().length < 3 ||
          input.text.length > 20000
        )
          throw error("Document text must contain 3–20,000 characters.");
        const date = input.date || AS_OF,
          sourceType =
            input.note_type || input.type || "Post-discharge nurse call note";
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) ||
          new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date ||
          date > AS_OF ||
          date < "1900-01-01"
        )
          throw error(
            `Use a valid source date on or before the ${AS_OF} snapshot.`,
          );
        if (!NOTE_TYPES.includes(sourceType))
          throw error("Choose a supported hospital clinical-note type.");
        const patient = await repository.getPatient(patientId),
          previousBarriers = patient.barriers;
        const originalJson = json(patient);
        const document = {
          id: `${patientId}-${uid("N")}`,
          note_type: sourceType.trim(),
          authorRole: {
            "Bedside nursing note": "Inpatient nurse",
            "Physician progress note": "Hospitalist",
            "Social work and case management note": "Social worker",
            "Discharge summary": "Discharging physician",
            "Post-discharge nurse call note": "Care transitions nurse",
          }[sourceType],
          date,
          daysFromDischarge: daysBetween(patient.admission.dischargeDate, date),
          text: input.text.trim(),
          synthetic: true,
          patientId,
        };
        patient.notes = [...patient.notes, document];
        patient.barriers = reconcileBarriers(
          patient.notes,
          patient.socialNeeds,
        );
        Object.assign(patient, preparePatient(patient));
        const changedTypes = Object.keys(BARRIERS).filter(
          (type) =>
            json(previousBarriers.find((b) => b.type === type)) !==
            json(patient.barriers.find((b) => b.type === type)),
        );
        // The NOT NULL constraint aborts and rolls back the entire batch if another
        // Worker changed this patient after our read. A process-local queue alone
        // cannot protect deployments with multiple independent Worker instances.
        const compareAndSwap = statement(
          "UPDATE patients SET priority=?,likely_to_return=?,json=CASE WHEN json=? THEN ? ELSE NULL END WHERE id=?",
          [
            patient.priority,
            +patient.likelyToReturn,
            originalJson,
            json(patient),
            patientId,
          ],
        );
        const graphRows = patientGraphStatements(patient).filter((row) =>
          row.sql.includes("graph_nodes")
            ? row.params[2] === patientId
            : row.params[4] === patientId,
        );
        const statements = [
          compareAndSwap,
          documentStatement(document, patientId),
          statement("DELETE FROM assertions WHERE patient_id=?", [patientId]),
          ...compactInserts(assertionStatements(patient)),
          statement("DELETE FROM graph_edges WHERE patient_id=?", [patientId]),
          statement("DELETE FROM graph_nodes WHERE patient_id=?", [patientId]),
          ...compactInserts(
            graphRows.filter((s) => s.sql.includes("graph_nodes")),
          ),
          ...compactInserts(
            graphRows.filter((s) => s.sql.includes("graph_edges")),
          ),
        ];
        const staleTypes = [
          ...changedTypes,
          ...(changedTypes.length ? ["standard"] : []),
        ];
        if (staleTypes.length)
          statements.push(
            statement(
              `UPDATE tasks SET status='needs_review',version=version+1,reason=?,updated_at=? WHERE patient_id=? AND barrier IN (${placeholders(staleTypes)}) AND status IN ('pending','approved','needs_review')`,
              [
                "New clinical evidence changed the follow-up plan. Human review is required.",
                now(),
                patientId,
                ...staleTypes,
              ],
            ),
          );
        statements.push(
          auditStatement("document.ingested", document.id, {
            patientId,
            type: sourceType,
            date,
            changedBarriers: changedTypes,
            synthetic: true,
          }),
        );
        try {
          await batch(statements);
        } catch (cause) {
          if (/NOT NULL constraint failed: patients\.json/i.test(cause.message))
            throw error(
              "Another source changed this patient during ingestion. Refresh and submit the note again; nothing from this attempt was saved.",
              409,
            );
          throw cause;
        }
        return {
          document,
          patient,
          barriers: patient.barriers,
          previousBarriers,
          changedBarriers: changedTypes,
          invalidatedTasks: (await repository.listTasks()).filter(
            (t) => t.patientId === patientId && t.status === "needs_review",
          ),
          asOf: AS_OF,
        };
      });
    },
    async saveRun(input) {
      const id = uid("run"),
        createdAt = now();
      const record = { ...input, id, createdAt, synthetic: true, asOf: AS_OF };
      await batch([
        statement(
          "INSERT INTO runs(id,question,engine,fingerprint,count,json,created_at) VALUES(?,?,?,?,?,?,?)",
          [
            id,
            String(input.question || ""),
            String(input.engine || "deterministic"),
            input.result?.fingerprint || null,
            input.result?.count || 0,
            json(record),
            createdAt,
          ],
        ),
        auditStatement("analysis.completed", id, {
          engine: record.engine,
          count: input.result?.count || 0,
          fingerprint: input.result?.fingerprint || null,
        }),
      ]);
      return record;
    },
    async listRuns({ limit = 50 } = {}) {
      return (
        await all(
          "SELECT id,question,engine,fingerprint,count,created_at FROM runs ORDER BY created_at DESC,id DESC LIMIT ?",
          [clamp(limit, 50, 200)],
        )
      ).map((row) => ({
        id: row.id,
        question: row.question,
        engine: row.engine,
        fingerprint: row.fingerprint,
        count: row.count,
        createdAt: row.created_at,
      }));
    },
    async getRun(id) {
      const row = await get("SELECT json FROM runs WHERE id=?", [id]);
      if (!row) throw error("Analysis run not found.", 404);
      return JSON.parse(row.json);
    },
    async auditLog({ limit = 100 } = {}) {
      return (
        await all(
          "SELECT * FROM audit ORDER BY created_at DESC,id DESC LIMIT ?",
          [clamp(limit, 100, 500)],
        )
      ).map((row) => ({
        id: row.id,
        action: row.action,
        entityId: row.entity_id,
        ...JSON.parse(row.json),
        createdAt: row.created_at,
      }));
    },
  };
  return repository;
}
