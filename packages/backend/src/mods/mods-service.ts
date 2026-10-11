import { access, mkdir, readdir, rename, rm, stat } from 'fs/promises';
import { createWriteStream, type Dirent, type Stats } from 'fs';
import { pipeline } from 'stream/promises';
import { Transform, type Readable } from 'stream';
import { randomUUID } from 'crypto';
import path from 'path';
import { MAX_UPLOAD_BYTES, type JarMeta, type ManualMod, type ModsDir, type ModsView, type ModrinthMod, type ModrinthSearchHit, type ModsSearchResult, type WsMessage } from '@mc/common';
import { inspectJar, pickLoader, JarError } from './jar-inspector.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../utils/logger.js';
import { mapWriteError } from '../utils/atomic-write.js';
import { serverTypeOf, modrinthSource, envMap, COMPOSE_LINE, LISTING_RELATIVE } from './server-type.js';
import { readListing, writeListing, isManaged, isValidEntry, slugOf, prefixOf, type ListingLine } from './listing-file.js';
import { readManifest, type ModrinthManifest } from './manifest.js';
import { ModrinthUnavailable, type ModrinthLike } from './modrinth-client.js';

/** AppSetting : slugs actifs au dernier démarrage qui a appliqué le fichier de liste (JSON, trié). */
const APPLIED_KEY = 'mods.appliedSlugs';

export const UPLOAD_NAME_RE = /^[A-Za-z0-9._+ ()[\]-]{1,96}\.jar$/;
const isUploadName = (n: string): boolean => UPLOAD_NAME_RE.test(n) && !n.includes('..') && path.basename(n) === n;

class TooLarge extends Error { constructor() { super('too large'); this.name = 'TooLarge'; } }
/** Compte les octets et coupe au-delà de `max` : Content-Length n'est qu'une déclaration. */
function limited(max: number): Transform {
  let seen = 0;
  return new Transform({ transform(chunk: Buffer, _enc, cb) { seen += chunk.length; if (seen > max) cb(new TooLarge()); else cb(null, chunk); } });
}

export interface ModsDeps {
  dataDir: string;
  docker: Pick<DockerService, 'inspectServer'>;
  modrinth: ModrinthLike;
  prisma: PrismaClient;
  lock: DataLock;
  broadcast: (msg: WsMessage) => void;
  /** Version Minecraft en cours d'exécution (lue dans les logs par le collecteur), null si inconnue. */
  gameVersion?: () => string | null;
}

const RESOLVE_RETRY_MS = 60 * 60_000;
const SEARCH_TTL_MS = 60_000;
const SEARCH_CACHE_MAX = 50;
const SEARCH_LIMIT = 20;
const VERSION_RE = /^\d+\.\d+(\.\d+)?$/;

export class ModsService {
  readonly listingPath: string;
  /** Dernier renommage manuel (mémoire seulement) : comparé à StartedAt pour restartRequired. */
  protected lastFileWriteAt: Date | null = null;
  /** Promesse de la résolution en arrière-plan en cours (les tests l'attendent). */
  pendingResolution: Promise<void> | null = null;
  private attempted = new Map<string, number>();
  /** Dossier des uploads en cours (`<uuid>.part`), dans le volume pour que le rename final soit atomique. */
  readonly tmpDir: string;
  private metaCache = new Map<string, { size: number; mtimeMs: number; meta: JarMeta | null }>();

  constructor(protected deps: ModsDeps) {
    this.listingPath = path.join(deps.dataDir, LISTING_RELATIVE);
    this.tmpDir = path.join(deps.dataDir, 'mc-manager', 'tmp');
  }

  /** Au démarrage : supprime les .part laissés par un upload interrompu. */
  async start(): Promise<void> {
    let names: string[];
    try { names = await readdir(this.tmpDir); }
    catch (err) {
      // Dossier absent : rien à faire. Autre erreur (droits) : on ne bloque pas le démarrage du backend pour ça.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn({ err, dir: this.tmpDir }, 'cannot read upload temp folder');
      return;
    }
    for (const n of names) if (n.endsWith('.part')) await rm(path.join(this.tmpDir, n), { force: true }).catch((err) => logger.warn({ err, n }, 'cannot remove orphan upload'));
  }

  /** Métadonnées d'un jar, mises en cache par taille et mtime ; null si illisible. */
  private async jarMeta(file: string, size: number, mtimeMs: number, dir: ModsDir, loader: string): Promise<JarMeta | null> {
    const hit = this.metaCache.get(file);
    if (hit && hit.size === size && hit.mtimeMs === mtimeMs) return hit.meta;
    let meta: JarMeta | null;
    try { const info = await inspectJar(file); meta = (pickLoader(info, dir, loader) ?? info.found[0])?.meta ?? null; }
    catch { meta = null; }
    this.metaCache.set(file, { size, mtimeMs, meta });
    return meta;
  }

