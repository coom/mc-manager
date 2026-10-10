export interface OnlinePlayer { name: string; uuid: string | null; joinedAt: string; country: string | null; hasIp: boolean }
export type SessionSource = 'log' | 'reconciled';
export interface PlayerSessionEntry {
  id: number; uuid: string | null; name: string; source: SessionSource;
  joinedAt: string; leftAt: string | null;
  /** Absents pour un viewer. */
  ip?: string | null; country?: string | null;
}
export interface PlayerSummary {
  uuid: string | null; name: string; online: boolean; lastSeenAt: string; sessionCount: number;
  op: boolean; whitelisted: boolean; banned: boolean;
}
export interface VanillaStats {
  playTimeSeconds: number | null; deaths: number | null; playerKills: number | null; mobKills: number | null;
  distanceMeters: number | null; jumps: number | null; damageTaken: number | null; blocksMined: number | null; itemsCrafted: number | null;
}
export interface PlayerSheet {
  uuid: string; name: string; previousNames: string[]; online: boolean; op: boolean; whitelisted: boolean; banned: boolean;
  lastSeenAt: string | null; sessionCount: number; playTimeObservedSeconds: number;
  sessions: PlayerSessionEntry[];
  /** 30 derniers jours, `day` au format YYYY-MM-DD (UTC). */
  daily: { day: string; minutes: number }[];
  stats: VanillaStats | null;
}
export interface WhitelistEntry { uuid: string; name: string }
export interface OpEntry { uuid: string; name: string; level: number; bypassesPlayerLimit: boolean }
export interface BannedPlayer { uuid: string; name: string; created: string; source: string; expires: string; reason: string }
export interface BannedIp { ip: string; created: string; source: string; expires: string; reason: string }
export interface ServerLists { whitelist: WhitelistEntry[]; ops: OpEntry[]; bannedPlayers: BannedPlayer[]; bannedIps: BannedIp[]; whitelistEnabled: boolean }
