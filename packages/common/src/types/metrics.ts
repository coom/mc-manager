export type MetricsRange = '24h' | '7d' | '30d';
export interface MetricPoint {
  at: string;
  players: number | null;
  playersMax?: number | null;
  cpuPercent: number | null;
  memUsed: number | null;
  mspt: number | null;
}
export interface MetricsResponse { range: MetricsRange; points: MetricPoint[] }
