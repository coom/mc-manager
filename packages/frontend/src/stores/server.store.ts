import { create } from 'zustand';
import type { LogLine, ServerInfo, WsMessage } from '@mc/common';

export const LOG_CAP = 2000;

interface ServerStore {
  info: ServerInfo | null;
  logs: LogLine[];
  backupOutput: string[];
  backupRunning: boolean;
  connected: boolean;
  setConnected: (v: boolean) => void;
  startBackupOutput: () => void;
  apply: (msg: WsMessage) => void;
  reset: () => void;
}

export const useServerStore = create<ServerStore>()((set) => ({
  info: null, logs: [], backupOutput: [], backupRunning: false, connected: false,
  setConnected: (connected) => set({ connected }),
  startBackupOutput: () => set({ backupOutput: [], backupRunning: true }),
  reset: () => set({ info: null, logs: [], backupOutput: [], backupRunning: false }),
  apply: (msg) => set((s) => {
    switch (msg.type) {
      case 'server.status':
      case 'metrics.tick': return { info: msg.info };
      case 'log.history': return { logs: msg.lines.slice(-LOG_CAP) };
      case 'log.line': { const logs = s.logs.length >= LOG_CAP ? s.logs.slice(s.logs.length - LOG_CAP + 1) : s.logs; return { logs: [...logs, msg.line] }; }
      case 'backup.progress': return { backupOutput: [...s.backupOutput, msg.line], backupRunning: true };
      case 'backup.done': return { backupRunning: false };
      default: return {};
    }
  }),
}));
