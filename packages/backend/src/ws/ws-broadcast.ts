import type { WebSocketServer } from 'ws';
import type { WsMessage } from '@mc/common';
type AuthedSocket = { readyState: number; authed?: boolean; send(data: string): void };
export function markAuthenticated(socket: unknown): void { (socket as AuthedSocket).authed = true; }
export function broadcast(wss: WebSocketServer, msg: WsMessage): void {
  const data = JSON.stringify(msg);
  wss.clients.forEach((raw) => { const c = raw as unknown as AuthedSocket; if (c.readyState === 1 && c.authed) c.send(data); });
}
