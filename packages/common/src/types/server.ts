export type ServerStatus = 'unavailable' | 'stopped' | 'starting' | 'ready' | 'unhealthy' | 'stopping';

export interface ServerStats {
  cpuPercent: number | null;
  memUsed: number | null;
  memLimit: number | null;
}

export interface ServerInfo {
  status: ServerStatus;
  message?: string;
  containerName: string;
  startedAt: string | null;
  uptimeSeconds: number | null;
  version: string | null;
  players: { online: number; max: number; names: string[] } | null;
  mspt: number | null;
  tps: number | null;
  stats: ServerStats;
  worldBytes: number | null;
  diskFree: number | null;
}
