export interface ModrinthProjectInfo { id: string; slug: string; title: string; description: string | null; iconUrl: string | null; projectType: string; loaders: string[] }

export interface ModrinthLike {
  /** null si le projet n'existe pas ; lève ModrinthUnavailable si l'API ne répond pas correctement. */
  getProject(slug: string): Promise<ModrinthProjectInfo | null>;
}

export class ModrinthUnavailable extends Error {
  constructor(message: string) { super(message); this.name = 'ModrinthUnavailable'; }
}

const BASE = 'https://api.modrinth.com/v2';
/** Modrinth demande un User-Agent identifiant l'application et un contact. */
const USER_AGENT = 'mc-manager (https://github.com/coom/mc-manager)';
const TIMEOUT_MS = 10_000;

export function realModrinth(fetchFn: typeof fetch = fetch): ModrinthLike {
  return {
    async getProject(slug) {
      let res: Response;
      try {
        res = await fetchFn(`${BASE}/project/${encodeURIComponent(slug)}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) { throw new ModrinthUnavailable(`Modrinth request failed: ${(err as Error).message}`); }
      if (res.status === 404) return null;
      if (!res.ok) throw new ModrinthUnavailable(`Modrinth answered ${res.status}`);
      let body: unknown;
      try { body = await res.json(); } catch { throw new ModrinthUnavailable('Modrinth answered with invalid JSON'); }
      const b = body as Record<string, unknown>;
      if (!b || typeof b.id !== 'string' || typeof b.slug !== 'string' || typeof b.title !== 'string' || typeof b.project_type !== 'string') throw new ModrinthUnavailable('Modrinth answered with an unexpected payload');
      return {
        id: b.id, slug: b.slug, title: b.title,
        description: typeof b.description === 'string' && b.description.trim() ? b.description.trim() : null,
        iconUrl: typeof b.icon_url === 'string' ? b.icon_url : null,
        projectType: b.project_type,
        loaders: Array.isArray(b.loaders) ? b.loaders.filter((l): l is string => typeof l === 'string') : [],
      };
    },
  };
}
