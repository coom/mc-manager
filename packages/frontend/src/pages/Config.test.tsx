import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { configApi } from '@/api/config.api';
import Config from './Config';
import { toast } from 'sonner';
import type { ServerPropertiesView } from '@mc/common';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/config.api', () => ({ configApi: { get: vi.fn(), save: vi.fn() } }));
vi.mock('@/api/server.api', () => ({ serverApi: { restart: vi.fn().mockResolvedValue({}) } }));

const view: ServerPropertiesView = { raw: '#c\nmotd=Hello\nmax-players=20\npvp=true\nrcon.password=********\n', values: { motd: 'Hello', 'max-players': '20', pvp: 'true', 'rcon.password': '********' }, locked: { motd: 'MOTD', 'rcon.password': 'rcon', 'rcon.port': 'rcon', 'enable-rcon': 'rcon' }, exists: true, restartRequired: false };

function setup(role: 'admin' | 'viewer' = 'admin', v = view) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(configApi.get).mockResolvedValue(v);
  vi.mocked(configApi.save).mockResolvedValue({ ...v, values: { ...v.values, 'max-players': '10' }, restartRequired: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/config']}><Routes><Route path="/config" element={<Config />} /><Route path="/dashboard" element={<div>DASH</div>} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('Config page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });

  it('redirects viewers', async () => {
    setup('viewer');
    expect(await screen.findByText('DASH')).toBeInTheDocument();
    expect(configApi.get).not.toHaveBeenCalled();
  });

  it('renders the form with a locked field and saves only the changed values', async () => {
    setup();
    const motd = await screen.findByLabelText('Message of the day');
    expect(motd).toBeDisabled();
    expect(screen.getByTitle(/Managed by MOTD in the container environment.*OVERRIDE_SERVER_PROPERTIES=false/)).toBeInTheDocument();
    expect(screen.getByText(/Some keys are locked because the container environment sets them/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Max players'), { target: { value: '10' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(configApi.save).toHaveBeenCalledWith({ values: { 'max-players': '10' } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Configuration saved'));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
  });

  it('hides the lock hint when only RCON keys are locked', async () => {
    setup('admin', { ...view, locked: { 'rcon.password': 'rcon', 'rcon.port': 'rcon', 'enable-rcon': 'rcon' } });
    await screen.findByLabelText('Message of the day');
    expect(screen.queryByText(/Some keys are locked/)).not.toBeInTheDocument();
  });

  it('raw tab saves the whole text and shows the changed line count', async () => {
    setup();
    await screen.findByLabelText('Message of the day');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Raw file' })); fireEvent.click(screen.getByRole('tab', { name: 'Raw file' }));
    const area = await screen.findByRole('textbox', { name: 'server.properties' });
    fireEvent.change(area, { target: { value: '#c\nmotd=Hello\nmax-players=5\npvp=false\nrcon.password=********\n' } });
    expect(screen.getByText('2 changed line(s)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(configApi.save).toHaveBeenCalledWith({ raw: '#c\nmotd=Hello\nmax-players=5\npvp=false\nrcon.password=********\n' }));
  });

  it('shows the missing-file message read-only', async () => {
    setup('admin', { ...view, exists: false, raw: '', values: {} });
    expect(await screen.findByText(/does not exist yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('surfaces a 409 from the server', async () => {
    setup();
    vi.mocked(configApi.save).mockRejectedValue({ response: { status: 409, data: { error: 'Key motd is managed by MOTD' } } });
    fireEvent.change(await screen.findByLabelText('Max players'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Key motd is managed by MOTD'));
  });
});
