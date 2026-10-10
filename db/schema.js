import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const metadata = sqliteTable('metadata', { key: text('key').primaryKey(), value: text('value').notNull() });
export const patients = sqliteTable('patients', {
  id: text('id').primaryKey(), name: text('name').notNull(), age: integer('age').notNull(), diabetes: integer('diabetes').notNull(),
  gapOpen: integer('gap_open').notNull(), daysOverdue: integer('days_overdue').notNull(), a1c: real('a1c').notNull(),
  refillGap: integer('refill_gap').notNull(), priority: integer('priority').notNull(), structuredBarrierCode: integer('structured_barrier_code').notNull(), json: text('json').notNull(),
}, t => [index('patients_cohort').on(t.diabetes, t.gapOpen, t.age, t.priority)]);
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull().references(() => patients.id), type: text('type').notNull(),
  date: text('date').notNull(), text: text('text').notNull(), json: text('json').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('documents_patient').on(t.patientId, t.date)]);
export const assertions = sqliteTable('assertions', {
  patientId: text('patient_id').notNull().references(() => patients.id), type: text('type').notNull(), status: text('status').notNull(),
  documentId: text('document_id').notNull().references(() => documents.id), quote: text('quote').notNull(), date: text('date').notNull(), json: text('json').notNull(),
}, t => [primaryKey({ columns: [t.patientId, t.type] }), index('assertions_filter').on(t.type, t.status, t.patientId), check('assertions_status_check', sql`${t.status} IN ('active','resolved')`)]);
export const graphNodes = sqliteTable('graph_nodes', {
  id: text('id').primaryKey(), type: text('type').notNull(), patientId: text('patient_id'), json: text('json').notNull(),
}, t => [index('graph_nodes_patient').on(t.patientId)]);
export const graphEdges = sqliteTable('graph_edges', {
  id: text('id').primaryKey(), source: text('source').notNull().references(() => graphNodes.id), target: text('target').notNull().references(() => graphNodes.id),
  type: text('type').notNull(), patientId: text('patient_id'), status: text('status'), documentId: text('document_id'), json: text('json').notNull(),
}, t => [index('graph_edges_patient').on(t.patientId), index('graph_edges_source').on(t.source, t.type), index('graph_edges_target').on(t.target, t.type)]);
export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), patientId: text('patient_id').notNull().references(() => patients.id), barrier: text('barrier').notNull(),
  title: text('title').notNull(), body: text('body').notNull(), status: text('status').notNull(), version: integer('version').notNull().default(1),
  evidenceJson: text('evidence_json').notNull(), reason: text('reason'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [uniqueIndex('tasks_one_open').on(t.patientId, t.barrier).where(sql`${t.status} IN ('pending','approved','needs_review')`)]);
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), question: text('question').notNull(), engine: text('engine').notNull(), fingerprint: text('fingerprint'), count: integer('count').notNull(), json: text('json').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('runs_created').on(t.createdAt)]);
export const audit = sqliteTable('audit', {
  id: text('id').primaryKey(), action: text('action').notNull(), entityId: text('entity_id'), json: text('json').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('audit_created').on(t.createdAt)]);
