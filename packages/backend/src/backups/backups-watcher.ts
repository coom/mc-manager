import { watch as fsWatch } from 'fs';
import { isSafeBackupName } from './backup-service.js';
import { logger } from '../utils/logger.js';

interface WatcherLike { on(event: 'error', listener: (err: Error) => void): unknown; close(): void }
type WatchFn = (dir: string, listener: (event: string, filename: string | Buffer | null) => void) => WatcherLike;

/**
 * Signale les archives créées, modifiées ou supprimées au premier niveau du dossier des backups, y compris par la
 * boucle de mc-backup que le backend ne pilote pas. Au plus un signal par intervalle, toujours un après le dernier
 * changement (une archive en cours d'écriture est donc relue toutes les `intervalMs`). Renvoie la fonction d'arrêt.
 */
export function watchBackups(dir: string, onChange: () => void, opts: { intervalMs?: number; watch?: WatchFn } = {}): () => void {
  const intervalMs = opts.intervalMs ?? 2000;
  const watchFn: WatchFn = opts.watch ?? ((d, l) => fsWatch(d, { persistent: false }, l));
  let timer: NodeJS.Timeout | null = null;
  let watcher: WatcherLike | null = null;
  const close = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    watcher?.close();
    watcher = null;
  };
  const fire = () => {
    timer = null;
    try { onChange(); } catch (err) { logger.warn({ err }, 'backups watcher listener failed'); }
  };
  try {
    watcher = watchFn(dir, (_event, filename) => {
      // Sans nom (certaines plateformes), on relit par prudence ; sinon seules les archives comptent.
      if (filename !== null && !isSafeBackupName(String(filename))) return;
      if (!timer && watcher) timer = setTimeout(fire, intervalMs);
    });
    watcher.on('error', (err) => { logger.warn({ err, dir }, 'backups watcher stopped: the list refreshes on demand only'); close(); });
  } catch (err) {
    logger.warn({ err, dir }, 'cannot watch the backups directory: the list refreshes on demand only');
  }
  return close;
}
