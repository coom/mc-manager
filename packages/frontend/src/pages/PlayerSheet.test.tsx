import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { playersApi } from '@/api/players.api';
import type { PlayerSheet as PlayerSheetDto } from '@mc/common';
import PlayerSheet from './PlayerSheet';

vi.mock('@/api/players.api', () => ({ playersApi: { sheet: vi.fn() } }));
const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const base = { uuid: UUID, name: 'Alice', previousNames: ['OldAlice'], online: true, op: true, whitelisted: false, banned: false, lastSeenAt: '2026-10-10T10:00:00Z', sessionCount: 3, playTimeObservedSeconds: 5400,
  sessions: [{ id: 1, uuid: UUID, name: 'Alice', source: 'log' as const, joinedAt: '2026-10-10T09:00:00Z', leftAt: '2026-10-10T10:00:00Z', ip: '8.8.8.8', country: 'US' }],
  daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(11 + i).padStart(2, '0')}`, minutes: i })), stats: null };

function setup(role: 'admin' | 'viewer', sheet: PlayerSheetDto = base) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(playersApi.sheet).mockResolvedValue(sheet);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/players/${UUID}`]}><Routes><Route path="/players/:uuid" element={<PlayerSheet />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('PlayerSheet', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  it('shows identity, badges, observed play time and the no-stats message', async () => {
    setup('viewer');
    expect(await screen.findByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText(/OldAlice/)).toBeInTheDocument();
    expect(screen.getByText('op')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    expect(screen.getByText(/No statistics yet/)).toBeInTheDocument();
    expect(screen.queryByText('8.8.8.8')).not.toBeInTheDocument();
  });
  it('admin sees ip and country in sessions and stats tiles when present', async () => {
    setup('admin', { ...base, stats: { playTimeSeconds: 7200, deaths: 4, playerKills: null, mobKills: 10, distanceMeters: 12345, jumps: 1, damageTaken: 2, blocksMined: 3, itemsCrafted: 5 } });
    await screen.findByRole('heading', { name: 'Alice' });
    expect(screen.getByText('8.8.8.8')).toBeInTheDocument();
    expect(screen.getByText('2h 0m')).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('12.3 km')).toBeInTheDocument();
  });
  it('shows not found on 404', async () => {
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'viewer' } });
    vi.mocked(playersApi.sheet).mockRejectedValue({ response: { status: 404 } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/players/${UUID}`]}><Routes><Route path="/players/:uuid" element={<PlayerSheet />} /></Routes></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText('Player not found')).toBeInTheDocument();
  });
});
