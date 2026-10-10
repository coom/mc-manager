import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuditAction, OnlinePlayer, PlayerSummary } from '@mc/common';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { parsePage } from '../utils/pagination.js';
import { readLists } from '../players/data-files.js';
import { buildPlayerSheet, flagsFor } from '../players/player-sheet.js';
import { assertIp, assertName, assertReason } from '../players/player-admin.js';
import type { PlayerAdmin } from '../players/player-admin.js';

type Handler = (req: Request, res: Response, next: NextFunction) => void;
const wrap = (fn: (req: Request, res: Response) => Promise<void>): Handler => (req, res, next) => { fn(req, res).catch(next); };
const adminOf = (req: Request): PlayerAdmin => req.app.locals.playerAdmin;

export const playersRoutes: Router = Router();

playersRoutes.get('/', wrap(async (req, res) => {
  const online: OnlinePlayer[] = req.app.locals.journal.online();
  if (req.query.online === '1') { res.json({ items: online, total: online.length, page: 1, limit: Math.max(1, online.length) }); return; }
  const { page, limit, skip } = parsePage(req.query);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const groups = await req.app.locals.prisma.playerSession.groupBy({ by: ['uuid', 'name'], _max: { joinedAt: true, leftAt: true }, _count: { _all: true } });
  // Fusion par UUID (ou par nom sans UUID) : le nom retenu est celui de la session la plus récente.
  const merged = new Map<string, { uuid: string | null; name: string; lastSeen: Date; count: number }>();
  for (const g of groups) {
    const key = g.uuid ? `u:${g.uuid}` : `n:${g.name.toLowerCase()}`;
    const joined = g._max.joinedAt ?? new Date(0);
    const lastSeen = g._max.leftAt && g._max.leftAt > joined ? g._max.leftAt : joined;
    const cur = merged.get(key);
    if (!cur) merged.set(key, { uuid: g.uuid, name: g.name, lastSeen, count: g._count._all });
    else { cur.count += g._count._all; if (lastSeen > cur.lastSeen) { cur.lastSeen = lastSeen; cur.name = g.name; } }
  }
  const lists = await readLists(req.app.locals.dataDir);
  const onlineKeys = new Set(online.map((p) => (p.uuid ? `u:${p.uuid}` : `n:${p.name.toLowerCase()}`)));
  const now = new Date();
  const all: PlayerSummary[] = [...merged].map(([key, p]) => {
    const isOnline = onlineKeys.has(key);
    return { uuid: p.uuid, name: p.name, online: isOnline, lastSeenAt: (isOnline ? now : p.lastSeen).toISOString(), sessionCount: p.count, ...flagsFor(lists, p.uuid, p.name) };
  }).filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  res.json({ items: all.slice(skip, skip + limit), total: all.length, page, limit });
}));

playersRoutes.get('/:uuid', wrap(async (req, res) => {
  const sheet = await buildPlayerSheet(req.app.locals.prisma, req.app.locals.dataDir, String(req.params.uuid), { withIp: req.user?.role === 'admin', online: req.app.locals.journal.online() });
  if (!sheet) throw new AppError(404, 'Player not found');
  res.json(sheet);
}));

/** Action sur un nom : validation, audit avant l'envoi, puis commande. Un échec RCON est audité aussi. */
function nameAction(action: AuditAction, run: (admin: PlayerAdmin, name: string, reason?: string) => Promise<string>, withReason = false): Handler {
  return wrap(async (req, res) => {
    const name = assertName(req.params.name);
    const reason = withReason ? assertReason(req.body?.reason) : undefined;
    await audit(req, action, reason ? `${name}: ${reason}` : name);
    res.json({ response: await run(adminOf(req), name, reason) });
  });
}

playersRoutes.post('/:name/kick', requireRole('admin'), nameAction('player.kick', (a, n, r) => a.kick(n, r), true));
playersRoutes.post('/:name/ban', requireRole('admin'), nameAction('player.ban', (a, n, r) => a.ban(n, r), true));
playersRoutes.post('/:name/pardon', requireRole('admin'), nameAction('player.pardon', (a, n) => a.pardon(n)));
playersRoutes.post('/:name/op', requireRole('admin'), nameAction('player.op', (a, n) => a.op(n)));
playersRoutes.post('/:name/deop', requireRole('admin'), nameAction('player.deop', (a, n) => a.deop(n)));

/** Ban de l'IP de la session en cours d'un joueur : l'IP reste côté serveur, le navigateur ne la voit jamais. */
playersRoutes.post('/:name/ban-ip', requireRole('admin'), wrap(async (req, res) => {
  const name = assertName(req.params.name);
  const reason = assertReason(req.body?.reason);
  const ip: string | null = req.app.locals.journal.currentIp(name);
  if (!ip) throw new AppError(409, 'No IP known for this player');
  await audit(req, 'player.ban_ip', reason ? `${ip} (${name}): ${reason}` : `${ip} (${name})`);
  res.json({ response: await adminOf(req).banIp(ip, reason) });
}));

export const bansRoutes: Router = Router();
bansRoutes.use(requireRole('admin'));
bansRoutes.post('/ip', wrap(async (req, res) => {
  const ip = assertIp(req.body?.ip);
  const reason = assertReason(req.body?.reason);
  await audit(req, 'player.ban_ip', reason ? `${ip}: ${reason}` : ip);
  res.json({ response: await adminOf(req).banIp(ip, reason) });
}));
bansRoutes.delete('/ip/:ip', wrap(async (req, res) => {
  const ip = assertIp(req.params.ip);
  await audit(req, 'player.pardon_ip', ip);
  res.json({ response: await adminOf(req).pardonIp(ip) });
}));

export const listsRoutes: Router = Router();
listsRoutes.get('/', wrap(async (req, res) => {
  const lists = await readLists(req.app.locals.dataDir);
  // Les viewers ne reçoivent aucune IP.
  res.json(req.user?.role === 'admin' ? lists : { ...lists, bannedIps: [] });
}));

export const whitelistRoutes: Router = Router();
whitelistRoutes.use(requireRole('admin'));
whitelistRoutes.put('/enabled', wrap(async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
  await audit(req, 'whitelist.toggle', enabled ? 'on' : 'off');
  res.json({ response: await adminOf(req).whitelistEnabled(enabled) });
}));
whitelistRoutes.post('/:name', nameAction('whitelist.add', (a, n) => a.whitelistAdd(n)));
whitelistRoutes.delete('/:name', nameAction('whitelist.remove', (a, n) => a.whitelistRemove(n)));
