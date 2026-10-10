import test from 'node:test';
import assert from 'node:assert/strict';
import { getSimulationDefaults, simulateResources, simulateFromRepository } from '../backend/insights.js';
import { createSqliteRepository } from '../backend/sqlite.js';

const fixture = (id, types, priority = 50, overrides = {}) => ({
  id, name: `Fictional ${id}`, diabetes: true, gapOpen: true, priority,
  gaps: [{ type: 'a1c_overdue', label: 'A1c overdue' }],
  documents: types.map(type => ({ id: `${id}-${type}`, date: '2026-10-09', type: 'Synthetic call', text: `Active ${type} evidence for ${id}.` })),
  barriers: types.map(type => ({ type, status: 'active', documentId: `${id}-${type}`, date: '2026-10-09', source: 'Synthetic call', quote: `Active ${type} evidence for ${id}.` })),
  ...overrides,
});

test('bundle-aware allocation covers complete bundles without claiming predicted health outcomes', () => {
  const patients = [fixture('P0001', ['transportation', 'cost'], 99), fixture('P0002', ['cost'], 70), fixture('P0003', ['food'], 60)];
  const result = simulateResources({ patients, scenario: { budget: 55, outreachCapacity: 2 } });
  assert.equal(result.optimized.allBarriersAddressed, 2);
  assert.equal(result.baseline.allBarriersAddressed, 0);
  assert.equal(result.optimized.budgetUsed, 55);
  assert.deepEqual(result.optimized.allocations.map(item => item.patientId), ['P0002', 'P0003']);
  assert.equal(result.difference.allBarriersAddressed, 2);
  assert.equal(result.hypothetical, true);
  assert.match(result.assumptions.join(' '), /does not predict barrier resolution/);
  assert.match(result.assumptions.join(' '), /not guaranteed optimal/);
  assert.equal(patients[0].barriers[0].status, 'active');
});

test('patient bundles deduplicate outreach while preserving every exact evidence reference and graph edge', () => {
  const result = simulateResources({ patients: [fixture('P0042', ['transportation', 'cost'])] });
  const item = result.optimized.allocations[0];
  assert.equal(result.optimized.totalActions, 2);
  assert.equal(result.optimized.patientsReached, 1);
  assert.equal(result.optimized.duplicateOutreachAvoided, 1);
  assert.equal(item.evidence.length, 2);
  assert.equal(item.evidence[0].quote, 'Active transportation evidence for P0042.');
  assert.ok(result.graphOverlay.nodes.includes('P0042:a1c_overdue'));
  assert.ok(result.graphOverlay.edges.includes('EVIDENCES:P0042-transportation:barrier:transportation'));
  assert.ok(result.graphOverlay.edges.includes('ADDRESSED_BY:barrier:cost:intervention:cost'));
});

test('unselected and unverifiable active barriers remain blockers, while resolved assertions never consume resources', () => {
  const first = fixture('P0001', ['transportation', 'food']);
  const second = fixture('P0002', ['transportation', 'cost']);
  second.barriers[1].status = 'resolved';
  const third = fixture('P0003', ['transportation', 'cost']);
  third.barriers[1].quote = 'Not a substring of the source';
  const result = simulateResources({ patients: [first, second, third], scenario: { barriers: ['transportation', 'cost'] } });
  assert.equal(result.optimized.allBarriersAddressed, 1);
  assert.equal(result.optimized.partiallyAddressed, 2);
  assert.equal(result.population.unverifiedActionsExcluded, 1);
  assert.deepEqual(result.remainingBlockers.map(item => [item.type, item.count]), [['cost', 1], ['food', 1]]);
  assert.equal(result.optimized.capacityUsed.cost, 0);
  assert.equal(result.optimized.allocations.find(item => item.patientId === 'P0003').allAddressed, false);
});

