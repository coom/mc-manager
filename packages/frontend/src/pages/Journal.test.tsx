import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { journalApi } from '@/api/journal.api';
import { useAuthStore } from '@/stores/auth.store';
import Journal from './Journal';

vi.mock('@/api/journal.api', () => ({ journalApi: { players: vi.fn(), failures: vi.fn(), web: vi.fn() } }));

function setup(role: 'admin' | 'viewer' = 'admin') {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(journalApi.players).mockResolvedValue({ total: 1, page: 1, limit: 50, items: [{ id: 1, uuid: null, name: 'Alice', source: 'log', joinedAt: '2026-10-10T09:00:00Z', leftAt: '2026-10-10T10:30:00Z', ip: '8.8.8.8', country: 'US' }] });
  vi.mocked(journalApi.failures).mockResolvedValue({ total: 1, page: 1, limit: 50, items: [{ id: 1, name: 'Mallory', ip: '198.51.100.7', country: null, reason: 'banned', message: 'You are banned', createdAt: '2026-10-10T09:00:00Z' }] });
  vi.mocked(journalApi.web).mockResolvedValue({ total: 1, page: 1, limit: 50, items: [{ id: 1, username: 'nobody', userId: null, ip: '1.2.3.4', country: 'FR', success: false, reason: 'unknown_user', createdAt: '2026-10-10T09:00:00Z' }] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/journal']}>
        <Routes>
          <Route path="/journal" element={<Journal />} />
          <Route path="/dashboard" element={<div>dashboard placeholder</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Journal page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  it('shows Minecraft sessions with ip, flag and duration, and filters by name', async () => {
    setup();
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('8.8.8.8')).toBeInTheDocument();
    expect(screen.getByLabelText('United States')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'ali' } });
    await waitFor(() => expect(journalApi.players).toHaveBeenCalledWith(expect.objectContaining({ q: 'ali', page: 1 })));
  });
  it('switches to refusals and web logins', async () => {
    setup();
    await screen.findByText('Alice');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Refused' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Refused' }));
    expect(await screen.findByText('Mallory')).toBeInTheDocument();
    expect(screen.getByText('banned')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'MC Manager' }));
    fireEvent.click(screen.getByRole('tab', { name: 'MC Manager' }));
    expect(await screen.findByText('nobody')).toBeInTheDocument();
    expect(screen.getByText('unknown user')).toBeInTheDocument();
    expect(screen.getByText('failure')).toBeInTheDocument();
  });
  it('redirects a viewer to the dashboard', async () => {
    vi.mocked(journalApi.players).mockClear();
    setup('viewer');
    expect(await screen.findByText('dashboard placeholder')).toBeInTheDocument();
    expect(journalApi.players).not.toHaveBeenCalled();
  });
});
