CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, diabetes INTEGER NOT NULL,
  gap_open INTEGER NOT NULL, days_overdue INTEGER NOT NULL, a1c REAL NOT NULL,
  refill_gap INTEGER NOT NULL, priority INTEGER NOT NULL, structured_barrier_code INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patients_cohort ON patients(diabetes, gap_open, age, priority);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), type TEXT NOT NULL,
  date TEXT NOT NULL, text TEXT NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_patient ON documents(patient_id, date);
CREATE TABLE IF NOT EXISTS assertions (
  patient_id TEXT NOT NULL REFERENCES patients(id), type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','resolved')), document_id TEXT NOT NULL REFERENCES documents(id),
  quote TEXT NOT NULL, date TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(patient_id, type)
);
CREATE INDEX IF NOT EXISTS assertions_filter ON assertions(type, status, patient_id);
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, patient_id TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS graph_nodes_patient ON graph_nodes(patient_id);
CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY, source TEXT NOT NULL REFERENCES graph_nodes(id), target TEXT NOT NULL REFERENCES graph_nodes(id),
  type TEXT NOT NULL, patient_id TEXT, status TEXT, document_id TEXT, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS graph_edges_patient ON graph_edges(patient_id);
CREATE INDEX IF NOT EXISTS graph_edges_source ON graph_edges(source, type);
CREATE INDEX IF NOT EXISTS graph_edges_target ON graph_edges(target, type);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id), barrier TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  evidence_json TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_one_open ON tasks(patient_id, barrier) WHERE status IN ('pending','approved','needs_review');
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, engine TEXT NOT NULL, fingerprint TEXT,
  count INTEGER NOT NULL, json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at);
CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY, action TEXT NOT NULL, entity_id TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_created ON audit(created_at);
