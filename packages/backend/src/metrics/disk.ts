import { readdir, stat, statfs } from 'fs/promises';
import path from 'path';

export async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * Dossiers du monde : vanilla range les dimensions dans <level>/DIM-1 et DIM1, Paper/Spigot les
 * sépare en <level>_nether et <level>_the_end. level-name vient de server.properties (défaut world).
 */
export function worldDirs(dataDir: string, props: Record<string, string>): string[] {
  const level = props['level-name'] || 'world';
  return [level, `${level}_nether`, `${level}_the_end`].map((d) => path.join(dataDir, d));
}

/** Somme de dirSize sur les dossiers de worldDirs (un dossier absent compte 0). */
export async function worldSize(dataDir: string, props: Record<string, string>): Promise<number> {
  const sizes = await Promise.all(worldDirs(dataDir, props).map((d) => dirSize(d)));
  return sizes.reduce((a, b) => a + b, 0);
}

export async function diskFree(dir: string): Promise<number | null> {
  try { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}
