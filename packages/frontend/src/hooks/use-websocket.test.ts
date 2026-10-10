import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useWebSocket } from './use-websocket';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: (() => void) | null = null; onclose: ((e: { code: number }) => void) | null = null; onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) { FakeSocket.instances.push(this); }
  close() {}
}

vi.mock('@/api/token-refresh', () => ({ refreshAccessToken: vi.fn().mockResolvedValue('fresh-token') }));
import { refreshAccessToken } from '@/api/token-refresh';

describe('useWebSocket', () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.useFakeTimers();
    useAuthStore.setState({ accessToken: 'tok', refreshToken: 'r', user: { id: 1, username: 'u', displayName: 'U', role: 'admin' } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const wrapper = ({ children }: { children: React.ReactNode }) => createElement(QueryClientProvider, { client: new QueryClient() }, children);

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
});
