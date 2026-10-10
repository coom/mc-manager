import { EventEmitter } from 'events';
import { isIP } from 'net';
import { AppError } from '../middleware/error-handler.js';
import { stripColors } from '../rcon/parsers.js';

const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MAX_REASON = 100;

export function assertName(v: unknown): string {
  if (typeof v !== 'string' || !NAME_RE.test(v)) throw new AppError(400, 'Invalid player name');
  return v;
}
export function assertIp(v: unknown): string {
  if (typeof v !== 'string' || isIP(v.trim()) === 0 || v !== v.trim()) throw new AppError(400, 'Invalid IP address');
  return v;
}
/** Raison optionnelle : absente ou vide → undefined ; une ligne de 1 à 100 caractères sinon. */
export function assertReason(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new AppError(400, 'Invalid reason');
  const r = v.trim();
  if (!r) return undefined;
  if (r.length > MAX_REASON || /[\r\n]/.test(r)) throw new AppError(400, `Reason must be a single line of at most ${MAX_REASON} characters`);
  return r;
}

interface Rule { re: RegExp; status: number; message: string }
const ALREADY: Rule = { re: /nothing changed|already|isn't|is not/i, status: 409, message: 'Nothing changed' };
const UNKNOWN: Rule = { re: /does not exist|no player was found|unknown player/i, status: 404, message: 'Player not found' };
const BAD_IP: Rule = { re: /invalid ip/i, status: 400, message: 'Invalid IP address' };
const withReason = (cmd: string, reason?: string) => (reason ? `${cmd} ${reason}` : cmd);

/**
 * Commandes d'administration des joueurs. Les arguments sont validés ici, avant tout envoi :
 * rien d'autre qu'un nom, une IP ou une raison sur une ligne n'atteint la console RCON.
 */
export class PlayerAdmin extends EventEmitter {
  constructor(private rcon: { send(cmd: string): Promise<string> }) { super(); }

  private async run(cmd: string, ok: RegExp, rules: Rule[], changesLists = true): Promise<string> {
    const raw = stripColors(await this.rcon.send(cmd)).trim();
    if (ok.test(raw)) { if (changesLists) this.emit('listsChanged'); return raw; }
    for (const r of rules) if (r.re.test(raw)) throw new AppError(r.status, r.message, raw);
    throw new AppError(502, 'Unexpected server response', raw);
  }

  // async : une erreur de validation doit être un rejet de promesse, pas une exception synchrone.
  async kick(name: unknown, reason?: unknown): Promise<string> {
    return this.run(withReason(`kick ${assertName(name)}`, assertReason(reason)), /^Kicked /, [UNKNOWN], false);
  }
  async ban(name: unknown, reason?: unknown): Promise<string> {
    return this.run(withReason(`ban ${assertName(name)}`, assertReason(reason)), /^Banned /, [ALREADY, UNKNOWN]);
  }
  async banIp(ip: unknown, reason?: unknown): Promise<string> {
    return this.run(withReason(`ban-ip ${assertIp(ip)}`, assertReason(reason)), /^Banned IP/, [ALREADY, BAD_IP]);
  }
  async pardon(name: unknown): Promise<string> { return this.run(`pardon ${assertName(name)}`, /^Unbanned /, [ALREADY, UNKNOWN]); }
  async pardonIp(ip: unknown): Promise<string> { return this.run(`pardon-ip ${assertIp(ip)}`, /^Unbanned IP/, [ALREADY, BAD_IP]); }
  async op(name: unknown): Promise<string> { return this.run(`op ${assertName(name)}`, /^Made .* a server operator/, [ALREADY, UNKNOWN]); }
  async deop(name: unknown): Promise<string> { return this.run(`deop ${assertName(name)}`, /^Made .* no longer a server operator/, [ALREADY, UNKNOWN]); }
  async whitelistAdd(name: unknown): Promise<string> {
    const r = await this.run(`whitelist add ${assertName(name)}`, /^Added /, [ALREADY, UNKNOWN]);
    await this.rcon.send('whitelist reload').catch(() => undefined);
    return r;
  }
  async whitelistRemove(name: unknown): Promise<string> {
    const r = await this.run(`whitelist remove ${assertName(name)}`, /^Removed /, [ALREADY, UNKNOWN]);
    await this.rcon.send('whitelist reload').catch(() => undefined);
    return r;
  }
  async whitelistEnabled(on: boolean): Promise<string> {
    return this.run(on ? 'whitelist on' : 'whitelist off', on ? /^Turned on/ : /^Turned off/, [ALREADY]);
  }
}
