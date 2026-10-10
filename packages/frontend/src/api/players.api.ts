import api from './client';
import type { OnlinePlayer, Page, PlayerSheet, PlayerSummary, ServerLists } from '@mc/common';

export const playersApi = {
  online: (): Promise<Page<OnlinePlayer>> => api.get('/players', { params: { online: 1 } }).then((r) => r.data),
  list: (p: { q?: string; page: number; limit: number }): Promise<Page<PlayerSummary>> => api.get('/players', { params: p }).then((r) => r.data),
  sheet: (uuid: string): Promise<PlayerSheet> => api.get(`/players/${encodeURIComponent(uuid)}`).then((r) => r.data),
  kick: (name: string, reason?: string) => api.post(`/players/${encodeURIComponent(name)}/kick`, { reason }),
  ban: (name: string, reason?: string) => api.post(`/players/${encodeURIComponent(name)}/ban`, { reason }),
  pardon: (name: string) => api.post(`/players/${encodeURIComponent(name)}/pardon`),
  op: (name: string) => api.post(`/players/${encodeURIComponent(name)}/op`),
  deop: (name: string) => api.post(`/players/${encodeURIComponent(name)}/deop`),
  /** Bannit l'IP de la session en cours d'un joueur en ligne (l'IP reste côté serveur). */
  banIp: (name: string, reason?: string) => api.post(`/players/${encodeURIComponent(name)}/ban-ip`, { reason }),
  banIpAddress: (ip: string, reason?: string) => api.post('/bans/ip', { ip, reason }),
  pardonIp: (ip: string) => api.delete(`/bans/ip/${encodeURIComponent(ip)}`),
  lists: (): Promise<ServerLists> => api.get('/lists').then((r) => r.data),
  whitelistAdd: (name: string) => api.post(`/whitelist/${encodeURIComponent(name)}`),
  whitelistRemove: (name: string) => api.delete(`/whitelist/${encodeURIComponent(name)}`),
  whitelistEnabled: (enabled: boolean) => api.put('/whitelist/enabled', { enabled }),
};
