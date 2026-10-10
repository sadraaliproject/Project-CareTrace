import { AS_OF, BARRIERS, buildGraph } from "../dist/engine.js";

const TYPES = Object.keys(BARRIERS);
const MAX_PATIENTS = 1000;
const error = (message) => Object.assign(new Error(message), { status: 400 });
const roundMoney = (cents) => cents / 100;
const cents = (value) => Math.round(value * 100);
const compareId = (a, b) => a.patient.id.localeCompare(b.patient.id);
const hash = (value) => {
  let h = 2166136261;
  for (const c of value) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0").toUpperCase();
};

export function getSimulationDefaults() {
  return {
    barriers: [...TYPES],
    budget: 1000,
    contactCapacity: 20,
    capacities: { transportation: 20, cost: 20, food: 20, health_literacy: 20 },
    costs: { transportation: 40, cost: 25, food: 30, health_literacy: 15 },
  };
}

function numeric(value, label, max, integer = false) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    (integer
      ? !Number.isInteger(value)
      : Math.abs(value * 100 - Math.round(value * 100)) > 1e-7)
  ) {
    throw error(
      `${label} must be a number from 0 to ${max}${integer ? " in whole units" : " with at most two decimal places"}.`,
    );
  }
  return value;
}

export function validateScenario(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw error("The scenario must be an object.");
  const allowed = [
    "barriers",
    "budget",
    "contactCapacity",
    "capacities",
    "costs",
    "patientIds",
  ];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw error("The scenario contains an unsupported setting.");
  const base = getSimulationDefaults();
  const barriers = input.barriers ?? base.barriers;
  if (
    !Array.isArray(barriers) ||
    barriers.length > TYPES.length ||
    barriers.some((type) => !TYPES.includes(type)) ||
    new Set(barriers).size !== barriers.length
  )
    throw error("Choose each supported barrier at most once.");
  const scenario = {
    barriers: TYPES.filter((type) => barriers.includes(type)),
    budget: numeric(input.budget ?? base.budget, "Budget", 10000000),
    contactCapacity: numeric(
      input.contactCapacity ?? base.contactCapacity,
      "Contact capacity",
      MAX_PATIENTS,
      true,
    ),
    capacities: {},
    costs: {},
  };
  for (const field of ["capacities", "costs"]) {
    const supplied = input[field] ?? {};
    if (
      !supplied ||
      typeof supplied !== "object" ||
      Array.isArray(supplied) ||
      Object.keys(supplied).some((type) => !TYPES.includes(type))
    )
      throw error(`${field} must contain only supported barrier types.`);
    for (const type of TYPES)
      scenario[field][type] = numeric(
        supplied[type] ?? base[field][type],
        `${BARRIERS[type].label} ${field}`,
        field === "capacities" ? MAX_PATIENTS : 1000000,
        field === "capacities",
      );
  }
  if (input.patientIds !== undefined) {
    if (
      !Array.isArray(input.patientIds) ||
      input.patientIds.length > MAX_PATIENTS ||
      input.patientIds.some(
        (id) => typeof id !== "string" || !/^P\d{4}$/.test(id),
      ) ||
      new Set(input.patientIds).size !== input.patientIds.length
    )
      throw error(
        "Patient scope must contain at most 1,000 unique patient IDs.",
      );
    scenario.patientIds = [...input.patientIds].sort();
  }
  return scenario;
}

function sourceVerified(patient, assertion) {
  return (
    typeof assertion.quote === "string" &&
    assertion.quote.trim().length > 0 &&
    [...(patient.notes || []), ...(patient.socialNeeds || [])].some(
      (doc) =>
        doc.id === assertion.documentId &&
        (doc.text || doc.display || "").includes(assertion.quote),
    )
  );
}

