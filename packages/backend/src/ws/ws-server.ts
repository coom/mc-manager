import type { IncomingMessage, Server } from 'http';
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '@mc/common';
import { config } from '../config.js';

type PrismaLike = { user: { findUnique(args: { where: { id: number }; select: { enabled: true } }): Promise<{ enabled: boolean } | null> } };

/** Identité portée par le token de la query string, ou null si invalide. */
export async function authenticate(req: IncomingMessage, prisma: PrismaLike): Promise<JwtPayload | null> {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');
    if (!token) return null;
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
    if (payload.typ !== 'access') return null;
    const user = await prisma.user.findUnique({ where: { id: payload.id }, select: { enabled: true } });
    return user?.enabled ? payload : null;
  } catch { return null; }
}

/**
 * La connexion est acceptée puis fermée en 4401 si le token est invalide :
 * un refus au handshake arrive au navigateur comme un 1006 indistinct, alors
 * que le code 4401 permet au client de rafraîchir son token avant de réessayer.
 * Le handler 'connection' ne reçoit que des sockets authentifiés : il attend
 * l'événement 'authenticated' émis ici.
 */
export function attachWebSocket(server: Server, prisma: PrismaLike): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket, req) => {
    void authenticate(req, prisma).then((identity) => {
      if (!identity) { socket.close(4401, 'Unauthenticated'); return; }
      wss.emit('authenticated', socket, identity);
    });
  });
  return wss;
}
