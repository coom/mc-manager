import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { worldApi } from '@/api/world.api';
import World from './World';
import type { ServerStatus, WorldState } from '@mc/common';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/world.api', () => ({ worldApi: { get: vi.fn(), setTime: vi.fn(), setWeather: vi.fn(), setDifficulty: vi.fn(), setGamemode: vi.fn(), setTick: vi.fn(), setGamerule: vi.fn() } }));

export const worldState: WorldState = {
  time: { daytime: 6000, day: 12 }, tick: { supported: true, targetRate: 20, frozen: false, sprinting: false },
  difficulty: 'normal', defaultGamemode: 'survival',
  gamerules: { doDaylightCycle: true, doWeatherCycle: true, randomTickSpeed: 3, keepInventory: false, playersSleepingPercentage: 100 },
  resetOnRestart: {},
};

export function setup(role: 'admin' | 'viewer' = 'admin', status: ServerStatus = 'ready', state = worldState) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: { status, containerName: 'mc', startedAt: null } as never });
  vi.mocked(worldApi.get).mockResolvedValue(state);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/world']}><Routes><Route path="/world" element={<World />} /><Route path="/dashboard" element={<div>DASH</div>} /></Routes></MemoryRouter></QueryClientProvider>);
  return qc;
}

describe('World page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('redirects viewers', async () => {
    setup('viewer');
    expect(await screen.findByText('DASH')).toBeInTheDocument();
    expect(worldApi.get).not.toHaveBeenCalled();
  });
  it('shows the offline state without querying when the server is stopped', async () => {
    setup('admin', 'stopped');
    expect(await screen.findByText('The server must be running to adjust the world.')).toBeInTheDocument();
    expect(worldApi.get).not.toHaveBeenCalled();
  });
  it('loads the state when the server is ready and switches to offline when it stops', async () => {
    setup('admin', 'ready');
    await waitFor(() => expect(worldApi.get).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { level: 1, name: 'World' })).toBeInTheDocument();
    useServerStore.setState({ info: { status: 'stopped', containerName: 'mc', startedAt: null } as never });
    expect(await screen.findByText('The server must be running to adjust the world.')).toBeInTheDocument();
  });
});
