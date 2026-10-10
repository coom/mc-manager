import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import Audit from './Audit';
import { auditApi } from '@/api/audit.api';

vi.mock('@/api/audit.api', () => ({ auditApi: { list: vi.fn() } }));

describe('Audit page', () => {
  it('renders entries and the pager', async () => {
    vi.mocked(auditApi.list).mockResolvedValue({
      total: 2, page: 1, pageSize: 50,
      entries: [
        { id: 2, at: '2026-10-10T10:00:00.000Z', userId: 2, username: 'bob', action: 'rcon.command', detail: 'list', ip: null },
        { id: 1, at: '2026-10-10T09:00:00.000Z', userId: 1, username: 'alice', action: 'server.start', detail: null, ip: null },
      ],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><Audit /></QueryClientProvider>);
    expect(await screen.findByText('bob')).toBeTruthy();
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('1 / 1')).toBeTruthy();
  });
});
