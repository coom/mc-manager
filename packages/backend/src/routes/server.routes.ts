import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import { AppError } from '../middleware/error-handler.js';
import { stripColors } from '../rcon/parsers.js';
import { logger } from '../utils/logger.js';
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
      const docker = req.app.locals.docker;
      if (!(await docker.hasServerContainer())) throw new AppError(503, 'Minecraft container not found');
      await audit(req, `server.${action}`);
      // Pas d'await : un arrêt peut durer jusqu'à 60 s ; l'état suit en WebSocket (server.status).
      void docker[method]().catch((err: unknown) => logger.error({ err, action }, 'server action failed'));
      res.status(202).json({ accepted: true });
    } catch (err) { next(err); }
  });
}

serverRoutes.post('/command', requireRole('admin'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const command = typeof req.body?.command === 'string' ? req.body.command.trim().replace(/^\//, '') : '';
    if (!command || command.length > 1000) throw new AppError(400, 'command must be 1 to 1000 characters');
    // Audité avant l'envoi : une commande en échec ou en timeout laisse quand même une trace.
    await audit(req, 'rcon.command', command);
    const response = stripColors(await req.app.locals.rcon.send(command));
    res.json({ response });
  } catch (err) { next(err); }
});
