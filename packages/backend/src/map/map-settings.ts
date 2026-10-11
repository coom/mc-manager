import type { PrismaClient } from '../../generated/prisma/index.js';

const KEY = 'map.url';
export const MAX_MAP_URL_LENGTH = 2000;

/** URL http(s) absolue, sans espace, de longueur bornée ; null sinon. */
export function normalizeMapUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > MAX_MAP_URL_LENGTH || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:' || !u.hostname) return null;
    return s;
  } catch { return null; }
}

/** URL de la carte (BlueMap, Dynmap...) affichée dans la page Carte ; null si absente ou invalide. */
export async function loadMapUrl(prisma: PrismaClient): Promise<string | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
    return row ? normalizeMapUrl(row.value) : null;
  } catch { return null; }
}

/** Enregistre l'URL ; une chaîne vide efface le réglage. */
export async function saveMapUrl(prisma: PrismaClient, url: string | null): Promise<void> {
  if (url === null) { await prisma.appSetting.deleteMany({ where: { key: KEY } }); return; }
  await prisma.appSetting.upsert({ where: { key: KEY }, update: { value: url }, create: { key: KEY, value: url } });
}
