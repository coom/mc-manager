import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { playersApi } from '@/api/players.api';
import { BansTab } from './BansTab';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/players.api', () => ({ playersApi: { lists: vi.fn(), pardon: vi.fn().mockResolvedValue({}), pardonIp: vi.fn().mockResolvedValue({}) } }));

function setup(role: 'admin' | 'viewer') {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: { status: 'ready', containerName: 'mc' } as never });
  vi.mocked(playersApi.lists).mockResolvedValue({ whitelist: [], ops: [], whitelistEnabled: false,
    bannedPlayers: [{ uuid: 'x', name: 'Mallory', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: 'griefing' }],
    bannedIps: [{ ip: '198.51.100.7', created: '2026-10-10 10:00:00 +0000', source: 'Server', expires: 'forever', reason: '' }] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><BansTab /></QueryClientProvider>);
}

describe('BansTab', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  it('viewer sees both lists without lift buttons', async () => {
    setup('viewer');
    expect(await screen.findByText('Mallory')).toBeInTheDocument();
    expect(screen.getByText('198.51.100.7')).toBeInTheDocument();
    expect(screen.getByText('griefing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lift' })).not.toBeInTheDocument();
  });
  it('admin lifts a player ban and an ip ban after confirmation', async () => {
    setup('admin');
    await screen.findByText('Mallory');
    const buttons = screen.getAllByRole('button', { name: 'Lift' });
    fireEvent.click(buttons[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(playersApi.pardon).toHaveBeenCalledWith('Mallory'));
    fireEvent.click(buttons[1]);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(playersApi.pardonIp).toHaveBeenCalledWith('198.51.100.7'));
  });
});
