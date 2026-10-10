import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import { AppError } from '../middleware/error-handler.js';

export const backupsRoutes: Router = Router();

/** Route PUBLIQUE (montée avant authMiddleware) : le jeton à usage unique tient lieu d'authentification. */
export const backupDownloadRoutes: Router = Router();

backupDownloadRoutes.get('/download/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = req.app.locals.downloadTokens.consume(String(req.params.token));
    if (!entry) throw new AppError(404, 'Download link not found or expired');
    const full = await req.app.locals.backups.resolve(entry.name);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full)}"`);
    res.sendFile(full, (err) => { if (err && !res.headersSent) next(err); });
  } catch (err) { next(err); }
});

backupsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.backups.list()); } catch (err) { next(err); }
});

// Émet un lien de téléchargement court (60 s, usage unique) : le navigateur le suit directement,
// sans charger l'archive en mémoire ni porter l'en-tête Bearer.
backupsRoutes.post('/:name/link', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    await req.app.locals.backups.resolve(name);
    await audit(req, 'backup.download', name);
    const token = req.app.locals.downloadTokens.issue(name, req.user!.id);
    res.json({ url: `/api/backups/download/${token}` });
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
    // Le résultat (code de sortie ou échec) est audité à la fin, la réponse 202 part tout de suite.
    backups.runNow()
      .then((code: number) => audit(req, 'backup.run', `exit ${code}`))
      .catch((err: Error) => audit(req, 'backup.run', `failed: ${err.message}`));
    res.status(202).json({ accepted: true });
  } catch (err) { next(err); }
});
