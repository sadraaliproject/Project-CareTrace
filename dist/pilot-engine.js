import { BARRIERS, ontology } from "./ontology.js";
import { readNote } from "./pilot-reader.js";

export const AS_OF = "2026-10-10";
const DAY = 86400000;
const dateOnly = (value) => String(value || "").slice(0, 10);
export const daysBetween = (start, end = AS_OF) =>
  Math.floor(
    (Date.parse(`${dateOnly(end)}T12:00:00Z`) -
      Date.parse(`${dateOnly(start)}T12:00:00Z`)) /
      DAY,
  );
const atOrBefore = (value, asOf) =>
  Boolean(value) && dateOnly(value) <= dateOnly(asOf);
const unique = (values) => [...new Set(values)];
const clone = (value) => structuredClone(value);
const barrierId = (type) => `barrier:${type}`;
const actionId = (type) => `action:${type}`;
const edgeId = (from, type, to, source = "") =>
  `${from}:${type}:${to}${source ? `:${source}` : ""}`;
const stamp = (row) => row.written_datetime || row.date || "";
const prescriptionDate = (row, patient) =>
  row.prescribed_datetime ||
  row.prescribedDate ||
  patient.admission.dischargeDate;

function followUp(patient, asOf) {
  const days = daysBetween(patient.admission.dischargeDate, asOf);
  const eligible = Boolean(patient.admission.diabetesRelated && days >= 14);
  const reasons = [];
  if (eligible) {
    const attended = patient.appointments.some(
      (row) =>
        row.status === "completed" &&
        daysBetween(patient.admission.dischargeDate, row.date) >= 0 &&
        daysBetween(patient.admission.dischargeDate, row.date) <= 14,
    );
    if (!attended) reasons.push("follow_up_not_completed_within_14_days");
    if (
      patient.medications.some(
        (row) =>
          row.newStart &&
          (!row.pickedUp ||
            !row.pickupDate ||
            daysBetween(patient.admission.dischargeDate, row.pickupDate) > 3),
      )
    )
      reasons.push("new_medication_not_picked_up_within_3_days");
  }
  return {
    eligible,
    open: reasons.length > 0,
    reasons,
    daysSinceDischarge: days,
  };
}

function choosePrimary(patient) {
  if (!patient.barriers.length)
    return { type: null, reason: "No current barrier was documented." };
  const missedPickup =
    patient.daysSinceDischarge >= 3 &&
    patient.medications.some(
      (row) =>
        row.newStart &&
        (!row.pickedUp ||
          daysBetween(patient.admission.dischargeDate, row.pickupDate) > 3),
    );
  const missedVisit =
    patient.daysSinceDischarge >= 14 &&
    !patient.appointments.some(
      (row) =>
        row.status === "completed" &&
        daysBetween(patient.admission.dischargeDate, row.date) <= 14,
    );
  const deadline = (barrier) =>
    barrier.type === "cost" && missedPickup
      ? 3
      : barrier.type === "transportation" && missedVisit
        ? 14
        : Infinity;
  const ranked = [...patient.barriers].sort(
    (a, b) =>
      deadline(a) - deadline(b) ||
      b.confidence - a.confidence ||
      stamp(b).localeCompare(stamp(a)) ||
      a.type.localeCompare(b.type),
  );
  const first = ranked[0],
    second = ranked[1];
  let reason;
  if (Number.isFinite(deadline(first)))
    reason = `${BARRIERS[first.type].label} blocks the earliest already-missed behavior: ${deadline(first) === 3 ? "medication pickup, due by day 3" : "the follow-up visit, due by day 14"}.`;
  else if (!second)
    reason = `${BARRIERS[first.type].label} is the only current documented barrier.`;
  else if (first.confidence !== second.confidence)
    reason = `No timed missed behavior separates these barriers; ${BARRIERS[first.type].label.toLowerCase()} has the higher reading confidence.`;
  else if (stamp(first) !== stamp(second))
    reason = `The behavior and confidence are tied; ${BARRIERS[first.type].label.toLowerCase()} was documented more recently.`;
  else
    reason =
      "The behavior, confidence and note date are tied; the stable barrier-name order breaks the remaining tie.";
  return { type: first.type, reason };
}

function prepare(raw, asOf, resolved, readings) {
  const patient = clone(raw);
  const dischargeDate = patient.admission.dischargeDate;
  patient.daysSinceDischarge = daysBetween(dischargeDate, asOf);
  patient.daysRemaining = Math.max(0, 30 - patient.daysSinceDischarge);
  patient.notes = (patient.notes || []).filter((note) =>
    atOrBefore(stamp(note), asOf),
  );
  patient.socialNeeds = (patient.socialNeeds || []).filter((row) =>
    atOrBefore(row.date || dischargeDate, asOf),
  );
  patient.labs = (patient.labs || []).filter((row) =>
    atOrBefore(row.date || patient.admission.admitDate, asOf),
  );
  patient.medications = (patient.medications || [])
    .filter((row) => atOrBefore(prescriptionDate(row, patient), asOf))
    .map((row) => ({
      ...row,
      pickedUp: Boolean(row.pickedUp && atOrBefore(row.pickupDate, asOf)),
      pickupDate: atOrBefore(row.pickupDate, asOf) ? row.pickupDate : null,
    }));
  patient.appointments = (patient.appointments || [])
    .filter((row) => atOrBefore(row.created_datetime || dischargeDate, asOf))
    .map((row) => ({
      ...row,
      status: atOrBefore(row.date, asOf) ? row.status : "scheduled",
    }));
  patient.emergencyVisits = (patient.emergencyVisits || []).filter((row) =>
    atOrBefore(row.date, asOf),
  );
  const assertions = patient.socialNeeds.flatMap((row) => {
    const type =
      row.type ||
      Object.keys(BARRIERS).find((key) => BARRIERS[key].zCode === row.code);
    return type
      ? [
          {
            type,
            status: row.resolved ? "resolved" : "active",
            confidence: 1,
            quote: row.display || BARRIERS[type].label,
            evidence_sentence: row.display || BARRIERS[type].label,
            note_id: row.id,
            documentId: row.id,
            note_type: "Coded social need",
            date: row.date || dischargeDate,
            sourceKind: "coded",
            code: row.code,
            action_recorded: Boolean(row.action_recorded),
            char_span: null,
          },
        ]
      : [];
  });
  for (const note of patient.notes)
    assertions.push(
      ...readings.get(note.id).assertions.map((assertion) => ({
        ...assertion,
        date: assertion.date || note.date,
        written_datetime: assertion.written_datetime || stamp(note),
        author_role: note.author_role || note.authorRole,
        author_initials: note.author_initials,
        unit: note.unit,
        action_recorded: Boolean(note.action_recorded || note.actionRecorded),
        sourceKind: "note",
      })),
    );
  assertions.sort(
    (a, b) =>
      stamp(a).localeCompare(stamp(b)) || (a.sourceKind === "coded" ? -1 : 1),
  );
  const latest = new Map();
  for (const assertion of assertions)
    if (
      ![
        "historical",
        "past",
        "third_party",
        "clinical",
        "third party",
      ].includes(assertion.status)
    )
      latest.set(assertion.type, assertion);
  patient.barrierAssertions = assertions;
  patient.barriers = [...latest.values()]
    .filter(
      (assertion) =>
        assertion.status === "active" &&
        !resolved.has(`${patient.id}:${assertion.type}`),
    )
    .map((assertion) => ({
      ...assertion,
      resolved: false,
      evidence_sources: assertions.filter(
        (item) => item.type === assertion.type && item.status === "active",
      ),
    }));
  patient.resolvedBarriers = [...latest.values()]
    .filter(
      (assertion) =>
        assertion.status === "active" &&
        resolved.has(`${patient.id}:${assertion.type}`),
    )
    .map((assertion) => ({ ...assertion, resolved: true }));
  patient.followUpGap = followUp(patient, asOf);
  const primary = choosePrimary(patient);
  patient.primary_barrier = primary.type;
  patient.primary_barrier_reason = primary.reason;
  patient.primaryBarrier = primary.type;
  patient.likelyToReturn = Boolean(
    patient.admission.diabetesRelated &&
      patient.daysSinceDischarge >= 3 &&
      patient.labs.some(
        (row) =>
          (row.code === "4548-4" ||
            /a1c/i.test(row.name || row.display || "")) &&
          row.value > 9,
      ) &&
      !patient.appointments.some((row) => row.status === "completed") &&
      patient.medications.some(
        (row) => row.newStart && row.isInsulin && !row.pickedUp,
      ) &&
      patient.barriers.length,
  );
  return patient;
}

