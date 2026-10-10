import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServerInfo, ServerStatus } from '@mc/common';
import i18n from '@/i18n';
import { useServerStore } from '@/stores/server.store';
import { useAuthStore } from '@/stores/auth.store';
import { serverApi } from '@/api/server.api';
import { StatusBanner } from './StatusBanner';

vi.mock('@/api/server.api', () => ({
  serverApi: {
    get: vi.fn(), start: vi.fn().mockResolvedValue({}), stop: vi.fn().mockResolvedValue({}),
    restart: vi.fn().mockResolvedValue({}), command: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mkInfo = (status: ServerStatus, extra: Partial<ServerInfo> = {}) =>
  ({ status, containerName: 'mc', ...extra }) as ServerInfo;

function setup(status: ServerStatus, role: 'admin' | 'viewer' = 'admin', extra: Partial<ServerInfo> = {}) {
  useAuthStore.setState({ user: { id: 1, username: 'u', displayName: 'U', role } });
  useServerStore.setState({ info: mkInfo(status, extra) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StatusBanner /></QueryClientProvider>);
}
const btn = (name: string) => screen.getByRole('button', { name });

describe('StatusBanner', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([
    ['stopped', true, false, false],
    ['ready', false, true, true],
    ['starting', false, false, false],
    ['stopping', false, false, false],
    ['unavailable', false, false, false],
  ] as const)('%s: start/restart/stop enabled matrix', (status, start, restart, stop) => {
    setup(status);
    expect(btn('Start').hasAttribute('disabled')).toBe(!start);
    expect(btn('Restart').hasAttribute('disabled')).toBe(!restart);
    expect(btn('Stop').hasAttribute('disabled')).toBe(!stop);
  });

  it('renders the message when unavailable', () => {
    setup('unavailable', 'admin', { message: 'docker socket down' });
    expect(screen.getByText('docker socket down')).toBeInTheDocument();
  });

  it('hides buttons for a viewer', () => {
    setup('ready', 'viewer');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('stop asks for confirmation then calls serverApi.stop', async () => {
    const user = userEvent.setup();
    setup('ready');
    await user.click(btn('Stop'));
    expect(await screen.findByText('Stop the server?')).toBeInTheDocument();
    expect(serverApi.stop).not.toHaveBeenCalled();
    await user.click(btn('Confirm'));
    await waitFor(() => expect(serverApi.stop).toHaveBeenCalled());
  });

  it('start calls serverApi.start directly', async () => {
    const user = userEvent.setup();
    setup('stopped');
    await user.click(btn('Start'));
    await waitFor(() => expect(serverApi.start).toHaveBeenCalled());
    expect(screen.queryByText('Stop the server?')).not.toBeInTheDocument();
  });
});
