import { AS_OF, BARRIERS, ontology, patients as seedPatients, reconcileBarriers, makeDraft } from '../dist/engine.js';
import { validatePlan } from '../planner.js';

export const SCHEMA_VERSION = 1;
const defaults = () => ({ barriers: [], barrierMode: 'any', gapOnly: true, gapType: 'any', diabetesOnly: true, refillMin: null, ageMin: null, ageMax: null, status: 'active', sort: 'priority', limit: null });
const json = value => JSON.stringify(value);
const now = () => new Date().toISOString();
const uid = prefix => `${prefix}-${crypto.randomUUID()}`;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const clamp = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
const placeholders = values => values.map(() => '?').join(',');
const statement = (sql, params = []) => ({ sql, params });
const changes = result => Number(result?.changes ?? result?.meta?.changes ?? 0);
const hash = value => { let h = 2166136261; for (const c of value) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, '0').toUpperCase(); };
const auditStatement = (action, entityId, details = {}) => statement('INSERT INTO audit(id,action,entity_id,json,created_at) VALUES(?,?,?,?,?)', [uid('audit'), action, entityId, json(details), now()]);

// A D1 batch still counts every statement against the request's query budget.
// Bind rows as JSON instead of issuing a query per graph node or exceeding the
// 100-parameter limit. The caller's batch remains one atomic transaction.
function compactInserts(statements, insertOnly = false) {
  const groups = new Map();
  for (const item of statements) {
    const match = item.sql.match(/^INSERT(?: OR (?:IGNORE|REPLACE))? INTO (\w+)\(([^)]+)\) VALUES\(/);
    if (!match) throw new Error('Only row inserts can be compacted.');
    const [, table, columns] = match;
    const key = `${table}(${columns})`;
    if (!groups.has(key)) groups.set(key, { table, columns, rows: [] });
    groups.get(key).rows.push(item.params);
  }
  return [...groups.values()].map(({ table, columns, rows }) => statement(
    `INSERT ${insertOnly ? 'OR IGNORE ' : 'OR REPLACE '}INTO ${table}(${columns}) SELECT ${columns.split(',').map((_, index) => `json_extract(value,'$[${index}]')`).join(',')} FROM json_each(?)`, [json(rows)]));
}

