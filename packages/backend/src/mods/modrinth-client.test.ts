import { describe, it, expect, vi } from 'vitest';
import { realModrinth, ModrinthUnavailable } from './modrinth-client.js';

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('realModrinth', () => {
  it('maps the API payload and sends a User-Agent', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', description: 'Optimizes many areas of the game.', icon_url: 'https://cdn.modrinth.com/x.png', project_type: 'mod', loaders: ['fabric', 'quilt'] }));
    const info = await realModrinth(fetchFn as unknown as typeof fetch).getProject('lithium');
    expect(info).toEqual({ id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', description: 'Optimizes many areas of the game.', iconUrl: 'https://cdn.modrinth.com/x.png', projectType: 'mod', loaders: ['fabric', 'quilt'] });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.modrinth.com/v2/project/lithium');
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^mc-manager/);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it('maps a missing or blank description to null', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { id: 'x', slug: 'x', title: 'X', description: '   ', project_type: 'mod', loaders: [] }));
    expect((await realModrinth(fetchFn as unknown as typeof fetch).getProject('x'))?.description).toBeNull();
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

describe('realModrinth.search', () => {
  const hit = { slug: 'xaeros-minimap', project_id: '1bokaNcj', title: "Xaero's Minimap", description: 'A minimap.', icon_url: 'https://cdn.modrinth.com/m.png', author: 'xaero96', downloads: 12345678, follows: 4321, latest_version: '24.2.0' };
  it('encodes the query and facets, maps hits', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { hits: [hit, { slug: 'nope' }] }));
    const hits = await realModrinth(fetchFn as unknown as typeof fetch).search('mini map & co #1', { loader: 'fabric', gameVersion: '1.21.1', limit: 20 });
    const url = new URL((fetchFn.mock.calls[0] as [string])[0]);
    expect(url.origin + url.pathname).toBe('https://api.modrinth.com/v2/search');
    expect(url.searchParams.get('query')).toBe('mini map & co #1');
    expect(url.searchParams.get('limit')).toBe('20');
    expect(url.searchParams.get('index')).toBe('relevance');
    expect(JSON.parse(url.searchParams.get('facets')!)).toEqual([['project_type:mod'], ['categories:fabric'], ['versions:1.21.1']]);
    expect(hits).toEqual([{ slug: 'xaeros-minimap', projectId: '1bokaNcj', title: "Xaero's Minimap", description: 'A minimap.', iconUrl: 'https://cdn.modrinth.com/m.png', author: 'xaero96', downloads: 12345678, follows: 4321, latestVersion: '24.2.0' }]);
  });
  it('omits the version facet when unknown and tolerates missing optional fields', async () => {
    const fetchFn = vi.fn().mockImplementation(() => json(200, { hits: [{ slug: 'a', project_id: 'b', title: 'A' }] }));
    const hits = await realModrinth(fetchFn as unknown as typeof fetch).search('a', { loader: 'paper', gameVersion: null, limit: 5 });
    expect(JSON.parse(new URL((fetchFn.mock.calls[0] as [string])[0]).searchParams.get('facets')!)).toEqual([['project_type:mod'], ['categories:paper']]);
    expect(hits).toEqual([{ slug: 'a', projectId: 'b', title: 'A', description: null, iconUrl: null, author: null, downloads: 0, follows: 0, latestVersion: null }]);
  });
  it('throws ModrinthUnavailable on errors and malformed payloads', async () => {
    await expect(realModrinth(vi.fn().mockImplementation(() => json(503, {})) as unknown as typeof fetch).search('a', { loader: 'fabric', gameVersion: null, limit: 5 })).rejects.toBeInstanceOf(ModrinthUnavailable);
    await expect(realModrinth(vi.fn().mockImplementation(() => json(200, { nope: 1 })) as unknown as typeof fetch).search('a', { loader: 'fabric', gameVersion: null, limit: 5 })).rejects.toBeInstanceOf(ModrinthUnavailable);
  });
});
