import { AppError } from '../middleware/error-handler.js';

export type DataOp = 'backup' | 'restore' | 'properties' | 'mods' | 'backup-settings' | 'delete';

/**
 * Verrou global des écritures dans /data, des sauvegardes et du redémarrage de mc-backup : une seule opération à la fois.
 * Jamais persistant : un processus qui redémarre repart libre.
 */
export class DataLock {
  private current: DataOp | null = null;
  private token = 0;

  get busy(): DataOp | null { return this.current; }

  assertFree(): void {
    if (this.current) throw new AppError(409, `Another operation is running: ${this.current}`, undefined, 'busy');
  }

  /** Prend le verrou ou lève 409 ; renvoie la fonction de libération (idempotente, liée à cette prise). */
  acquire(op: DataOp): () => void {
    this.assertFree();
    this.current = op;
    const mine = ++this.token;
    return () => { if (this.token === mine && this.current !== null) this.current = null; };
  }
}
