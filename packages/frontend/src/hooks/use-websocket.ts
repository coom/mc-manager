import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsMessage } from '@mc/common';
import { useAuthStore } from '@/stores/auth.store';
import { useServerStore } from '@/stores/server.store';
import { refreshAccessToken } from '@/api/token-refresh';

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws?token=${encodeURIComponent(token)}`;
}

export function useWebSocket(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const apply = useServerStore((s) => s.apply);
  const setConnected = useServerStore((s) => s.setConnected);
  const retryRef = useRef(1000);

  useEffect(() => {
    if (!accessToken) return;
    // Drapeau propre à ce cycle d'effet : une continuation async d'un cycle
    // précédent ne doit jamais rouvrir un socket après le nettoyage.
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = (token: string) => {
      if (stopped) return;
      socket = new WebSocket(wsUrl(token));
      socket.onopen = () => {
        retryRef.current = 1000;
        setConnected(true);
        void queryClient.invalidateQueries({ queryKey: ['server'] });
        void queryClient.invalidateQueries({ queryKey: ['backups'] });
        void queryClient.invalidateQueries({ queryKey: ['metrics'] });
      };
      socket.onmessage = (e) => { try { apply(JSON.parse(e.data) as WsMessage); } catch { /* message illisible, ignoré */ } };
      socket.onclose = (e) => {
        setConnected(false);
        if (stopped) return;
        const delay = retryRef.current;
        retryRef.current = Math.min(delay * 2, 30_000);
        timer = setTimeout(async () => {
          if (stopped) return;
          let next: string | null = useAuthStore.getState().accessToken;
          if (e.code === 4401 || e.code === 1008) next = await refreshAccessToken();
          if (stopped) return;
          if (next) connect(next);
        }, delay);
      };
    };
    connect(accessToken);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
    // accessToken change = nouvelle session ; les refresh passent par refreshAccessToken dans onclose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken ? 'has-token' : 'no-token']);
}
