import type { PrismaClient } from '../../generated/prisma/index.js';
import type { OnlinePlayer, PlayerSessionEntry, PlayerSheet, ServerLists } from '@mc/common';
import { isUuid, readLists, readPlayerStats, readUserCache } from './data-files.js';

const DAY = 86_400_000;

/** Minutes jouées par jour UTC sur les `days` derniers jours, sessions ouvertes comptées jusqu'à `now`. */
export function dailyMinutes(sessions: { joinedAt: Date; leftAt: Date | null }[], now: Date, days = 30): { day: string; minutes: number }[] {
  const end = now.getTime();
  const start = Math.floor(end / DAY) * DAY - (days - 1) * DAY;
  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) buckets.set(new Date(start + i * DAY).toISOString().slice(0, 10), 0);
  for (const s of sessions) {
    let a = Math.max(s.joinedAt.getTime(), start);
    const b = Math.min((s.leftAt ?? now).getTime(), end);
    while (a < b) {
      const dayStart = Math.floor(a / DAY) * DAY;
      const segEnd = Math.min(b, dayStart + DAY);
      const key = new Date(dayStart).toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) ?? 0) + (segEnd - a));
      a = segEnd;
    }
  }
  return [...buckets].map(([day, ms]) => ({ day, minutes: Math.round(ms / 60_000) }));
}

export interface ListFlags { op: boolean; whitelisted: boolean; banned: boolean }
/** Drapeaux d'un joueur dans les listes du serveur, par UUID puis par nom (insensible à la casse). */
export function flagsFor(lists: ServerLists, uuid: string | null, name: string): ListFlags {
  const u = uuid?.toLowerCase();
  const n = name.toLowerCase();
  const has = (rows: { uuid?: string; name: string }[]) => rows.some((r) => (u && r.uuid?.toLowerCase() === u) || r.name.toLowerCase() === n);
  return { op: has(lists.ops), whitelisted: has(lists.whitelist), banned: has(lists.bannedPlayers) };
}

export function toSessionEntry(s: { id: number; uuid: string | null; name: string; ip: string | null; country: string | null; source: string; joinedAt: Date; leftAt: Date | null }, withIp: boolean): PlayerSessionEntry {
  const base: PlayerSessionEntry = { id: s.id, uuid: s.uuid, name: s.name, source: s.source as PlayerSessionEntry['source'], joinedAt: s.joinedAt.toISOString(), leftAt: s.leftAt ? s.leftAt.toISOString() : null };
  return withIp ? { ...base, ip: s.ip, country: s.country } : base;
}

export async function buildPlayerSheet(
  prisma: PrismaClient, dataDir: string, uuidRaw: string,
  opts: { withIp: boolean; online: OnlinePlayer[]; now?: Date },
): Promise<PlayerSheet | null> {
  if (!isUuid(uuidRaw)) return null;
  const uuid = uuidRaw.toLowerCase();
  const now = opts.now ?? new Date();
  const sessions = await prisma.playerSession.findMany({ where: { uuid }, orderBy: { joinedAt: 'desc' } });
  const cached = (await readUserCache(dataDir)).find((u) => u.uuid === uuid);
  if (sessions.length === 0 && !cached) return null;
  const name = sessions[0]?.name ?? cached!.name;
  const previousNames = [...new Set(sessions.map((s) => s.name).filter((n) => n !== name))];
  const lists = await readLists(dataDir);
  const online = opts.online.some((p) => p.uuid === uuid || p.name.toLowerCase() === name.toLowerCase());
  const last = sessions[0];
  const lastSeenAt = online ? now.toISOString() : last ? (last.leftAt ?? last.joinedAt).toISOString() : null;
  const playTimeObservedSeconds = Math.round(sessions.reduce((sum, s) => sum + ((s.leftAt ?? now).getTime() - s.joinedAt.getTime()), 0) / 1000);
  return {
    uuid, name, previousNames, online, ...flagsFor(lists, uuid, name),
    lastSeenAt, sessionCount: sessions.length, playTimeObservedSeconds,
    sessions: sessions.slice(0, 30).map((s) => toSessionEntry(s, opts.withIp)),
    daily: dailyMinutes(sessions, now),
    stats: await readPlayerStats(dataDir, uuid),
  };
}