  protected async inspect() { return this.deps.docker.inspectServer().catch((err) => { logger.warn({ err }, 'docker inspect failed'); return null; }); }

  async view(): Promise<ModsView> {
    const inspect = await this.inspect();
    const env = inspect?.env ?? [];
    const server = inspect ? serverTypeOf(env) : null;
    const { source, inlineEntries } = modrinthSource(env);
    const { exists, lines } = await readListing(this.listingPath);
    const manifest = await readManifest(this.deps.dataDir);
    const manifestFiles = new Set(manifest?.files ?? []);
    const managed = lines.filter(isManaged);
    const slugs = [...new Set(managed.map((l) => slugOf(l.entry)))];
    const cached = slugs.length ? await this.deps.prisma.modrinthProject.findMany({ where: { slug: { in: slugs } } }) : [];
    const bySlug = new Map(cached.map((c) => [c.slug, c]));
    const active = new Set(managed.filter((l) => l.kind === 'entry').map((l) => slugOf(l.entry)));
    const state = await this.installedState(manifest, active);
    const modrinth: ModrinthMod[] = managed.map((l) => {
      const slug = slugOf(l.entry);
      const c = bySlug.get(slug);
      return { entry: l.entry, slug, enabled: l.kind === 'entry', installed: state.installed.has(slug), title: c?.title ?? null, description: c?.description ?? null, iconUrl: c?.iconUrl ?? null, projectId: c?.projectId ?? null };
    });
    const unmanagedLines = lines.filter((l) => l.kind === 'comment' || l.kind === 'invalid').map((l) => ({ raw: l.raw, invalid: l.kind === 'invalid' }));
    const manual = server ? await this.listManual(server.dir, manifestFiles, server.loader) : [];
    // Tant que MODRINTH_PROJECTS ne pointe pas sur notre fichier, un redémarrage n'appliquerait pas la liste : pas de bandeau.
    const modrinthPending = source === 'file' && state.pending;
    const manualPending = !!inspect?.startedAt && this.lastFileWriteAt !== null && new Date(inspect.startedAt).getTime() < this.lastFileWriteAt.getTime();
    const serverIssue = server ? null : inspect ? 'unsupported' : 'unavailable';
    // Sans ligne en cache, ou ligne mise en cache avant l'ajout du résumé : à résoudre en arrière-plan.
    this.scheduleResolution(slugs.filter((s) => !bySlug.has(s) || bySlug.get(s)!.description === null));
    return { server, serverIssue, source, inlineEntries, listingExists: exists, composeLine: COMPOSE_LINE, restartRequired: modrinthPending || manualPending, modrinth, unmanagedLines, manual };
  }

  /**
   * Ce que le dernier démarrage a installé, et si un redémarrage est attendu.
   * - Liste inline : `projects` du manifeste contient les entrées, comparées par slug.
   * - Fichier de liste : `projects` ne contient que `@/data/…` (mc-image-helper n'y met pas les entrées
   *   développées) ; on compare alors la date du manifeste à celle du fichier. Manifeste plus récent =
   *   la liste courante a été appliquée (les actives sont installées) et on mémorise ces slugs en base ;
   *   fichier plus récent = redémarrage attendu, l'état installé est celui mémorisé au dernier démarrage.
   */
  private async installedState(manifest: ModrinthManifest | null, active: Set<string>): Promise<{ installed: Set<string>; pending: boolean }> {
    if (!manifest) return { installed: new Set(), pending: active.size > 0 };
    if (!manifest.projects.some((p) => p.startsWith('@'))) {
      const installed = new Set(manifest.projects.map(slugOf));
      return { installed, pending: installed.size !== active.size || [...active].some((s) => !installed.has(s)) };
    }
    const listingMtime = await stat(this.listingPath).then((s) => s.mtimeMs, () => Infinity);
    if (listingMtime <= manifest.timestamp.getTime()) {
      await this.saveApplied(active);
      return { installed: new Set(active), pending: false };
    }
    return { installed: await this.loadApplied(), pending: true };
  }

  private async loadApplied(): Promise<Set<string>> {
    const row = await this.deps.prisma.appSetting.findUnique({ where: { key: APPLIED_KEY } });
    try { const v: unknown = row ? JSON.parse(row.value) : []; return new Set(Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []); }
    catch { return new Set(); }
  }

  private async saveApplied(slugs: Set<string>): Promise<void> {
    const value = JSON.stringify([...slugs].sort());
    const row = await this.deps.prisma.appSetting.findUnique({ where: { key: APPLIED_KEY } });
    if (row?.value === value) return;
    await this.deps.prisma.appSetting.upsert({ where: { key: APPLIED_KEY }, create: { key: APPLIED_KEY, value }, update: { value } });
  }

