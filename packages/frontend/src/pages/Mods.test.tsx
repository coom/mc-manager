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
vi.mock('@/api/mods.api', () => ({ modsApi: { get: vi.fn(), import: vi.fn(), add: vi.fn(), toggle: vi.fn(), remove: vi.fn(), toggleFile: vi.fn(), search: vi.fn(), upload: vi.fn(), deleteFile: vi.fn() } }));
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
  manual: [{ file: 'custom.jar', enabled: true, size: 2048, mtime: '2026-10-11T10:00:00Z', conflict: false, meta: { id: 'custom', name: 'Custom Mod', version: '1.0' } }],
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

  it('searches Modrinth after a short pause, adds from a result and marks listed ones', async () => {
    setup();
    vi.mocked(modsApi.search).mockResolvedValue({ loader: 'fabric', gameVersion: '1.21.1', hits: [
      { slug: 'xaeros-minimap', projectId: '1', title: "Xaero's Minimap", description: 'A minimap.', iconUrl: null, author: 'xaero96', downloads: 12345678, follows: 1, latestVersion: '24.2', alreadyListed: false },
      { slug: 'fabric-api', projectId: '2', title: 'Fabric API', description: null, iconUrl: null, author: null, downloads: 0, follows: 0, latestVersion: null, alreadyListed: true },
    ] });
    vi.mocked(modsApi.add).mockResolvedValue(base);
    await screen.findByText('custom.jar');
    const input = screen.getByPlaceholderText(/Search Modrinth/);
    fireEvent.change(input, { target: { value: 'xa' } });
    expect(modsApi.search).not.toHaveBeenCalled();
    await waitFor(() => expect(modsApi.search).toHaveBeenCalledWith('xa', expect.anything()), { timeout: 1500 });
    expect(await screen.findByText("Xaero's Minimap")).toBeInTheDocument();
    expect(screen.getByText('fabric · 1.21.1')).toBeInTheDocument();
    expect(screen.getByText('12.3M downloads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Already listed' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]); // [0] = bouton du formulaire, [1] = premier résultat
    await waitFor(() => expect(modsApi.add).toHaveBeenCalledWith('xaeros-minimap'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod added'));
    await waitFor(() => expect(screen.queryByText("Xaero's Minimap")).not.toBeInTheDocument()); // panneau fermé
  });

  it('adds a typed slug directly on Enter and shows translated errors', async () => {
    setup();
    await screen.findByText('custom.jar');
    const input = screen.getByPlaceholderText(/Search Modrinth/);
    vi.mocked(modsApi.add).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'loader_mismatch' } } });
    fireEvent.change(input, { target: { value: 'plugin' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(modsApi.add).toHaveBeenCalledWith('plugin'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This project has no version for the server loader.'));
    vi.mocked(modsApi.add).mockResolvedValueOnce(base);
    fireEvent.change(input, { target: { value: 'spark' } });
    fireEvent.submit(input.closest('form')!);
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

  it('uploads a jar with progress, then shows the new view', async () => {
    setup();
    await screen.findByText('Custom Mod');
    const file = new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'new-mod.jar', { type: 'application/java-archive' });
    vi.mocked(modsApi.upload).mockImplementation(async (_f, opts) => { opts?.onProgress?.(0.5); return { ...base, restartRequired: true, manual: [...base.manual, { file: 'new-mod.jar', enabled: true, size: 4, mtime: '2026-10-11T11:00:00Z', conflict: false, meta: null }] }; });
    const input = screen.getByLabelText(/Drop a .jar file/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(modsApi.upload).toHaveBeenCalledWith(file, expect.objectContaining({ replace: false })));
    expect(await screen.findByText('new-mod.jar')).toBeInTheDocument();
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Mod uploaded'));
    expect(await screen.findByText(/Restart required/)).toBeInTheDocument();
  });

  it('offers to replace an existing file and retries with replace', async () => {
    setup();
    await screen.findByText('Custom Mod');
    const file = new File(['x'], 'custom.jar');
    vi.mocked(modsApi.upload).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'exists' } } }).mockResolvedValueOnce(base);
    fireEvent.change(screen.getByLabelText(/Drop a .jar file/), { target: { files: [file] } });
    expect(await screen.findByText('Replace custom.jar?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.upload).toHaveBeenLastCalledWith(file, expect.objectContaining({ replace: true })));
  });

  it('refuses a file above 100 MB before sending it (nginx would answer a bare 413)', async () => {
    setup();
    await screen.findByText('Custom Mod');
    const file = new File(['x'], 'huge.jar');
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText(/Drop a .jar file/), { target: { files: [file] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Jar files are limited to 100 MB.'));
    expect(modsApi.upload).not.toHaveBeenCalled();
  });

  it('asks to replace each existing file in turn when several are dropped', async () => {
    setup();
    await screen.findByText('Custom Mod');
    const a = new File(['a'], 'a.jar');
    const b = new File(['b'], 'b.jar');
    vi.mocked(modsApi.upload).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'exists' } } }).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'exists' } } }).mockResolvedValue(base);
    fireEvent.change(screen.getByLabelText(/Drop a .jar file/), { target: { files: [a, b] } });
    expect(await screen.findByText('Replace a.jar?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.upload).toHaveBeenCalledWith(a, expect.objectContaining({ replace: true })));
    expect(await screen.findByText('Replace b.jar?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.upload).toHaveBeenCalledWith(b, expect.objectContaining({ replace: true })));
  });

  it('shows a translated upload error with details', async () => {
    setup();
    await screen.findByText('Custom Mod');
    vi.mocked(modsApi.upload).mockRejectedValueOnce({ response: { data: { error: 'x', code: 'wrong_loader', details: 'paper' } } });
    fireEvent.change(screen.getByLabelText(/Drop a .jar file/), { target: { files: [new File(['x'], 'p.jar')] } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('This jar is not a mod for the server loader (detected: paper).'));
  });

  it('deletes a manual jar after confirmation and shows name and version', async () => {
    setup();
    expect(await screen.findByText('Custom Mod')).toBeInTheDocument();
    expect(screen.getByText('1.0')).toBeInTheDocument();
    vi.mocked(modsApi.deleteFile).mockResolvedValue({ ...base, manual: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete custom.jar from the server?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(modsApi.deleteFile).toHaveBeenCalledWith('custom.jar'));
    await waitFor(() => expect(screen.queryByText('Custom Mod')).not.toBeInTheDocument());
  });

  it('is read-only for viewers', async () => {
    setup('viewer');
    await screen.findByText('Fabric API');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Search Modrinth/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Drop a .jar file/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
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
