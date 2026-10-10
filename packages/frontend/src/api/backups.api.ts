import api from './client';
import type { BackupList } from '@mc/common';
export const backupsApi = {
  list: (): Promise<BackupList> => api.get('/backups').then((r) => r.data),
  run: () => api.post('/backups/run'),
  remove: (name: string) => api.delete(`/backups/${encodeURIComponent(name)}`),
  download: async (name: string) => {
    const res = await api.get(`/backups/${encodeURIComponent(name)}/download`, { responseType: 'blob', timeout: 0 });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  },
};
