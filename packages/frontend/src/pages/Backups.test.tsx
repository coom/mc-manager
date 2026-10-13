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
  backupsApi: {
    list: vi.fn(), run: vi.fn(), remove: vi.fn(), download: vi.fn(), restore: vi.fn(), restoreStatus: vi.fn(), dismissInterrupted: vi.fn(),
    settings: vi.fn(async () => ({ containerFound: false, running: false, managed: false, cronSchedule: null, interval: null, pruneDays: null, pendingRestart: false, initialDelay: '2m', backupOnStartup: true })),
    updateSettings: vi.fn(),
  },
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
    vi.mocked(backupsApi.restoreStatus).mockResolvedValue({ running: false, step: null, interrupted: null });
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

  it('viewer has no restore button', async () => {
    useAuthStore.setState({ user: { id: 2, username: 'v', displayName: 'V', role: 'viewer' } });
    setup();
    await screen.findByText('w.tgz');
    expect(screen.queryByLabelText('restore')).not.toBeInTheDocument();
    act(() => { useServerStore.getState().apply({ type: 'restore.done', ok: false, message: 'boom', safetyBackup: 'safe.tgz' }); });
    expect(screen.getByText('Safety backup: safe.tgz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this one' })).not.toBeInTheDocument();
  });

  it('shows the progress panel, then the failure with the safety backup name', async () => {
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    setup();
    await screen.findByText('w.tgz');
    act(() => { useServerStore.getState().startRestoreOutput(); useServerStore.getState().apply({ type: 'restore.progress', step: 'stop', line: 'stopping the server' }); });
    expect(screen.getByText('Restore in progress…')).toBeInTheDocument();
    expect(screen.getByLabelText('restore')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Backup now/ })).toBeDisabled();
    expect(screen.getByText('stopping: stopping the server')).toBeInTheDocument();
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

  it('clears a stuck restoreRunning when the server reports no restore running (missed restore.done)', async () => {
    useServerStore.setState({ restoreRunning: true, restoreOutput: ['[extract] world'] });
    setup();
    await waitFor(() => expect(useServerStore.getState().restoreRunning).toBe(false));
  });

  it('clears a stuck backupRunning when the list reports no backup running (missed backup.done)', async () => {
    useServerStore.setState({ backupRunning: true });
    setup();
    await waitFor(() => expect(useServerStore.getState().backupRunning).toBe(false));
  });
});

describe('Backups page interrupted restore', () => {
  const interrupted = { archive: 'world-a.tgz', safetyBackup: 'world-safe.tgz', startedAt: '2026-10-10T10:00:00Z' };
  beforeEach(() => {
    useServerStore.getState().reset();
    vi.mocked(backupsApi.list).mockResolvedValue({ entries: [{ name: 'world-safe.tgz', size: 10, modifiedAt: '2026-10-10T09:00:00Z' }], totalBytes: 10, running: false });
    vi.mocked(backupsApi.restoreStatus).mockResolvedValue({ running: false, step: null, interrupted });
    vi.mocked(backupsApi.dismissInterrupted).mockResolvedValue({} as never);
  });

  it('shows the warning with the safety backup and lets an admin restore it or dismiss', async () => {
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
    useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
    setup();
    expect(await screen.findByText('A restore was interrupted')).toBeInTheDocument();
    expect(screen.getByText(/The restore of world-a\.tgz did not finish/)).toBeInTheDocument();
    expect(screen.getByText('Safety backup: world-safe.tgz')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this one' }));
    expect(await screen.findByText('Restore world-safe.tgz?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(backupsApi.dismissInterrupted).toHaveBeenCalled());
  });

  it('shows the warning without action buttons to a viewer', async () => {
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 2, username: 'v', displayName: 'V', role: 'viewer' } });
    setup();
    expect(await screen.findByText('A restore was interrupted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this one' })).not.toBeInTheDocument();
  });
});
