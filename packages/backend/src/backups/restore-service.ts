import { EventEmitter } from 'events';
import type { RestoreStatus, RestoreStep, ServerStatus } from '@mc/common';
import type { BackupService } from './backup-service.js';
import type { DockerService } from '../docker/docker-service.js';
import { inspectArchive, restoreArchive } from './archive-filter.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

export interface RestoreDeps { dataDir: string; backups: BackupService; docker: DockerService; stopTimeoutMs?: number }
export interface RestoreOptions { startAfter: boolean; confirmNoSafetyBackup: boolean }
type AuditFn = (detail: string) => Promise<void>;

interface DoneEvent { ok: boolean; message: string; safetyBackup: string | null }
class RestoreFailure extends Error {}

/**
 * Restauration d'une archive : check (synchrone, avant le 202) puis, en arrière-plan,
 * safety → stop → replace → extract → start → done. Le verrou est tenu du check à la fin.
 */
export class RestoreService extends EventEmitter {
  private step: RestoreStep | null = null;
  private readonly stopTimeoutMs: number;

  constructor(private deps: RestoreDeps) { super(); this.stopTimeoutMs = deps.stopTimeoutMs ?? 90_000; }

  status(): RestoreStatus { return { running: this.step !== null, step: this.step }; }

  private progress(step: RestoreStep, line: string): void { this.step = step; this.emit('progress', { step, line }); }

  async restore(name: string, opts: RestoreOptions, audit: AuditFn): Promise<void> {
    const { backups, docker } = this.deps;
    // check : tout ce qui peut refuser avant le 202, sans rien écrire.
    const file = await backups.resolve(name);
    backups.dataLock.assertFree();
    if (!(await docker.hasServerContainer())) throw new AppError(503, 'Minecraft container not found');
    const canSafety = docker.getStatus() === 'ready' || docker.getStatus() === 'unhealthy';
    if (canSafety) await backups.ensureContainer();
    else if (!opts.confirmNoSafetyBackup) throw new AppError(409, 'Server is stopped: no safety backup possible, confirm to proceed');
    const info = await inspectArchive(file);
    const release = backups.dataLock.acquire('restore');
    try { this.progress('check', `${name}: ${info.entries} entries, ${info.topLevel.join(', ')}`); }
    catch (err) { this.step = null; release(); throw err; }
    void this.run(name, file, opts, canSafety, audit)
      .then((outcome) => {
        // Un seul `done`, émis après remise à zéro de l'étape et libération du verrou.
        this.step = null;
        release();
        try { this.emit('done', outcome); } catch (err) { logger.error({ err }, 'restore done listener threw'); }
      })
      .catch((err) => { this.step = null; release(); logger.error({ err }, 'restore run crashed'); });
  }

  /** L'audit ne doit jamais faire échouer ni interrompre la restauration. */
  private async safeAudit(audit: AuditFn, detail: string): Promise<void> {
    try { await audit(detail); } catch (err) { logger.warn({ err, detail }, 'restore audit failed'); }
  }

  private async run(name: string, file: string, opts: RestoreOptions, canSafety: boolean, audit: AuditFn): Promise<DoneEvent> {
    let safetyBackup: string | null = null;
    try {
      await this.safeAudit(audit, name);
      if (canSafety) safetyBackup = await this.safetyBackup();
      await this.stopServer();
      try {
        await restoreArchive(file, this.deps.dataDir, (line) => this.progress(line.startsWith('replace') ? 'replace' : 'extract', line));
      } catch (err) {
        throw new RestoreFailure(`partial restore: ${(err as Error).message}`);
      }
      if (opts.startAfter) {
        this.progress('start', 'starting the server');
        await this.deps.docker.startServer().catch((err) => { throw new RestoreFailure(`restored, but the server did not start: ${(err as Error).message}`); });
      }
      await this.safeAudit(audit, 'exit ok');
      return { ok: true, message: 'restored', safetyBackup };
    } catch (err) {
      const raw = (err as Error).message;
      logger.error({ err, name }, 'restore failed');
      await this.safeAudit(audit, `failed: ${raw}`);
      return { ok: false, message: err instanceof RestoreFailure ? raw : `failed: ${raw}`, safetyBackup };
    }
  }

  /** `backup now` sous le verrou déjà tenu ; renvoie le nom de la nouvelle archive. */
  private async safetyBackup(): Promise<string> {
    const { backups } = this.deps;
    this.progress('safety', 'running a safety backup');
    const before = new Set((await backups.list()).entries.map((e) => e.name));
    const relay = (line: string) => this.progress('safety', line);
    backups.on('progress', relay);
    let code: number;
    try { code = await backups.runNow({ lockHeld: true }); }
    catch (err) { throw new RestoreFailure(`safety backup failed: ${(err as Error).message}`); }
    finally { backups.off('progress', relay); }
    if (code !== 0) throw new RestoreFailure(`safety backup failed (exit ${code})`);
    const created = (await backups.list()).entries.filter((e) => !before.has(e.name)).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    if (!created[0]) throw new RestoreFailure('safety backup produced no archive');
    return created[0].name;
  }

  private async stopServer(): Promise<void> {
    const { docker } = this.deps;
    if (docker.getStatus() === 'stopped') { this.progress('stop', 'server already stopped'); return; }
    this.progress('stop', 'stopping the server');
    const stopped = new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); docker.off('status', onStatus); };
      const timer = setTimeout(() => { cleanup(); reject(new RestoreFailure(`server did not stop within ${Math.round(this.stopTimeoutMs / 1000)} s`)); }, this.stopTimeoutMs);
      const onStatus = (s: ServerStatus) => { if (s === 'stopped') { cleanup(); resolve(); } };
      docker.on('status', onStatus);
      Promise.resolve().then(() => docker.stopServer()).catch((err) => { cleanup(); reject(new RestoreFailure(`stop request failed: ${(err as Error).message}`)); });
    });
    await stopped;
  }
}
