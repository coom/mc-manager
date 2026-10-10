import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import Backups from './Backups';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { backupsApi } from '@/api/backups.api';

vi.mock('@/api/backups.api', () => ({
  backupsApi: { list: vi.fn(), run: vi.fn(), remove: vi.fn(), download: vi.fn() },
}));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><Backups /></QueryClientProvider>);
}

describe('Backups page run failure', () => {
  beforeEach(() => {
    useServerStore.getState().reset();
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
    vi.mocked(backupsApi.list).mockResolvedValue({ entries: [], totalBytes: 0, running: false });
  });

  it('resets backupRunning when run fails with a non-409 error', async () => {
    vi.mocked(backupsApi.run).mockRejectedValue({ response: { status: 500, data: { error: 'boom' } } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /backup now/i }));
    await waitFor(() => expect(backupsApi.run).toHaveBeenCalled());
    await waitFor(() => expect(useServerStore.getState().backupRunning).toBe(false));
  });

  it('keeps backupRunning on 409', async () => {
    vi.mocked(backupsApi.run).mockRejectedValue({ response: { status: 409, data: { error: 'busy' } } });
    setup();
    fireEvent.click(await screen.findByRole('button', { name: /backup now/i }));
    await waitFor(() => expect(backupsApi.run).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(useServerStore.getState().backupRunning).toBe(true);
  });
});
