import { access, readdir, rename, stat } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { ManualMod, ModsDir, ModsView, ModrinthMod, WsMessage } from '@mc/common';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';
import { mapWriteError } from '../utils/atomic-write.js';
import { serverTypeOf, modrinthSource, COMPOSE_LINE, LISTING_RELATIVE } from './server-type.js';
import { readListing, writeListing, isManaged, isValidEntry, slugOf, prefixOf, type ListingLine } from './listing-file.js';
import { readManifest } from './manifest.js';
import { ModrinthUnavailable, type ModrinthLike } from './modrinth-client.js';

export interface ModsDeps {
  dataDir: string;
  docker: Pick<DockerService, 'inspectServer'>;
  modrinth: ModrinthLike;
  prisma: PrismaClient;
  lock: DataLock;
  broadcast: (msg: WsMessage) => void;
}

const RESOLVE_RETRY_MS = 60 * 60_000;

export class ModsService {
  readonly listingPath: string;
  /** Dernier renommage manuel (mémoire seulement) : comparé à StartedAt pour restartRequired. */
  protected lastFileWriteAt: Date | null = null;
  /** Promesse de la résolution en arrière-plan en cours (les tests l'attendent). */
  pendingResolution: Promise<void> | null = null;
  private attempted = new Map<string, number>();

  constructor(protected deps: ModsDeps) { this.listingPath = path.join(deps.dataDir, LISTING_RELATIVE); }

  protected async inspect() { return this.deps.docker.inspectServer().catch((err) => { logger.warn({ err }, 'docker inspect failed'); return null; }); }

  async view(): Promise<ModsView> {
    const inspect = await this.inspect();
    const env = inspect?.env ?? [];
    const server = inspect ? serverTypeOf(env) : null;
    const { source, inlineEntries } = modrinthSource(env);
    const { exists, lines } = await readListing(this.listingPath);
    const manifest = await readManifest(this.deps.dataDir);
    const manifestSlugs = new Set((manifest?.projects ?? []).map(slugOf));
    const manifestFiles = new Set(manifest?.files ?? []);
    const managed = lines.filter(isManaged);
    const slugs = [...new Set(managed.map((l) => slugOf(l.entry)))];
    const cached = slugs.length ? await this.deps.prisma.modrinthProject.findMany({ where: { slug: { in: slugs } } }) : [];
    const bySlug = new Map(cached.map((c) => [c.slug, c]));
    const modrinth: ModrinthMod[] = managed.map((l) => {
      const slug = slugOf(l.entry);
      const c = bySlug.get(slug);
      return { entry: l.entry, slug, enabled: l.kind === 'entry', installed: manifestSlugs.has(slug), title: c?.title ?? null, iconUrl: c?.iconUrl ?? null, projectId: c?.projectId ?? null };
    });
    const unmanagedLines = lines.filter((l) => l.kind === 'comment' || l.kind === 'invalid').map((l) => ({ raw: l.raw, invalid: l.kind === 'invalid' }));
    const manual = server ? await this.listManual(server.dir, manifestFiles) : [];
    const active = new Set(modrinth.filter((m) => m.enabled).map((m) => m.slug));
    const modrinthPending = active.size !== manifestSlugs.size || [...active].some((s) => !manifestSlugs.has(s));
    const manualPending = !!inspect?.startedAt && this.lastFileWriteAt !== null && new Date(inspect.startedAt).getTime() < this.lastFileWriteAt.getTime();
    this.scheduleResolution(slugs.filter((s) => !bySlug.has(s)));
    return { server, source, inlineEntries, listingExists: exists, composeLine: COMPOSE_LINE, restartRequired: modrinthPending || manualPending, modrinth, unmanagedLines, manual };
  }

