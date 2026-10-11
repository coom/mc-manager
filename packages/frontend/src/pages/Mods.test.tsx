import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { modsApi } from '@/api/mods.api';
import Mods from './Mods';
import { toast } from 'sonner';
import type { ModsView } from '@mc/common';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/api/mods.api', () => ({ modsApi: { get: vi.fn(), import: vi.fn(), add: vi.fn(), toggle: vi.fn(), remove: vi.fn(), toggleFile: vi.fn() } }));
vi.mock('@/api/server.api', () => ({ serverApi: { restart: vi.fn().mockResolvedValue({}) } }));

const base: ModsView = {
  server: { loader: 'fabric', dir: 'mods' }, serverIssue: null, source: 'file', inlineEntries: [], listingExists: true,
  composeLine: 'MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"', restartRequired: false,
  modrinth: [
    { entry: 'fabric-api', slug: 'fabric-api', enabled: true, installed: true, title: 'Fabric API', description: 'Lightweight and modular API providing common hooks.', iconUrl: null, projectId: 'P7dR8mSH' },
    { entry: 'lithium:0.14.0', slug: 'lithium', enabled: false, installed: true, title: null, description: null, iconUrl: null, projectId: null },
    { entry: 'spark', slug: 'spark', enabled: false, installed: false, title: null, description: null, iconUrl: null, projectId: null },
  ],
  unmanagedLines: [{ raw: 'bad entry', invalid: true }],
  manual: [{ file: 'custom.jar', enabled: true, size: 2048, mtime: '2026-10-11T10:00:00Z', conflict: false, meta: null }],
};

function setup(role: 'admin' | 'viewer' = 'admin', view: ModsView = base) {
  useAuthStore.setState({ accessToken: 't', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role } });
  vi.mocked(modsApi.get).mockResolvedValue(view);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><Mods /></MemoryRouter></QueryClientProvider>);
}

describe('Mods page', () => {
  beforeAll(async () => { await i18n.changeLanguage('en'); });
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists Modrinth and manual mods with their state', async () => {
    setup();
    expect(await screen.findByText('Fabric API')).toBeInTheDocument();
    expect(screen.getByText('lithium:0.14.0')).toBeInTheDocument();
    expect(screen.getByText('Installed')).toBeInTheDocument();      // fabric-api : actif et installé
    expect(screen.getByText('Pending restart')).toBeInTheDocument(); // lithium : désactivé mais encore installé
    expect(screen.getByText('Not installed')).toBeInTheDocument();   // spark : désactivé et absent
    expect(screen.getByText('bad entry')).toBeInTheDocument();
    expect(screen.getByText('custom.jar')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.queryByText(/Restart required/)).not.toBeInTheDocument();
  });

  it('shows the Modrinth summary under the name and links the name to the project page', async () => {
    setup();
    const summary = await screen.findByText('Lightweight and modular API providing common hooks.');
    expect(summary).toHaveAttribute('title', 'Lightweight and modular API providing common hooks.');
    const link = screen.getByRole('link', { name: /Fabric API/ });
    expect(link).toHaveAttribute('href', 'https://modrinth.com/project/fabric-api');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    // Sans résumé en cache, la ligne reste sur un seul niveau et le slug sert de nom.
    expect(screen.getByRole('link', { name: /^lithium$/ })).toBeInTheDocument();
  });

  it('toggles a Modrinth mod and a manual jar, replacing the view', async () => {
    setup();
    vi.mocked(modsApi.toggle).mockResolvedValue({ ...base, restartRequired: true });
    vi.mocked(modsApi.toggleFile).mockResolvedValue({ ...base, restartRequired: true });
    await screen.findByText('Fabric API');
    fireEvent.click(screen.getByRole('switch', { name: 'lithium:0.14.0' }));
    await waitFor(() => expect(modsApi.toggle).toHaveBeenCalledWith('lithium:0.14.0', true));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'custom.jar' }));
    await waitFor(() => expect(modsApi.toggleFile).toHaveBeenCalledWith('custom.jar', false));
  });

  it('adds a mod and shows the translated error code on failure', async () => {
    setup();
    await screen.findByText('Fabric API');
    const input = screen.getByPlaceholderText(/Project slug/);
    vi.mocked(modsApi.add).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'loader_mismatch' } } });
    fireEvent.change(input, { target: { value: 'plugin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This project has no version for the server loader.'));
    vi.mocked(modsApi.add).mockResolvedValueOnce(base);
    fireEvent.change(input, { target: { value: 'spark' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(modsApi.add).toHaveBeenCalledWith('spark'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod added'));
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('removes a mod after confirmation', async () => {
    setup();
    vi.mocked(modsApi.remove).mockResolvedValue({ ...base, modrinth: [base.modrinth[1]] });
    await screen.findByText('Fabric API');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(await screen.findByText('Remove fabric-api from the list?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.remove).toHaveBeenCalledWith('fabric-api'));
    await waitFor(() => expect(screen.queryByText('Fabric API')).not.toBeInTheDocument());
  });

  it('offers the import when the list is inline, with the compose line', async () => {
    setup('admin', { ...base, source: 'inline', inlineEntries: ['fabric-api', 'lithium'], listingExists: false, modrinth: [] });
    vi.mocked(modsApi.import).mockResolvedValue({ ...base, source: 'inline', inlineEntries: ['fabric-api', 'lithium'] });
    expect(await screen.findByText('The mod list still lives in your compose file')).toBeInTheDocument();
    expect(screen.getByText(base.composeLine)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 mod(s)' }));
    await waitFor(() => expect(modsApi.import).toHaveBeenCalled());
    expect(await screen.findByText('Fabric API')).toBeInTheDocument();
  });

  it('is read-only for viewers', async () => {
    setup('viewer');
    await screen.findByText('Fabric API');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('explains unsupported servers and keeps the list read-only', async () => {
    setup('admin', { ...base, server: null, serverIssue: 'unsupported', source: 'none', manual: [] });
    expect(await screen.findByText('Mods are not managed for this server')).toBeInTheDocument();
    expect(screen.getByText('Fabric API')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Project slug/)).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByText(/Restart required/)).not.toBeInTheDocument();
    expect(screen.queryByText(base.composeLine)).not.toBeInTheDocument();
  });

  it('distinguishes a missing container from an unsupported server', async () => {
    setup('admin', { ...base, server: null, serverIssue: 'unavailable', source: 'none', manual: [] });
    expect(await screen.findByText('The Minecraft container cannot be reached')).toBeInTheDocument();
    expect(screen.queryByText('Mods are not managed for this server')).not.toBeInTheDocument();
    expect(screen.getByText('Fabric API')).toBeInTheDocument();
  });
});