function nodeStatement(node, patientId = null) {
  return statement('INSERT OR REPLACE INTO graph_nodes(id,type,patient_id,json) VALUES(?,?,?,?)', [node.id, node.type, patientId, json(node)]);
}
function edgeStatement(source, target, type, patientId = null, properties = {}) {
  const id = `${type}:${source}:${target}`;
  const edge = { id, source, target, from: source, to: target, type, ...properties };
  return statement('INSERT OR REPLACE INTO graph_edges(id,source,target,type,patient_id,status,document_id,json) VALUES(?,?,?,?,?,?,?,?)', [id, source, target, type, patientId, properties.status || null, properties.documentId || null, json(edge)]);
}
function sharedGraphStatements() {
  const output = [nodeStatement({ id: 'condition:diabetes', type: 'Condition', label: 'Type 2 diabetes' })];
  for (const [type, info] of Object.entries(BARRIERS)) {
    output.push(nodeStatement({ id: `barrier:${type}`, type: 'Barrier', label: info.label }), nodeStatement({ id: `intervention:${type}`, type: 'Intervention', label: info.intervention }));
  }
  for (const type of Object.keys(BARRIERS)) output.push(edgeStatement(`barrier:${type}`, `intervention:${type}`, 'ADDRESSED_BY'));
  return output;
}
function patientRow(patient, insertOnly = false) {
  return statement(`INSERT ${insertOnly ? 'OR IGNORE' : 'OR REPLACE'} INTO patients(id,name,age,diabetes,gap_open,days_overdue,a1c,refill_gap,priority,structured_barrier_code,json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [patient.id, patient.name, patient.age, +patient.diabetes, +patient.gapOpen, patient.daysOverdue, patient.a1c, patient.refillGap, patient.priority, +patient.structuredBarrierCode, json(patient)]);
}
function documentStatement(doc, patientId) {
  return statement('INSERT OR IGNORE INTO documents(id,patient_id,type,date,text,json,created_at) VALUES(?,?,?,?,?,?,?)', [doc.id, patientId, doc.type, doc.date, doc.text, json({ ...doc, patientId, synthetic: true }), now()]);
}
function assertionStatements(patient) {
  return patient.barriers.map(b => statement('INSERT INTO assertions(patient_id,type,status,document_id,quote,date,json) VALUES(?,?,?,?,?,?,?)', [patient.id, b.type, b.status, b.documentId, b.quote, b.date, json(b)]));
}
function patientGraphStatements(patient) {
  const output = [nodeStatement({ id: patient.id, type: 'Patient', label: patient.name, fictional: true, age: patient.age, priority: patient.priority, gapOpen: patient.gapOpen }, patient.id)];
  for (const doc of patient.documents) output.push(nodeStatement({ ...doc, id: doc.id, type: 'Document', sourceType: doc.type, label: doc.type, patientId: patient.id }, patient.id));
  for (const gap of patient.gaps) output.push(nodeStatement({ ...gap, id: `${patient.id}:${gap.type}`, type: 'CareGap', gapType: gap.type, patientId: patient.id }, patient.id));
  if (patient.diabetes) output.push(edgeStatement(patient.id, 'condition:diabetes', 'HAS_CONDITION', patient.id));
  for (const doc of patient.documents) output.push(edgeStatement(patient.id, doc.id, 'HAS_DOCUMENT', patient.id));
  for (const gap of patient.gaps) output.push(edgeStatement(patient.id, `${patient.id}:${gap.type}`, 'HAS_GAP', patient.id));
  for (const b of patient.barriers) {
    const props = { patientId: patient.id, status: b.status, quote: b.quote, date: b.date, documentId: b.documentId };
    output.push(edgeStatement(b.documentId, `barrier:${b.type}`, 'EVIDENCES', patient.id, props), edgeStatement(patient.id, `barrier:${b.type}`, 'EXPERIENCES', patient.id, props));
  }
  return output;
}
function basePredicate(plan) {
  const clauses = [], params = [];
  if (plan.diabetesOnly) clauses.push('p.diabetes = 1');
  if (plan.gapOnly) clauses.push('p.gap_open = 1');
  if (plan.gapType === 'overdue') clauses.push('p.diabetes = 1 AND p.days_overdue > 0');
  if (plan.gapType === 'elevated') clauses.push('p.diabetes = 1 AND p.a1c > 9');
  for (const [key, column, op] of [['refillMin', 'refill_gap', '>='], ['ageMin', 'age', '>='], ['ageMax', 'age', '<=']]) {
    if (plan[key] !== null) { clauses.push(`p.${column} ${op} ?`); params.push(plan[key]); }
  }
  return { sql: clauses.length ? clauses.map(c => `(${c})`).join(' AND ') : '1=1', params };
}
function barrierPredicate(plan, overrideStatus) {
  if (!plan.barriers.length) return { sql: '1=1', params: [] };
  const status = overrideStatus || plan.status;
  const params = [...plan.barriers, ...(status === 'any' ? [] : [status])];
  const filter = `a.patient_id=p.id AND a.type IN (${placeholders(plan.barriers)})${status === 'any' ? '' : ' AND a.status = ?'}`;
  return plan.barrierMode === 'all'
    ? { sql: `(SELECT COUNT(DISTINCT a.type) FROM assertions a WHERE ${filter}) = ?`, params: [...params, plan.barriers.length] }
    : { sql: `EXISTS(SELECT 1 FROM assertions a WHERE ${filter})`, params };
}
function taskObject(row) {
  if (!row) return null;
  return { id: row.id, patientId: row.patient_id, barrier: row.barrier, title: row.title, body: row.body, status: row.status, version: row.version, evidence: JSON.parse(row.evidence_json), reason: row.reason, createdAt: row.created_at, updatedAt: row.updated_at, simulated: true, sent: false };
}
function validateTaskEvidence(patient, type) {
  const draft = makeDraft(patient, type);
  const assertion = patient.barriers.find(b => b.type === type && b.status === 'active');
  const doc = patient.documents.find(d => d.id === assertion.documentId);
  if (!doc || !doc.text.includes(assertion.quote)) throw error('The current evidence cannot be verified against its source document.', 409);
  return { draft, evidence: { ...assertion, patientId: patient.id, gapTypes: patient.gaps.map(g => g.type) } };
}
function patientConnectedGraph(nodes, edges) {
  const neighbors = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    if (!neighbors.has(edge.source) || !neighbors.has(edge.target)) continue;
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  }
  const frontier = nodes.filter(node => node.type === 'Patient').map(node => node.id), connected = new Set(frontier);
  for (let index = 0; index < frontier.length; index++) for (const neighbor of neighbors.get(frontier[index]) || []) {
    if (!connected.has(neighbor)) { connected.add(neighbor); frontier.push(neighbor); }
  }
  return { nodes: nodes.filter(node => connected.has(node.id)), edges: edges.filter(edge => connected.has(edge.source) && connected.has(edge.target)) };
}

/** Portable persistent repository: every cohort predicate executes as bound SQL. */
export function createRepository(adapter) {
  const { all, get, run, batch } = adapter;
  // Serial mutations preserve read/reconcile/write ordering in a single process. SQLite
  // transactions and task versions also protect atomic writes and concurrent approvals.
  let writeTail = Promise.resolve();
  const serialize = operation => { const next = writeTail.then(operation); writeTail = next.catch(() => {}); return next; };
  const repository = {
    async seedStatus() {
      const row = await get('SELECT COUNT(*) AS count FROM patients');
      const marker = await get("SELECT value FROM metadata WHERE key='seed_complete'");
      return { complete: row.count === seedPatients.length && marker?.value === String(SCHEMA_VERSION), count: row.count, total: seedPatients.length, schemaVersion: SCHEMA_VERSION };
    },
    async seedPatientBatch({ offset = 0, limit = 25 } = {}) {
      const start = Math.max(0, Number(offset) || 0), size = clamp(limit, 25, 100);
      const selected = seedPatients.slice(start, start + size);
      if (!selected.length) return { ...(await repository.seedStatus()), offset: start, nextOffset: start, inserted: 0 };
      const existing = new Set((await all(`SELECT id FROM patients WHERE id IN (${placeholders(selected)})`, selected.map(p => p.id))).map(p => p.id));
      const fresh = selected.filter(p => !existing.has(p.id));
      const rows = fresh.flatMap(patient => [patientRow(patient, true), ...patient.documents.map(d => documentStatement(d, patient.id)), ...assertionStatements(patient)]);
      // Parents precede foreign-key dependants. Shared graph records are insert-only:
      // replacing a referenced node would temporarily delete it under SQLite rules.
      const graphRows = [...sharedGraphStatements(), ...fresh.flatMap(patientGraphStatements)];
      await batch([...compactInserts(rows, true), ...compactInserts(graphRows.filter(s => s.sql.includes('graph_nodes')), true), ...compactInserts(graphRows.filter(s => s.sql.includes('graph_edges')), true)]);
      const count = (await get('SELECT COUNT(*) AS count FROM patients')).count;
      if (count === seedPatients.length) await run("INSERT OR REPLACE INTO metadata(key,value) VALUES('seed_complete',?)", [String(SCHEMA_VERSION)]);
      await run("INSERT OR REPLACE INTO metadata(key,value) VALUES('schema_version',?)", [String(SCHEMA_VERSION)]);
      return { complete: count === seedPatients.length, count, total: seedPatients.length, offset: start, nextOffset: Math.min(start + size, seedPatients.length), inserted: selected.length - existing.size, schemaVersion: SCHEMA_VERSION };
    },
    async seed() {
      if ((await repository.seedStatus()).complete) return repository.seedStatus();
      for (let offset = 0; offset < seedPatients.length; offset += 50) await repository.seedPatientBatch({ offset, limit: 50 });
      return repository.seedStatus();
    },
    async metrics() {
      const p = await get(`SELECT COUNT(*) AS population,SUM(diabetes) AS diabetes,SUM(gap_open) AS openGaps,
        SUM(CASE WHEN gap_open=1 AND EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=patients.id AND a.status='active') THEN 1 ELSE 0 END) AS actionable,
        SUM(CASE WHEN gap_open=1 AND structured_barrier_code=0 AND EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=patients.id AND a.status='active') THEN 1 ELSE 0 END) AS hiddenBarriers,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM assertions a WHERE a.patient_id=patients.id AND a.status='resolved') THEN 1 ELSE 0 END) AS resolved FROM patients`);
      const totals = await get('SELECT (SELECT COUNT(*) FROM documents) AS documents,(SELECT COUNT(*) FROM assertions) AS evidence,(SELECT COUNT(*) FROM graph_nodes) AS nodes,(SELECT COUNT(*) FROM graph_edges) AS edges,(SELECT COUNT(*) FROM tasks) AS tasks,(SELECT COUNT(*) FROM runs) AS runs');
      return { ...p, ...totals, docs: totals.documents, graph: { nodes: totals.nodes, edges: totals.edges }, asOf: AS_OF, synthetic: true, storage: 'SQL property graph' };
    },
    async getPatient(id) {
      const row = await get('SELECT json FROM patients WHERE id=?', [id]);
      if (!row) throw error('Patient not found.', 404);
      return JSON.parse(row.json);
    },
    async listPatients({ search = '', limit = 1000, offset = 0 } = {}) {
      const pattern = `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
      const where = "id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'";
      const rows = await all(`SELECT json FROM patients WHERE ${where} ORDER BY priority DESC,id LIMIT ? OFFSET ?`, [pattern, pattern, clamp(limit, 1000, 1000), Math.max(0, Number(offset) || 0)]);
      const count = (await get(`SELECT COUNT(*) AS count FROM patients WHERE ${where}`, [pattern, pattern])).count;
      return { patients: rows.map(r => JSON.parse(r.json)), count, limit: clamp(limit, 1000, 1000), offset: Math.max(0, Number(offset) || 0) };
    },
    async getDocument(id) {
      const row = await get('SELECT json FROM documents WHERE id=?', [id]);
      if (!row) throw error('Source document not found.', 404);
      return JSON.parse(row.json);
    },
    async getDocuments(ids) {
      if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string')) throw error('Provide at most 1,000 source document IDs.');
      return (await all('SELECT json FROM documents WHERE id IN (SELECT value FROM json_each(?))', [json(ids)])).map(row => JSON.parse(row.json));
    },
    async query(input = {}) {
      const plan = { ...defaults(), ...input, barriers: [...(input.barriers || [])] };
      if (!validatePlan(plan)) throw error('Invalid or unsupported cohort plan.');
      const base = basePredicate(plan), barrier = barrierPredicate(plan);
      const where = `${base.sql} AND (${barrier.sql})`, params = [...base.params, ...barrier.params];
      const sql = `SELECT p.json FROM patients p WHERE ${where} ORDER BY p.${plan.sort === 'age' ? 'age' : 'priority'} DESC,p.id`;
      const rows = await all(sql, params), matching = rows.map(row => JSON.parse(row.json));
      const [baseCount, population] = await Promise.all([get(`SELECT COUNT(*) AS count FROM patients p WHERE ${base.sql}`, base.params), get('SELECT COUNT(*) AS count FROM patients')]);
      let excludedResolved = 0;
      if (plan.status === 'active' && plan.barriers.length) {
        const resolved = barrierPredicate(plan, 'resolved');
        excludedResolved = (await get(`SELECT COUNT(*) AS count FROM patients p WHERE ${base.sql} AND NOT (${barrier.sql}) AND (${resolved.sql})`, [...base.params, ...barrier.params, ...resolved.params])).count;
      }
      const groupRows = await all(`SELECT a.type,COUNT(DISTINCT a.patient_id) AS count FROM assertions a WHERE ${plan.status === 'any' ? '1=1' : 'a.status=?'} AND a.patient_id IN (SELECT p.id FROM patients p WHERE ${where}) GROUP BY a.type`, [...(plan.status === 'any' ? [] : [plan.status]), ...params]);
      const groups = Object.entries(BARRIERS).map(([type, info]) => ({ type, label: info.label, intervention: info.intervention, count: groupRows.find(g => g.type === type)?.count || 0 })).filter(g => g.count);
      const fingerprint = hash(json({ ...plan, barriers: [...plan.barriers].sort(), ids: matching.map(p => p.id), asOf: AS_OF }));
      const evidence = matching.flatMap(p => p.barriers.filter(b => (!plan.barriers.length || plan.barriers.includes(b.type)) && (plan.status === 'any' || b.status === plan.status)));
      const witness = matching.find(p => p.id === 'P0412') || matching.find(p => !p.structuredBarrierCode && p.barriers.some(b => b.status === 'active'));
      const events = [
        { tool: 'plan_cohort', say: 'Validated the proposed filters against the fixed ontology.', found: population.count, nodes: ['Patient'], edges: [], evidence: [] },
        { tool: 'query_clinical_facts', say: `Executed parameterized SQL across ${population.count} persisted fictional patients.`, found: baseCount.count, nodes: ['Patient','Condition','CareGap'], edges: ['HAS_CONDITION','HAS_GAP'], evidence: [] },
      ];
      if (witness && plan.barriers.length) events.push({ tool: 'lookup_structured_barrier', say: `${witness.id}: structured record ${witness.structuredBarrierCode ? 'contains a barrier flag' : 'contains no barrier flag; source-document evidence supplies the connection'}.`, found: +witness.structuredBarrierCode, nodes: ['Patient','Document','Barrier'], edges: ['HAS_DOCUMENT','EVIDENCES'], evidence: witness.barriers.filter(b => plan.barriers.includes(b.type)) });
      events.push({ tool: 'traverse_barrier_evidence', say: `Joined current source-backed ${plan.status} assertions. Excluded ${excludedResolved} resolved-only matches.`, found: matching.length, nodes: ['Patient','Document','Barrier'], edges: ['HAS_DOCUMENT','EVIDENCES','EXPERIENCES'], evidence: evidence.slice(0, 6) }, { tool: 'validate_and_count', say: `Exact SQL cohort: ${matching.length} distinct patients. Reproducible fingerprint ${fingerprint}.`, found: matching.length, nodes: ['Patient','Intervention'], edges: ['ADDRESSED_BY'], evidence: evidence.slice(0, 3) });
      return { patients: plan.limit ? matching.slice(0, plan.limit) : matching, count: matching.length, groups, excludedResolved, fingerprint, events: events.map((event, index) => ({ step: index + 1, ...event })), sql: { text: sql, parameters: params }, asOf: AS_OF };
    },
    async getGraph({ patientIds, patientId, mode = 'population', limit = 420 } = {}) {
      if (mode === 'ontology') {
        const counts = await all('SELECT type,COUNT(*) AS count FROM graph_nodes GROUP BY type');
        const relationships = [['Patient','Condition','HAS_CONDITION'], ['Patient','CareGap','HAS_GAP'], ['Patient','Document','HAS_DOCUMENT'], ['Document','Barrier','EVIDENCES'], ['Patient','Barrier','EXPERIENCES'], ['Barrier','Intervention','ADDRESSED_BY']];
        const nodes = ontology.nodeTypes.map(type => ({ id: `ontology:${type}`, type, label: type, count: counts.find(c => c.type === type)?.count || 0, schemaNode: true }));
        const edges = relationships.map(([from, to, type]) => ({ id: type, source: `ontology:${from}`, target: `ontology:${to}`, from: `ontology:${from}`, to: `ontology:${to}`, type }));
        return { nodes, edges, totalNodes: nodes.length, totalEdges: edges.length, truncated: false, mode, ontology, asOf: AS_OF };
      }
      const maxNodes = clamp(limit, 420, 8000);
      if (patientIds !== undefined && (!Array.isArray(patientIds) || patientIds.length > 1000 || patientIds.some(id => typeof id !== 'string'))) throw error('Graph patient IDs must be an array of at most 1,000 IDs.');
      const ids = patientId ? [patientId] : ['cohort','patient'].includes(mode) ? (patientIds || []) : patientIds?.length ? patientIds : undefined;
      if (ids && (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string'))) throw error('Graph patient IDs must be an array of at most 1,000 IDs.');
      const filter = ids ? 'patient_id IN (SELECT value FROM json_each(?))' : '1=1';
      if (ids) {
        const nodeRows = await all(`SELECT json FROM graph_nodes WHERE patient_id IS NULL OR (${filter}) ORDER BY patient_id,id`, [json(ids)]);
        const edgeRows = await all(`SELECT json FROM graph_edges WHERE patient_id IS NULL OR (${filter}) ORDER BY id`, [json(ids)]);
        const complete = patientConnectedGraph(nodeRows.map(row => JSON.parse(row.json)), edgeRows.map(row => JSON.parse(row.json)));
        const totalNodes = complete.nodes.length, totalEdges = complete.edges.length;
        const fullPatients = complete.nodes.filter(node => node.type === 'Patient');
        let graph = complete;
        if (totalNodes > maxNodes) {
          const selectedIds = new Set(fullPatients.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, Math.max(1, Math.floor((maxNodes - 9) / 7))).map(node => node.id));
          const nodes = complete.nodes.filter(node => node.type === 'Patient' ? selectedIds.has(node.id) : !node.patientId || selectedIds.has(node.patientId)).slice(0, maxNodes);
          const visible = new Set(nodes.map(node => node.id));
          graph = patientConnectedGraph(nodes, complete.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)));
        }
        return { ...graph, totalNodes, totalEdges, truncated: graph.nodes.length < totalNodes, samplePatientCount: graph.nodes.filter(node => node.type === 'Patient').length, patientCount: fullPatients.length, mode, ontology, asOf: AS_OF };
      }
      const totalNodes = (await get(`SELECT COUNT(*) AS count FROM graph_nodes WHERE patient_id IS NULL OR (${filter})`, ids ? [json(ids)] : [])).count;
      const totalEdges = (await get(`SELECT COUNT(*) AS count FROM graph_edges WHERE patient_id IS NULL OR (${filter})`, ids ? [json(ids)] : [])).count;
      let selectedIds = ids;
      if (totalNodes > maxNodes) {
        // Keep complete patient/source neighborhoods rather than dropping every document
        // when a large population is visualized. Counts still describe the whole cohort.
        const count = Math.max(1, Math.floor((maxNodes - 9) / 7));
        const selected = await all(`SELECT id FROM patients ${ids ? 'WHERE id IN (SELECT value FROM json_each(?))' : ''} ORDER BY priority DESC,id LIMIT ?`, [...(ids ? [json(ids)] : []), count]);
        selectedIds = selected.map(p => p.id);
      }
      const sampleFilter = selectedIds ? 'patient_id IN (SELECT value FROM json_each(?))' : '1=1';
      const rows = await all(`SELECT json FROM graph_nodes WHERE patient_id IS NULL OR (${sampleFilter}) ORDER BY CASE WHEN patient_id IS NULL THEN 0 ELSE 1 END,patient_id,id`, selectedIds ? [json(selectedIds)] : []);
      const nodes = rows.slice(0, maxNodes).map(row => JSON.parse(row.json)), visible = new Set(nodes.map(n => n.id));
      const edgeRows = await all(`SELECT json FROM graph_edges WHERE patient_id IS NULL OR (${sampleFilter}) ORDER BY id`, selectedIds ? [json(selectedIds)] : []);
      const edges = edgeRows.map(row => JSON.parse(row.json)).filter(e => visible.has(e.source) && visible.has(e.target));
      return { nodes, edges, totalNodes, totalEdges, truncated: nodes.length < totalNodes, samplePatientCount: nodes.filter(n => n.type === 'Patient').length, patientCount: ids?.length ?? (await get('SELECT COUNT(*) AS count FROM patients')).count, mode, ontology, asOf: AS_OF };
    },
    async expandNode(id, edgeType) {
      const row = await get('SELECT json FROM graph_nodes WHERE id=?', [id]);
      if (!row) throw error('Graph node not found.', 404);
      if (edgeType && !ontology.relationships.includes(edgeType)) throw error('Traversal relationship is outside the permitted ontology.');
      const filter = `(source=? OR target=?)${edgeType ? ' AND type=?' : ''}`, params = [id, id, ...(edgeType ? [edgeType] : [])];
      const totalEdges = (await get(`SELECT COUNT(*) AS count FROM graph_edges WHERE ${filter}`, params)).count;
      const edges = (await all(`SELECT json FROM graph_edges WHERE ${filter} ORDER BY id LIMIT 1000`, params)).map(r => JSON.parse(r.json));
      const ids = [...new Set([id, ...edges.flatMap(e => [e.source, e.target])])];
      const nodes = [];
      // Bound parameter count for both native SQLite and hosted D1.
      for (let start = 0; start < ids.length; start += 80) {
        const page = ids.slice(start, start + 80);
        nodes.push(...(await all(`SELECT json FROM graph_nodes WHERE id IN (${placeholders(page)})`, page)).map(r => JSON.parse(r.json)));
      }
      return { nodes, edges, center: id, edgeType: edgeType || null, totalNodes: nodes.length, totalEdges, truncated: totalEdges > edges.length, ontology, asOf: AS_OF };
    },
    async listTasks() { return (await all('SELECT * FROM tasks ORDER BY created_at DESC,id DESC')).map(taskObject); },
    async getTask(id) {
      const task = taskObject(await get('SELECT * FROM tasks WHERE id=?', [id]));
      if (!task) throw error('Care-coordination task not found.', 404);
      return task;
    },
    createTask({ patientId, barrier, title, body }) { return serialize(async () => {
      if (!BARRIERS[barrier]) throw error('Select a supported barrier.');
      const patient = await repository.getPatient(patientId);
      let verified;
      try { verified = validateTaskEvidence(patient, barrier); } catch (e) { throw error(e.message, 409); }
      const existing = await get("SELECT id FROM tasks WHERE patient_id=? AND barrier=? AND status IN ('pending','approved','needs_review')", [patientId, barrier]);
      if (existing) throw error('A current care-coordination task already exists for this patient and barrier.', 409);
      if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 200)) throw error('Task title must contain 1–200 characters.');
      if (body !== undefined && (typeof body !== 'string' || !body.trim() || body.length > 12000)) throw error('Task draft must contain 1–12,000 characters.');
      const id = uid('task'), timestamp = now();
      try { await batch([
        statement('INSERT INTO tasks(id,patient_id,barrier,title,body,status,version,evidence_json,created_at,updated_at) VALUES(?,?,?,CASE WHEN (SELECT json FROM patients WHERE id=?)=? THEN ? ELSE NULL END,?,?,?,?,?,?)', [id, patientId, barrier, patientId, json(patient), title?.trim() || verified.draft.title, body?.trim() || verified.draft.body, 'pending', 1, json(verified.evidence), timestamp, timestamp]),
        auditStatement('task.created', id, { patientId, barrier, documentId: verified.evidence.documentId, simulated: true }),
      ]); } catch (cause) {
        if (/NOT NULL constraint failed: tasks\.title|UNIQUE constraint failed: tasks\.patient_id/i.test(cause.message)) throw error('This patient or task changed while the draft was prepared. Refresh and try again.', 409);
        throw cause;
      }
      return repository.getTask(id);
    }); },
    updateTask(id, update = {}) { return serialize(async () => {
      const task = await repository.getTask(id);
      if (!Number.isInteger(update.version)) throw error('Provide the task version to prevent overwriting another reviewer’s changes.', 409);
      if (update.version !== task.version) throw error('This task changed since you opened it. Refresh it before saving.', 409);
      const status = update.status || task.status;
      const transitions = { pending: ['pending','approved','cancelled'], approved: ['approved','completed','cancelled'], needs_review: ['needs_review','pending','cancelled'], completed: [], cancelled: [] };
      if (!transitions[task.status]?.includes(status)) throw error(`Cannot change a ${task.status} task to ${status}.`, 409);
      if (['approved','completed'].includes(task.status) && (update.title !== undefined || update.body !== undefined)) throw error('Approved drafts cannot be edited. Cancel and prepare a new draft for review.', 409);
      let title = update.title === undefined ? task.title : update.title, body = update.body === undefined ? task.body : update.body;
      if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof body !== 'string' || !body.trim() || body.length > 12000) throw error('Provide a title of 1–200 characters and draft of 1–12,000 characters.');
      let evidence = task.evidence;
      if (!['cancelled','needs_review'].includes(status)) {
        let verified;
        try { verified = validateTaskEvidence(await repository.getPatient(task.patientId), task.barrier); } catch (e) { throw error(`Evidence review failed: ${e.message}`, 409); }
        if (['approved','completed'].includes(status) && json(verified.evidence) !== json(task.evidence)) throw error('Source evidence changed. Revalidate the draft before approval.', 409);
        evidence = verified.evidence;
        if (task.status === 'needs_review' && status === 'pending') {
          if (update.title === undefined) title = verified.draft.title;
          if (update.body === undefined) body = verified.draft.body;
        }
      }
      const result = await run('UPDATE tasks SET title=?,body=?,status=?,version=version+1,evidence_json=?,reason=?,updated_at=? WHERE id=? AND version=?', [title.trim(), body.trim(), status, json(evidence), status === 'needs_review' ? task.reason : null, now(), id, task.version]);
      if (!changes(result)) throw error('This task changed during review. Refresh before trying again.', 409);
      const audit = auditStatement(`task.${status === task.status ? 'edited' : status}`, id, { version: task.version + 1, patientId: task.patientId, simulated: true });
      await run(audit.sql, audit.params);
      return repository.getTask(id);
    }); },
    async removeTask(id, version) { const current = await repository.getTask(id); return repository.updateTask(id, { status: 'cancelled', version: version ?? current.version }); },
    addDocument(patientId, input) { return serialize(async () => {
      if (input?.synthetic !== true) throw error('Only explicitly synthetic documents may be added to this demonstration.');
      if (typeof input.text !== 'string' || input.text.trim().length < 3 || input.text.length > 20000) throw error('Document text must contain 3–20,000 characters.');
      const date = input.date || AS_OF, sourceType = input.type || 'Care coordinator follow-up';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date || date > AS_OF || date < '1900-01-01') throw error(`Use a valid source date on or before the ${AS_OF} snapshot.`);
      if (typeof sourceType !== 'string' || !sourceType.trim() || sourceType.length > 100) throw error('Document type must contain 1–100 characters.');
      const patient = await repository.getPatient(patientId), previousBarriers = patient.barriers;
      const originalJson = json(patient);
      const document = { id: `${patientId}-${uid('D')}`, type: sourceType.trim(), date, text: input.text.trim(), synthetic: true, patientId };
      patient.documents = [...patient.documents, document];
      patient.barriers = reconcileBarriers(patient.documents);
      patient.priority = Math.min(99, Math.round((patient.gapOpen ? 30 : 5) + patient.daysOverdue / 12 + Math.max(0, patient.a1c - 8) * 5 + patient.refillGap / 5 + patient.barriers.filter(b => b.status === 'active').length * 8));
      const changedTypes = Object.keys(BARRIERS).filter(type => json(previousBarriers.find(b => b.type === type)) !== json(patient.barriers.find(b => b.type === type)));
      // The NOT NULL constraint aborts and rolls back the entire batch if another
      // Worker changed this patient after our read. A process-local queue alone
      // cannot protect deployments with multiple independent Worker instances.
      const compareAndSwap = statement('UPDATE patients SET priority=?,json=CASE WHEN json=? THEN ? ELSE NULL END WHERE id=?', [patient.priority, originalJson, json(patient), patientId]);
      const graphRows = patientGraphStatements(patient);
      const statements = [compareAndSwap, documentStatement(document, patientId), statement('DELETE FROM assertions WHERE patient_id=?', [patientId]), ...compactInserts(assertionStatements(patient)), statement('DELETE FROM graph_edges WHERE patient_id=?', [patientId]), statement('DELETE FROM graph_nodes WHERE patient_id=?', [patientId]), ...compactInserts(graphRows.filter(s => s.sql.includes('graph_nodes'))), ...compactInserts(graphRows.filter(s => s.sql.includes('graph_edges')))];
      if (changedTypes.length) statements.push(statement(`UPDATE tasks SET status='needs_review',version=version+1,reason=?,updated_at=? WHERE patient_id=? AND barrier IN (${placeholders(changedTypes)}) AND status IN ('pending','approved','needs_review')`, ['New source evidence changed the current barrier assertion. Human review is required.', now(), patientId, ...changedTypes]));
      statements.push(auditStatement('document.ingested', document.id, { patientId, type: sourceType, date, changedBarriers: changedTypes, synthetic: true }));
      try { await batch(statements); }
      catch (cause) {
        if (/NOT NULL constraint failed: patients\.json/i.test(cause.message)) throw error('Another source changed this patient during ingestion. Refresh and submit the note again; nothing from this attempt was saved.', 409);
        throw cause;
      }
      return { document, patient, barriers: patient.barriers, previousBarriers, changedBarriers: changedTypes, invalidatedTasks: (await repository.listTasks()).filter(t => t.patientId === patientId && t.status === 'needs_review'), asOf: AS_OF };
    }); },
    async saveRun(input) {
      const id = uid('run'), createdAt = now();
      const record = { ...input, id, createdAt, synthetic: true, asOf: AS_OF };
      await batch([statement('INSERT INTO runs(id,question,engine,fingerprint,count,json,created_at) VALUES(?,?,?,?,?,?,?)', [id, String(input.question || ''), String(input.engine || 'deterministic'), input.result?.fingerprint || null, input.result?.count || 0, json(record), createdAt]), auditStatement('analysis.completed', id, { engine: record.engine, count: input.result?.count || 0, fingerprint: input.result?.fingerprint || null })]);
      return record;
    },
    async listRuns({ limit = 50 } = {}) {
      return (await all('SELECT id,question,engine,fingerprint,count,created_at FROM runs ORDER BY created_at DESC,id DESC LIMIT ?', [clamp(limit, 50, 200)])).map(row => ({ id: row.id, question: row.question, engine: row.engine, fingerprint: row.fingerprint, count: row.count, createdAt: row.created_at }));
    },
    async getRun(id) {
      const row = await get('SELECT json FROM runs WHERE id=?', [id]);
      if (!row) throw error('Analysis run not found.', 404);
      return JSON.parse(row.json);
    },
    async auditLog({ limit = 100 } = {}) {
      return (await all('SELECT * FROM audit ORDER BY created_at DESC,id DESC LIMIT ?', [clamp(limit, 100, 500)])).map(row => ({ id: row.id, action: row.action, entityId: row.entity_id, ...JSON.parse(row.json), createdAt: row.created_at }));
    },
  };
  return repository;
}
