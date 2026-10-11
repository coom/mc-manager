import { ModrinthUnavailable, type ModrinthLike, type ModrinthProjectInfo } from './modrinth-client.js';

export class FakeModrinth implements ModrinthLike {
  projects = new Map<string, ModrinthProjectInfo>();
  /** true : toute requête lève ModrinthUnavailable. */
  down = false;
  calls: string[] = [];
  add(p: Partial<ModrinthProjectInfo> & { slug: string }): void {
    this.projects.set(p.slug, { id: p.id ?? `id-${p.slug}`, slug: p.slug, title: p.title ?? p.slug, iconUrl: p.iconUrl ?? null, projectType: p.projectType ?? 'mod', loaders: p.loaders ?? ['fabric'] });
  }
  async getProject(slug: string): Promise<ModrinthProjectInfo | null> {
    this.calls.push(slug);
    if (this.down) throw new ModrinthUnavailable('fake down');
    return this.projects.get(slug) ?? null;
  }
}
