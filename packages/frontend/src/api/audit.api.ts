import api from './client';
import type { AuditPage } from '@mc/common';
export const auditApi = { list: (p: { page: number; pageSize: number; action?: string; user?: string }): Promise<AuditPage> => api.get('/audit', { params: p }).then((r) => r.data) };
