import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';

export const propertiesRoutes: Router = Router();
propertiesRoutes.use(requireRole('admin'));

propertiesRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.properties.read()); } catch (err) { next(err); }
});

propertiesRoutes.put('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body ?? {};
    const update = typeof body.raw === 'string' ? { raw: body.raw } : body.values && typeof body.values === 'object' && !Array.isArray(body.values) ? { values: body.values } : null;
    if (!update) throw new AppError(400, 'Body must contain values or raw');
    // Audit avant l'écriture ; le détail nomme les clés (ou le nombre de lignes en mode brut).
    const detail = 'raw' in update ? `raw (${update.raw.split(/\r?\n/).filter((l: string) => l.trim()).length} lines)` : Object.keys(update.values).sort().join(',').slice(0, 500);
    await audit(req, 'server.properties', detail);
    const { view } = await req.app.locals.properties.write(update);
    res.json(view);
  } catch (err) { next(err); }
});
