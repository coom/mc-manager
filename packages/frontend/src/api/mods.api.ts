import api from './client';
import type { ModsSearchQuery, ModsSearchResult, ModsView } from '@mc/common';

const data = (p: Promise<{ data: ModsView }>): Promise<ModsView> => p.then((r) => r.data);

export const modsApi = {
  get: (): Promise<ModsView> => data(api.get('/mods')),
  import: (): Promise<ModsView> => data(api.post('/mods/import')),
  add: (entry: string): Promise<ModsView> => data(api.post('/mods/modrinth', { entry })),
  toggle: (entry: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/modrinth/${encodeURIComponent(entry)}`, { enabled })),
  remove: (entry: string): Promise<ModsView> => data(api.delete(`/mods/modrinth/${encodeURIComponent(entry)}`)),
  toggleFile: (file: string, enabled: boolean): Promise<ModsView> => data(api.patch(`/mods/files/${encodeURIComponent(file)}`, { enabled })),
  deleteFile: (file: string): Promise<ModsView> => data(api.delete(`/mods/files/${encodeURIComponent(file)}`)),
  /** Recherche (`q`, tri `relevance`) ou navigation (`index` ≠ relevance, `offset`, `category`) dans le catalogue Modrinth. */
  search: (params: ModsSearchQuery, signal?: AbortSignal): Promise<ModsSearchResult> => api.get('/mods/search', { params, signal }).then((r) => r.data),
  /** Corps brut, pas de timeout (gros fichiers), progression et annulation. */
  upload: (file: File, opts: { replace?: boolean; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<ModsView> =>
    data(api.post('/mods/upload', file, {
      params: { name: file.name, ...(opts.replace ? { replace: 1 } : {}) },
      headers: { 'Content-Type': 'application/java-archive' },
      timeout: 0,
      signal: opts.signal,
      onUploadProgress: (e) => opts.onProgress?.(e.total ? e.loaded / e.total : 0),
    })),
};
