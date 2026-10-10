import { randomBytes } from 'crypto';

const TTL_MS = 60_000;

interface Entry { name: string; userId: number; expiresAt: number }

/**
 * Liens de téléchargement de backup : jeton aléatoire (32 octets hex), en mémoire, valable 60 s,
 * à usage unique. Le navigateur suit le lien sans en-tête Bearer, d'où ce jeton émis par une route
 * authentifiée (admin, auditée).
 */
export class DownloadTokenStore {
  private tokens = new Map<string, Entry>();

  issue(name: string, userId: number): string {
    this.sweep();
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, { name, userId, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  /** Renvoie le backup visé et supprime le jeton ; null si inconnu, déjà utilisé ou expiré. */
  consume(token: string): { name: string; userId: number } | null {
    const e = this.tokens.get(token);
    if (!e) return null;
    this.tokens.delete(token);
    if (e.expiresAt <= Date.now()) return null;
    return { name: e.name, userId: e.userId };
  }

  size(): number { return this.tokens.size; }

  private sweep(): void {
    const now = Date.now();
    for (const [t, e] of this.tokens) if (e.expiresAt <= now) this.tokens.delete(t);
  }
}
