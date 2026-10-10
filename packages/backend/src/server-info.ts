import type { ServerInfo, ServerStats, ServerStatus } from '@mc/common';
import type { LatestMetrics } from './metrics/collector.js';

export interface ServerInfoDeps {
  /** État courant de DockerService (suit les événements, garde 'stopping' pendant un arrêt). */
  getStatus: () => ServerStatus;
  /** Utilisé seulement pour startedAt et pour détecter l'absence du conteneur. */
  inspectServer: () => Promise<{ startedAt: string | null } | null>;
  stats: () => Promise<ServerStats>;
  latest: () => Partial<LatestMetrics> | undefined;
  containerName: string;
}

const NULL_STATS: ServerStats = { cpuPercent: null, memUsed: null, memLimit: null };

/** Compose la réponse de GET /api/server et des messages server.status / metrics.tick. Ne lève jamais. */
export async function buildServerInfo(deps: ServerInfoDeps): Promise<ServerInfo> {
  const i = await deps.inspectServer().catch(() => null);
  const stats = await deps.stats().catch(() => NULL_STATS);
  const startedAt = i?.startedAt ?? null;
  const latest = deps.latest() ?? {};
  return {
    status: i ? deps.getStatus() : 'unavailable',
    message: i ? undefined : `Container "${deps.containerName}" not found or Docker socket unreachable`,
    containerName: deps.containerName,
    startedAt,
    uptimeSeconds: startedAt ? Math.floor((Date.now() - Date.parse(startedAt)) / 1000) : null,
    version: latest.version ?? null,
    players: latest.players ?? null,
    mspt: latest.mspt ?? null,
    tps: latest.tps ?? null,
    stats,
    worldBytes: latest.worldBytes ?? null,
    diskFree: latest.diskFree ?? null,
  };
}
