import { ModrinthUnavailable, type ModrinthLike, type ModrinthProjectInfo, type RawSearchHit, type SearchOpts } from './modrinth-client.js';

export class FakeModrinth implements ModrinthLike {
  projects = new Map<string, ModrinthProjectInfo>();
  /** true : toute requête lève ModrinthUnavailable. */
  down = false;
  calls: string[] = [];
  /** Résultats renvoyés par search(), tronqués à `limit`. */
  hits: RawSearchHit[] = [];
  searches: { q: string; loader: string; gameVersion: string | null }[] = [];
  add(p: Partial<ModrinthProjectInfo> & { slug: string }): void {
    this.projects.set(p.slug, { id: p.id ?? `id-${p.slug}`, slug: p.slug, title: p.title ?? p.slug, description: p.description ?? null, iconUrl: p.iconUrl ?? null, projectType: p.projectType ?? 'mod', loaders: p.loaders ?? ['fabric'] });
  }
  async getProject(slug: string): Promise<ModrinthProjectInfo | null> {
    this.calls.push(slug);
    if (this.down) throw new ModrinthUnavailable('fake down');
    return this.projects.get(slug) ?? null;
  }
  async search(q: string, opts: SearchOpts): Promise<RawSearchHit[]> {
    this.searches.push({ q, loader: opts.loader, gameVersion: opts.gameVersion });
    if (this.down) throw new ModrinthUnavailable('fake down');
    return this.hits.slice(0, opts.limit);
  }
}