  /** Jars du dossier non gérés par Modrinth (ni le .jar ni son .jar.disabled n'est dans le manifeste). */
  protected async listManual(dir: ModsDir, manifestFiles: Set<string>, loader: string): Promise<ManualMod[]> {
    const abs = path.join(this.deps.dataDir, dir);
    let entries: Dirent[];
    try { entries = await readdir(abs, { withFileTypes: true }); }
    catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []; throw err; }
    type Form = { size: number; mtime: Date; mtimeMs: number; path: string };
    const byBase = new Map<string, { enabled?: Form; disabled?: Form }>();
    for (const d of entries) {
      if (!d.isFile()) continue;
      const n = d.name;
      const on = n.endsWith('.jar');
      if (!on && !n.endsWith('.jar.disabled')) continue;
      const base = on ? n : n.slice(0, -'.disabled'.length);
      if (manifestFiles.has(`${dir}/${base}`)) continue;
      let st: Stats;
      // Un jar peut disparaître entre readdir et stat : l'image supprime et retélécharge au démarrage du conteneur.
      try { st = await stat(path.join(abs, n)); }
      catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; throw err; }
      const rec = byBase.get(base) ?? {};
      rec[on ? 'enabled' : 'disabled'] = { size: st.size, mtime: st.mtime, mtimeMs: st.mtimeMs, path: path.join(abs, n) };
      byBase.set(base, rec);
    }
    const out: ManualMod[] = [];
    for (const [file, r] of [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const info = r.enabled ?? r.disabled!;
      out.push({ file, enabled: !!r.enabled, size: info.size, mtime: info.mtime.toISOString(), conflict: !!r.enabled && !!r.disabled, meta: await this.jarMeta(info.path, info.size, info.mtimeMs, dir, loader) });
    }
    return out;
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

  protected async cacheProject(slug: string, info: { id: string; title: string; description: string | null; iconUrl: string | null }): Promise<void> {
    const data = { projectId: info.id, title: info.title, description: info.description, iconUrl: info.iconUrl, fetchedAt: new Date() };
    await this.deps.prisma.modrinthProject.upsert({ where: { slug }, create: { slug, ...data }, update: data });
  }

  private fail(status: number, code: string, message: string): never { throw new AppError(status, message, undefined, code); }

  private searchCache = new Map<string, { at: number; hits: Omit<ModrinthSearchHit, 'alreadyListed'>[] }>();

  /** Version MC pour filtrer la recherche : logs du serveur, sinon VERSION du conteneur si numérique, sinon null. */
  private gameVersion(env: string[]): string | null {
    const running = this.deps.gameVersion?.() ?? null;
    if (running && VERSION_RE.test(running)) return running;
    const v = (envMap(env).get('VERSION') ?? '').trim();
    return VERSION_RE.test(v) ? v : null;
  }

  /** Recherche dans le catalogue Modrinth, filtrée sur le loader (et la version MC si connue), cache 60 s par requête. */
  async search(raw: string): Promise<ModsSearchResult> {
    const q = raw.trim().slice(0, 100);
    if (q.length < 2) this.fail(400, 'invalid_query', 'Query must have at least 2 characters');
    const inspect = await this.inspect();
    const server = inspect ? serverTypeOf(inspect.env) : null;
    if (!server || !inspect) this.fail(409, 'unsupported_server', 'Mods are only managed for modded or plugin servers (TYPE=FABRIC, PAPER, ...)');
    const gameVersion = this.gameVersion(inspect.env);
    const key = `${q}\u0000${server.loader}\u0000${gameVersion ?? ''}`;
    const now = Date.now();
    let entry = this.searchCache.get(key);
    if (!entry || entry.at + SEARCH_TTL_MS < now) {
      let hits;
      try { hits = await this.deps.modrinth.search(q, { loader: server.loader, gameVersion, limit: SEARCH_LIMIT }); }
      catch (err) { if (err instanceof ModrinthUnavailable) this.fail(502, 'modrinth_unavailable', err.message); throw err; }
      entry = { at: now, hits };
      this.searchCache.delete(key);
      this.searchCache.set(key, entry);
      while (this.searchCache.size > SEARCH_CACHE_MAX) this.searchCache.delete(this.searchCache.keys().next().value!);
    }
    // alreadyListed est recalculé à chaque appel : le fichier a pu changer depuis la mise en cache.
    const listed = new Set((await readListing(this.listingPath)).lines.filter(isManaged).map((l) => slugOf(l.entry)));
    return { loader: server.loader, gameVersion, hits: entry.hits.map((h) => ({ ...h, alreadyListed: listed.has(h.slug) })) };
  }

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
      const manual = await this.listManual(server.dir, new Set(manifest?.files ?? []), server.loader);
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

  /**
   * Dépôt d'un jar : corps streamé dans mc-manager/tmp (limite stricte, hors verrou), inspection du
   * descripteur, puis déplacement atomique dans le dossier des mods sous verrou. Jamais d'écrasement
   * d'un jar géré par Modrinth ; le temporaire est toujours supprimé.
   */
  async upload(opts: { name: string; replace: boolean; declaredSize: number; body: Readable }): Promise<void> {
    const { name } = opts;
    if (!isUploadName(name)) this.fail(400, 'invalid_name', 'Invalid jar file name');
    const server = await this.requireServer();
    if (!Number.isInteger(opts.declaredSize) || opts.declaredSize < 1 || opts.declaredSize > MAX_UPLOAD_BYTES) this.fail(413, 'too_large', `Jar files are limited to ${MAX_UPLOAD_BYTES} bytes`);
    await mkdir(this.tmpDir, { recursive: true }).catch((err) => { throw mapWriteError(err, this.tmpDir, this.deps.dataDir); });
    const tmp = path.join(this.tmpDir, `${randomUUID()}.part`);
    try {
      try { await pipeline(opts.body, limited(MAX_UPLOAD_BYTES), createWriteStream(tmp)); }
      catch (err) {
        if (err instanceof TooLarge) this.fail(413, 'too_large', `Jar files are limited to ${MAX_UPLOAD_BYTES} bytes`);
        this.fail(400, 'upload_aborted', `Upload interrupted: ${(err as Error).message}`);
      }
      let info;
      try { info = await inspectJar(tmp); }
      catch (err) { if (err instanceof JarError) this.fail(422, 'not_a_jar', 'The file is not a valid jar archive'); throw err; }
      const picked = pickLoader(info, server.dir, server.loader);
      if (!picked) throw new AppError(422, `This jar is not a ${server.loader} ${server.dir === 'plugins' ? 'plugin' : 'mod'}`, info.found[0]?.loader ?? 'none', 'wrong_loader');
      await this.withLock(async () => {
        const manifest = await readManifest(this.deps.dataDir);
        const files = new Set(manifest?.files ?? []);
        if (files.has(`${server.dir}/${name}`)) this.fail(409, 'managed', `${name} is managed by Modrinth: remove it from the list instead`);
        const manual = await this.listManual(server.dir, files, server.loader);
        const existing = manual.find((m) => m.file === name);
        if (existing && !opts.replace) this.fail(409, 'exists', `${name} already exists`);
        const id = picked.meta?.id;
        const other = id ? manual.find((m) => m.file !== name && m.meta?.id === id) : undefined;
        if (other) throw new AppError(409, `Mod ${id} is already provided by ${other.file}`, other.file, 'duplicate_mod');
        const dir = path.join(this.deps.dataDir, server.dir);
        try {
          await mkdir(dir, { recursive: true });
          // rename écrase la destination (c'est le remplacement). La forme .disabled n'est retirée qu'après :
          // si le rename échoue, l'ancien jar désactivé est toujours là.
          await rename(tmp, path.join(dir, name));
          if (opts.replace) await rm(path.join(dir, `${name}.disabled`), { force: true });
        } catch (err) { throw mapWriteError(err, path.join(dir, name), dir); }
        this.metaCache.delete(path.join(dir, name));
        this.lastFileWriteAt = new Date();
        return { changed: true, result: undefined };
      });
    } finally { await rm(tmp, { force: true }).catch(() => undefined); }
  }

  /** Supprime définitivement un jar manuel (ses deux formes si présentes) ; jamais un jar géré par Modrinth. */
  async deleteFile(file: string): Promise<void> {
    if (!/^[^/\\]+\.jar$/.test(file) || file.includes('..') || path.basename(file) !== file) this.fail(404, 'not_found', 'Unknown file');
    const server = await this.requireServer();
    await this.withLock(async () => {
      const manifest = await readManifest(this.deps.dataDir);
      const manual = await this.listManual(server.dir, new Set(manifest?.files ?? []), server.loader);
      if (!manual.some((m) => m.file === file)) this.fail(404, 'not_found', 'Unknown file');
      const dir = path.join(this.deps.dataDir, server.dir);
      try { await rm(path.join(dir, file), { force: true }); await rm(path.join(dir, `${file}.disabled`), { force: true }); }
      catch (err) { throw mapWriteError(err, path.join(dir, file), dir); }
      this.metaCache.delete(path.join(dir, file)); this.metaCache.delete(path.join(dir, `${file}.disabled`));
      this.lastFileWriteAt = new Date();
      return { changed: true, result: undefined };
    });
  }
}