function candidatesFor(patients, scenario) {
  return patients
    .filter(
      (patient) =>
        patient.admission.diabetesRelated && patient.followUpGap.open,
    )
    .map((patient) => {
      // Repository assertions already contain the reconciled current state. Never
      // turn a historical/resolved assertion into an actionable support request.
      const active = new Map(
        TYPES.flatMap((type) => {
          const assertion = patient.barriers?.find(
            (item) => item.type === type,
          );
          return assertion ? [[type, assertion]] : [];
        }),
      );
      const verified = new Map(
        [...active].filter(([, assertion]) =>
          sourceVerified(patient, assertion),
        ),
      );
      const available = TYPES.filter(
        (type) => scenario.barriers.includes(type) && verified.has(type),
      );
      const priority = Math.max(0, Math.min(99, Number(patient.priority) || 0));
      return { patient, active, verified, available, priority };
    })
    .sort(compareId);
}

function graphFor(candidate, selected) {
  const graph = buildGraph([candidate.patient]);
  const selectedIds = new Set(
    selected
      .map((type) => `barrier:${type}`)
      .concat(selected.map((type) => `action:${type}`)),
  );
  const nodes = graph.nodes.filter(
    (n) => !["Barrier", "Action"].includes(n.type) || selectedIds.has(n.id),
  );
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes: [...ids].sort(),
    edges: graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => e.id)
      .sort(),
  };
}
function allocation(candidate, selected, scenario) {
  const addressedBarriers = TYPES.filter((type) => selected.includes(type));
  const remainingBarriers = TYPES.filter(
    (type) => candidate.active.has(type) && !selected.includes(type),
  );
  return {
    patientId: candidate.patient.id,
    name: candidate.patient.name,
    priority: candidate.priority,
    addressedBarriers,
    remainingBarriers,
    allAddressed: remainingBarriers.length === 0,
    cost: roundMoney(
      addressedBarriers.reduce(
        (sum, type) => sum + cents(scenario.costs[type]),
        0,
      ),
    ),
    actions: addressedBarriers.map((type) => ({
      type,
      label: BARRIERS[type].label,
      action: BARRIERS[type].action,
      estimatedCost: scenario.costs[type],
    })),
    evidence: addressedBarriers.map((type) => ({
      ...candidate.verified.get(type),
      patientId: candidate.patient.id,
    })),
    graph: graphFor(candidate, addressedBarriers),
  };
}

function summarize(allocations, scenario) {
  const totalActions = allocations.reduce(
    (sum, item) => sum + item.addressedBarriers.length,
    0,
  );
  const budgetCents = allocations.reduce(
    (sum, item) => sum + cents(item.cost),
    0,
  );
  const capacityUsed = Object.fromEntries(
    TYPES.map((type) => [
      type,
      allocations.filter((item) => item.addressedBarriers.includes(type))
        .length,
    ]),
  );
  const prioritySum = allocations.reduce((sum, item) => sum + item.priority, 0);
  return {
    patientsReached: allocations.length,
    allBarriersAddressed: allocations.filter((item) => item.allAddressed)
      .length,
    partiallyAddressed: allocations.filter((item) => !item.allAddressed).length,
    totalActions,
    duplicateContactsAvoided: totalActions - allocations.length,
    prioritySum,
    averagePriority: allocations.length
      ? Math.round((prioritySum / allocations.length) * 10) / 10
      : 0,
    budgetUsed: roundMoney(budgetCents),
    budgetRemaining: roundMoney(cents(scenario.budget) - budgetCents),
    contactRemaining: scenario.contactCapacity - allocations.length,
    capacityUsed,
    capacityRemaining: Object.fromEntries(
      TYPES.map((type) => [
        type,
        scenario.capacities[type] - capacityUsed[type],
      ]),
    ),
    allocations,
  };
}

