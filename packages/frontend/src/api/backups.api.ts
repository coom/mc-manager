import api from './client';
import type { BackupList } from '@mc/common';
export const backupsApi = {
  list: (): Promise<BackupList> => api.get('/backups').then((r) => r.data),
  run: () => api.post('/backups/run'),
  remove: (name: string) => api.delete(`/backups/${encodeURIComponent(name)}`),
  /** Obtient un lien court à usage unique puis laisse le navigateur télécharger (pas de blob en mémoire). */
  download: async (name: string) => {
    const { data } = await api.post<{ url: string }>(`/backups/${encodeURIComponent(name)}/link`);
    const a = document.createElement('a'); a.href = data.url; a.download = name; a.click();
  },
};
