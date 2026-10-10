import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { playersApi } from '@/api/players.api';
import { OnlineTab } from './OnlineTab';
import { toast } from 'sonner';

// Les menus Radix s'ouvrent au pointeur, pas au click synthétique : userEvent est requis.
const user = () => userEvent.setup({ pointerEventsCheck: 0 });

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/players.api', () => ({ playersApi: { online: vi.fn(), kick: vi.fn().mockResolvedValue({}), ban: vi.fn().mockResolvedValue({}), banIp: vi.fn(), op: vi.fn().mockResolvedValue({}), deop: vi.fn(), pardon: vi.fn() } }));

const alice = { name: 'Alice', uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', joinedAt: '2026-10-10T10:00:00Z', country: 'FR', hasIp: true };
const bob = { name: 'Bob', uuid: null, joinedAt: '2026-10-10T10:05:00Z', country: null, hasIp: false };

function setup(role: 'admin' | 'viewer', status: 'ready' | 'stopped' = 'ready') {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: { status, containerName: 'mc' } as never });
  vi.mocked(playersApi.online).mockResolvedValue({ items: [alice, bob], total: 2, page: 1, limit: 2 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><OnlineTab /></MemoryRouter></QueryClientProvider>);
}

describe('OnlineTab', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('lists online players with their flag or LAN chip and links to the sheet', async () => {
    setup('viewer');
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByLabelText('France')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Alice/ })).toHaveAttribute('href', `/players/${alice.uuid}`);
    expect(screen.queryByRole('link', { name: /Bob/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions' })).not.toBeInTheDocument();
  });

  it('admin kicks with a reason after confirmation', async () => {
    const u = user();
    setup('admin');
    await screen.findByText('Alice');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Kick' }));
    fireEvent.change(await screen.findByLabelText('Reason (optional)'), { target: { value: 'afk' } });
    await u.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(playersApi.kick).toHaveBeenCalledWith('Alice', 'afk'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alice kicked'));
  });

  it('clears the reason when the dialog is cancelled', async () => {
    const u = user();
    setup('admin');
    await screen.findByText('Alice');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Kick' }));
    fireEvent.change(await screen.findByLabelText('Reason (optional)'), { target: { value: 'afk' } });
    await u.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Reason (optional)')).not.toBeInTheDocument());
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Kick' }));
    expect(await screen.findByLabelText('Reason (optional)')).toHaveValue('');
  });

  it('clears the reason after a successful action', async () => {
    const u = user();
    setup('admin');
    await screen.findByText('Alice');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Kick' }));
    fireEvent.change(await screen.findByLabelText('Reason (optional)'), { target: { value: 'afk' } });
    await u.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Alice kicked'));
    await waitFor(() => expect(screen.queryByLabelText('Reason (optional)')).not.toBeInTheDocument());
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Ban' }));
    expect(await screen.findByLabelText('Reason (optional)')).toHaveValue('');
  });

  it('ban IP is disabled for a player without ip', async () => {
    const u = user();
    setup('admin');
    await screen.findByText('Bob');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[1]);
    expect(await screen.findByRole('menuitem', { name: 'Ban IP' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('actions are disabled when the server is not ready', async () => {
    setup('admin', 'stopped');
    await screen.findByText('Alice');
    expect(screen.getAllByRole('button', { name: 'Actions' })[0]).toBeDisabled();
  });

  it('shows the server error on failure', async () => {
    const u = user();
    vi.mocked(playersApi.op).mockRejectedValueOnce({ response: { status: 409, data: { error: 'Nothing changed' } } });
    setup('admin');
    await screen.findByText('Alice');
    await u.click(screen.getAllByRole('button', { name: 'Actions' })[0]);
    await u.click(await screen.findByRole('menuitem', { name: 'Make operator' }));
    await u.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nothing changed'));
  });
});
