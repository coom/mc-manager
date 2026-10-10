import api from './client';
import type { JournalRetention, Page, PlayerLoginFailureEntry, PlayerSessionEntry, WebLoginEntry } from '@mc/common';

export interface JournalQuery { q?: string; from?: string; to?: string; page: number; limit: number }

export const journalApi = {
  players: (p: JournalQuery): Promise<Page<PlayerSessionEntry>> => api.get('/journal/players', { params: p }).then((r) => r.data),
  failures: (p: JournalQuery): Promise<Page<PlayerLoginFailureEntry>> => api.get('/journal/failures', { params: p }).then((r) => r.data),
  web: (p: JournalQuery): Promise<Page<WebLoginEntry>> => api.get('/journal/web', { params: p }).then((r) => r.data),
  retention: (): Promise<JournalRetention> => api.get('/journal/retention').then((r) => r.data),
  setRetention: (days: number): Promise<JournalRetention> => api.put('/journal/retention', { days }).then((r) => r.data),
};
