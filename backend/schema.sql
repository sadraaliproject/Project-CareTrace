CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patients (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER NOT NULL, sex TEXT NOT NULL,
 diabetes_admission INTEGER NOT NULL, followup_gap INTEGER NOT NULL, insulin_not_picked_up INTEGER NOT NULL,
 likely_to_return INTEGER NOT NULL, days_since_discharge INTEGER NOT NULL, priority INTEGER NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS patients_cohort ON patients(diabetes_admission,followup_gap,age,priority);
CREATE TABLE IF NOT EXISTS admissions (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),admit_date TEXT NOT NULL,discharge_date TEXT NOT NULL,principal_diagnosis TEXT NOT NULL,json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS admissions_patient ON admissions(patient_id);
CREATE TABLE IF NOT EXISTS conditions (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),code TEXT NOT NULL,display TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lab_results (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),code TEXT NOT NULL,value REAL NOT NULL,date TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS medications (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),name TEXT NOT NULL,new_start INTEGER NOT NULL,is_insulin INTEGER NOT NULL,prescribed_date TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pharmacy_pickups (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),medication_id TEXT NOT NULL REFERENCES medications(id),picked_up INTEGER NOT NULL,pickup_date TEXT,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS appointments (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),date TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS emergency_department_visits (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),date TEXT NOT NULL,reason TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS social_needs (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),type TEXT NOT NULL,code TEXT NOT NULL,date TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,patient_id TEXT NOT NULL REFERENCES patients(id),note_type TEXT NOT NULL,date TEXT NOT NULL,text TEXT NOT NULL,json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notes_patient ON notes(patient_id,date);
CREATE TABLE IF NOT EXISTS assertions (
 patient_id TEXT NOT NULL REFERENCES patients(id),type TEXT NOT NULL,status TEXT NOT NULL CHECK(status='active'),document_id TEXT NOT NULL,
 quote TEXT NOT NULL,date TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(patient_id,type)
);
CREATE INDEX IF NOT EXISTS assertions_filter ON assertions(type,status,patient_id);CREATE TABLE IF NOT EXISTS graph_nodes (
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
