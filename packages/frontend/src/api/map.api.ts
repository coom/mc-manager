import api from './client';
import type { MapSettings } from '@mc/common';

export const mapApi = {
  get: (): Promise<MapSettings> => api.get('/map').then((r) => r.data),
  /** Chaîne vide = effacement. */
  set: (url: string): Promise<MapSettings> => api.put('/map', { url }).then((r) => r.data),
};
