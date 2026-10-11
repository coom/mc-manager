import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { loadMapUrl, normalizeMapUrl, saveMapUrl, MAX_MAP_URL_LENGTH } from '../map/map-settings.js';

export const mapRoutes: Router = Router();
const wrap = (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

/** Lecture pour tous les rôles : l'entrée de navigation n'apparaît que si une URL est définie. */
mapRoutes.get('/', wrap(async (req, res) => { res.json({ url: await loadMapUrl(req.app.locals.prisma) }); }));

/** Écriture admin ; chaîne vide = effacement. Le backend ne contacte jamais cette URL, seul le navigateur la charge. */
mapRoutes.put('/', requireRole('admin'), wrap(async (req, res) => {
  const raw = req.body?.url;
  if (typeof raw !== 'string') throw new AppError(400, 'url must be a string');
  const url = raw.trim() === '' ? null : normalizeMapUrl(raw);
  if (raw.trim() !== '' && url === null) throw new AppError(400, `url must be an absolute http(s) URL of at most ${MAX_MAP_URL_LENGTH} characters`);
  await saveMapUrl(req.app.locals.prisma, url);
  await audit(req, 'map.url', url ?? '');
  res.json({ url });
}));
