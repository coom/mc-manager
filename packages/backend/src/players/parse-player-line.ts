import type { LoginFailureReason } from '@mc/common';
import { normalizeIp } from '../utils/geo.js';

export type PlayerEvent =
  | { type: 'uuid'; name: string; uuid: string }
  | { type: 'join'; name: string; ip: string }
  | { type: 'leave'; name: string }
  | { type: 'refused'; name: string; ip: string | null; message: string };

const NAME = '([A-Za-z0-9_]{3,16})';
const RE_UUID = new RegExp(`^UUID of player ${NAME} is ([0-9a-fA-F-]{36})$`);
const RE_JOIN = new RegExp(`^${NAME}\\[/(.+?)\\] logged in with entity id \\d+`);
const RE_LEAVE = new RegExp(`^${NAME} left the game$`);
const RE_LOST = new RegExp(`^${NAME} lost connection: `);
const RE_REFUSED = new RegExp(`^Disconnecting ${NAME} \\(/(.+?)\\): (.*)$`);
const RE_REFUSED_PROFILE = /^Disconnecting com\.mojang\.authlib\.GameProfile@\S*?\[.*?name=([A-Za-z0-9_]{3,16}).*?\] \(\/(.+?)\): (.*)$/;

/** Applique au champ `message` d'une LogLine (niveau et thread déjà retirés). */
export function parsePlayerLine(message: string): PlayerEvent | null {
  // Un message de chat est encadré de <pseudo> : tout ce qu'il contient est du texte de joueur.
  if (message.startsWith('<')) return null;
  let m: RegExpExecArray | null;
  if ((m = RE_UUID.exec(message))) return { type: 'uuid', name: m[1], uuid: m[2].toLowerCase() };
  if ((m = RE_JOIN.exec(message))) return { type: 'join', name: m[1], ip: normalizeIp(m[2]) };
  if ((m = RE_LEAVE.exec(message)) || (m = RE_LOST.exec(message))) return { type: 'leave', name: m[1] };
  if ((m = RE_REFUSED.exec(message)) || (m = RE_REFUSED_PROFILE.exec(message))) {
    const ip = normalizeIp(m[2]);
    return { type: 'refused', name: m[1], ip: ip || null, message: m[3].trim() };
  }
  return null;
}

export function classifyRefusal(message: string): LoginFailureReason {
  const s = message.toLowerCase();
  if (s.includes('white-list') || s.includes('whitelist')) return 'not_whitelisted';
  if (s.includes('banned')) return 'banned';
  if (s.includes('full')) return 'full';
  return 'other';
}
