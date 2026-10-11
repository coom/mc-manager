import { DIFFICULTIES, type Difficulty } from '@mc/common';
import { stripColors } from '../rcon/parsers.js';

/** « Unknown or incomplete command » (commande absente de cette version, ex. /tick avant 1.20.3). */
export function isUnknownCommand(raw: string): boolean {
  return /unknown (?:or incomplete )?command/i.test(stripColors(raw));
}

/** `time query daytime` / `time query day` → « The time is 6000 ». */
export function parseTimeQuery(raw: string): number | null {
  const m = /The time is (\d+)/i.exec(stripColors(raw));
  return m ? parseInt(m[1], 10) : null;
}

/** `gamerule <name>` → « … is currently set to: X » ; `gamerule <name> <v>` → « … is now set to: X ». */
export function parseGamerule(raw: string): boolean | number | null {
  const m = /Gamerule \w+ is (?:currently|now) set to:\s*(\S+)/i.exec(stripColors(raw));
  if (!m) return null;
  if (m[1] === 'true') return true;
  if (m[1] === 'false') return false;
  return /^-?\d+$/.test(m[1]) ? parseInt(m[1], 10) : null;
}

/** `difficulty` → « The difficulty is Normal ». */
export function parseDifficulty(raw: string): Difficulty | null {
  const m = /The difficulty is (\w+)/i.exec(stripColors(raw));
  const d = m?.[1].toLowerCase();
  return d && (DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : null;
}

/**
 * `tick query` : ligne « Target tick rate: 20.0 per second. » et, selon l'état, une ligne contenant
 * « frozen » ou « sprinting ». Tolérant : l'absence de la ligne de taux ne masque pas l'état. RCON vanilla colle
 * les deux messages sans séparateur (MC-7569), donc aucune limite de mot n'est exigée après l'état.
 */
export function parseTickStatus(raw: string): { targetRate: number | null; frozen: boolean; sprinting: boolean } | null {
  const s = stripColors(raw);
  const rate = /Target tick rate:\s*([\d.]+)/i.exec(s);
  const frozen = /frozen/i.test(s);
  const sprinting = /sprinting/i.test(s);
  if (!rate && !frozen && !sprinting) return null;
  return { targetRate: rate ? parseFloat(rate[1]) : null, frozen, sprinting };
}
