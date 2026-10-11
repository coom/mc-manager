export interface ModrinthProjectInfo { id: string; slug: string; title: string; description: string | null; iconUrl: string | null; projectType: string; loaders: string[] }
export interface RawSearchHit { slug: string; projectId: string; title: string; description: string | null; iconUrl: string | null; author: string | null; downloads: number; follows: number; latestVersion: string | null }
export interface SearchOpts { loader: string; gameVersion: string | null; limit: number }

export interface ModrinthLike {
  /** null si le projet n'existe pas ; lève ModrinthUnavailable si l'API ne répond pas correctement. */
  getProject(slug: string): Promise<ModrinthProjectInfo | null>;
  /** Recherche de projets de type mod pour un loader (et une version MC si connue). */
  search(q: string, opts: SearchOpts): Promise<RawSearchHit[]>;
}

export class ModrinthUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ModrinthUnavailable'; }
}

const BASE = 'https://api.modrinth.com/v2';
/** Modrinth demande un User-Agent identifiant l'application et un contact. */
const USER_AGENT = 'mc-manager (https://github.com/coom/mc-manager)';
const TIMEOUT_MS = 10_000;

async function request(fetchFn: typeof fetch, url: string): Promise<Response> {
  try { return await fetchFn(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (err) { throw new ModrinthUnavailable(`Modrinth request failed: ${(err as Error).message}`); }
}
async function body(res: Response): Promise<unknown> {
  if (!res.ok) throw new ModrinthUnavailable(`Modrinth answered ${res.status}`);
  try { return await res.json(); } catch { throw new ModrinthUnavailable('Modrinth answered with invalid JSON'); }
}
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const optStr = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);

export function realModrinth(fetchFn: typeof fetch = fetch): ModrinthLike {
  return {
    async getProject(slug) {
      const res = await request(fetchFn, `${BASE}/project/${encodeURIComponent(slug)}`);
      if (res.status === 404) return null;
      const b = (await body(res)) as Record<string, unknown>;
      if (!b || typeof b.id !== 'string' || typeof b.slug !== 'string' || typeof b.title !== 'string' || typeof b.project_type !== 'string') throw new ModrinthUnavailable('Modrinth answered with an unexpected payload');
      return {
        id: b.id, slug: b.slug, title: b.title,
        description: optStr(b.description),
        iconUrl: optStr(b.icon_url),
        projectType: b.project_type,
        loaders: Array.isArray(b.loaders) ? b.loaders.filter((l): l is string => typeof l === 'string') : [],
      };
    },
    async search(q, opts) {
      const facets: string[][] = [['project_type:mod'], [`categories:${opts.loader}`]];
      if (opts.gameVersion) facets.push([`versions:${opts.gameVersion}`]);
      const params = new URLSearchParams({ query: q, limit: String(opts.limit), index: 'relevance', facets: JSON.stringify(facets) });
      const b = (await body(await request(fetchFn, `${BASE}/search?${params}`))) as { hits?: unknown };
      if (!b || !Array.isArray(b.hits)) throw new ModrinthUnavailable('Modrinth answered with an unexpected payload');
      return b.hits.flatMap((h: unknown): RawSearchHit[] => {
        const r = h as Record<string, unknown>;
        if (typeof r.slug !== 'string' || typeof r.project_id !== 'string' || typeof r.title !== 'string') return [];
        return [{ slug: r.slug, projectId: r.project_id, title: r.title, description: optStr(r.description), iconUrl: optStr(r.icon_url), author: optStr(r.author), downloads: num(r.downloads), follows: num(r.follows), latestVersion: optStr(r.latest_version) }];
      });
    },
  };
}
