import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useWebSocket } from './use-websocket';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null; onclose: ((e: { code: number }) => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { FakeSocket.instances.push(this); }
}

vi.mock('@/api/token-refresh', () => ({ refreshAccessToken: vi.fn() }));
import { refreshAccessToken } from '@/api/token-refresh';

describe('useWebSocket', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  const count = () => FakeSocket.instances.length;

  beforeEach(() => {
    FakeSocket.instances = [];
    queryClient = new QueryClient();
    vi.mocked(refreshAccessToken).mockReset().mockResolvedValue('fresh-token');
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
    useServerStore.getState().reset();
    useAuthStore.setState({ accessToken: 'tok', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('connects with the access token and applies messages', () => {
    renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    expect(ws.url).toContain('token=tok');
    act(() => ws.onmessage?.({ data: JSON.stringify({ type: 'server.status', info: { status: 'ready' } }) }));
    expect(useServerStore.getState().info?.status).toBe('ready');
  });

  it('refreshes the token before reconnecting after a 4401 close', async () => {
    renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    await act(async () => { ws.onclose?.({ code: 4401 }); await vi.advanceTimersByTimeAsync(1500); });
    expect(refreshAccessToken).toHaveBeenCalled();
    expect(FakeSocket.instances[1].url).toContain('token=fresh-token');
  });

  it('backs off 1s, 2s, 4s... capped at 30s, without refreshing on a plain close', async () => {
    renderHook(() => useWebSocket(), { wrapper });
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = count();
      await act(async () => { FakeSocket.instances[before - 1].onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(delay - 1); });
      expect(count()).toBe(before);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(count()).toBe(before + 1);
    }
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('resets the backoff once a connection opens', async () => {
    renderHook(() => useWebSocket(), { wrapper });
    await act(async () => { FakeSocket.instances[0].onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { FakeSocket.instances[1].onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(2000); });
    act(() => FakeSocket.instances[2].onopen?.());
    await act(async () => { FakeSocket.instances[2].onclose?.({ code: 1006 }); await vi.advanceTimersByTimeAsync(1000); });
    expect(count()).toBe(4);
  });

  it('stops reconnecting when the refresh returns null', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValue(null);
    renderHook(() => useWebSocket(), { wrapper });
    await act(async () => { FakeSocket.instances[0].onclose?.({ code: 4401 }); await vi.advanceTimersByTimeAsync(60_000); });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(count()).toBe(1);
  });

  it('does not reconnect after unmount during the backoff delay', async () => {
    const { unmount } = renderHook(() => useWebSocket(), { wrapper });
    const ws = FakeSocket.instances[0];
    act(() => ws.onclose?.({ code: 1006 }));
    unmount();
    expect(ws.close).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(count()).toBe(1);
  });

  it('does not reconnect when unmounted while a token refresh is in flight', async () => {
    let resolveRefresh: (v: string | null) => void = () => {};
    vi.mocked(refreshAccessToken).mockReturnValue(new Promise((r) => { resolveRefresh = r; }));
    const { unmount } = renderHook(() => useWebSocket(), { wrapper });
    await act(async () => { FakeSocket.instances[0].onclose?.({ code: 4401 }); await vi.advanceTimersByTimeAsync(1000); });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { resolveRefresh('fresh-token'); await vi.advanceTimersByTimeAsync(60_000); });
    expect(count()).toBe(1);
  });

  it('invalidates the backups query on backup.list.changed', () => {
    renderHook(() => useWebSocket(), { wrapper });
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    act(() => FakeSocket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'backup.list.changed' }) }));
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['backups']]);
  });

  it('invalidates the server, backups and metrics queries on open', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useWebSocket(), { wrapper });
    act(() => FakeSocket.instances[0].onopen?.());
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual([['server'], ['backups'], ['metrics']]);
    expect(useServerStore.getState().connected).toBe(true);
  });
});
