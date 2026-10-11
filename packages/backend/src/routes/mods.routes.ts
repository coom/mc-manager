import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { AppError } from '../middleware/error-handler.js';
import { audit } from '../audit/audit.js';
import { MAX_UPLOAD_BYTES } from '@mc/common';
import { isValidEntry } from '../mods/listing-file.js';
import { UPLOAD_NAME_RE } from '../mods/mods-service.js';

export const modsRoutes: Router = Router();
const admin = requireRole('admin');

/** Paramètre de route en chaîne simple (Express le type aussi en tableau pour les segments répétés). */
const param = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
const entryParam = (req: Request): string => {
  const entry = param(req.params.entry);
  if (!isValidEntry(entry)) throw new AppError(400, 'Invalid Modrinth entry', undefined, 'invalid_entry');
  return entry;
};
const fileParam = (req: Request): string => {
  const file = param(req.params.file);
  if (!/^[^/\\]+\.jar$/.test(file) || file.includes('..')) throw new AppError(404, 'Unknown file', undefined, 'not_found');
  return file;
};
const enabledBody = (req: Request): boolean => {
  const v = req.body?.enabled;
  if (typeof v !== 'boolean') throw new AppError(400, 'enabled must be a boolean');
  return v;
};

modsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.mods.view()); } catch (err) { next(err); }
});

modsRoutes.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (q.trim().length < 2) throw new AppError(400, 'Query must have at least 2 characters', undefined, 'invalid_query');
    res.json(await req.app.locals.mods.search(q));
  } catch (err) { next(err); }
});

modsRoutes.post('/import', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const n: number = await req.app.locals.mods.importFromEnv();
    await audit(req, 'mods.import', `${n} entries`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.post('/modrinth', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = req.body?.entry;
    if (typeof entry !== 'string' || !entry.trim()) throw new AppError(400, 'entry is required');
    if (!isValidEntry(entry.trim())) throw new AppError(400, 'Invalid Modrinth entry', undefined, 'invalid_entry');
    await req.app.locals.mods.add(entry.trim());
    await audit(req, 'mods.add', entry.trim());
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.patch('/modrinth/:entry', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = entryParam(req);
    const enabled = enabledBody(req);
    await req.app.locals.mods.setEnabled(entry, enabled);
    await audit(req, 'mods.toggle', `${entry} ${enabled ? 'enabled' : 'disabled'}`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.delete('/modrinth/:entry', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entry = entryParam(req);
    await req.app.locals.mods.remove(entry);
    await audit(req, 'mods.remove', entry);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.post('/upload', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    if (!UPLOAD_NAME_RE.test(name) || name.includes('..')) throw new AppError(400, 'Invalid jar file name', undefined, 'invalid_name');
    const replace = req.query.replace === '1' || req.query.replace === 'true';
    const declaredSize = Number.parseInt(String(req.headers['content-length'] ?? ''), 10);
    if (!Number.isInteger(declaredSize)) throw new AppError(411, 'Content-Length is required');
    if (declaredSize < 1 || declaredSize > MAX_UPLOAD_BYTES) throw new AppError(413, `Jar files are limited to ${MAX_UPLOAD_BYTES} bytes`, undefined, 'too_large');
    // Le corps brut est streamé par le service (express.json ne touche pas à ce Content-Type).
    await req.app.locals.mods.upload({ name, replace, declaredSize, body: req });
    await audit(req, 'mods.upload', `${name} ${declaredSize}`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.delete('/files/:file', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = fileParam(req);
    await req.app.locals.mods.deleteFile(file);
    await audit(req, 'mods.file.delete', file);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});

modsRoutes.patch('/files/:file', admin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const file = fileParam(req);
    const enabled = enabledBody(req);
    await req.app.locals.mods.setFileEnabled(file, enabled);
    await audit(req, 'mods.file.toggle', `${file} ${enabled ? 'enabled' : 'disabled'}`);
    res.json(await req.app.locals.mods.view());
  } catch (err) { next(err); }
});
