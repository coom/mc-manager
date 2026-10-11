import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  gamerules: { advance_time: true, advance_weather: true, random_tick_speed: 3, keep_inventory: false, players_sleeping_percentage: 100 },
  legacyGamerules: false,
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

describe('World cards', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the clock and applies a time preset, replacing the cached state', async () => {
    setup();
    expect(await screen.findByText('12:00')).toBeInTheDocument();
    expect(screen.getByText('Day 12')).toBeInTheDocument();
    vi.mocked(worldApi.setTime).mockResolvedValue({ ...worldState, time: { daytime: 13000, day: 12 } });
    fireEvent.click(screen.getByRole('button', { name: 'Night' }));
    await waitFor(() => expect(worldApi.setTime).toHaveBeenCalledWith('night'));
    expect(await screen.findByText('19:00')).toBeInTheDocument();
  });
  it('freezing the daylight cycle sets advance_time to false', async () => {
    setup();
    const sw = await screen.findByRole('switch', { name: 'Freeze the day-night cycle' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    vi.mocked(worldApi.setGamerule).mockResolvedValue({ ...worldState, gamerules: { ...worldState.gamerules, advance_time: false } });
    fireEvent.click(sw);
    await waitFor(() => expect(worldApi.setGamerule).toHaveBeenCalledWith('advance_time', false));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
  });
  it('sends the weather and the tick rate', async () => {
    setup();
    vi.mocked(worldApi.setWeather).mockResolvedValue(worldState);
    vi.mocked(worldApi.setTick).mockResolvedValue({ ...worldState, tick: { ...worldState.tick, targetRate: 40 } });
    fireEvent.click(await screen.findByRole('button', { name: 'Rain' }));
    await waitFor(() => expect(worldApi.setWeather).toHaveBeenCalledWith('rain'));
    fireEvent.change(screen.getByLabelText('Tick rate'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /^Apply$/ }));
    await waitFor(() => expect(worldApi.setTick).toHaveBeenCalledWith({ rate: 40 }));
  });
  it('sprint converts seconds to ticks', async () => {
    setup();
    vi.mocked(worldApi.setTick).mockResolvedValue(worldState);
    fireEvent.change(await screen.findByLabelText('Seconds to sprint'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sprint' }));
    await waitFor(() => expect(worldApi.setTick).toHaveBeenCalledWith({ sprint: 1200 }));
  });
  it('disables the tick card when unsupported', async () => {
    setup('admin', 'ready', { ...worldState, tick: { supported: false, targetRate: null, frozen: false, sprinting: false } });
    expect(await screen.findByText('Requires Minecraft 1.20.3 or later.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tick rate')).toBeDisabled();
  });
  it('shows the reset-at-restart hint for difficulty', async () => {
    setup('admin', 'ready', { ...worldState, resetOnRestart: { difficulty: 'DIFFICULTY' } });
    expect(await screen.findByText(/Reset at restart by DIFFICULTY/)).toBeInTheDocument();
  });
  it('mentions the legacy rule names on an old server', async () => {
    setup('admin', 'ready', { ...worldState, legacyGamerules: true });
    expect(await screen.findByText(/old rule names are used/)).toBeInTheDocument();
  });
  it('applies an integer gamerule and shows unknown values', async () => {
    setup('admin', 'ready', { ...worldState, gamerules: { ...worldState.gamerules, random_tick_speed: null } });
    const input = await screen.findByLabelText('Random tick speed (crop growth)');
    expect(input).toHaveValue(null);
    expect(screen.getAllByText('unknown').length).toBeGreaterThan(0);
    vi.mocked(worldApi.setGamerule).mockResolvedValue({ ...worldState, gamerules: { ...worldState.gamerules, random_tick_speed: 10 } });
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply random_tick_speed' }));
    await waitFor(() => expect(worldApi.setGamerule).toHaveBeenCalledWith('random_tick_speed', 10));
  });
});
