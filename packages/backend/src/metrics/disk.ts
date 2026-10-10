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

export async function diskFree(dir: string): Promise<number | null> {
  try { const s = await statfs(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}
