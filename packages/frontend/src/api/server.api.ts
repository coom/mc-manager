import api from './client';
import type { ServerInfo } from '@mc/common';
export const serverApi = {
  get: (): Promise<ServerInfo> => api.get('/server').then((r) => r.data),
  start: () => api.post('/server/start'),
  stop: () => api.post('/server/stop'),
  restart: () => api.post('/server/restart'),
  command: (command: string): Promise<{ response: string }> => api.post('/server/command', { command }).then((r) => r.data),
};
