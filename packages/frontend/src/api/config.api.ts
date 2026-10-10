import api from './client';
import type { ServerPropertiesUpdate, ServerPropertiesView } from '@mc/common';
export const configApi = {
  get: (): Promise<ServerPropertiesView> => api.get('/server/properties').then((r) => r.data),
  save: (update: ServerPropertiesUpdate): Promise<ServerPropertiesView> => api.put('/server/properties', update).then((r) => r.data),
};
