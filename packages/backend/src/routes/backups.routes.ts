import { Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import { AppError } from '../middleware/error-handler.js';
import { BACKUP_DELETE_MAX } from '@mc/common';
import { pruneCandidates, retentionDays } from '../backups/prune.js';

/** Corps `{ names: string[] }` des suppressions multiples (1 à BACKUP_DELETE_MAX noms). */
function namesOf(body: unknown): string[] {
  const names = (body as { names?: unknown } | null)?.names;
  if (!Array.isArray(names) || names.length === 0 || names.length > BACKUP_DELETE_MAX || names.some((n) => typeof n !== 'string')) {
    throw new AppError(400, `names must be a list of 1 to ${BACKUP_DELETE_MAX} archive names`, undefined, 'invalid_names');
  }
  return names as string[];
}

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

// Planification de mc-backup : lecture pour tous les rôles, comme la liste.
backupsRoutes.get('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.backupSettings.read()); } catch (err) { next(err); }
});

// Écrit le fichier lu par mc-backup puis le redémarre ; le service audite le résultat avant la réponse.
backupsRoutes.put('/settings', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await req.app.locals.backupSettings.apply(req.body, (detail: string) => audit(req, 'backup.settings', detail)));
  } catch (err) { next(err); }
});

backupsRoutes.get('/restore/status', (req: Request, res: Response) => { res.json(req.app.locals.restore.status()); });

// Restauration interrompue traitée à la main par l'admin : retire le marqueur.
backupsRoutes.delete('/restore/interrupted', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await req.app.locals.restore.clearInterrupted();
    await audit(req, 'backup.restore', 'interrupted marker cleared');
    res.status(204).send();
  } catch (err) { next(err); }
});

// Restauration : la réponse 202 part après les vérifications (archive, verrou, filet) ; la suite est diffusée en WebSocket.
backupsRoutes.post('/:name/restore', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.params.name);
    const body = req.body ?? {};
    for (const k of ['startAfter', 'safetyBackup'] as const) if (body[k] !== undefined && typeof body[k] !== 'boolean') throw new AppError(400, `${k} must be a boolean`);
    const opts = { startAfter: body.startAfter ?? true, safetyBackup: body.safetyBackup ?? true };
    await req.app.locals.restore.restore(name, opts, (detail: string) => audit(req, 'backup.restore', detail));
    res.status(202).json({ accepted: true });
  } catch (err) { next(err); }
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

// Suppression multiple : tout ou rien sur la validation des noms, un audit backup.delete par fichier supprimé.
backupsRoutes.post('/delete', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const names = namesOf(req.body);
    const deleted = await req.app.locals.backups.removeMany(names, (name: string) => audit(req, 'backup.delete', name));
    res.json({ deleted });
  } catch (err) { next(err); }
});

// Rétention : archives plus anciennes que PRUNE_BACKUPS_DAYS effectif (horloge du serveur), la plus récente exclue.
backupsRoutes.get('/prune', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const days = retentionDays(await req.app.locals.backupSettings.read());
    const { entries } = await req.app.locals.backups.list();
    res.json({ days, candidates: pruneCandidates(entries, days, Date.now()) });
  } catch (err) { next(err); }
});

// N'applique que les noms confirmés qui sont encore candidats à cet instant : rien d'autre n'est supprimé.
backupsRoutes.post('/prune', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const names = namesOf(req.body);
    const days = retentionDays(await req.app.locals.backupSettings.read());
    const { entries } = await req.app.locals.backups.list();
    const still = new Set(pruneCandidates(entries, days, Date.now()).map((e) => e.name));
    const targets = [...new Set(names)].filter((n) => still.has(n));
    const deleted = targets.length === 0 ? [] : await req.app.locals.backups.removeMany(targets, (name: string) => audit(req, 'backup.prune', `${name} (older than ${days} days)`));
    res.json({ deleted });
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
    backups.dataLock.assertFree();
    await backups.ensureContainer();
    await audit(req, 'backup.run');
    // Le résultat (code de sortie ou échec) est audité à la fin, la réponse 202 part tout de suite.
    backups.runNow()
      .then((code: number) => audit(req, 'backup.run', `exit ${code}`))
      .catch((err: Error) => audit(req, 'backup.run', `failed: ${err.message}`));
    res.status(202).json({ accepted: true });
  } catch (err) { next(err); }
});
