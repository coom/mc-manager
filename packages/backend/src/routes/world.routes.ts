import { Router, type Request, type Response, type NextFunction } from 'express';
import type { AuditAction } from '@mc/common';
import { requireRole } from '../middleware/rbac.js';
import { audit } from '../audit/audit.js';
import { assertDifficulty, assertGamemode, assertGamerule, assertPreset, assertTick, assertWeather } from '../world/validate.js';

export const worldRoutes: Router = Router();
worldRoutes.use(requireRole('admin'));

worldRoutes.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try { res.json(await req.app.locals.world.read()); } catch (err) { next(err); }
});

const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});

/**
 * Chaque action : validation (400 sans trace d'audit), audit AVANT l'envoi (une commande en échec laisse une trace,
 * comme rcon.command), commande, puis état relu renvoyé au client.
 */
function action(path: string, name: AuditAction, prepare: (req: Request) => { detail: string; run: () => Promise<void> }) {
  worldRoutes.put(path, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { detail, run } = prepare(req);
      await audit(req, name, detail);
      await run();
      res.json(await req.app.locals.world.read());
    } catch (err) { next(err); }
  });
}

action('/time', 'world.time', (req) => { const preset = assertPreset(body(req).preset); return { detail: preset, run: () => req.app.locals.world.setTime(preset) }; });
action('/weather', 'world.weather', (req) => { const kind = assertWeather(body(req).kind); return { detail: kind, run: () => req.app.locals.world.setWeather(kind) }; });
action('/difficulty', 'world.difficulty', (req) => { const d = assertDifficulty(body(req).difficulty); return { detail: d, run: () => req.app.locals.world.setDifficulty(d) }; });
action('/gamemode', 'world.gamemode', (req) => { const g = assertGamemode(body(req).gamemode); return { detail: g, run: () => req.app.locals.world.setDefaultGamemode(g) }; });
action('/tick', 'world.tick', (req) => {
  const u = assertTick(req.body);
  const detail = 'rate' in u ? `rate=${u.rate}` : 'frozen' in u ? `frozen=${u.frozen}` : `sprint=${u.sprint}`;
  return { detail, run: () => req.app.locals.world.setTick(u) };
});
action('/gamerules/:name', 'world.gamerule', (req) => { const g = assertGamerule(req.params.name, body(req).value); return { detail: `${g.name}=${g.value}`, run: () => req.app.locals.world.setGamerule(g.name, g.value) }; });
