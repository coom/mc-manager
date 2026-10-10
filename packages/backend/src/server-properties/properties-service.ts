import { readFile, writeFile, rename, rm, stat, chmod } from 'fs/promises';
import path from 'path';
import type { ServerPropertiesUpdate, ServerPropertiesView } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { parseServerProperties, updateServerProperties, validateRawProperties, maskRconPassword, escapeValue, KEY_RE, MAX_PROPERTIES_BYTES } from '../utils/server-properties.js';
import { lockedKeys } from './itzg-env.js';
import { logger } from '../utils/logger.js';

const MASK = '********';

export class PropertiesService {
  private lastWriteAt: Date | null = null;
  private readonly file: string;

  constructor(private deps: { dataDir: string; docker: DockerService; lock: DataLock }) { this.file = path.join(deps.dataDir, 'server.properties'); }

  private async readRaw(): Promise<string | null> {
    try { return await readFile(this.file, 'utf8'); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
  }

  private async locked(): Promise<Record<string, string>> {
    const i = await this.deps.docker.inspectServer().catch(() => null);
    return lockedKeys(i?.env ?? []);
  }

  private async restartRequired(): Promise<boolean> {
    if (!this.lastWriteAt) return false;
    const i = await this.deps.docker.inspectServer().catch(() => null);
    // Serveur arrêté : il lira le fichier au prochain démarrage, aucun redémarrage n'est requis.
    if (!i?.startedAt) return false;
    return new Date(i.startedAt).getTime() < this.lastWriteAt.getTime();
  }

  private async view(raw: string | null, locked: Record<string, string>): Promise<ServerPropertiesView> {
    const masked = raw === null ? '' : maskRconPassword(raw);
    const values = raw === null ? {} : parseServerProperties(raw);
    if ('rcon.password' in values) values['rcon.password'] = MASK;
    return { raw: masked, values, locked, exists: raw !== null, restartRequired: await this.restartRequired() };
  }

  async read(): Promise<ServerPropertiesView> { return this.view(await this.readRaw(), await this.locked()); }

  /** Écrit sous verrou, de façon atomique ; renvoie les clés changées et la nouvelle vue. */
  async write(update: ServerPropertiesUpdate): Promise<{ changed: string[]; view: ServerPropertiesView }> {
    const release = this.deps.lock.acquire('properties');
    try {
      const current = (await this.readRaw()) ?? '';
      const currentValues = parseServerProperties(current);
      const locked = await this.locked();
      let next: string;
      let changed: string[];
      if ('raw' in update) {
        if (typeof update.raw !== 'string') throw new AppError(400, 'raw must be a string');
        const err = validateRawProperties(update.raw);
        if (err) throw new AppError(400, err);
        // Le mot de passe masqué dans le brut est remplacé par la valeur réelle.
        const real = currentValues['rcon.password'];
        next = real !== undefined ? update.raw.replace(/^(\s*rcon\.password\s*[=:]\s*)\*{8}$/m, (_m, p1: string) => p1 + escapeValue(real)) : update.raw;
        if (!next.endsWith('\n')) next += '\n';
        const nextValues = parseServerProperties(next);
        const isLocked = (k: string) => Object.hasOwn(locked, k);
        for (const [k, v] of Object.entries(nextValues)) if (isLocked(k) && v !== (Object.hasOwn(currentValues, k) ? currentValues[k] : '')) throw new AppError(409, `Key ${k} is managed by ${locked[k]}`);
        for (const k of Object.keys(currentValues)) if (isLocked(k) && !Object.hasOwn(nextValues, k)) throw new AppError(409, `Key ${k} is managed by ${locked[k]}`);
        changed = [...new Set([...Object.keys(currentValues), ...Object.keys(nextValues)])]
          .filter((k) => (Object.hasOwn(currentValues, k) ? currentValues[k] : undefined) !== (Object.hasOwn(nextValues, k) ? nextValues[k] : undefined)).sort();
      } else {
        if (!update.values || typeof update.values !== 'object') throw new AppError(400, 'values must be an object');
        const values: Record<string, string> = {};
        for (const [k, v] of Object.entries(update.values)) {
          if (!KEY_RE.test(k)) throw new AppError(400, `Invalid key ${k}`);
          if (typeof v !== 'string' || /[\r\n]/.test(v)) throw new AppError(400, `Invalid value for ${k}`);
          if (k === 'rcon.password' && v === MASK) continue;
          const cur = Object.hasOwn(currentValues, k) ? currentValues[k] : undefined;
          if (Object.hasOwn(locked, k)) { if (v !== (cur ?? '')) throw new AppError(409, `Key ${k} is managed by ${locked[k]}`); continue; }
          if (cur !== v) values[k] = v;
        }
        changed = Object.keys(values).sort();
        next = changed.length ? updateServerProperties(current, values) : current;
        if (Buffer.byteLength(next, 'utf8') > MAX_PROPERTIES_BYTES) throw new AppError(400, 'Content exceeds 64 KiB');
      }
      if (changed.length) {
        await this.atomicWrite(next);
        this.lastWriteAt = new Date();
      }
      return { changed, view: await this.view(next, locked) };
    } finally { release(); }
  }

  private async atomicWrite(content: string): Promise<void> {
    const tmp = path.join(this.deps.dataDir, `.server.properties.${process.pid}.tmp`);
    try {
      await writeFile(tmp, content, 'utf8');
      // Conserve le mode du fichier d'origine (ignoré s'il n'existe pas ou sous Windows).
      try { await chmod(tmp, (await stat(this.file)).mode & 0o777); } catch { /* sans effet */ }
      await rename(tmp, this.file);
    } catch (err) {
      await rm(tmp, { force: true }).catch(() => undefined);
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EROFS') throw new AppError(500, `Cannot write ${this.file}: the data volume is mounted read-only. Remove :ro from the data volume in docker-compose.yml.`);
      if (code === 'ENOSPC') throw new AppError(500, `Cannot write ${this.file}: no space left on the data volume.`);
      if (code === 'EACCES' || code === 'EPERM') {
        logger.warn({ err, file: this.file }, 'cannot write server.properties');
        throw new AppError(500, `Cannot write ${this.file}: the data directory is not writable by the backend (UID 1000). Run chown -R 1000:1000 ${this.deps.dataDir} on the host.`);
      }
      throw err;
    }
  }
}
