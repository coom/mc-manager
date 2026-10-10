import api from './client';

export interface UserRow {
  id: number; username: string; displayName: string; role: 'admin' | 'viewer';
  enabled: boolean; createdAt: string; lastLoginAt: string | null; mfaEnabled: boolean; mfaRequired: boolean;
}

export const usersApi = {
  list: (): Promise<UserRow[]> => api.get('/users').then((r) => r.data),
  create: (data: { username: string; password: string; displayName: string; role: string; mfaRequired?: boolean; mustChangePassword?: boolean }) =>
    api.post('/users', data).then((r) => r.data),
  update: (id: number, data: Partial<{ displayName: string; role: string; enabled: boolean; password: string; mfaRequired: boolean; mustChangePassword: boolean; resetMfa: boolean }>) =>
    api.put(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  passwordPolicy: (): Promise<{ minLength: number; requireComplexity: boolean }> => api.get('/users/password-policy').then((r) => r.data),
  updatePasswordPolicy: (data: { minLength: number; requireComplexity: boolean }) => api.put('/users/password-policy', data).then((r) => r.data),
};
