import { EventEmitter } from 'events';
import { access, readFile, rm, statfs as fsStatfs, writeFile, constants as fsConstants } from 'fs/promises';
import path from 'path';
import type { InterruptedRestore, RestoreStatus, RestoreStep, ServerStatus } from '@mc/common';
import type { BackupService } from './backup-service.js';
import type { DockerService } from '../docker/docker-service.js';
import { DEFAULT_EXCLUDES, RESTORE_MARKER, openArchive, restoreArchive, type ArchiveHandle, type ArchiveInfo } from './archive-filter.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';

type StatfsFn = (p: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;
export interface RestoreDeps { dataDir: string; backups: BackupService; docker: DockerService; stopTimeoutMs?: number; statfs?: StatfsFn }
export interface RestoreOptions { startAfter: boolean; safetyBackup: boolean }
type AuditFn = (detail: string) => Promise<void>;

interface DoneEvent { ok: boolean; message: string; safetyBackup: string | null }
class RestoreFailure extends Error {}

/** Liste `EXCLUDES` du conteneur mc-backup : défaut si absente, `EXCLUDES=` vide = aucune exclusion. */
export function parseExcludes(env: string[]): string[] {
  const line = env.find((e) => e.startsWith('EXCLUDES='));
  if (line === undefined) return [...DEFAULT_EXCLUDES];
  return line.slice('EXCLUDES='.length).split(',').map((s) => s.trim()).filter(Boolean);
}

function fmtBytes(n: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/**
 * Restauration d'une archive : check (synchrone, avant le 202) puis, en arrière-plan,
 * safety → stop → replace → extract → start → done. Le verrou est tenu du check à la fin.
 * L'archive est ouverte une seule fois au check : le prune de mc-backup après la sauvegarde de
 * sécurité ne peut pas la faire disparaître sous nos pieds.
 */
export class RestoreService extends EventEmitter {
  private step: RestoreStep | null = null;
  private interrupted: InterruptedRestore | null = null;
  private readonly stopTimeoutMs: number;
  private readonly marker: string;

  constructor(private deps: RestoreDeps) {
    super();
    this.stopTimeoutMs = deps.stopTimeoutMs ?? 90_000;
    this.marker = path.join(deps.dataDir, RESTORE_MARKER);
  }

  /** Au démarrage du backend : un marqueur restant signale une restauration interrompue (crash, arrêt). */
  async start(): Promise<void> {
    let raw: string;
    try { raw = await readFile(this.marker, 'utf8'); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err, marker: this.marker }, 'cannot read the restore marker');
      return;
    }
    let parsed: Partial<InterruptedRestore> = {};
    try { parsed = JSON.parse(raw) as Partial<InterruptedRestore>; } catch { /* marqueur illisible : signalé quand même */ }
    this.interrupted = {
      archive: typeof parsed.archive === 'string' ? parsed.archive : 'unknown',
      safetyBackup: typeof parsed.safetyBackup === 'string' ? parsed.safetyBackup : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
    logger.error({ marker: this.marker, ...this.interrupted }, 'a previous restore was interrupted: the data may be half restored, restore the safety backup');
  }

  status(): RestoreStatus { return { running: this.step !== null, step: this.step, interrupted: this.interrupted }; }

  /** L'admin a traité la restauration interrompue à la main : retire le marqueur. */
  async clearInterrupted(): Promise<void> {
    if (this.step !== null) throw new AppError(409, 'A restore is running');
    await rm(this.marker, { force: true });
    this.interrupted = null;
  }

  private progress(step: RestoreStep, line: string): void { this.step = step; this.emit('progress', { step, line }); }

  async restore(name: string, opts: RestoreOptions, audit: AuditFn): Promise<void> {
    const { backups, docker } = this.deps;
    // check : tout ce qui peut refuser avant le 202, sans rien écrire.
    const file = await backups.resolve(name);
    backups.dataLock.assertFree();
    if (!(await docker.hasServerContainer())) throw new AppError(503, 'Minecraft container not found');
    // Sauvegarde de sécurité facultative ; demandée, elle exige le serveur (RCON save-off) et mc-backup (exec) en marche.
    if (opts.safetyBackup) {
      const running = docker.getStatus() === 'ready' || docker.getStatus() === 'unhealthy';
      if (!running) throw new AppError(409, 'Server is stopped: a safety backup is not possible, restore without one');
      const bk = await docker.inspectBackup();
      if (!bk) throw new AppError(503, 'Backup container not found');
      if (!bk.running) throw new AppError(409, 'The backup container is stopped: start it, or restore without a safety backup');
    }
    const handle = await openArchive(file).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') throw new AppError(404, 'Backup not found');
      throw err;
    });
    let release: (() => void) | null = null;
    let info: ArchiveInfo; let excludes: string[];
    try {
      info = await handle.inspect();
      await this.preflight(info);
      excludes = await this.excludes();
      release = backups.dataLock.acquire('restore');
      this.progress('check', `${name}: ${info.entries} entries, ${info.topLevel.join(', ')}`);
    } catch (err) {
      this.step = null; release?.();
      await handle.close().catch(() => undefined);
      throw err;
    }
    const unlock = release;
    void this.run(name, handle, info, excludes, opts, audit)
      .then((outcome) => {
        // Un seul `done`, émis après remise à zéro de l'étape et libération du verrou.
        this.step = null;
        unlock();
        try { this.emit('done', outcome); } catch (err) { logger.error({ err }, 'restore done listener threw'); }
      })
      .catch((err) => { this.step = null; unlock(); logger.error({ err }, 'restore run crashed'); })
      .finally(() => handle.close().catch((err) => logger.warn({ err }, 'cannot close the archive')));
  }

  /** Refus avant toute écriture : dossier non inscriptible, place insuffisante. */
  private async preflight(info: ArchiveInfo): Promise<void> {
    const { dataDir } = this.deps;
    const writable = async (p: string) => {
      try { await access(p, fsConstants.W_OK); }
      catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' && p !== dataDir) return;
        if (code === 'EACCES' || code === 'EPERM') {
          throw new AppError(500, `Cannot write ${dataDir}: the data directory is not writable by the backend (UID 1000). Run chown -R 1000:1000 ${dataDir} on the host.`);
        }
        if (code === 'EROFS') throw new AppError(500, `Cannot write ${dataDir}: the data volume is mounted read-only. Remove :ro from the data volume in docker-compose.yml.`);
        throw err;
      }
    };
    await writable(dataDir);
    for (const name of info.topLevel) await writable(path.resolve(dataDir, name));
    let free: number | null = null;
    try {
      const s = await (this.deps.statfs ?? (fsStatfs as unknown as StatfsFn))(dataDir);
      free = Number(s.bavail) * Number(s.bsize);
    } catch (err) { logger.warn({ err, dataDir }, 'statfs failed, free space not checked'); }
    if (free !== null && free < info.bytes) throw new AppError(507, `Not enough free space on the data volume: need ${fmtBytes(info.bytes)}, have ${fmtBytes(free)}`);
  }

  private async excludes(): Promise<string[]> {
    try { return parseExcludes(await this.deps.docker.backupEnv()); }
    catch (err) { logger.warn({ err }, 'cannot read EXCLUDES of the backup container, using the defaults'); return [...DEFAULT_EXCLUDES]; }
  }

  /** L'audit ne doit jamais faire échouer ni interrompre la restauration. */
  private async safeAudit(audit: AuditFn, detail: string): Promise<void> {
    try { await audit(detail); } catch (err) { logger.warn({ err, detail }, 'restore audit failed'); }
  }

  private async writeMarker(m: InterruptedRestore & { step: RestoreStep }): Promise<void> {
    await writeFile(this.marker, JSON.stringify(m) + '\n', 'utf8');
  }

  private async run(name: string, handle: ArchiveHandle, info: ArchiveInfo, excludes: string[], opts: RestoreOptions, audit: AuditFn): Promise<DoneEvent> {
    let safetyBackup: string | null = null;
    let touched = false;
    let stopRequested = false;
    try {
      await this.safeAudit(audit, `${name} (startAfter=${opts.startAfter}, safetyBackup=${opts.safetyBackup})`);
      if (opts.safetyBackup) safetyBackup = await this.safetyBackup();
      stopRequested = this.deps.docker.getStatus() !== 'stopped';
      await this.stopServer();
      const marker = { archive: name, safetyBackup, startedAt: new Date().toISOString() };
      try {
        await restoreArchive(handle, this.deps.dataDir, (line) => this.progress(line.startsWith('replace') ? 'replace' : 'extract', line), {
          excludes, info,
          onBeforeReplace: async () => { await this.writeMarker({ ...marker, step: 'replace' }); touched = true; },
          onBeforeExtract: () => this.writeMarker({ ...marker, step: 'extract' }),
        });
      } catch (err) {
        if (touched) { this.interrupted = marker; throw new RestoreFailure(`partial restore: ${(err as Error).message}`); }
        throw err;
      }
      await rm(this.marker, { force: true }).catch((err) => logger.warn({ err }, 'cannot remove the restore marker'));
      this.interrupted = null;
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
      if (err instanceof RestoreFailure && touched) return { ok: false, message: raw, safetyBackup };
      if (!touched) {
        // Rien n'a été supprimé : la restauration est annulée et le serveur relancé si on l'avait arrêté.
        if (opts.startAfter && stopRequested) {
          await this.deps.docker.startServer().catch((e) => logger.warn({ err: e }, 'restart after an aborted restore failed'));
        }
        return { ok: false, message: `aborted: ${raw}`, safetyBackup };
      }
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