  /** Jars du dossier non gérés par Modrinth (ni le .jar ni son .jar.disabled n'est dans le manifeste). */
  protected async listManual(dir: ModsDir, manifestFiles: Set<string>): Promise<ManualMod[]> {
    const abs = path.join(this.deps.dataDir, dir);
    let entries: Dirent[];
    try { entries = await readdir(abs, { withFileTypes: true }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
    const byBase = new Map<string, { enabled?: { size: number; mtime: Date }; disabled?: { size: number; mtime: Date } }>();
    for (const d of entries) {
      if (!d.isFile()) continue;
      const n = d.name;
      const on = n.endsWith('.jar');
      if (!on && !n.endsWith('.jar.disabled')) continue;
      const base = on ? n : n.slice(0, -'.disabled'.length);
      if (manifestFiles.has(`${dir}/${base}`)) continue;
      const st = await stat(path.join(abs, n));
      const rec = byBase.get(base) ?? {};
      rec[on ? 'enabled' : 'disabled'] = { size: st.size, mtime: st.mtime };
      byBase.set(base, rec);
    }
    return [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, r]) => {
      const info = r.enabled ?? r.disabled!;
      return { file, enabled: !!r.enabled, size: info.size, mtime: info.mtime.toISOString(), conflict: !!r.enabled && !!r.disabled };
    });
  }

  /** Résout en arrière-plan les slugs sans cache, au plus une tentative par slug et par heure, un passage à la fois. */
  private scheduleResolution(slugs: string[]): void {
    const now = Date.now();
    const todo = slugs.filter((s) => (this.attempted.get(s) ?? 0) + RESOLVE_RETRY_MS < now);
    if (!todo.length || this.pendingResolution) return;
    for (const s of todo) this.attempted.set(s, now);
    this.pendingResolution = (async () => {
      for (const slug of todo) {
        try {
          const info = await this.deps.modrinth.getProject(slug);
          if (info) await this.cacheProject(slug, info);
        } catch (err) { logger.warn({ err, slug }, 'modrinth metadata resolution failed'); }
      }
    })().finally(() => { this.pendingResolution = null; });
  }

  protected async cacheProject(slug: string, info: { id: string; title: string; iconUrl: string | null }): Promise<void> {
    const data = { projectId: info.id, title: info.title, iconUrl: info.iconUrl, fetchedAt: new Date() };
    await this.deps.prisma.modrinthProject.upsert({ where: { slug }, create: { slug, ...data }, update: data });
  }

  private fail(status: number, code: string, message: string): never { throw new AppError(status, message, undefined, code); }

  private async requireServer() {
    const inspect = await this.inspect();
    const server = inspect ? serverTypeOf(inspect.env) : null;
    if (!server) this.fail(409, 'unsupported_server', 'Mods are only managed for modded or plugin servers (TYPE=FABRIC, PAPER, ...)');
    return server;
  }

  /** Exécute `fn` sous le verrou de données, puis diffuse mods.changed si `fn` renvoie changed. */
  private async withLock<T>(fn: () => Promise<{ changed: boolean; result: T }>): Promise<T> {
    const release = this.deps.lock.acquire('mods');
    try {
      const { changed, result } = await fn();
      if (changed) this.deps.broadcast({ type: 'mods.changed' });
      return result;
    } finally { release(); }
  }

  /** Crée le fichier de liste à partir de MODRINTH_PROJECTS inline ; renvoie le nombre d'entrées écrites. */
  async importFromEnv(): Promise<number> {
    await this.requireServer();
    const inspect = await this.inspect();
    const { source, inlineEntries } = modrinthSource(inspect?.env ?? []);
    if (source !== 'inline') this.fail(409, 'conflict', 'MODRINTH_PROJECTS is not an inline list');
    return this.withLock(async () => {
      if ((await readListing(this.listingPath)).exists) this.fail(409, 'conflict', 'The listing file already exists');
      const lines: ListingLine[] = inlineEntries.map((e) => (isValidEntry(e) ? { kind: 'entry', entry: e, raw: e } : { kind: 'invalid', raw: e }));
      await writeListing(this.listingPath, lines);
      return { changed: true, result: lines.length };
    });
  }

