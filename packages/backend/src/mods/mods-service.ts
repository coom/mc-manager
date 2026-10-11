import { readdir, stat } from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import type { ManualMod, ModsDir, ModsView, ModrinthMod, WsMessage } from '@mc/common';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { DockerService } from '../docker/docker-service.js';
import type { DataLock } from '../data/data-lock.js';
import { logger } from '../utils/logger.js';
import { serverTypeOf, modrinthSource, COMPOSE_LINE, LISTING_RELATIVE } from './server-type.js';
import { readListing, isManaged, slugOf } from './listing-file.js';
import { readManifest } from './manifest.js';
import type { ModrinthLike } from './modrinth-client.js';

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
}
