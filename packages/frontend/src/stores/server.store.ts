import { create } from 'zustand';
import type { LogLine, RestoreResult, ServerInfo, WsMessage } from '@mc/common';

export const LOG_CAP = 2000;

interface ServerStore {
  info: ServerInfo | null;
  logs: LogLine[];
  backupOutput: string[];
  backupRunning: boolean;
  restoreOutput: string[];
  restoreRunning: boolean;
  restoreResult: RestoreResult | null;
  connected: boolean;
  setConnected: (v: boolean) => void;
  startBackupOutput: () => void;
  startRestoreOutput: () => void;
  apply: (msg: WsMessage) => void;
  reset: () => void;
}

export const useServerStore = create<ServerStore>()((set) => ({
  info: null, logs: [], backupOutput: [], backupRunning: false, restoreOutput: [], restoreRunning: false, restoreResult: null, connected: false,
  setConnected: (connected) => set({ connected }),
  startBackupOutput: () => set({ backupOutput: [], backupRunning: true, restoreOutput: [], restoreRunning: false, restoreResult: null }),
  startRestoreOutput: () => set({ restoreOutput: [], restoreRunning: true, restoreResult: null, backupOutput: [], backupRunning: false }),
  reset: () => set({ info: null, logs: [], backupOutput: [], backupRunning: false, restoreOutput: [], restoreRunning: false, restoreResult: null }),
  apply: (msg) => set((s) => {
    switch (msg.type) {
      case 'server.status':
      case 'metrics.tick': return { info: msg.info };
      case 'log.history': return { logs: msg.lines.slice(-LOG_CAP) };
      case 'log.line': { const logs = s.logs.length >= LOG_CAP ? s.logs.slice(s.logs.length - LOG_CAP + 1) : s.logs; return { logs: [...logs, msg.line] }; }
      case 'backup.progress': return { backupOutput: [...s.backupOutput, msg.line], backupRunning: true };
      case 'backup.done': return { backupRunning: false };
      case 'restore.progress': return { restoreOutput: [...s.restoreOutput, `[${msg.step}] ${msg.line}`], restoreRunning: true };
      case 'restore.done': return { restoreRunning: false, restoreResult: { ok: msg.ok, message: msg.message, safetyBackup: msg.safetyBackup } };
      default: return {};
    }
  }),
}));