  async add(entry: string): Promise<void> {
    if (!isValidEntry(entry)) this.fail(400, 'invalid_entry', 'Invalid Modrinth entry');
    const server = await this.requireServer();
    const slug = slugOf(entry);
    const dup = (lines: ListingLine[]) => lines.some((l) => isManaged(l) && slugOf(l.entry) === slug);
    if (dup((await readListing(this.listingPath)).lines)) this.fail(409, 'duplicate', `${slug} is already listed`);
    // Appel Modrinth hors verrou (jusqu'à 10 s) ; le doublon est revérifié sous verrou avant d'écrire.
    let info;
    try { info = await this.deps.modrinth.getProject(slug); }
    catch (err) { if (err instanceof ModrinthUnavailable) this.fail(502, 'modrinth_unavailable', err.message); throw err; }
    if (!info) this.fail(404, 'unknown_project', `Modrinth project ${slug} not found`);
    if (info.projectType !== 'mod') this.fail(422, 'wrong_type', `${slug} is a ${info.projectType}, not a mod`);
    const wanted = prefixOf(entry) ?? server.loader;
    if (!info.loaders.includes(wanted)) this.fail(422, 'loader_mismatch', `${slug} has no ${wanted} version (loaders: ${info.loaders.join(', ') || 'none'})`);
    await this.cacheProject(slug, info);
    await this.withLock(async () => {
      const { lines } = await readListing(this.listingPath);
      if (dup(lines)) this.fail(409, 'duplicate', `${slug} is already listed`);
      await writeListing(this.listingPath, [...lines, { kind: 'entry', entry, raw: entry }]);
      return { changed: true, result: undefined };
    });
  }

  private findLine(lines: ListingLine[], entry: string): number {
    if (!isValidEntry(entry)) this.fail(400, 'invalid_entry', 'Invalid Modrinth entry');
    const i = lines.findIndex((l) => isManaged(l) && l.entry === entry);
    if (i < 0) this.fail(404, 'not_found', `${entry} is not listed`);
    return i;
  }

  async setEnabled(entry: string, enabled: boolean): Promise<void> {
    await this.requireServer();
    await this.withLock(async () => {
      const { lines } = await readListing(this.listingPath);
      const i = this.findLine(lines, entry);
      const kind = enabled ? 'entry' : 'disabled';
      if (lines[i].kind === kind) return { changed: false, result: undefined };
      const next = [...lines];
      next[i] = { kind, entry, raw: enabled ? entry : `# ${entry}` };
      await writeListing(this.listingPath, next);
      return { changed: true, result: undefined };
    });
  }

  async remove(entry: string): Promise<void> {
    await this.requireServer();
    await this.withLock(async () => {
      const { lines } = await readListing(this.listingPath);
      const i = this.findLine(lines, entry);
      await writeListing(this.listingPath, lines.filter((_, j) => j !== i));
      return { changed: true, result: undefined };
    });
  }

  /** Renomme <file> ⇄ <file>.disabled dans le dossier des mods ; `file` doit être un nom simple présent dans le listing manuel. */
  async setFileEnabled(file: string, enabled: boolean): Promise<void> {
    if (!/^[^/\\]+\.jar$/.test(file) || file.includes('..') || path.basename(file) !== file) this.fail(404, 'not_found', 'Unknown file');
    const server = await this.requireServer();
    await this.withLock(async () => {
      const manifest = await readManifest(this.deps.dataDir);
      const manual = await this.listManual(server.dir, new Set(manifest?.files ?? []));
      const m = manual.find((x) => x.file === file);
      if (!m) this.fail(404, 'not_found', 'Unknown file');
      if (m.conflict) this.fail(409, 'conflict', `${file} and ${file}.disabled both exist: remove one on the host`);
      if (m.enabled === enabled) return { changed: false, result: undefined };
      const dir = path.join(this.deps.dataDir, server.dir);
      const from = path.join(dir, enabled ? `${file}.disabled` : file);
      const to = path.join(dir, enabled ? file : `${file}.disabled`);
      if (await access(to).then(() => true, () => false)) this.fail(409, 'conflict', `${path.basename(to)} already exists`);
      try { await rename(from, to); } catch (err) { throw mapWriteError(err, from, dir); }
      this.lastFileWriteAt = new Date();
      return { changed: true, result: undefined };
    });
  }
}