function groupsFor(patients) {
  return Object.entries(BARRIERS).map(([type, spec]) => ({
    type,
    label: spec.label,
    count: patients.filter((patient) => patient.primary_barrier === type)
      .length,
    action: spec.action,
    owner: spec.owner,
    patientIds: patients
      .filter((patient) => patient.primary_barrier === type)
      .map((patient) => patient.id),
  }));
}

export function createPilotGraph(
  rawPatients,
  { readNote: noteReader = readNote } = {},
) {
  const originals = clone(rawPatients);
  const resolved = new Set();
  const readings = new Map(
    originals.flatMap((patient) =>
      (patient.notes || []).map((note) => [note.id, noteReader(note)]),
    ),
  );
  let patients, nodes, edges, tables, nodeById, outgoing;

  function assemble(prepared, asOf = AS_OF) {
    const allNodes = [],
      allEdges = [];
    const sourceTables = Object.fromEntries(
      [
        "patients",
        "admissions",
        "conditions",
        "lab_results",
        "outpatient_pharmacy",
        "appointments",
        "coded_social_needs",
        "clinical_notes",
        "emergency_department_visits",
        "barrier_catalog",
        "action_catalog",
        "rule_catalog",
      ].map((name) => [name, []]),
    );
    const addNode = (id, type, label, row, table, source = {}) => {
      allNodes.push({
        id,
        type,
        label,
        properties: clone(row),
        source: { table, key: row.id || id, row: clone(row), ...source },
      });
      sourceTables[table].push(clone(row));
    };
    const addEdge = (from, type, to, properties = {}, suffix = "") =>
      allEdges.push({
        ...properties,
        id: edgeId(from, type, to, suffix),
        source: from,
        target: to,
        from,
        to,
        type,
        label: type,
        properties,
      });
    for (const [type, spec] of Object.entries(BARRIERS)) {
      addNode(
        barrierId(type),
        "Barrier",
        spec.label,
        { id: barrierId(type), type, label: spec.label, code: spec.zCode },
        "barrier_catalog",
      );
      addNode(
        actionId(type),
        "Action",
        spec.owner,
        { id: actionId(type), type, action: spec.action, owner: spec.owner },
        "action_catalog",
      );
      addEdge(barrierId(type), "ADDRESSED_BY", actionId(type));
    }
    for (const patient of prepared) {
      if (!atOrBefore(patient.admission.admitDate, asOf)) continue;
      const id = patient.id;
      addNode(
        id,
        "Patient",
        `${patient.name}\n${id}`,
        {
          id,
          name: patient.name,
          age: patient.age,
          sex: patient.sex,
          primary_barrier: patient.primary_barrier,
          primary_barrier_reason: patient.primary_barrier_reason,
        },
        "patients",
      );
      const admission = { ...patient.admission, patientId: id };
      if (!atOrBefore(admission.dischargeDate, asOf)) {
        admission.dischargeDate = null;
        admission.discharge_datetime = null;
        admission.disposition = "In hospital";
      }
      addNode(
        admission.id,
        "Admission",
        admission.unit,
        admission,
        "admissions",
      );
      addEdge(id, "HAD_ADMISSION", admission.id);
      if (patient.condition) {
        addNode(
          patient.condition.id,
          "Condition",
          patient.condition.display,
          { ...patient.condition, patientId: id },
          "conditions",
        );
        addEdge(id, "HAS_CONDITION", patient.condition.id);
      }
      for (const row of patient.labs) {
        addNode(
          row.id,
          "LabResult",
          `${row.name || row.display || "A1c"} ${row.value}${row.unit || "%"}`,
          { ...row, patientId: id },
          "lab_results",
        );
        addEdge(id, "HAS_RESULT", row.id);
      }
      for (const row of patient.medications) {
        addNode(
          row.id,
          "Medication",
          `${row.name || row.display}\n${row.pickedUp ? "Picked up" : patient.daysSinceDischarge < 3 ? "Awaiting pickup" : "Not picked up"}`,
          { ...row, patientId: id },
          "outpatient_pharmacy",
        );
        addEdge(id, "PRESCRIBED_AT_DISCHARGE", row.id);
      }
      for (const row of patient.appointments) {
        addNode(
          row.id,
          "Appointment",
          `${row.clinic}\n${row.status}`,
          { ...row, patientId: id },
          "appointments",
        );
        addEdge(id, "HAS_APPOINTMENT", row.id);
      }
      for (const note of patient.notes) {
        addNode(
          note.id,
          "ClinicalNote",
          note.note_type,
          { ...note, patientId: id },
          "clinical_notes",
          { note, char_span: [0, note.text.length] },
        );
        addEdge(id, "HAS_NOTE", note.id);
      }
      for (const row of patient.socialNeeds)
        sourceTables.coded_social_needs.push({ ...row, patientId: id });
      for (const row of patient.emergencyVisits)
        sourceTables.emergency_department_visits.push({
          ...row,
          patientId: id,
        });
      for (const assertion of patient.barrierAssertions.filter(
        (item) => item.status === "active",
      )) {
        const isResolved = resolved.has(`${id}:${assertion.type}`);
        const active = patient.barriers.some(
          (item) => item.type === assertion.type,
        );
        addEdge(
          id,
          "REPORTED_BARRIER",
          barrierId(assertion.type),
          {
            ...assertion,
            patientId: id,
            resolved: isResolved,
            active: active && !isResolved,
            note_id: assertion.note_id || assertion.documentId,
            evidence_sentence: assertion.evidence_sentence || assertion.quote,
          },
          assertion.note_id || assertion.documentId,
        );
      }
      if (patient.followUpGap.open) {
        const gapId = `${id}:gap`;
        addNode(
          gapId,
          "FollowUpGap",
          "Follow-up gap",
          {
            id: gapId,
            patientId: id,
            ...patient.followUpGap,
            asOf,
            rule: "At day 14, no completed follow-up by day 14 or a new medication was not picked up by day 3.",
            inputs: [
              admission.id,
              ...patient.appointments.map((row) => row.id),
              ...patient.medications.map((row) => row.id),
            ],
          },
          "rule_catalog",
        );
        addEdge(id, "HAS_GAP", gapId, { derived: true });
      }
      if (patient.likelyToReturn)
        addEdge(id, "LIKELY_TO_RETURN", admission.id, {
          derived: true,
          rule: "A1c above 9%, no completed follow-up, new insulin not picked up, and a current barrier.",
        });
    }
    return { nodes: allNodes, edges: allEdges, tables: sourceTables };
  }

  function rebuild() {
    patients = originals.map((patient) =>
      prepare(patient, AS_OF, resolved, readings),
    );
    const graph = assemble(patients);
    nodes = graph.nodes;
    edges = graph.edges;
    tables = graph.tables;
    nodeById = new Map(nodes.map((node) => [node.id, node]));
    outgoing = new Map();
    for (const edge of edges) {
      if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
      outgoing.get(edge.source).push(edge);
    }
  }
  rebuild();

  function totals() {
    return {
      nodes: nodes.length,
      edges: edges.length,
      notesRead: readings.size,
      byNodeType: Object.fromEntries(
        ontology.nodeTypes.map((type) => [
          type,
          nodes.filter((node) => node.type === type).length,
        ]),
      ),
      byEdgeType: Object.fromEntries(
        [...ontology.relationships, ...ontology.inferredRelationships].map(
          (type) => [type, edges.filter((edge) => edge.type === type).length],
        ),
      ),
      baseEdgeTypes: ontology.relationships.length,
      derivedEdges: edges.filter((edge) => edge.derived).length,
    };
  }

  function funnel() {
    const diabetes = patients.filter(
        (patient) => patient.admission.diabetesRelated,
      ),
      gaps = diabetes.filter((patient) => patient.followUpGap.open),
      barrier = gaps.filter((patient) => patient.barriers.length);
    return {
      discharges: patients.length,
      diabetes: diabetes.length,
      gaps: gaps.length,
      barrier: barrier.length,
      standard: gaps.length - barrier.length,
      within30: barrier.filter((patient) => patient.daysSinceDischarge < 30)
        .length,
      preDischarge: barrier.filter((patient) =>
        patient.barriers.some((assertion) =>
          assertion.evidence_sources.some(
            (source) =>
              source.sourceKind === "note" &&
              stamp(source) <
                (patient.admission.discharge_datetime ||
                  `${patient.admission.dischargeDate}T23:59:59`),
          ),
        ),
      ).length,
      missedByTables: barrier.filter(
        (patient) =>
          !patient.socialNeeds.some((row) =>
            patient.barriers.some(
              (assertion) =>
                assertion.type === row.type ||
                BARRIERS[assertion.type].zCode === row.code,
            ),
          ),
      ).length,
      groups: groupsFor(barrier),
    };
  }

  function query(filters = {}) {
    const id = filters.id || filters.questionId || "main";
    const visitedNodes = new Set(),
      visitedEdges = new Set();
    const follow = (patient, relationship) => {
      visitedNodes.add(patient.id);
      const found = (outgoing.get(patient.id) || []).filter(
        (edge) => edge.type === relationship,
      );
      for (const edge of found) {
        visitedEdges.add(edge.id);
        visitedNodes.add(edge.target);
      }
      return found;
    };
    const hasBarrier = (patient) =>
      follow(patient, "REPORTED_BARRIER").some(
        (edge) => edge.active && !edge.resolved,
      );
    const hasBarrierType = (patient, type) =>
      follow(patient, "REPORTED_BARRIER").some(
        (edge) =>
          edge.active && !edge.resolved && edge.properties.type === type,
      );
    const medicines = (patient) =>
      follow(patient, "PRESCRIBED_AT_DISCHARGE").map(
        (edge) => nodeById.get(edge.target).properties,
      );
    const gapDefault = ![
      "all",
      "no-pickup",
      "cost",
      "return-risk",
      "units",
      "before-discharge",
      "ed-returns",
    ].includes(id);
    let selected = patients.filter((patient) => {
      const admissions = follow(patient, "HAD_ADMISSION").map(
        (edge) => nodeById.get(edge.target).properties,
      );
      return (
        (id === "all" || admissions.some((row) => row.diabetesRelated)) &&
        (!gapDefault || follow(patient, "HAS_GAP").length > 0)
      );
    });
    if (!["all", "standard", "no-pickup", "ed-returns"].includes(id))
      selected = selected.filter(hasBarrier);
    if (id === "standard")
      selected = selected.filter((patient) => !hasBarrier(patient));
    if (id === "cost")
      selected = selected.filter(
        (patient) =>
          hasBarrierType(patient, "cost") &&
          medicines(patient).some(
            (row) => row.newStart && row.isInsulin && !row.pickedUp,
          ),
      );
    if (id === "no-pickup")
      selected = selected.filter((patient) =>
        medicines(patient).some((row) => row.newStart && !row.pickedUp),
      );
    if (id === "return-risk")
      selected = selected.filter(
        (patient) => follow(patient, "LIKELY_TO_RETURN").length > 0,
      );
    if (["transportation", "food", "health-literacy"].includes(id))
      selected = selected.filter((patient) =>
        hasBarrierType(patient, id.replaceAll("-", "_")),
      );
    if (id === "within30")
      selected = selected.filter((patient) => patient.daysSinceDischarge < 30);
    if (id === "dual")
      selected = selected.filter(
        (patient) =>
          new Set(
            follow(patient, "REPORTED_BARRIER")
              .filter((edge) => edge.active && !edge.resolved)
              .map((edge) => edge.target),
          ).size > 1,
      );
    if (id === "uncoded")
      selected = selected.filter((patient) => !patient.socialNeeds.length);
    if (filters.ageMin != null)
      selected = selected.filter((patient) => patient.age >= filters.ageMin);
    if (filters.ageMax != null)
      selected = selected.filter((patient) => patient.age <= filters.ageMax);
    if (filters.unit)
      selected = selected.filter(
        (patient) => patient.admission.unit === filters.unit,
      );
    if (filters.patientId)
      selected = selected.filter((patient) => patient.id === filters.patientId);
    if (filters.barrier)
      selected = selected.filter((patient) =>
        hasBarrierType(patient, filters.barrier),
      );
    let shape = "patients",
      rows;
    if (id === "units") {
      shape = "units";
      rows = unique(selected.map((patient) => patient.admission.unit))
        .map((unit) => ({
          unit,
          count: selected.filter((patient) => patient.admission.unit === unit)
            .length,
          patientIds: selected
            .filter((patient) => patient.admission.unit === unit)
            .map((patient) => patient.id),
        }))
        .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));
    } else if (id === "before-discharge") {
      shape = "noteTypes";
      selected.forEach((patient) => follow(patient, "HAS_NOTE"));
      const accepted = selected.flatMap((patient) =>
        patient.barriers.flatMap((assertion) =>
          assertion.evidence_sources
            .filter(
              (item) =>
                item.sourceKind === "note" &&
                !item.action_recorded &&
                stamp(item) <
                  (patient.admission.discharge_datetime ||
                    `${patient.admission.dischargeDate}T23:59:59`),
            )
            .map((item) => ({ ...item, patientId: patient.id })),
        ),
      );
      const ids = new Set(accepted.map((item) => item.patientId));
      selected = selected.filter((patient) => ids.has(patient.id));
      rows = unique(accepted.map((item) => item.note_type))
        .map((note_type) => ({
          note_type,
          count: unique(
            accepted
              .filter((item) => item.note_type === note_type)
              .map((item) => item.patientId),
          ).length,
          assertions: accepted.filter((item) => item.note_type === note_type)
            .length,
          patientIds: unique(
            accepted
              .filter((item) => item.note_type === note_type)
              .map((item) => item.patientId),
          ),
        }))
        .sort(
          (a, b) => b.count - a.count || a.note_type.localeCompare(b.note_type),
        );
    } else if (id === "ed-returns") {
      shape = "returns";
      rows = selected
        .flatMap((patient) => {
          const missed = follow(patient, "HAS_APPOINTMENT")
            .map((edge) => nodeById.get(edge.target).properties)
            .filter(
              (row) => row.status === "no-show" || row.status === "no_show",
            )
            .sort((a, b) => a.date.localeCompare(b.date))[0];
          if (!missed) return [];
          return patient.emergencyVisits
            .filter((row) => row.date > missed.date)
            .map((row) => ({
              id: patient.id,
              patientId: patient.id,
              name: patient.name,
              returnId: row.id,
              returnDate: row.date,
              daysToReturn: daysBetween(missed.date, row.date),
              daysAfterDischarge: daysBetween(
                patient.admission.dischargeDate,
                row.date,
              ),
              reason: row.reason,
              missedVisitDate: missed.date,
              source: { table: "emergency_department_visits", row },
            }));
        })
        .sort(
          (a, b) => a.daysToReturn - b.daysToReturn || a.id.localeCompare(b.id),
        );
      const ids = new Set(rows.map((row) => row.patientId));
      selected = selected.filter((patient) => ids.has(patient.id));
    }
    selected.sort(
      (a, b) => a.daysRemaining - b.daysRemaining || a.id.localeCompare(b.id),
    );
    rows ||= selected.map((patient) => ({
      id: patient.id,
      name: patient.name,
      age: patient.age,
      primary_barrier: patient.primary_barrier,
      daysRemaining: patient.daysRemaining,
      daysSinceDischarge: patient.daysSinceDischarge,
    }));
    return {
      shape,
      patients: selected,
      rows,
      count: selected.length,
      headline: selected.length,
      groups: groupsFor(selected),
      funnel: funnel(),
      execution: { nodes: [...visitedNodes], edges: [...visitedEdges] },
    };
  }

  function patientGraph(id, { asOf = AS_OF, limit = 50 } = {}) {
    const raw = originals.find((patient) => patient.id === id);
    if (!raw) return { nodes: [], edges: [], patient: null, asOf };
    const patient = prepare(raw, asOf, resolved, readings);
    const graph = assemble([patient], asOf);
    const linked = new Set(
      graph.edges
        .filter((edge) => edge.source === id)
        .map((edge) => edge.target),
    );
    for (const type of [...patient.barriers, ...patient.resolvedBarriers].map(
      (item) => item.type,
    )) {
      linked.add(barrierId(type));
      linked.add(actionId(type));
    }
    linked.add(id);
    const resultNodes = graph.nodes
      .filter((node) => linked.has(node.id))
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((node) => {
        if (node.type !== "Barrier") return node;
        const type = node.properties.type;
        const assertion =
          [...patient.barriers, ...patient.resolvedBarriers].find(
            (item) => item.type === type,
          ) ||
          patient.barrierAssertions.find(
            (item) => item.type === type && item.status === "active",
          );
        if (!assertion) return node;
        const note = patient.notes.find(
          (item) => item.id === (assertion.note_id || assertion.documentId),
        );
        const coded = patient.socialNeeds.find(
          (item) => item.id === (assertion.note_id || assertion.documentId),
        );
        return {
          ...node,
          properties: {
            ...node.properties,
            patientId: id,
            evidence_sentence: assertion.evidence_sentence || assertion.quote,
            confidence: assertion.confidence,
            resolved: Boolean(assertion.resolved),
            author_role: assertion.author_role,
            written_datetime: stamp(assertion),
          },
          source: note
            ? {
                table: "clinical_notes",
                key: note.id,
                row: clone(note),
                note: clone(note),
                char_span: assertion.char_span,
                evidence_sentence:
                  assertion.evidence_sentence || assertion.quote,
              }
            : coded
              ? {
                  table: "coded_social_needs",
                  key: coded.id,
                  row: clone(coded),
                }
              : node.source,
        };
      });
    const ids = new Set(resultNodes.map((node) => node.id));
    return {
      patient,
      asOf,
      nodes: resultNodes,
      edges: graph.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    };
  }

  function featured() {
    return (
      patients.find(
        (patient) =>
          patient.daysSinceDischarge >= 8 &&
          patient.daysSinceDischarge <= 20 &&
          /ketoacidosis|\bdka\b/i.test(
            patient.admission.principalDiagnosis ||
              patient.admission.principal_diagnosis ||
              "",
          ) &&
          patient.labs.some(
            (row) =>
              Number(row.value) > 9 &&
              (row.code === "4548-4" ||
                /a1c/i.test(row.name || row.display || "")),
          ) &&
          patient.appointments.some((row) =>
            ["no-show", "no_show"].includes(row.status),
          ) &&
          patient.medications.some(
            (row) =>
              row.newStart &&
              /glargine/i.test(row.name || row.display || "") &&
              !row.pickedUp,
          ) &&
          patient.barriers.length === 1 &&
          patient.barriers[0].type === "transportation" &&
          patient.barriers[0].evidence_sources.some(
            (row) =>
              row.sourceKind === "note" &&
              /bedside|nursing/i.test(row.note_type) &&
              stamp(row) <
                (patient.admission.discharge_datetime ||
                  `${patient.admission.dischargeDate}T23:59:59`),
          ) &&
          !patient.socialNeeds.length,
      )?.id || null
    );
  }

  function trace(patientId, plan = {}) {
    const patient = patients.find((item) => item.id === patientId);
    if (!patient) return [];
    const events = [],
      visitedNodes = new Set(),
      visitedEdges = new Set();
    let rowsRead = 0,
      sentencesRead = 0;
    const route = plan.route || [];
    const routeEdges = new Set(route.map((hop) => hop.edge));
    const thoughtFor = (edge, fallback) =>
      route.find((hop) => hop.edge === edge)?.thought || fallback;
    const emit = (
      tool,
      args,
      queryText,
      thought,
      operation,
      stage = "store",
    ) => {
      const started = performance.now();
      const result = operation();
      const ms = performance.now() - started;
      result.nodes = unique(result.nodes || []);
      result.edges = unique(result.edges || []);
      (result.nodes || []).forEach((id) => visitedNodes.add(id));
      (result.edges || []).forEach((id) => visitedEdges.add(id));
      rowsRead += result.rowsRead || 0;
      sentencesRead += result.sentencesRead || 0;
      const event = {
        step: events.length + 1,
        tool,
        args,
        query: queryText,
        rows: result.rows || [],
        ms,
        nodes: result.nodes || [],
        edges: result.edges || [],
        evidence: result.evidence || [],
        thought,
        observation:
          result.observation || `${result.rows?.length || 0} rows returned.`,
        stage,
        stageSequence:
          stage === "store"
            ? ["tools", "graph", "store"]
            : stage === "notes"
              ? ["tools", "graph", "notes"]
              : ["tools", "graph", stage],
        provenance: {
          thought: "plan",
          action: "graph",
          observation: result.reader
            ? "reader"
            : result.rule
              ? "rule"
              : "graph",
        },
        ...result,
        counters: {
          toolCalls: events.length + 1,
          nodesVisited: visitedNodes.size,
          edgesFollowed: visitedEdges.size,
          rowsRead,
          sentencesRead,
        },
        visited: [...visitedNodes],
      };
      events.push(event);
      return event;
    };
    const tableRead = (table, edge, thought) =>
      emit(
        "read_table",
        { table, key: { patientId } },
        `MATCH (p:Patient {id: '${patientId}'})${edge ? `-[:${edge}]->(n)` : ""}\nCALL source_table('${table}', {patientId: p.id})\nRETURN row`,
        thought,
        () => {
          const rows = tables[table].filter(
            (row) =>
              row.patientId === patientId ||
              (table === "patients" && row.id === patientId),
          );
          const touched = rows.flatMap((row) =>
            nodeById.has(row.id)
              ? [row.id]
              : table === "coded_social_needs"
                ? [
                    barrierId(
                      row.type ||
                        Object.keys(BARRIERS).find(
                          (type) => BARRIERS[type].zCode === row.code,
                        ),
                    ),
                  ]
                : [],
          );
          const followed = edges.filter(
            (item) =>
              item.source === patientId &&
              (edge
                ? item.type === edge &&
                  touched.includes(item.target) &&
                  (table !== "coded_social_needs" ||
                    rows.some((row) => row.id === item.note_id))
                : false),
          );
          return {
            rows,
            nodes: [patientId, ...touched],
            edges: followed.map((item) => item.id),
            rowsRead: rows.length,
            source: {
              table,
              key: { patientId },
              rows,
              neighbors: tables[table].slice(
                Math.max(
                  0,
                  tables[table].findIndex(
                    (row) => row.patientId === patientId,
                  ) - 2,
                ),
                Math.max(
                  0,
                  tables[table].findIndex(
                    (row) => row.patientId === patientId,
                  ) - 2,
                ) + 5,
              ),
            },
            observation:
              table === "coded_social_needs"
                ? rows.length
                  ? `${rows.length} coded social need${rows.length === 1 ? "" : "s"} were recorded during the stay.`
                  : "No social need was coded during the stay. 0 rows for this patient."
                : table === "appointments"
                  ? rows
                      .map(
                        (row) =>
                          `The ${row.clinic} visit on day ${daysBetween(patient.admission.dischargeDate, row.date)} was ${row.status}.`,
                      )
                      .join(" ") || "No follow-up visit is recorded."
                  : table === "outpatient_pharmacy"
                    ? rows
                        .map(
                          (row) =>
                            `${row.name || row.display} was ${row.pickedUp ? "picked up" : "not picked up"}.`,
                        )
                        .join(" ") || "No discharge medication is recorded."
                    : table === "admissions"
                      ? `${patient.name} left ${patient.admission.unit} ${patient.daysSinceDischarge} days ago.`
                      : `${rows.length} ${table.replaceAll("_", " ")} row${rows.length === 1 ? "" : "s"} returned.`,
          };
        },
      );
    tableRead(
      "patients",
      null,
      "Start with the person whose care needs review.",
    );
    const planned = routeEdges.size
      ? routeEdges
      : new Set([
          "HAD_ADMISSION",
          "HAS_RESULT",
          "HAS_APPOINTMENT",
          "PRESCRIBED_AT_DISCHARGE",
          "HAS_GAP",
          "REPORTED_BARRIER",
          "HAS_NOTE",
          "ADDRESSED_BY",
        ]);
    const rowHops = [
      [
        "HAD_ADMISSION",
        "admissions",
        "Check when the patient left the hospital.",
      ],
      ["HAS_CONDITION", "conditions", "Read the reason for the admission."],
      ["HAS_RESULT", "lab_results", "Read the admission A1c."],
      [
        "HAS_APPOINTMENT",
        "appointments",
        "Check whether the follow-up visit happened.",
      ],
      [
        "PRESCRIBED_AT_DISCHARGE",
        "outpatient_pharmacy",
        "Check whether the new medicine was picked up.",
      ],
    ];
    for (const [edge, table, thought] of rowHops)
      if (planned.has(edge)) tableRead(table, edge, thoughtFor(edge, thought));
    if (planned.has("HAS_GAP"))
      emit(
        "derive_follow_up_gap",
        { patientId, asOf: AS_OF },
        `MATCH (p:Patient {id: '${patientId}'})-[:HAS_GAP]->(g:FollowUpGap)\nRETURN g`,
        thoughtFor(
          "HAS_GAP",
          "Join the visit and pickup records to check for an open follow-up gap.",
        ),
        () => ({
          rows: patient.followUpGap.open ? [clone(patient.followUpGap)] : [],
          nodes: [
            patientId,
            ...(patient.followUpGap.open ? [`${patientId}:gap`] : []),
          ],
          edges: edges
            .filter(
              (edge) => edge.source === patientId && edge.type === "HAS_GAP",
            )
            .map((edge) => edge.id),
          rule: true,
          observation: patient.followUpGap.open
            ? `The day-14 check finds an open follow-up gap on day ${patient.daysSinceDischarge}.`
            : `The day-14 check finds no open follow-up gap on day ${patient.daysSinceDischarge}.`,
        }),
        "graph",
      );
    if (planned.has("REPORTED_BARRIER") || planned.has("HAS_NOTE")) {
      const coded = tableRead(
        "coded_social_needs",
        "REPORTED_BARRIER",
        thoughtFor(
          "REPORTED_BARRIER",
          "Look for coded social needs first, then read the notes when the reason is missing.",
        ),
      );
      if (!coded.rows.length) {
        coded.pauseMs = 1000;
        coded.noResult = true;
      }
      const relevant = patient.barriers.flatMap((assertion) =>
        assertion.evidence_sources
          .filter((item) => item.sourceKind === "note")
          .sort((a, b) => {
            const bedsideBefore = (item) =>
              /bedside/i.test(item.note_type) &&
              item.date < patient.admission.dischargeDate;
            return (
              Number(bedsideBefore(b)) - Number(bedsideBefore(a)) ||
              b.confidence - a.confidence ||
              stamp(b).localeCompare(stamp(a))
            );
          })
          .slice(0, 1)
          .map((item) => item.note_id || item.documentId),
      );
      const noteIds = unique(
        relevant.length ? relevant : patient.notes.map((note) => note.id),
      );
      for (const noteId of noteIds) {
        const note = patient.notes.find((item) => item.id === noteId);
        if (!note) continue;
        emit(
          "read_note",
          { patientId, noteId },
          `MATCH (p:Patient {id: '${patientId}'})-[:HAS_NOTE]->(n:ClinicalNote {id: '${noteId}'})\nRETURN n.text, n.note_type, n.written_datetime`,
          thoughtFor(
            "HAS_NOTE",
            coded.rows.length
              ? "Read the sentence behind the documented barrier."
              : "Nothing was coded, so read what the care team wrote.",
          ),
          () => {
            const reader = readNote(note);
            const created = edges.filter(
              (edge) =>
                edge.source === patientId &&
                edge.type === "REPORTED_BARRIER" &&
                edge.note_id === noteId,
            );
            const accepted = reader.assertions.filter(
              (item) => item.status === "active",
            );
            return {
              rows: [clone(note)],
              nodes: [patientId, noteId, ...created.map((edge) => edge.target)],
              edges: [
                edgeId(patientId, "HAS_NOTE", noteId),
                ...created.map((edge) => edge.id),
              ],
              evidence: reader.assertions,
              reader,
              sentencesRead: reader.sentences.length,
              rowsRead: 1,
              rerouted: !coded.rows.length,
              source: {
                table: "clinical_notes",
                key: { id: noteId },
                rows: [clone(note)],
                neighbors: tables.clinical_notes
                  .filter((row) => row.patientId === patientId)
                  .slice(0, 5),
              },
              writes: accepted.map(
                (item) =>
                  `MATCH (p:Patient {id: '${patientId}'}), (b:Barrier {type: '${item.type}'})\nMERGE (p)-[:REPORTED_BARRIER {note_id: '${noteId}', confidence: ${item.confidence}, resolved: ${resolved.has(`${patientId}:${item.type}`)}}]->(b)`,
              ),
              observation: accepted.length
                ? accepted
                    .map(
                      (item) =>
                        `The ${note.note_type.toLowerCase()} says: “${item.evidence_sentence || item.quote}”`,
                    )
                    .join(" ")
                : reader.assertions.length
                  ? `The reader rejects this sentence: ${reader.assertions.map((item) => item.status).join(", ")}.`
                  : "The note contains no current barrier the reader can identify.",
            };
          },
          "notes",
        );
      }
      if (!noteIds.length && !coded.rows.length)
        emit(
          "read_notes",
          { patientId },
          `MATCH (p:Patient {id: '${patientId}'})-[:HAS_NOTE]->(n:ClinicalNote)\nRETURN n`,
          "Check whether any note can explain the missed care.",
          () => ({
            rows: [],
            nodes: [patientId],
            edges: [],
            observation: "There are no clinical notes for this patient.",
          }),
          "notes",
        );
    }
    if (planned.has("LIKELY_TO_RETURN"))
      emit(
        "check_return_rule",
        { patientId, asOf: AS_OF },
        `MATCH (p:Patient {id: '${patientId}'})-[r:LIKELY_TO_RETURN]->(a:Admission)\nRETURN a.id, r.rule`,
        thoughtFor(
          "LIKELY_TO_RETURN",
          "Check all four facts in the follow-up priority rule.",
        ),
        () => ({
          rows: patient.likelyToReturn
            ? [
                {
                  patientId,
                  admissionId: patient.admission.id,
                  rule: "A1c above 9%, no completed visit, new insulin not picked up, current barrier.",
                },
              ]
            : [],
          nodes: [patientId, patient.admission.id],
          edges: edges
            .filter(
              (edge) =>
                edge.source === patientId && edge.type === "LIKELY_TO_RETURN",
            )
            .map((edge) => edge.id),
          rule: true,
          observation: patient.likelyToReturn
            ? "All four follow-up priority conditions are present."
            : "The patient does not meet all four follow-up priority conditions.",
        }),
        "graph",
      );
    if ((plan.filters?.id || plan.id) === "ed-returns")
      tableRead(
        "emergency_department_visits",
        null,
        "Join the missed appointment to a later emergency department visit using the patient ID.",
      );
    if (planned.has("ADDRESSED_BY"))
      emit(
        "match_actions",
        { patientId, barriers: patient.barriers.map((item) => item.type) },
        `MATCH (p:Patient {id: '${patientId}'})-[r:REPORTED_BARRIER]->(b:Barrier)-[:ADDRESSED_BY]->(a:Action)\nWHERE r.active = true AND r.resolved = false\nRETURN DISTINCT b.type, a.action, a.owner`,
        thoughtFor(
          "ADDRESSED_BY",
          "Match each current barrier to the hospital role that can help.",
        ),
        () => ({
          rows: patient.barriers.map((item) => ({
            barrier: item.type,
            action: BARRIERS[item.type].action,
            owner: BARRIERS[item.type].owner,
          })),
          nodes: [
            patientId,
            ...patient.barriers.flatMap((item) => [
              barrierId(item.type),
              actionId(item.type),
            ]),
          ],
          edges: edges
            .filter(
              (edge) =>
                (edge.source === patientId &&
                  edge.type === "REPORTED_BARRIER" &&
                  edge.active) ||
                (edge.type === "ADDRESSED_BY" &&
                  patient.barriers.some(
                    (item) => edge.source === barrierId(item.type),
                  )),
            )
            .map((edge) => edge.id),
          observation: patient.barriers.length
            ? `${patient.barriers.map((item) => BARRIERS[item.type].owner).join(" and ")} can take the next step. ${patient.primary_barrier_reason}`
            : "No barrier-specific action is indicated; use the standard discharge call.",
        }),
        "answer",
      );
    emit(
      "query_patients",
      { filters: plan.filters || { id: plan.id || "main" } },
      queryText(plan.filters || { id: plan.id || "main" }),
      "Run the same route across every discharge and count each patient once.",
      () => {
        const answer = query(plan.filters || { id: plan.id || "main" });
        return {
          rows: answer.rows,
          nodes: answer.execution.nodes,
          edges: answer.execution.edges,
          answer,
          observation: `${answer.count} patients match this question across ${patients.length} discharges.`,
        };
      },
      "answer",
    );
    return events;
  }

  function buildEvents() {
    const events = [],
      builtNodes = new Set(),
      builtEdges = new Set();
    let notesRead = 0,
      rowsRead = 0,
      sentencesRead = 0;
    const add = (tool, args, operation) => {
      const start = performance.now(),
        result = operation(),
        ms = performance.now() - start;
      result.nodes.forEach((id) => builtNodes.add(id));
      result.edges.forEach((id) => builtEdges.add(id));
      notesRead += result.notesRead || 0;
      rowsRead += result.rowsRead || 0;
      sentencesRead += result.sentencesRead || 0;
      events.push({
        step: events.length + 1,
        tool,
        args,
        query: result.query,
        ms,
        rows: result.rows || [],
        rowsRead: result.rowsRead || 0,
        sentencesRead: result.sentencesRead || 0,
        nodes: result.nodes,
        edges: result.edges,
        evidence: result.evidence || [],
        stage: result.stage || "store",
        observation: result.observation,
        thought:
          result.thought || "Connect each fact to the source that recorded it.",
        source: result.source,
        reader: result.reader,
        counters: {
          nodes: builtNodes.size,
          edges: builtEdges.size,
          notesRead,
          toolCalls: events.length + 1,
          nodesVisited: builtNodes.size,
          edgesFollowed: builtEdges.size,
          rowsRead,
          sentencesRead,
        },
        totals: { nodes: builtNodes.size, edges: builtEdges.size, notesRead },
        byNodeType: Object.fromEntries(
          ontology.nodeTypes.map((type) => [
            type,
            nodes.filter(
              (node) => builtNodes.has(node.id) && node.type === type,
            ).length,
          ]),
        ),
        byEdgeType: Object.fromEntries(
          [...ontology.relationships, ...ontology.inferredRelationships].map(
            (type) => [
              type,
              edges.filter(
                (edge) => builtEdges.has(edge.id) && edge.type === type,
              ).length,
            ],
          ),
        ),
      });
    };
    for (const table of [
      "patients",
      "admissions",
      "conditions",
      "lab_results",
      "outpatient_pharmacy",
      "appointments",
      "barrier_catalog",
      "action_catalog",
      "coded_social_needs",
    ])
      add("load_table", { table }, () => {
        const batch = nodes.filter((node) => node.source.table === table);
        const ids = new Set([...builtNodes, ...batch.map((node) => node.id)]);
        const links = edges.filter(
          (edge) =>
            ids.has(edge.source) &&
            ids.has(edge.target) &&
            !edge.derived &&
            (edge.type !== "REPORTED_BARRIER" ||
              (edge.sourceKind === "coded" &&
                table === "coded_social_needs")) &&
            !builtEdges.has(edge.id),
        );
        return {
          nodes: batch.map((node) => node.id),
          edges: links.map((edge) => edge.id),
          rows: tables[table],
          rowsRead: tables[table].length,
          source: { table, rows: tables[table].slice(0, 5), key: {} },
          query: `LOAD SOURCE TABLE ${table}\nMERGE graph nodes and declared relationships BY source row id`,
          observation: `${tables[table].length} rows from ${table.replaceAll("_", " ")} connect ${batch.length} nodes.`,
        };
      });
    for (const note_type of unique(
      tables.clinical_notes.map((note) => note.note_type),
    ))
      add("load_notes", { note_type }, () => {
        const batch = nodes.filter(
          (node) =>
            node.type === "ClinicalNote" &&
            node.properties.note_type === note_type,
        );
        const ids = new Set(batch.map((node) => node.id));
        const links = edges.filter(
          (edge) => edge.type === "HAS_NOTE" && ids.has(edge.target),
        );
        return {
          nodes: batch.map((node) => node.id),
          edges: links.map((edge) => edge.id),
          rows: batch.map((node) => node.properties),
          rowsRead: batch.length,
          stage: "notes",
          query: `MATCH SOURCE clinical_notes WHERE note_type = ${JSON.stringify(note_type)}\nMERGE (p:Patient)-[:HAS_NOTE]->(n:ClinicalNote)`,
          observation: `${batch.length} ${note_type.toLowerCase()} records now point back to their text.`,
        };
      });
    add("read_notes", { noteIds: [...readings.keys()] }, () => {
      const parsed = originals.flatMap((patient) =>
        patient.notes.map((note) => ({
          note_id: note.id,
          reading: readNote(note),
        })),
      );
      const output = parsed.map(({ note_id, reading }) => ({
        note_id,
        assertions: reading.assertions,
      }));
      const links = edges.filter(
        (edge) =>
          edge.type === "REPORTED_BARRIER" && edge.sourceKind === "note",
      );
      return {
        nodes: [],
        edges: links.map((edge) => edge.id),
        rows: output,
        rowsRead: parsed.length,
        sentencesRead: parsed.reduce(
          (sum, item) => sum + item.reading.sentences.length,
          0,
        ),
        evidence: output.flatMap((row) => row.assertions),
        notesRead: output.length,
        stage: "notes",
        query:
          "MATCH (p:Patient)-[:HAS_NOTE]->(n:ClinicalNote)\nCALL read_note(n.text) YIELD assertions\nMERGE (p)-[:REPORTED_BARRIER {note_id:n.id}]->(b:Barrier)",
        observation: `${output.length} notes read; ${links.length} source-linked barrier edges written.`,
      };
    });
    add(
      "apply_rules",
      {
        asOf: AS_OF,
        rules: ["follow_up_gap", "primary_barrier", "likely_to_return"],
      },
      () => {
        const batch = nodes.filter((node) => node.type === "FollowUpGap"),
          links = edges.filter((edge) => edge.derived);
        return {
          nodes: batch.map((node) => node.id),
          edges: links.map((edge) => edge.id),
          rows: patients
            .filter(
              (patient) => patient.followUpGap.open || patient.barriers.length,
            )
            .map((patient) => ({
              patientId: patient.id,
              gap: patient.followUpGap.open,
              primary_barrier: patient.primary_barrier,
              primary_barrier_reason: patient.primary_barrier_reason,
              likelyToReturn: patient.likelyToReturn,
            })),
          rowsRead: 0,
          sentencesRead: 0,
          stage: "graph",
          query: `MATCH (p:Patient)\nCALL apply_follow_up_rules(p, '${AS_OF}')\nSET p.primary_barrier = chosen.type, p.primary_barrier_reason = chosen.reason`,
          observation: `${batch.length} follow-up gaps and ${links.length} derived edges are computed from dated facts.`,
        };
      },
    );
    return events;
  }

  const featuredId = featured();
  return {
    get patients() {
      return patients;
    },
    get nodes() {
      return nodes;
    },
    get edges() {
      return edges;
    },
    get featuredId() {
      return featuredId;
    },
    totals,
    funnel,
    query,
    patientGraph,
    trace,
    buildEvents,
    getPatient: (id) => patients.find((patient) => patient.id === id) || null,
    readTable: (table) => clone(tables[table] || []),
    reading: (noteId) => clone(readings.get(noteId) || null),
    setResolved(patientId, type, value = true) {
      if (
        !patients.some(
          (patient) =>
            patient.id === patientId &&
            patient.barrierAssertions.some(
              (item) => item.type === type && item.status === "active",
            ),
        )
      )
        return false;
      if (value) resolved.add(`${patientId}:${type}`);
      else resolved.delete(`${patientId}:${type}`);
      rebuild();
      return true;
    },
    reset() {
      resolved.clear();
      rebuild();
    },
  };
}

