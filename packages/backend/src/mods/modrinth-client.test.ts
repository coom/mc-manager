import { describe, it, expect, vi } from 'vitest';
import { realModrinth, ModrinthUnavailable } from './modrinth-client.js';

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('realModrinth', () => {
  it('maps the API payload and sends a User-Agent', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', icon_url: 'https://cdn.modrinth.com/x.png', project_type: 'mod', loaders: ['fabric', 'quilt'] }));
    const info = await realModrinth(fetchFn as unknown as typeof fetch).getProject('lithium');
    expect(info).toEqual({ id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', iconUrl: 'https://cdn.modrinth.com/x.png', projectType: 'mod', loaders: ['fabric', 'quilt'] });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.modrinth.com/v2/project/lithium');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^mc-manager/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('encodes the slug and returns null on 404', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(404, { error: 'not_found' }));
    expect(await realModrinth(fetchFn as unknown as typeof fetch).getProject('a b')).toBeNull();
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe('https://api.modrinth.com/v2/project/a%20b');
  });
  it('throws ModrinthUnavailable on other statuses, network errors and bad payloads', async () => {
    await expect(realModrinth(vi.fn().mockImplementation(() => json(500, {})) as unknown as typeof fetch).getProject('x')).rejects.toBeInstanceOf(ModrinthUnavailable);
    await expect(realModrinth(vi.fn().mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch).getProject('x')).rejects.toBeInstanceOf(ModrinthUnavailable);
    await expect(realModrinth(vi.fn().mockImplementation(() => json(200, { slug: 'x' })) as unknown as typeof fetch).getProject('x')).rejects.toBeInstanceOf(ModrinthUnavailable);
  });
});
