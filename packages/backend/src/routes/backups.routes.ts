import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';

export const backupsRoutes: Router = Router();

backupsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.backups.list()); } catch (err) { next(err); }
});

backupsRoutes.get('/:name/download', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    const full = await req.app.locals.backups.resolve(name);
    await audit(req, 'backup.download', name);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full)}"`);
    res.sendFile(full, (err) => { if (err && !res.headersSent) next(err); });
  } catch (err) { next(err); }
});

backupsRoutes.delete('/:name', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    await req.app.locals.backups.remove(name);
    await audit(req, 'backup.delete', name);
    res.status(204).send();
  } catch (err) { next(err); }
});

backupsRoutes.post('/run', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const backups = req.app.locals.backups;
    if (backups.isRunning()) { res.status(409).json({ error: 'A backup is already running' }); return; }
    await backups.ensureContainer();
    await audit(req, 'backup.run');
    backups.runNow().catch(() => { /* déjà journalisé et diffusé par le service */ });
    res.status(202).json({ accepted: true });
  } catch (err) { next(err); }
});