function allocate(candidates, scenario, bundleAware) {
  let remainingBudget = cents(scenario.budget);
  const remainingCapacity = { ...scenario.capacities },
    selectedIds = new Set(),
    allocations = [];
  const canAfford = (types) =>
    types.length > 0 &&
    types.every((type) => remainingCapacity[type] > 0) &&
    types.reduce((sum, type) => sum + cents(scenario.costs[type]), 0) <=
      remainingBudget;
  const add = (candidate, types) => {
    if (
      allocations.length >= scenario.contactCapacity ||
      selectedIds.has(candidate.patient.id) ||
      !canAfford(types)
    )
      return false;
    for (const type of types) {
      remainingCapacity[type]--;
      remainingBudget -= cents(scenario.costs[type]);
    }
    selectedIds.add(candidate.patient.id);
    allocations.push(allocation(candidate, types, scenario));
    return true;
  };
  const priorityOrder = (a, b) => b.priority - a.priority || compareId(a, b);
  if (bundleAware) {
    // Greedy completion-per-cost heuristic, with a modest, explicit priority
    // weight. This is not a proof of an optimal resource allocation.
    const completeBundles = candidates
      .filter(
        (item) =>
          item.available.length && item.available.length === item.active.size,
      )
      .map((item) => ({
        ...item,
        value:
          (1 + item.priority / 100) /
          Math.max(
            1,
            item.available.reduce((sum, type) => sum + scenario.costs[type], 0),
          ),
      }))
      .sort((a, b) => b.value - a.value || priorityOrder(a, b));
    for (const candidate of completeBundles)
      add(candidate, candidate.available);
  }
  for (const candidate of [...candidates].sort(priorityOrder)) {
    if (allocations.length >= scenario.contactCapacity) break;
    if (selectedIds.has(candidate.patient.id)) continue;
    let patientBudget = remainingBudget;
    const order = [...candidate.available].sort((a, b) =>
      bundleAware
        ? scenario.costs[a] - scenario.costs[b] ||
          TYPES.indexOf(a) - TYPES.indexOf(b)
        : TYPES.indexOf(a) - TYPES.indexOf(b),
    );
    const selected = order.filter((type) => {
      if (
        remainingCapacity[type] <= 0 ||
        cents(scenario.costs[type]) > patientBudget
      )
        return false;
      patientBudget -= cents(scenario.costs[type]);
      return true;
    });
    add(candidate, selected);
  }
  return summarize(allocations, scenario);
}

