import api from './client';
import { backupsApi } from './backups.api';

vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

describe('backupsApi.download', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('asks for a short-lived link and lets the browser follow it (no blob)', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { url: '/api/backups/download/abc' } });
    vi.mocked(api.get).mockClear();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await backupsApi.download('w 1.tgz');
    expect(api.post).toHaveBeenCalledWith('/backups/w%201.tgz/link');
    expect(api.get).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/api/backups/download/abc');
  });

  it('rejects when the link cannot be obtained', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { status: 403 } });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await expect(backupsApi.download('w.tgz')).rejects.toMatchObject({ response: { status: 403 } });
    expect(click).not.toHaveBeenCalled();
  });
});
