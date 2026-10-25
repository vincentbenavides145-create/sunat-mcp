import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import { operatorDirectory } from './operator-storage.js';
import { requireWorkflow, type WorkOperation } from './workflows.js';

export type WorkStatus = 'queued' | 'preparing' | 'awaiting_approval' | 'paused' | 'submitting' | 'uncertain' | 'completed' | 'cancelled';
export interface WorkItem { id: string; accountId: string; procedureId: string; operation: WorkOperation; status: WorkStatus; steps: number; attempts: number; createdAt: string; updatedAt: string; evidence?: string }
interface WorkRow extends WorkItem { intentHash: string; scopeHash: string; owner: string | null; baseline: string | null }
export interface NewWork { accountId: string; procedureId: string; operation: WorkOperation; idempotencyKey: string; taxpayerId?: string }

/** Only technical states and opaque IDs/HMACs; never names, RUCs, form values, documents or page bodies. */
export class WorkStore {
  private readonly db: Database.Database;
  readonly session = randomUUID();
  constructor(private readonly key: Buffer, directory = path.join(operatorDirectory(), 'work')) {
    mkdirSync(directory, { recursive: true });
    this.db = new Database(path.join(directory, 'jobs.sqlite'));
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, accountId TEXT NOT NULL, procedureId TEXT NOT NULL, operation TEXT NOT NULL,
      intentHash TEXT NOT NULL UNIQUE, scopeHash TEXT NOT NULL, status TEXT NOT NULL, steps INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      evidence TEXT, owner TEXT, baseline TEXT);
      CREATE INDEX IF NOT EXISTS jobs_account ON jobs(accountId, createdAt, id);
      CREATE INDEX IF NOT EXISTS jobs_scope ON jobs(scopeHash, status);
      CREATE TABLE IF NOT EXISTS events (sequence INTEGER PRIMARY KEY, jobId TEXT NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_job ON events(jobId, sequence);
      CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    try {
      this.db.transaction(() => {
        const saved = this.db.prepare("SELECT value FROM metadata WHERE name = 'vault-key'").get() as { value: string } | undefined;
        if (!saved) {
          if ((this.db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as { count: number }).count) throw new Error('El registro de trabajos no tiene una vinculación verificable con la bóveda. Conserva ambos archivos; no se crearán duplicados.');
          this.db.prepare("INSERT INTO metadata(name,value) VALUES('vault-key',?)").run(this.digest('sunat-work-store-v1'));
        } else this.assertKey(key);
      }).immediate();
    } catch (error) { this.db.close(); throw error; }
  }
  digest(...values: string[]): string { return createHmac('sha256', this.key).update(JSON.stringify(values)).digest('hex'); }
  assertKey(key: Buffer): void {
    const saved = this.db.prepare("SELECT value FROM metadata WHERE name = 'vault-key'").get() as { value: string };
    if (saved.value !== createHmac('sha256', key).update(JSON.stringify(['sunat-work-store-v1'])).digest('hex')) throw new Error('La bóveda cambió o fue reemplazada. Restaura la bóveda correspondiente al registro de trabajos; no se crearán operaciones duplicadas.');
  }
  async create(accountId: string, procedureId: string, operation: WorkOperation, idempotencyKey: string, taxpayerId = accountId): Promise<{ job: WorkItem; existing: boolean }> {
    return (await this.createMany([{ accountId, procedureId, operation, idempotencyKey, taxpayerId }]))[0];
  }
  async createMany(entries: NewWork[]): Promise<Array<{ job: WorkItem; existing: boolean }>> {
    if (!entries.length) throw new Error('El lote de trabajos está vacío.');
    for (const entry of entries) {
      if (!/^[a-f0-9-]{36}$/.test(entry.accountId) || !entry.idempotencyKey.trim()) throw new Error('Se requieren una cuenta local y una clave de operación estable.');
      await requireWorkflow(entry.procedureId, entry.operation);
    }
    return this.db.transaction(() => entries.map((entry) => this.insert(entry))).immediate();
  }
  private insert({ accountId, procedureId, operation, idempotencyKey, taxpayerId = accountId }: NewWork): { job: WorkItem; existing: boolean } {
    const hash = this.digest(taxpayerId, procedureId, operation, idempotencyKey);
      const previous = this.db.prepare('SELECT id FROM jobs WHERE intentHash = ?').get(hash) as { id: string } | undefined;
      if (previous) return { job: this.get(previous.id), existing: true };
      const id = randomUUID(); const now = new Date().toISOString();
      this.db.prepare('INSERT INTO jobs(id,accountId,procedureId,operation,intentHash,scopeHash,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?)').run(id, accountId, procedureId, operation, hash, this.digest('scope', taxpayerId, procedureId, operation), 'queued', now, now);
      this.event(id, 'queued', now);
      return { job: this.get(id), existing: false };
  }
  private row(id: string): WorkRow {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Identificador de trabajo no válido.');
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as WorkRow | undefined;
    if (!row) throw new Error('No existe ese trabajo en este operador.');
    return row;
  }
  get(id: string): WorkItem {
    const { intentHash: _intent, scopeHash: _scope, owner: _owner, baseline: _baseline, ...job } = this.row(id);
    return job;
  }
  list(after = '', limit = 50, accountId?: string): { jobs: WorkItem[]; next?: string } {
    if (!Number.isSafeInteger(limit) || limit < 1 || after && !/^[a-f0-9-]{36}$/.test(after)) throw new Error('Paginación no válida.');
    const rows = this.db.prepare('SELECT id FROM jobs WHERE id > ? AND (? IS NULL OR accountId = ?) ORDER BY id LIMIT ?').all(after, accountId ?? null, accountId ?? null, limit + 1) as { id: string }[];
    return { jobs: rows.slice(0, limit).map((row) => this.get(row.id)), ...(rows.length > limit ? { next: rows[limit - 1].id } : {}) };
  }
  events(id: string) { this.row(id); return this.db.prepare('SELECT sequence,status,at FROM events WHERE jobId = ? ORDER BY sequence').all(id); }
  private event(id: string, status: WorkStatus, at: string) { this.db.prepare('INSERT INTO events(jobId,status,at) VALUES(?,?,?)').run(id, status, at); }
  private update(id: string, status: WorkStatus, evidence: string | null = null): WorkItem {
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      this.db.prepare('UPDATE jobs SET status = ?, updatedAt = ?, evidence = ?, owner = ? WHERE id = ?').run(status, now, evidence, this.session, id);
      this.event(id, status, now); return this.get(id);
    })();
  }
  /** Called only after acquiring exclusive ownership of this browser, never by status/list. */
  recover(): void {
    this.db.transaction(() => {
      const rows = this.db.prepare("SELECT id,status FROM jobs WHERE owner IS NOT NULL AND owner <> ? AND status IN ('preparing','awaiting_approval','submitting')").all(this.session) as WorkItem[];
      for (const row of rows) this.update(row.id, row.status === 'submitting' ? 'uncertain' : 'paused');
    }).immediate();
  }
  activate(id: string): WorkItem {
    return this.db.transaction(() => {
      const row = this.row(id);
      if (['submitting', 'uncertain', 'completed', 'cancelled'].includes(row.status)) throw new Error('Este trabajo no puede ejecutarse: requiere conciliación o ya terminó. No se repetirá el envío.');
      const uncertain = this.db.prepare("SELECT id FROM jobs WHERE id <> ? AND scopeHash = ? AND status IN ('submitting','uncertain') LIMIT 1").get(id, row.scopeHash) as { id: string } | undefined;
      if (uncertain) throw new Error(`Hay un envío incierto del mismo contribuyente y trámite (${uncertain.id}). Concílialo antes de preparar otro; una clave diferente no elude el bloqueo.`);
      const other = this.db.prepare("SELECT id FROM jobs WHERE id <> ? AND status IN ('preparing','awaiting_approval','submitting') LIMIT 1").get(id) as { id: string } | undefined;
      if (other) throw new Error(`Hay otro trabajo activo (${other.id}). Páusalo antes de cambiar de cliente.`);
      return this.update(id, 'preparing');
    }).immediate();
  }
  checkpoint(id: string, count: number): WorkItem {
    if (this.row(id).status !== 'preparing' || !Number.isSafeInteger(count) || count < 0) throw new Error('No se puede registrar progreso en este estado.');
    this.db.prepare('UPDATE jobs SET steps = steps + ?, updatedAt = ? WHERE id = ?').run(count, new Date().toISOString(), id);
    return this.get(id);
  }
  awaitApproval(id: string): WorkItem { if (this.row(id).status !== 'preparing') throw new Error('El trabajo no está preparado.'); return this.update(id, 'awaiting_approval'); }
  pause(id: string): WorkItem {
    if (!['queued', 'preparing', 'awaiting_approval', 'paused'].includes(this.row(id).status)) throw new Error('Un envío iniciado o incierto requiere conciliación; no puede pausarse para volver a enviarlo.');
    return this.update(id, 'paused');
  }
  cancel(id: string): WorkItem { this.pause(id); return this.update(id, 'cancelled'); }
  beginSubmission(id: string, baseline: string): void {
    this.db.transaction(() => {
      if (this.row(id).status !== 'awaiting_approval') throw new Error('No existe un envío aprobado pendiente para este trabajo.');
      this.db.prepare('UPDATE jobs SET baseline = ?, attempts = attempts + 1 WHERE id = ?').run(baseline, id);
      this.update(id, 'submitting');
    }).immediate();
  }
  finishSubmission(id: string, current: string, evidence?: string): WorkItem {
    if (this.row(id).status !== 'submitting') throw new Error('El trabajo no tiene un envío pendiente de verificación.');
    const row = this.row(id);
    return this.update(id, evidence && current !== row.baseline ? 'completed' : 'uncertain', evidence ?? null);
  }
  async submit<T>(id: string, baseline: string, dispatch: () => Promise<{ value: T; signature: string; evidence?: string }>): Promise<T> {
    this.beginSubmission(id, baseline);
    try {
      const result = await dispatch();
      this.finishSubmission(id, result.signature, result.evidence);
      return result.value;
    } catch (error) {
      if (this.row(id).status === 'submitting') this.finishSubmission(id, '', undefined);
      throw error;
    }
  }
  reconcile(id: string, decision: 'completed' | 'not_performed'): WorkItem {
    if (!['submitting', 'uncertain'].includes(this.row(id).status)) throw new Error('El trabajo no requiere conciliación.');
    return this.update(id, decision === 'completed' ? 'completed' : 'paused', 'human-reconciliation');
  }
  closeConsultation(id: string): WorkItem {
    const job = this.row(id);
    if (!['consulta', 'preparacion'].includes(job.operation) || !['preparing', 'paused'].includes(job.status)) throw new Error('Un trámite tributario solo termina tras verificar su resultado o conciliarlo.');
    return this.update(id, 'completed', 'assisted-review-closed');
  }
  close(): void { this.db.close(); }
}
