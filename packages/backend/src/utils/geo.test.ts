import { describe, it, expect } from 'vitest';
import { normalizeIp, isPrivateIp, lookupCountry } from './geo.js';

describe('normalizeIp', () => {
  it.each([
    ['1.2.3.4:51234', '1.2.3.4'],
    ['::ffff:1.2.3.4', '1.2.3.4'],
    ['::ffff:1.2.3.4:51234', '1.2.3.4'],
    ['[2001:db8::1]:51234', '2001:db8::1'],
    ['0:0:0:0:0:0:0:1:51234', '0:0:0:0:0:0:0:1'],
    ['2001:db8::1', '2001:db8::1'],
    ['  10.0.0.5 ', '10.0.0.5'],
    ['', ''],
  ])('%s -> %s', (raw, expected) => expect(normalizeIp(raw)).toBe(expected));
});

describe('isPrivateIp', () => {
  it.each(['127.0.0.1', '::1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', 'fd12::1', 'fe80::1'])('%s is private', (ip) => expect(isPrivateIp(ip)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '2001:db8::1'])('%s is public', (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe('lookupCountry', () => {
  it('resolves a public IPv4 to an ISO code', () => {
    const r = lookupCountry('8.8.8.8:1234');
    expect(r.isPrivate).toBe(false);
    expect(r.country).toMatch(/^[A-Z]{2}$/);
  });
  it('flags private ranges without a country', () => {
    expect(lookupCountry('192.168.0.10:25565')).toEqual({ country: null, isPrivate: true });
  });
  it('returns null for an empty or invalid input', () => {
    expect(lookupCountry('')).toEqual({ country: null, isPrivate: false });
    expect(lookupCountry('not-an-ip')).toEqual({ country: null, isPrivate: false });
  });
});
