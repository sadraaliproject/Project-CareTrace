import { rawPatients } from "../dist/pilot-data.js";
import { createPilotGraph, AS_OF, daysBetween } from "../dist/pilot-engine.js";
import { BARRIERS, ontology } from "../dist/ontology.js";
import { readLiveNote, LIVE_READER_VERSION } from "./live-reader.js";

const copy = (value) => structuredClone(value);
const barrierTypes = Object.keys(BARRIERS);
const unique = (values) => [...new Set(values)];
const stamp = (value) => value.written_datetime || value.date || "";
function validateDate(asOf) {
  if (
    typeof asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
    !Number.isFinite(Date.parse(asOf)) ||
    new Date(asOf).toISOString().slice(0, 10) !== asOf ||
    asOf > AS_OF
  )
    throw new Error(`Choose a valid date on or before ${AS_OF}.`);
  return asOf;
}

export const defaultFilters = Object.freeze({
  diabetesAdmissionOnly: true,
  gapOnly: true,
  barrierPresence: "present",
  barriers: Object.freeze([]),
  barrierMode: "any",
  ageMin: null,
  ageMax: null,
  unit: null,
  within30: false,
  insulinNotPickedUp: false,
  likelyToReturn: false,
  beforeDischarge: false,
  uncodedOnly: false,
  edReturn: false,
  appointmentStatus: null,
  medicationPickup: null,
  patientSearch: null,
});

export function validateFilters(input = {}, units = null) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Filters must be an object.");
  for (const key of Object.keys(input))
    if (!Object.hasOwn(defaultFilters, key))
      throw new Error(`Unsupported filter: ${key}.`);
  const filters = { ...defaultFilters, ...input };
  if (
    ![null, "missed", "completed", "scheduled", "none"].includes(
      filters.appointmentStatus,
    )
  )
    throw new Error(
      "Choose a recorded appointment status: missed, completed, scheduled or none.",
    );
  if (![null, "uncollected", "collected"].includes(filters.medicationPickup))
    throw new Error("Choose collected or uncollected medication.");
  if (
    filters.patientSearch !== null &&
    (typeof filters.patientSearch !== "string" ||
      !filters.patientSearch.trim() ||
      filters.patientSearch.length > 100)
  )
    throw new Error("Use a patient name or ID up to 100 characters.");
  for (const [key, value] of Object.entries(defaultFilters))
    if (typeof value === "boolean" && typeof filters[key] !== "boolean")
      throw new Error(`${key} must be true or false.`);
  if (!["any", "present", "absent"].includes(filters.barrierPresence))
    throw new Error("barrierPresence must be any, present or absent.");
  if (!["any", "all"].includes(filters.barrierMode))
    throw new Error("barrierMode must be any or all.");
  if (
    !Array.isArray(filters.barriers) ||
    filters.barriers.some((type) => !barrierTypes.includes(type))
  )
    throw new Error("Use only supported barrier types.");
  filters.barriers = unique(filters.barriers).sort();
  if (filters.barriers.length && filters.barrierPresence === "absent")
    throw new Error(
      "Named current barriers conflict with barrierPresence absent.",
    );
  for (const key of ["ageMin", "ageMax"])
    if (
      filters[key] !== null &&
      (!Number.isInteger(filters[key]) ||
        filters[key] < 18 ||
        filters[key] > 120)
    )
      throw new Error(`${key} must be null or an integer from 18 to 120.`);
  if (
    filters.ageMin !== null &&
    filters.ageMax !== null &&
    filters.ageMin > filters.ageMax
  )
    throw new Error("The minimum age exceeds the maximum age.");
  if (
    filters.unit !== null &&
    (typeof filters.unit !== "string" ||
      !filters.unit.trim() ||
      filters.unit.length > 100)
  )
    throw new Error("unit must be null or a hospital unit name.");
  if (filters.unit && units && !units.includes(filters.unit))
    throw new Error(`Unknown hospital unit. Choose ${units.join(", ")}.`);
  return filters;
}