/** Pure, deterministic hypothetical support planning; does not resolve barriers. */
export function simulateResources({ patients, scenario: input = {} }) {
  if (
    !Array.isArray(patients) ||
    patients.length > MAX_PATIENTS ||
    patients.some((p) => !p || typeof p.id !== "string") ||
    new Set(patients.map((p) => p.id)).size !== patients.length
  )
    throw error(
      "A complete set of unique discharged patients of at most 1,000 patients is required.",
    );
  const scenario = validateScenario(input),
    ids = new Set(scenario.patientIds || []);
  if (
    scenario.patientIds?.some(
      (id) => !patients.some((patient) => patient.id === id),
    )
  )
    throw error("The scenario refers to an unknown patient.");
  const scoped = scenario.patientIds
    ? patients.filter((patient) => ids.has(patient.id))
    : patients;
  const candidates = candidatesFor(scoped, scenario),
    optimized = allocate(candidates, scenario, true),
    baseline = allocate(candidates, scenario, false);
  const chosen = new Map(
    optimized.allocations.map((item) => [item.patientId, item]),
  );
  const remainingBlockers = TYPES.map((type) => ({
    type,
    label: BARRIERS[type].label,
    count: candidates.filter(
      (item) =>
        item.active.has(type) &&
        !chosen.get(item.patient.id)?.addressedBarriers.includes(type),
    ).length,
    enabled: scenario.barriers.includes(type),
  })).filter((item) => item.count > 0);
  const graphOverlay = {
    nodes: [
      ...new Set(optimized.allocations.flatMap((item) => item.graph.nodes)),
    ].sort(),
    edges: [
      ...new Set(optimized.allocations.flatMap((item) => item.graph.edges)),
    ].sort(),
  };
  const patientCounts = {
    total: patients.length,
    scoped: scoped.length,
    eligible: candidates.length,
    withActiveBarriers: candidates.filter((item) => item.active.size).length,
    withSelectedBarriers: candidates.filter((item) =>
      [...item.active.keys()].some((type) => scenario.barriers.includes(type)),
    ).length,
    sourceVerified: candidates.filter((item) => item.available.length).length,
    unverifiedActionsExcluded: candidates.reduce(
      (sum, item) =>
        sum +
        [...item.active.keys()].filter(
          (type) =>
            scenario.barriers.includes(type) && !item.verified.has(type),
        ).length,
      0,
    ),
  };
  const fingerprint = hash(
    JSON.stringify({
      scenario,
      state: candidates.map((item) => ({
        id: item.patient.id,
        priority: item.priority,
        gap: item.patient.followUpGap,
        active: [...item.active.values()],
        available: item.available,
      })),
      selected: optimized.allocations.map((item) => [
        item.patientId,
        item.addressedBarriers,
      ]),
    }),
  );
  return {
    scenario,
    snapshot: AS_OF,
    synthetic: true,
    hypothetical: true,
    method: "deterministic-greedy-bundles-v1",
    fingerprint,
    assumptions: [
      "This is a hypothetical support plan for fictional hospital discharges with a follow-up gap. No patient record, follow-up gap, task, or barrier is changed.",
      "All barriers addressed means that the plan assigns a support for every currently documented active barrier; it does not predict barrier resolution, attendance, or any clinical outcome.",
      "Budget and per-support costs are editable, illustrative planning dollars, not real program prices. Eligibility, patient consent, and program availability still require a hospital staff review.",
      "Each support uses one slot of its barrier-specific capacity. One coordinated contact can cover multiple supports for a patient. Duplicate contact avoided is the difference from contacting the patient separately for every support, not an observed saving.",
      "The bundle-aware heuristic ranks complete bundles by (1 + synthetic priority / 100) divided by their cost, then uses remaining resources on partial bundles in priority order. It is deterministic, not guaranteed optimal or superior to the baseline.",
      "Coverage-first planning can favor less expensive supports over complex, higher-priority patients. Compare average synthetic priority and patients left without support before choosing a plan; greater coverage is not proof of greater clinical benefit.",
      "The baseline considers patients by descending synthetic priority, then ID, and assigns enabled supports in the fixed ontology order. Both plans use the same budget, patient-contact limit, per-support capacities, and verified current evidence.",
      "Only exact excerpts verified against their linked clinical note or coded row can support an allocation. Unselected and unverifiable current barriers still count as remaining blockers.",
    ],
    patients: patientCounts,
    optimized,
    baseline,
    tradeoffs: {
      optimizedAveragePriority: optimized.averagePriority,
      baselineAveragePriority: baseline.averagePriority,
      priorityDifference:
        Math.round(
          (optimized.averagePriority - baseline.averagePriority) * 10,
        ) / 10,
      highPriorityWithoutSupport: candidates.filter(
        (item) =>
          item.priority >= 80 &&
          item.active.size &&
          !chosen.has(item.patient.id),
      ).length,
      highPriorityThreshold: 80,
      label:
        "Synthetic priority is a demo ranking score, not a validated clinical prediction.",
    },
    difference: Object.fromEntries(
      [
        "allBarriersAddressed",
        "patientsReached",
        "budgetUsed",
        "duplicateContactsAvoided",
      ].map((key) => [
        key,
        Math.round((optimized[key] - baseline[key]) * 100) / 100,
      ]),
    ),
    remainingBlockers,
    graphOverlay,
  };
}

/** Read the live persisted discharges; never substitute the original seed data. */
export async function simulateFromRepository(repo, scenario = {}) {
  validateScenario(scenario);
  const result = await repo.listPatients({ limit: MAX_PATIENTS, offset: 0 });
  if (result.count !== result.patients.length)
    throw error(
      "The complete set of discharged patients is required for an exact simulation; this demo supports at most 1,000 patients.",
    );
  return simulateResources({ patients: result.patients, scenario });
}
