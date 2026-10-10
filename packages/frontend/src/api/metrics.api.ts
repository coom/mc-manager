import api from './client';
import type { MetricsRange, MetricsResponse } from '@mc/common';
export const metricsApi = { series: (range: MetricsRange): Promise<MetricsResponse> => api.get('/metrics', { params: { range } }).then((r) => r.data) };
