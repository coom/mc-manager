import { Router, type Request, type Response, type NextFunction } from 'express';
import { querySeries } from '../metrics/series.js';
import { AppError } from '../middleware/error-handler.js';
export const metricsRoutes: Router = Router();
metricsRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const range = String(req.query.range ?? '24h');
    if (range !== '24h' && range !== '7d' && range !== '30d') throw new AppError(400, 'range must be 24h, 7d or 30d');
    res.json({ range, points: await querySeries(req.app.locals.prisma, range) });
  } catch (err) { next(err); }
});