/** Stable content identity, not a security signature. No clock or random input. */
function fingerprint(value) {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `cw-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function describeFilters(filters) {
  const parts = [];
  if (filters.diabetesAdmissionOnly) parts.push("diabetes-related admissions");
  if (filters.gapOnly) parts.push("an open follow-up gap");
  if (filters.barrierPresence === "present")
    parts.push("at least one current documented barrier");
  if (filters.barrierPresence === "absent")
    parts.push("no current documented barrier");
  if (filters.barriers.length)
    parts.push(
      `${filters.barrierMode === "all" ? "all" : "any"} of: ${filters.barriers.map((type) => BARRIERS[type].label.toLowerCase()).join(", ")}`,
    );
  if (filters.ageMin !== null) parts.push(`age ${filters.ageMin} or older`);
  if (filters.ageMax !== null) parts.push(`age ${filters.ageMax} or younger`);
  if (filters.unit) parts.push(`discharged from ${filters.unit}`);
  if (filters.patientSearch)
    parts.push(`patient name or ID matching ${filters.patientSearch}`);
  if (filters.appointmentStatus)
    parts.push(
      filters.appointmentStatus === "none"
        ? "no recorded follow-up appointment"
        : `${filters.appointmentStatus} follow-up appointment`,
    );
  if (filters.medicationPickup)
    parts.push(
      filters.medicationPickup === "uncollected"
        ? "a discharge medication with no recorded pickup"
        : "a discharge medication with a recorded pickup",
    );
  if (filters.within30) parts.push("fewer than 30 days since discharge");
  if (filters.insulinNotPickedUp) parts.push("new insulin not picked up");
  if (filters.likelyToReturn)
    parts.push("the simplified likely-to-return flag");
  if (filters.beforeDischarge)
    parts.push(
      "a current barrier in a note before discharge, with no action recorded in that note",
    );
  if (filters.uncodedOnly) parts.push("no coded social need recorded");
  if (filters.edReturn)
    parts.push("an emergency visit after a missed follow-up visit");
  return parts.length ? parts : ["all synthetic patients"];
}

function evidenceFor(patient) {
  return patient.barriers.flatMap((barrier) => {
    const sources = barrier.evidence_sources || [barrier];
    return sources.map((item) => ({
      id: `${patient.id}:${barrier.type}:${item.note_id || item.documentId}`,
      patientId: patient.id,
      type: barrier.type,
      sourceKind: item.sourceKind,
      sourceId: item.note_id || item.documentId,
      quote: item.evidence_sentence || item.quote,
      charSpan: item.char_span || null,
      noteType: item.note_type,
      date: stamp(item),
      confidence: item.confidence,
    }));
  });
}

function summaryFor(patient) {
  if (!patient) return null;
  return {
    id: patient.id,
    name: patient.name,
    age: patient.age,
    sex: patient.sex,
    unit: patient.admission.unit,
    dischargeDate: patient.admission.dischargeDate,
    daysSinceDischarge: patient.daysSinceDischarge,
    daysRemaining: patient.daysRemaining,
    primaryBarrier: patient.primary_barrier,
    primaryBarrierReason: patient.primary_barrier_reason,
    barriers: patient.barriers.map((barrier) => ({
      type: barrier.type,
      label: BARRIERS[barrier.type].label,
      confidence: barrier.confidence,
      sourceId: barrier.note_id || barrier.documentId,
      quote: barrier.evidence_sentence || barrier.quote,
      sourceKind: barrier.sourceKind,
    })),
    gapReasons: patient.followUpGap.reasons,
    likelyToReturn: patient.likelyToReturn,
    sourceIds: unique([
      patient.admission.id,
      ...patient.barriers.flatMap((barrier) =>
        (barrier.evidence_sources || [barrier]).map(
          (item) => item.note_id || item.documentId,
        ),
      ),
      ...patient.notes.map((item) => item.id),
      ...patient.medications.map((item) => item.id),
      ...patient.appointments.map((item) => item.id),
    ]),
  };
}

export function createLiveGraph(inputPatients = rawPatients) {
  // Every caller receives immutable views; the underlying mutable pilot is private.
  const originals = copy(inputPatients);
  const pilot = createPilotGraph(originals, { readNote: readLiveNote });
  const units = unique(
    pilot.patients.map((patient) => patient.admission.unit),
  ).sort();
  const nodeIndex = new Map(pilot.nodes.map((node) => [node.id, node]));
  const adjacency = new Map();
  for (const edge of pilot.edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source).push(edge);
  }

  const sources = new Map();
  for (const patient of originals) {
    for (const [table, rows] of [
      [
        "patients",
        [
          {
            id: patient.id,
            name: patient.name,
            age: patient.age,
            sex: patient.sex,
          },
        ],
      ],
      ["admissions", [patient.admission]],
      ["clinical_notes", patient.notes],
      ["coded_social_needs", patient.socialNeeds],
      ["lab_results", patient.labs],
      ["outpatient_pharmacy", patient.medications],
      ["appointments", patient.appointments],
      ["emergency_department_visits", patient.emergencyVisits],
      ["conditions", patient.condition ? [patient.condition] : []],
    ])
      for (const row of rows || [])
        sources.set(row.id, {
          id: row.id,
          patientId: patient.id,
          table,
          row,
          text: row.text || row.display || null,
        });
  }

  function queryAgainst(graph, filters, { limit = 30 } = {}) {
    const started = performance.now();
    filters = validateFilters(filters, units);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error("The result sample limit must be from 1 to 100.");
    const visitedNodes = new Set(),
      visitedEdges = new Set();
    // Read actual stored edges. An isolated simulation has its own edge index.
    const localNodes =
      graph === pilot
        ? nodeIndex
        : new Map(graph.nodes.map((node) => [node.id, node]));
    const localAdjacency =
      graph === pilot
        ? adjacency
        : new Map(
            graph.patients.map((patient) => [
              patient.id,
              graph.edges.filter((edge) => edge.source === patient.id),
            ]),
          );
    const follow = (patient, type) => {
      visitedNodes.add(patient.id);
      const edges = (localAdjacency.get(patient.id) || []).filter(
        (edge) => edge.type === type,
      );
      for (const edge of edges) {
        visitedEdges.add(edge.id);
        visitedNodes.add(edge.target);
      }
      return edges;
    };
    const selected = graph.patients
      .filter((patient) => {
        const admission = follow(patient, "HAD_ADMISSION").map(
          (edge) => localNodes.get(edge.target)?.properties,
        );
        if (
          filters.diabetesAdmissionOnly &&
          !admission.some((row) => row?.diabetesRelated)
        )
          return false;
        if (filters.gapOnly && !follow(patient, "HAS_GAP").length) return false;
        if (
          filters.patientSearch &&
          !`${patient.id} ${patient.name}`
            .toLowerCase()
            .includes(filters.patientSearch.toLowerCase().trim())
        )
          return false;
        if (filters.appointmentStatus) {
          const appointments = follow(patient, "HAS_APPOINTMENT")
            .map((edge) => localNodes.get(edge.target)?.properties)
            .filter(Boolean);
          const statuses = {
            missed: ["no_show", "no-show"],
            completed: ["completed", "attended"],
            scheduled: ["scheduled"],
          };
          if (
            filters.appointmentStatus === "none"
              ? appointments.length > 0
              : !appointments.some((row) =>
                  statuses[filters.appointmentStatus].includes(row.status),
                )
          )
            return false;
        }
        if (
          filters.medicationPickup &&
          !follow(patient, "PRESCRIBED_AT_DISCHARGE").some((edge) => {
            const row = localNodes.get(edge.target)?.properties;
            return (
              row &&
              (filters.medicationPickup === "collected"
                ? row.pickedUp === true
                : row.pickedUp === false)
            );
          })
        )
          return false;
        if (filters.ageMin !== null && patient.age < filters.ageMin)
          return false;
        if (filters.ageMax !== null && patient.age > filters.ageMax)
          return false;
        if (
          filters.unit &&
          !admission.some((row) => row?.unit === filters.unit)
        )
          return false;
        const active = follow(patient, "REPORTED_BARRIER").filter(
          (edge) => edge.active && !edge.resolved,
        );
        const types = new Set(active.map((edge) => edge.properties.type));
        if (filters.barrierPresence === "present" && !types.size) return false;
        if (filters.barrierPresence === "absent" && types.size) return false;
        if (
          filters.barriers.length &&
          !(filters.barrierMode === "all"
            ? filters.barriers.every((type) => types.has(type))
            : filters.barriers.some((type) => types.has(type)))
        )
          return false;
        if (
          filters.within30 &&
          !(patient.daysSinceDischarge >= 0 && patient.daysSinceDischarge < 30)
        )
          return false;
        if (
          filters.insulinNotPickedUp &&
          !follow(patient, "PRESCRIBED_AT_DISCHARGE").some((edge) => {
            const row = localNodes.get(edge.target)?.properties;
            return row?.newStart && row.isInsulin && !row.pickedUp;
          })
        )
          return false;
        if (
          filters.likelyToReturn &&
          !follow(patient, "LIKELY_TO_RETURN").length
        )
          return false;
        if (filters.beforeDischarge) {
          follow(patient, "HAS_NOTE");
          if (
            !patient.barriers.some((barrier) =>
              barrier.evidence_sources.some(
                (item) =>
                  item.sourceKind === "note" &&
                  !item.action_recorded &&
                  Date.parse(stamp(item)) <
                    Date.parse(
                      patient.admission.discharge_datetime ||
                        `${patient.admission.dischargeDate}T23:59:59Z`,
                    ),
              ),
            )
          )
            return false;
        }
        if (filters.uncodedOnly && patient.socialNeeds.length) return false;
        if (filters.edReturn) {
          const appointments = follow(patient, "HAS_APPOINTMENT").map(
            (edge) => localNodes.get(edge.target)?.properties,
          );
          if (
            !patient.emergencyVisits.some((visit) =>
              appointments.some(
                (appointment) =>
                  ["no_show", "no-show"].includes(appointment?.status) &&
                  daysBetween(appointment.date, visit.date) >= 0 &&
                  daysBetween(patient.admission.dischargeDate, visit.date) >= 0,
              ),
            )
          )
            return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          Number(a.daysSinceDischarge >= 30) -
            Number(b.daysSinceDischarge >= 30) ||
          a.daysRemaining - b.daysRemaining ||
          a.id.localeCompare(b.id),
      );
    const groups = Object.entries(BARRIERS).map(([type, spec]) => ({
      type,
      label: spec.label,
      count: selected.filter((patient) => patient.primary_barrier === type)
        .length,
      patientIds: selected
        .filter((patient) => patient.primary_barrier === type)
        .map((patient) => patient.id),
      action: spec.action,
      owner: spec.owner,
    }));
    const ids = selected.map((patient) => patient.id);
    const sample = selected.slice(0, limit);
    const resultGraph = sample.length
      ? graph.patientGraph(sample[0].id)
      : { nodes: [], edges: [], patient: null, asOf: AS_OF };
    return {
      count: ids.length,
      ids,
      patients: sample.map(summaryFor),
      groups,
      units: unique(selected.map((patient) => patient.admission.unit))
        .map((unit) => ({
          unit,
          count: selected.filter((patient) => patient.admission.unit === unit)
            .length,
        }))
        .sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit)),
      filters,
      fingerprint: fingerprint({ asOf: AS_OF, filters, ids }),
      asOf: AS_OF,
      assumptions: describeFilters(filters),
      citations: sample.flatMap(evidenceFor),
      graph: copy(resultGraph),
      execution: {
        nodesVisited: visitedNodes.size,
        edgesVisited: visitedEdges.size,
        patientsScanned: graph.patients.length,
        durationMs: Math.round((performance.now() - started) * 100) / 100,
      },
      sampleLimit: limit,
      sampleTruncated: selected.length > sample.length,
    };
  }

  function datedPatientGraph(id, options = {}) {
    const asOf = validateDate(options.asOf || AS_OF);
    const snapshot = pilot.patientGraph(id, { ...options, asOf });
    if (snapshot.patient?.admission.admitDate > asOf)
      return { nodes: [], edges: [], patient: null, asOf };
    const admission = snapshot.nodes.find((node) => node.type === "Admission");
    if (admission && snapshot.patient) {
      const { patientId, ...row } = admission.properties;
      snapshot.patient.admission = row;
    }
    return snapshot;
  }

  function source(id, { asOf = AS_OF } = {}) {
    validateDate(asOf);
    const found = sources.get(id);
    if (!found) return null;
    const snapshot = datedPatientGraph(found.patientId, { asOf });
    const patient = snapshot.patient;
    if (!patient) return null;
    let row;
    if (found.table === "patients")
      row = {
        id: patient.id,
        name: patient.name,
        age: patient.age,
        sex: patient.sex,
      };
    else if (found.table === "admissions")
      row = snapshot.nodes.find((node) => node.id === id)?.properties;
    else if (found.table === "conditions") row = patient.condition;
    else {
      const records = {
        clinical_notes: patient.notes,
        coded_social_needs: patient.socialNeeds,
        lab_results: patient.labs,
        outpatient_pharmacy: patient.medications,
        appointments: patient.appointments,
        emergency_department_visits: patient.emergencyVisits,
      };
      row = records[found.table]?.find((item) => item.id === id);
    }
    if (!row) return null;
    return copy({
      ...found,
      row,
      text: row.text || row.display || null,
      asOf,
      historical: asOf !== AS_OF,
      assertions: patient.barrierAssertions.filter(
        (item) => (item.note_id || item.documentId) === id,
      ),
    });
  }

  function whatIf({ patientId, barrier, filters = defaultFilters } = {}) {
    const patient = pilot.getPatient(patientId);
    if (!patient) throw new Error("Patient not found.");
    if (
      !barrierTypes.includes(barrier) ||
      !patient.barriers.some((item) => item.type === barrier)
    )
      throw new Error("Choose a current barrier recorded for this patient.");
    const isolated = createPilotGraph(originals, { readNote: readLiveNote });
    isolated.setResolved(patientId, barrier, true);
    const before = queryAgainst(pilot, filters);
    const after = queryAgainst(isolated, filters);
    const changed = isolated.getPatient(patientId);
    return {
      patientId,
      barrier,
      simulated: true,
      persisted: false,
      before: {
        count: before.count,
        fingerprint: before.fingerprint,
        primaryBarrier: patient.primary_barrier,
        likelyToReturn: patient.likelyToReturn,
      },
      after: {
        count: after.count,
        fingerprint: after.fingerprint,
        primaryBarrier: changed.primary_barrier,
        likelyToReturn: changed.likelyToReturn,
      },
      difference: after.count - before.count,
      patient: summaryFor(changed),
      graph: isolated.patientGraph(patientId),
      explanation:
        "This removes a barrier from a copy of the graph. It does not change the recorded missed visit or medication pickup, predict a clinical outcome, or contact anyone.",
    };
  }

  return {
    overview: () =>
      copy({
        asOf: AS_OF,
        readerVersion: LIVE_READER_VERSION,
        ...pilot.funnel(),
        totals: pilot.totals(),
        featuredId: pilot.featuredId,
        featuredPatient: summaryFor(pilot.getPatient(pilot.featuredId)),
        units,
        barriers: BARRIERS,
      }),
    describe: () =>
      copy({
        asOf: AS_OF,
        readerVersion: LIVE_READER_VERSION,
        ontology,
        defaultFilters,
        units,
        barrierTypes,
        definitions: {
          gap: ontology.followUpGapRule,
          appointmentStatus:
            "Recorded follow-up appointment status; missed means no_show/no-show, completed means completed/attended. This is separate from the derived follow-up-gap rule.",
          medicationPickup:
            "At least one discharge medication with or without a recorded pickup. Uncollected does not imply the pickup deadline has passed.",
          likelyToReturn: ontology.likelyToReturnRule,
          beforeDischarge:
            "A currently active barrier has a clinical note written before discharge with no action recorded in that note.",
          uncodedOnly: "No coded social need row exists for the patient.",
          edReturn:
            "An emergency department visit occurred on or after a missed follow-up visit and on or after discharge.",
          barrierReading:
            "Current edges come from the versioned local text reader. Negation and context handling are measured but imperfect; every finding requires source review.",
        },
      }),
    query: (filters = defaultFilters, options) =>
      queryAgainst(pilot, filters, options),
    getPatient: (id, options = {}) =>
      options.asOf
        ? copy(datedPatientGraph(id, options).patient)
        : copy(pilot.getPatient(id)),
    patientGraph(id, options = {}) {
      return copy(datedPatientGraph(id, options));
    },
    source,
    whatIf,
  };
}