export function queryText(filters = {}) {
  const id = filters.id || "main";
  const lines = ["MATCH (p:Patient)-[:HAD_ADMISSION]->(a:Admission)"];
  if (
    ![
      "all",
      "no-pickup",
      "cost",
      "return-risk",
      "units",
      "before-discharge",
      "ed-returns",
    ].includes(id)
  )
    lines.push("MATCH (p)-[:HAS_GAP]->(:FollowUpGap)");
  if (!["all", "standard", "no-pickup", "ed-returns"].includes(id))
    lines.push(
      "MATCH (p)-[r:REPORTED_BARRIER]->(b:Barrier)",
      "WHERE r.active = true AND r.resolved = false",
    );
  if (id === "standard")
    lines.push(
      "WHERE NOT EXISTS { MATCH (p)-[r:REPORTED_BARRIER]->(:Barrier) WHERE r.active = true AND r.resolved = false }",
    );
  if (id === "all") lines.push("RETURN DISTINCT p");
  else if (id === "units")
    lines.push(
      "RETURN a.unit, count(DISTINCT p) ORDER BY count(DISTINCT p) DESC",
    );
  else if (id === "before-discharge")
    lines.push(
      "MATCH (p)-[:HAS_NOTE]->(n:ClinicalNote)",
      "WHERE n.id = r.note_id AND n.written_datetime < a.discharge_datetime AND n.action_recorded = false",
      "RETURN n.note_type, count(DISTINCT p)",
    );
  else if (id === "ed-returns")
    lines.push(
      "MATCH (p)-[:HAS_APPOINTMENT]->(v:Appointment)",
      "WHERE v.status IN ['no-show', 'no_show']",
      "CALL source_table('emergency_department_visits', {patientId:p.id}) YIELD row",
      "WHERE row.date > v.date",
      "RETURN DISTINCT p, row.date, daysBetween(v.date,row.date) AS daysToReturn",
    );
  else {
    if (id === "cost" || id === "no-pickup")
      lines.push(
        "MATCH (p)-[:PRESCRIBED_AT_DISCHARGE]->(m:Medication)",
        `WHERE m.newStart = true AND m.pickedUp = false${id === "cost" ? " AND m.isInsulin = true AND b.type = 'cost'" : ""}`,
      );
    if (id === "return-risk") lines.push("MATCH (p)-[:LIKELY_TO_RETURN]->(a)");
    if (["transportation", "food", "health-literacy"].includes(id))
      lines.push(`WHERE b.type = '${id.replaceAll("-", "_")}'`);
    if (id === "within30")
      lines.push(`WHERE daysBetween(a.dischargeDate, '${AS_OF}') < 30`);
    if (id === "dual")
      lines.push(
        "WITH p, count(DISTINCT b.type) AS barrier_count WHERE barrier_count > 1",
      );
    if (id === "uncoded")
      lines.push(
        "WHERE NOT EXISTS { CALL source_table('coded_social_needs', {patientId:p.id}) YIELD row }",
      );
    lines.push("RETURN DISTINCT p");
  }
  if (id !== "all") lines.splice(1, 0, "WHERE a.diabetesRelated = true");
  if (
    filters.ageMin != null ||
    filters.ageMax != null ||
    filters.unit ||
    filters.patientId ||
    filters.barrier
  )
    lines.push(
      `APPLY FILTERS ${JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([key]) => key !== "id")))}`,
    );
  return lines.join("\n");
}
