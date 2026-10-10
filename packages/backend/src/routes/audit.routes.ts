import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppError } from '../middleware/error-handler.js';
export const auditRoutes: Router = Router();
auditRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const pageSize = parseInt(String(req.query.pageSize ?? '50'), 10);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) throw new AppError(400, 'Invalid pagination');
    const action = typeof req.query.action === 'string' && req.query.action ? req.query.action : undefined;
    const user = typeof req.query.user === 'string' && req.query.user ? req.query.user : undefined;
    const where = { ...(action ? { action: { startsWith: action } } : {}), ...(user ? { username: { contains: user } } : {}) };
    const prisma = req.app.locals.prisma;
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const isAdmin = req.user?.role === 'admin';
    // Les viewers ne reçoivent aucune IP : ni celle de l'acteur, ni celles des détails de ban/pardon IP.
    const entries = rows.map((r: { at: Date; action: string; detail: string | null }) => ({
      ...r,
      at: r.at.toISOString(),
      ...(isAdmin ? {} : { ip: null, detail: r.action === 'player.ban_ip' || r.action === 'player.pardon_ip' ? null : r.detail }),
    }));
    res.json({ total, page, pageSize, entries });
  } catch (err) { next(err); }
});
