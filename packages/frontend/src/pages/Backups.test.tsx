import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import Backups from './Backups';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { backupsApi } from '@/api/backups.api';

import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/backups.api', () => ({
  backupsApi: { list: vi.fn(), run: vi.fn(), remove: vi.fn(), download: vi.fn(), restore: vi.fn(), restoreStatus: vi.fn() },
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

  it('downloads through the link API and toasts the server error when it fails', async () => {
    vi.mocked(backupsApi.list).mockResolvedValue({ entries: [{ name: 'w.tgz', size: 10, modifiedAt: '2026-10-10T10:00:00Z' }], totalBytes: 10, running: false });
    vi.mocked(backupsApi.download).mockRejectedValue({ response: { status: 404, data: { error: 'Backup not found' } } });
    setup();
    fireEvent.click(await screen.findByLabelText('download'));
    expect(backupsApi.download).toHaveBeenCalledWith('w.tgz');
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Backup not found'));
  });
});

describe('Backups page restore', () => {
  const entry = { name: 'w.tgz', size: 10, modifiedAt: '2026-10-10T10:00:00Z' };
  beforeEach(() => {
    useServerStore.getState().reset();
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
    vi.mocked(backupsApi.list).mockResolvedValue({ entries: [entry], totalBytes: 10, running: false });
    vi.mocked(backupsApi.restoreStatus).mockResolvedValue({ running: false, step: null });
    vi.mocked(backupsApi.restore).mockResolvedValue({} as never);
  });

  it('admin restores with the default options after confirming', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    setup();
    fireEvent.click(await screen.findByLabelText('restore'));
    expect(await screen.findByText('Restore w.tgz?')).toBeInTheDocument();
    expect(screen.queryByText(/without a safety net/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(backupsApi.restore).toHaveBeenCalledWith('w.tgz', { startAfter: true, confirmNoSafetyBackup: false }));
    expect(useServerStore.getState().restoreRunning).toBe(true);
  });

  it('with the server stopped, requires the explicit no-safety confirmation', async () => {
    useServerStore.setState({ info: { status: 'stopped', containerName: 'mc' } as never });
    setup();
    fireEvent.click(await screen.findByLabelText('restore'));
    expect(await screen.findByText(/without a safety net/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/I understand/));
    fireEvent.click(screen.getByLabelText('Start the server afterwards'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(backupsApi.restore).toHaveBeenCalledWith('w.tgz', { startAfter: false, confirmNoSafetyBackup: true }));
  });

  it('viewer has no restore button; a running restore disables run and restore', async () => {
    useAuthStore.setState({ user: { id: 2, username: 'v', displayName: 'V', role: 'viewer' } });
    setup();
    await screen.findByText('w.tgz');
    expect(screen.queryByLabelText('restore')).not.toBeInTheDocument();
  });

  it('shows the progress panel, then the failure with the safety backup name', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    setup();
    await screen.findByText('w.tgz');
    act(() => { useServerStore.getState().startRestoreOutput(); useServerStore.getState().apply({ type: 'restore.progress', step: 'stop', line: 'stopping the server' }); });
    expect(screen.getByText('Restore in progress…')).toBeInTheDocument();
    expect(screen.getByLabelText('restore')).toBeDisabled();
    act(() => { useServerStore.getState().apply({ type: 'restore.done', ok: false, message: 'partial restore: boom', safetyBackup: 'safe.tgz' }); });
    expect(screen.getByText('Restore failed')).toBeInTheDocument();
    expect(screen.getByText('Safety backup: safe.tgz')).toBeInTheDocument();
  });

  it('surfaces the server error on a refused restore and releases the running state', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    vi.mocked(backupsApi.restore).mockRejectedValue({ response: { status: 409, data: { error: 'Another operation is running: backup' } } });
    setup();
    fireEvent.click(await screen.findByLabelText('restore'));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Another operation is running: backup'));
    expect(useServerStore.getState().restoreRunning).toBe(false);
  });
});
