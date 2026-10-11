import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { mapApi } from '@/api/map.api';
import Map from './Map';

vi.mock('@/api/map.api', () => ({ mapApi: { get: vi.fn(), set: vi.fn() } }));

function setup(role: 'admin' | 'viewer', url: string | null) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(mapApi.get).mockResolvedValue({ url });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/map']}><Routes><Route path="/map" element={<Map />} /><Route path="/settings" element={<div>SETTINGS</div>} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('Map page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('embeds the configured map and offers to open it in a new tab', async () => {
    setup('viewer', 'https://map.example.com/');
    const frame = await screen.findByTitle('World map');
    expect(frame).toHaveAttribute('src', 'https://map.example.com/');
    const link = screen.getByRole('link', { name: 'Open in a new tab' });
    expect(link).toHaveAttribute('href', 'https://map.example.com/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });
  it('shows the empty state with a link to settings for admins when no map is configured', async () => {
    setup('admin', null);
    expect(await screen.findByText('No map configured.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configure in Settings' })).toHaveAttribute('href', '/settings');
    expect(screen.queryByTitle('World map')).not.toBeInTheDocument();
  });
  it('shows the empty state without the settings link for viewers', async () => {
    setup('viewer', null);
    expect(await screen.findByText('No map configured.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configure in Settings' })).not.toBeInTheDocument();
  });
});
