import type { ServerInfo } from './types/server.js';
export interface LogLine { ts: string | null; level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'RAW'; thread: string | null; message: string; raw: string }
export type WsMessage =
  | { type: 'server.status'; info: ServerInfo }
  | { type: 'log.line'; line: LogLine }
  | { type: 'log.history'; lines: LogLine[] }
  | { type: 'metrics.tick'; info: ServerInfo }
  | { type: 'backup.progress'; line: string }
  | { type: 'backup.done'; exitCode: number }
  | { type: 'backup.list.changed' };
