import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { installationDirectory } from './operator-storage.js';

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
};

/** Cross-process, crash-recoverable ownership. SQLite makes stale-owner takeover atomic. No heartbeat. */
export class ProcessLease {
  private database?: Database.Database;
  private token = randomUUID();
  private held = false;
  constructor(private readonly resource: string, private readonly directory = path.join(installationDirectory(), 'runtime'), private readonly pid = process.pid, private readonly isAlive = alive) {}
  acquire(): void {
    if (this.held) return;
    mkdirSync(this.directory, { recursive: true });
    const db = this.database ??= new Database(path.join(this.directory, 'coordination.sqlite'));
    db.pragma('busy_timeout = 5000');
    db.exec('CREATE TABLE IF NOT EXISTS leases (resource TEXT PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL)');
    db.transaction(() => {
      const owner = db.prepare('SELECT pid, token FROM leases WHERE resource = ?').get(this.resource) as { pid: number; token: string } | undefined;
      if (owner && owner.token !== this.token && this.isAlive(owner.pid)) throw new Error('Otro proceso está usando este recurso local. No se abrió otra conexión ni se tomó su sesión.');
      db.prepare('INSERT INTO leases(resource,pid,token) VALUES(?,?,?) ON CONFLICT(resource) DO UPDATE SET pid=excluded.pid,token=excluded.token').run(this.resource, this.pid, this.token);
    }).immediate();
    this.held = true;
  }
  release(): void {
    if (this.database && this.held) this.database.prepare('DELETE FROM leases WHERE resource = ? AND token = ?').run(this.resource, this.token);
    this.held = false;
    this.database?.close();
    this.database = undefined;
  }
}

const browserLease = new ProcessLease('existing-brave');
export const acquireBrowserLease = () => browserLease.acquire();
export const releaseBrowserLease = () => browserLease.release();
process.once('exit', releaseBrowserLease);
