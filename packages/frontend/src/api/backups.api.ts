import api from './client';
import type { BackupList, BackupSettings, BackupSettingsUpdate, RestoreRequest, RestoreStatus } from '@mc/common';
export const backupsApi = {
  list: (): Promise<BackupList> => api.get('/backups').then((r) => r.data),
  settings: (): Promise<BackupSettings> => api.get('/backups/settings').then((r) => r.data),
  updateSettings: (body: BackupSettingsUpdate): Promise<BackupSettings> => api.put('/backups/settings', body).then((r) => r.data),
  run: () => api.post('/backups/run'),
  restore: (name: string, req: RestoreRequest) => api.post(`/backups/${encodeURIComponent(name)}/restore`, req),
  restoreStatus: (): Promise<RestoreStatus> => api.get('/backups/restore/status').then((r) => r.data),
  dismissInterrupted: () => api.delete('/backups/restore/interrupted'),
  remove: (name: string) => api.delete(`/backups/${encodeURIComponent(name)}`),
  /** Obtient un lien court à usage unique puis laisse le navigateur télécharger (pas de blob en mémoire). */
  download: async (name: string) => {
    const { data } = await api.post<{ url: string }>(`/backups/${encodeURIComponent(name)}/link`);
    const a = document.createElement('a'); a.href = data.url; a.download = name; a.click();
  },
};
