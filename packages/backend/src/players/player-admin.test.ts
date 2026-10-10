import { describe, it, expect, vi } from 'vitest';
import { PlayerAdmin, assertName, assertIp, assertReason } from './player-admin.js';
import { AppError } from '../middleware/error-handler.js';

function admin(responses: Record<string, string>) {
  const send = vi.fn(async (cmd: string) => responses[cmd] ?? 'Unknown or incomplete command');
  const a = new PlayerAdmin({ send });
  const changed = vi.fn(); a.on('listsChanged', changed);
  return { a, send, changed };
}
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection'); }, (e) => e as AppError);

describe('validation', () => {
  it.each(['Alice', 'a_b_c', 'x'.repeat(16)])('accepts %s', (n) => expect(assertName(n)).toBe(n));
  it.each(['ab', 'a-b', 'x'.repeat(17), 'Alice reason', '', 42, null, 'say hi'])('rejects %j', (n) => expect(() => assertName(n)).toThrow(AppError));
  it.each(['1.2.3.4', '2001:db8::1'])('accepts ip %s', (ip) => expect(assertIp(ip)).toBe(ip));
  it.each(['1.2.3.4 reason', '::1\nsay hi', 'Alice', '', '1.2.3'])('rejects ip %j', (ip) => expect(() => assertIp(ip)).toThrow(AppError));
  it('accepts an optional reason and strips it', () => {
    expect(assertReason(undefined)).toBeUndefined();
    expect(assertReason('')).toBeUndefined();
    expect(assertReason('  griefing ')).toBe('griefing');
  });
  it.each(['a\nb', 'a\rb', 'x'.repeat(101)])('rejects reason %j', (r) => expect(() => assertReason(r)).toThrow(AppError));
});

describe('PlayerAdmin commands', () => {
  it('kick with reason', async () => {
    const { a, send, changed } = admin({ 'kick Alice griefing': 'Kicked Alice: griefing' });
    expect(await a.kick('Alice', 'griefing')).toBe('Kicked Alice: griefing');
    expect(send).toHaveBeenCalledWith('kick Alice griefing');
    expect(changed).not.toHaveBeenCalled();
  });
  it('kick unknown player is 404', async () => {
    const { a } = admin({ 'kick Bob': 'No player was found' });
    expect((await fail(a.kick('Bob'))).statusCode).toBe(404);
  });
  it('ban and already banned', async () => {
    const { a, changed } = admin({ 'ban Alice': 'Banned Alice: Banned by an operator', 'ban Bob': 'Nothing changed. The player is already banned' });
    expect(await a.ban('Alice')).toMatch(/^Banned Alice/);
    expect(changed).toHaveBeenCalledOnce();
    expect((await fail(a.ban('Bob'))).statusCode).toBe(409);
  });
  it('ban unknown player is 404', async () => {
    const { a } = admin({ 'ban Zed': 'That player does not exist' });
    expect((await fail(a.ban('Zed'))).statusCode).toBe(404);
  });
  it('ban-ip and pardon-ip', async () => {
    const { a } = admin({ 'ban-ip 1.2.3.4 spam': 'Banned IP 1.2.3.4: spam', 'pardon-ip 1.2.3.4': 'Unbanned IP 1.2.3.4', 'ban-ip 5.6.7.8': 'Nothing changed. That IP is already banned' });
    expect(await a.banIp('1.2.3.4', 'spam')).toMatch(/^Banned IP/);
    expect(await a.pardonIp('1.2.3.4')).toMatch(/^Unbanned IP/);
    expect((await fail(a.banIp('5.6.7.8'))).statusCode).toBe(409);
  });
  it('pardon, op, deop', async () => {
    const { a } = admin({ 'pardon Alice': 'Unbanned Alice', 'op Alice': 'Made Alice a server operator', 'deop Alice': 'Made Alice no longer a server operator', 'pardon Bob': "Nothing changed. The player isn't banned", 'op Bob': 'Nothing changed. The player already is an operator' });
    expect(await a.pardon('Alice')).toBe('Unbanned Alice');
    expect(await a.op('Alice')).toMatch(/server operator/);
    expect(await a.deop('Alice')).toMatch(/no longer/);
    expect((await fail(a.pardon('Bob'))).statusCode).toBe(409);
    expect((await fail(a.op('Bob'))).statusCode).toBe(409);
  });
  it('whitelist add/remove reload the list, on/off', async () => {
    const { a, send } = admin({ 'whitelist add Alice': 'Added Alice to the whitelist', 'whitelist reload': 'Reloaded the whitelist', 'whitelist remove Alice': 'Removed Alice from the whitelist', 'whitelist on': 'Turned on the whitelist', 'whitelist off': 'Turned off the whitelist', 'whitelist add Bob': 'Player is already whitelisted', 'whitelist add Zed': 'That player does not exist' });
    expect(await a.whitelistAdd('Alice')).toMatch(/^Added/);
    expect(send.mock.calls.map((c) => c[0])).toEqual(['whitelist add Alice', 'whitelist reload']);
    expect(await a.whitelistRemove('Alice')).toMatch(/^Removed/);
    expect(await a.whitelistEnabled(true)).toMatch(/Turned on/);
    expect(await a.whitelistEnabled(false)).toMatch(/Turned off/);
    expect((await fail(a.whitelistAdd('Bob'))).statusCode).toBe(409);
    expect((await fail(a.whitelistAdd('Zed'))).statusCode).toBe(404);
  });
  it('unexpected response is 502 with the raw text as details', async () => {
    const { a, changed } = admin({ 'op Alice': 'Unknown or incomplete command, see below for error' });
    const err = await fail(a.op('Alice'));
    expect(err.statusCode).toBe(502);
    expect(err.details).toContain('Unknown or incomplete');
    expect(changed).not.toHaveBeenCalled();
  });
  it('strips color codes before matching', async () => {
    const { a } = admin({ 'op Alice': '§aMade Alice a server operator§r' });
    expect(await a.op('Alice')).toBe('Made Alice a server operator');
  });
  it('validates before sending', async () => {
    const { a, send } = admin({});
    await expect(a.kick('a b')).rejects.toBeInstanceOf(AppError);
    await expect(a.banIp('1.2.3.4 x')).rejects.toBeInstanceOf(AppError);
    expect(send).not.toHaveBeenCalled();
  });
  it('propagates a 503 from rcon', async () => {
    const a = new PlayerAdmin({ send: vi.fn().mockRejectedValue(new AppError(503, 'RCON not connected')) });
    expect((await fail(a.op('Alice'))).statusCode).toBe(503);
  });
});
