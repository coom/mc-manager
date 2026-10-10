import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import type { ServerInfo } from '@mc/common';

export const serverRoutes: Router = Router();

serverRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info: ServerInfo = await req.app.locals.serverInfo();
    res.json(info);
  } catch (err) { next(err); }
});

for (const [action, method] of [['start', 'startServer'], ['stop', 'stopServer'], ['restart', 'restartServer']] as const) {
  serverRoutes.post(`/${action}`, requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
    try {
      await req.app.locals.docker[method]();
      await audit(req, `server.${action}`);
      res.status(202).json({ accepted: true });
    } catch (err) { next(err); }
  });
}
