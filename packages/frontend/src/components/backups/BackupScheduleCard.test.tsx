import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BackupSettings } from '@mc/common';
import '@/i18n';
import { toast } from 'sonner';
import { BackupScheduleCard } from './BackupScheduleCard';
import { backupsApi } from '@/api/backups.api';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/backups.api', () => ({ backupsApi: { settings: vi.fn(), updateSettings: vi.fn() } }));

const base: BackupSettings = {
  containerFound: true, running: true, managed: true, cronSchedule: null,
  interval: { value: '6h', source: 'compose' }, pruneDays: { value: '7', source: 'compose' },
  pendingRestart: false, initialDelay: '2m', backupOnStartup: true,
};

function setup(settings: BackupSettings, { isAdmin = true, busy = false } = {}) {
  vi.mocked(backupsApi.settings).mockResolvedValue(settings);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BackupScheduleCard isAdmin={isAdmin} busy={busy} /></QueryClientProvider>);
}

describe('BackupScheduleCard', () => {
  beforeEach(() => { vi.mocked(backupsApi.updateSettings).mockReset(); vi.mocked(toast.error).mockReset(); });

  it('viewer sees the values and their source, without edit button', async () => {
    setup(base, { isAdmin: false });
    expect(await screen.findByText('every 6 hours')).toBeInTheDocument();
    expect(screen.getByText('7 days')).toBeInTheDocument();
    expect(screen.getAllByText('(compose)')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows a compose value given in seconds in a readable unit', async () => {
    setup({ ...base, interval: { value: '21600', source: 'compose' } }, { isAdmin: false });
    expect(await screen.findByText('every 6 hours')).toBeInTheDocument();
  });

  it('shows a value it cannot convert as is, and leaves the field empty', async () => {
    setup({ ...base, interval: { value: '1.5h', source: 'compose' } });
    expect(await screen.findByText('1.5h (raw value)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Interval')).toHaveValue(null);
  });

  it('admin edits, confirms and sends the new values', async () => {
    vi.mocked(backupsApi.updateSettings).mockResolvedValue({ ...base, interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' } });
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Interval')).toHaveValue(6);
    expect(screen.getByLabelText('Retention')).toHaveValue(7);
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Retention'), { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Next backup in about 2m, then every 12 hours; archives are kept 14 days/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(backupsApi.updateSettings).toHaveBeenCalledWith({ interval: '12h', pruneDays: 14 }));
    expect(await screen.findByText('every 12 hours')).toBeInTheDocument();
  });

  it('keeps the dialog open and blocks a second submit while mc-backup restarts', async () => {
    let resolve!: (s: BackupSettings) => void;
    vi.mocked(backupsApi.updateSettings).mockReturnValue(new Promise((r) => { resolve = r; }));
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    const busyButton = await within(dialog).findByRole('button', { name: /processing/i });
    expect(busyButton).toBeDisabled();
    fireEvent.click(busyButton);
    expect(backupsApi.updateSettings).toHaveBeenCalledTimes(1);
    resolve({ ...base, interval: { value: '12h', source: 'file' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('validates the bounds before enabling Apply', async () => {
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '200' } });
    expect(screen.getByText('Between 30 minutes and 7 days.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Retention'), { target: { value: '0' } });
    expect(screen.getByText('Between 1 and 365 days.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('translates the error code of a refused change', async () => {
    vi.mocked(backupsApi.updateSettings).mockRejectedValue({ response: { status: 409, data: { error: 'x', code: 'busy' } } });
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('A backup or a restore is running, try again when it is done.'));
  });

  it('translates a write failure', async () => {
    vi.mocked(backupsApi.updateSettings).mockRejectedValue({ response: { status: 500, data: { error: 'Cannot write x', code: 'write_failed' } } });
    setup(base);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Interval'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The settings file could not be written in the backups volume: check that it is writable by MC Manager (UID 1000) and that nothing named .mc-manager is in the way.'));
  });

  it('admin sees the compose snippet when mc-backup does not read the file; a viewer does not', async () => {
    setup({ ...base, managed: false });
    expect(await screen.findByText('Settings read from the compose file')).toBeInTheDocument();
    expect(screen.getByText(/exec \/usr\/bin\/backup loop/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('a viewer of an unmanaged container sees no snippet', async () => {
    setup({ ...base, managed: false }, { isAdmin: false });
    await screen.findByText('every 6 hours');
    expect(screen.queryByText(/exec \/usr\/bin\/backup loop/)).not.toBeInTheDocument();
  });

  it('pending restart: banner and retry with the file values', async () => {
    vi.mocked(backupsApi.updateSettings).mockResolvedValue({ ...base, interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' } });
    setup({ ...base, interval: { value: '12h', source: 'file' }, pruneDays: { value: '14', source: 'file' }, pendingRestart: true });
    expect(await screen.findByText(/not applied yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(backupsApi.updateSettings).toHaveBeenCalledWith({ interval: '12h', pruneDays: 14 }));
  });

  it('missing container', async () => {
    setup({ ...base, containerFound: false, managed: false, interval: null, pruneDays: null });
    expect(await screen.findByText('The mc-backup container was not found.')).toBeInTheDocument();
  });

  it('disables Edit while a backup or restore runs', async () => {
    setup(base, { busy: true });
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});
