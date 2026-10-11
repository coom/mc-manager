import api from './client';
import type { ModsView } from '@mc/common';

const data = (p: Promise<{ data: ModsView }>): Promise<ModsView> => p.then((r) => r.data);

export const modsApi = {
  get: (): Promise<ModsView> => data(api.get('/mods')),
  import: (): Promise<ModsView> => data(api.post('/mods/import')),
  add: (entry: string): Promise<ModsView> => data(api.post('/mods/modrinth', { entry })),
  toggle: (entry: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/modrinth/${encodeURIComponent(entry)}`, { enabled })),
  remove: (entry: string): Promise<ModsView> => data(api.delete(`/mods/modrinth/${encodeURIComponent(entry)}`)),
  toggleFile: (file: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/files/${encodeURIComponent(file)}`, { enabled })),
};
