import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.js';

test('HTTP workflow persists source, graph, task version, run, and SQL cohort changes', async () => {
  const server = createAppServer({ filename: ':memory:', apiKey: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, method = 'GET', body) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  }
  try {
    const boot = await api('/api/bootstrap');
    assert.equal(boot.data.patients.length, 1000);
    assert.equal(boot.data.metrics.nodes, 4797);
    const question = 'Find diabetic patients overdue for A1c tests with transportation barriers.';
    const first = await api('/api/agent', 'POST', { question });
    assert.equal(first.status, 200);
    assert.equal(first.data.result.count, 82);
    assert.ok(first.data.runId);
    const task = (await api('/api/tasks', 'POST', { patientId: 'P0412', barrier: 'transportation' })).data;
    assert.equal(task.status, 'pending');
    const approved = (await api('/api/tasks/' + task.id, 'PATCH', { version: task.version, status: 'approved' })).data;
    assert.equal(approved.status, 'approved');
    const stale = await api('/api/tasks/' + task.id, 'PATCH', { version: task.version, status: 'completed' });
    assert.equal(stale.status, 409);
    const note = await api('/api/patients/P0412/documents', 'POST', { text: 'Patient: Transportation is no longer a problem. My daughter now drives me to appointments.', date: '2026-10-10', type: 'Care coordinator call', synthetic: true });
    assert.equal(note.status, 201);
    assert.equal(note.data.patient.barriers.find(b => b.type === 'transportation').status, 'resolved');
    assert.equal((await api('/api/tasks')).data.tasks[0].status, 'needs_review');
    assert.equal((await api('/api/query', 'POST', { question })).data.result.count, 81);
    const graph = (await api('/api/graph?mode=patient&patientId=P0412')).data;
    assert.ok(graph.edges.some(edge => edge.type === 'EXPERIENCES' && edge.status === 'resolved'));
    const saved = (await api('/api/runs/' + first.data.runId)).data;
    assert.equal(saved.result.count, 82);
    assert.ok((await api('/api/audit')).data.events.some(event => event.action === 'document.ingested'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
