import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { parsePage } from '../utils/pagination.js';
import { toSessionEntry } from '../players/player-sheet.js';
import { loadRetentionDays, saveRetentionDays, MAX_RETENTION_DAYS } from '../players/retention.js';

export const journalRoutes: Router = Router();
journalRoutes.use(requireRole('admin'));

const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

function parseDate(v: unknown, label: string): Date | undefined {
  if (v === undefined || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new AppError(400, `Invalid ${label} date`);
  return d;
}
/** Filtres communs : q (contient, insensible à la casse via SQLite), from/to sur le champ de date donné. */
function filters(req: Request, nameField: string, dateField: string): Record<string, unknown> {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const from = parseDate(req.query.from, 'from');
  const to = parseDate(req.query.to, 'to');
  return {
    ...(q ? { [nameField]: { contains: q } } : {}),
    ...(from || to ? { [dateField]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);

journalRoutes.get('/players', wrap(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = filters(req, 'name', 'joinedAt');
  const prisma = req.app.locals.prisma;
  const [total, rows] = await Promise.all([prisma.playerSession.count({ where }), prisma.playerSession.findMany({ where, orderBy: { joinedAt: 'desc' }, skip, take: limit })]);
  res.json({ items: rows.map((r: Parameters<typeof toSessionEntry>[0]) => toSessionEntry(r, true)), total, page, limit });
}));

journalRoutes.get('/failures', wrap(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = filters(req, 'name', 'createdAt');
  const prisma = req.app.locals.prisma;
  const [total, rows] = await Promise.all([prisma.playerLoginFailure.count({ where }), prisma.playerLoginFailure.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })]);
  res.json({ items: rows.map((r: { createdAt: Date }) => ({ ...r, createdAt: r.createdAt.toISOString() })), total, page, limit });
}));

journalRoutes.get('/web', wrap(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const where = filters(req, 'username', 'createdAt');
  const prisma = req.app.locals.prisma;
  const [total, rows] = await Promise.all([prisma.webLogin.count({ where }), prisma.webLogin.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit })]);
  res.json({ items: rows.map((r: { createdAt: Date }) => ({ ...r, createdAt: iso(r.createdAt) })), total, page, limit });
}));

journalRoutes.get('/retention', wrap(async (req, res) => { res.json({ days: await loadRetentionDays(req.app.locals.prisma) }); }));

journalRoutes.put('/retention', wrap(async (req, res) => {
  const days = req.body?.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 0 || days > MAX_RETENTION_DAYS) throw new AppError(400, `days must be an integer between 0 and ${MAX_RETENTION_DAYS}`);
  await saveRetentionDays(req.app.locals.prisma, days);
  await audit(req, 'journal.retention', String(days));
  res.json({ days });
}));