test('budget, patient slots, barrier capacity and decimal costs remain bounded for both strategies', () => {
  const patients = Array.from({ length: 30 }, (_, i) => fixture(`P${String(i + 1).padStart(4, '0')}`, ['transportation', 'cost', 'food'], 99 - i));
  const scenario = { budget: 100.01, outreachCapacity: 7, capacities: { transportation: 2, cost: 3, food: 4 }, costs: { transportation: 10.01, cost: 10.02, food: 10.03 } };
  const result = simulateResources({ patients, scenario });
  for (const plan of [result.optimized, result.baseline]) {
    assert.ok(plan.patientsReached <= 7); assert.ok(plan.budgetUsed <= scenario.budget); assert.ok(plan.budgetRemaining >= 0);
    for (const [type, used] of Object.entries(plan.capacityUsed)) assert.ok(used <= result.scenario.capacities[type]);
    assert.equal(new Set(plan.allocations.map(item => item.patientId)).size, plan.patientsReached);
    assert.equal(Math.round((plan.budgetUsed + plan.budgetRemaining) * 100), 10001);
  }
});

test('zero capacity and explicit empty scopes remain empty; zero-cost support still consumes capacity', () => {
  const patients = [fixture('P0001', ['transportation'])];
  for (const scenario of [{ budget: 0 }, { outreachCapacity: 0 }, { barriers: [] }, { patientIds: [] }, { capacities: { transportation: 0 } }]) {
    const result = simulateResources({ patients, scenario });
    assert.equal(result.optimized.patientsReached, 0);
    assert.equal(result.baseline.patientsReached, 0);
  }
  const result = simulateResources({ patients, scenario: { budget: 0, costs: { transportation: 0 } } });
  assert.equal(result.optimized.allBarriersAddressed, 1); assert.equal(result.optimized.capacityUsed.transportation, 1); assert.equal(result.optimized.budgetUsed, 0);
});

test('simulations are repeatable and independent of population ordering', () => {
  const patients = [fixture('P0001', ['food'], 70), fixture('P0002', ['food'], 70), fixture('P0003', ['transportation'], 80)];
  const first = simulateResources({ patients, scenario: { budget: 60 } });
  assert.deepEqual(simulateResources({ patients: [...patients].reverse(), scenario: { budget: 60 } }), first);
  assert.deepEqual(simulateResources({ patients, scenario: { budget: 60 } }), first);
  assert.deepEqual(first.optimized.allocations.map(item => item.patientId), ['P0001', 'P0002']);
});

test('invalid input is rejected rather than silently broadening the scenario', async () => {
  const patients = [fixture('P0001', ['cost'])];
  for (const scenario of [{ budget: -1 }, { budget: '100' }, { budget: NaN }, { budget: 0.001 }, { outreachCapacity: 2.5 }, { barriers: ['cost', 'cost'] }, { barriers: ['unknown'] }, { costs: { fake: 2 } }, { patientIds: ['P0002'] }, { patientIds: ['P0001', 'P0001'] }, { strategy: 'optimal' }]) {
    assert.throws(() => simulateResources({ patients, scenario }), { status: 400 });
  }
  assert.throws(() => simulateResources({ patients: [patients[0], patients[0]] }), { status: 400 });
  await assert.rejects(() => simulateFromRepository({ listPatients: async () => ({ patients, count: 1001 }) }), /complete population/);
  assert.equal(getSimulationDefaults().budget, 1000);
});

test('persisted live evidence changes the simulation and graph without changing stored tasks or asserting resolution', async t => {
  const repo = await createSqliteRepository({ filename: ':memory:' }); t.after(() => repo.close()); await repo.seed();
  const scenario = { patientIds: ['P0412'], barriers: ['transportation'], budget: 100 };
  const before = await simulateFromRepository(repo, scenario);
  assert.equal(before.optimized.patientsReached, 1);
  const graph = await repo.getGraph({ patientId: 'P0412' });
  for (const id of before.graphOverlay.nodes) assert.ok(graph.nodes.some(node => node.id === id), id);
  for (const id of before.graphOverlay.edges) assert.ok(graph.edges.some(edge => edge.id === id), id);
  await repo.addDocument('P0412', { text: 'Patient no longer needs transportation help and now has reliable rides.', type: 'Synthetic judge follow-up', date: '2026-10-10', synthetic: true });
  const after = await simulateFromRepository(repo, scenario);
  assert.equal(after.optimized.patientsReached, 0);
  assert.notEqual(after.fingerprint, before.fingerprint);
  assert.equal((await repo.listTasks()).length, 0);
});
