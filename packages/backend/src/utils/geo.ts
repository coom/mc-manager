import { isIP } from 'net';
import geoip from 'geoip-lite';

export interface GeoResult {
  country: string | null; // ISO 3166-1 alpha-2
  isPrivate: boolean;
}

/**
 * Ramène une adresse telle que Minecraft ou Express la donnent à une IP nue :
 * `[2001:db8::1]:51234`, `1.2.3.4:51234`, `0:0:0:0:0:0:0:1:51234`, `::ffff:1.2.3.4`.
 */
export function normalizeIp(raw: string): string {
  let ip = (raw || '').trim();
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracket) ip = bracket[1];
  else if (!isIP(ip)) {
    // Un suffixe :port sur une IPv4 ou une IPv6 en forme longue (le reste doit rester une IP valide).
    const i = ip.lastIndexOf(':');
    if (i > 0 && isIP(ip.slice(0, i))) ip = ip.slice(0, i);
  }
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    if (isIP(v4) === 4) ip = v4;
  }
  return ip;
}

export function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') return true;
  if (/^127\./.test(ip)) return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(ip)) return true;
  if (/^fe[89ab][0-9a-f]:/i.test(ip)) return true;
  return false;
}

export function lookupCountry(rawIp: string): GeoResult {
  const ip = normalizeIp(rawIp);
  if (!ip || !isIP(ip)) return { country: null, isPrivate: false };
  if (isPrivateIp(ip)) return { country: null, isPrivate: true };
  try {
    const geo = geoip.lookup(ip);
    return { country: geo?.country || null, isPrivate: false };
  } catch {
    return { country: null, isPrivate: false };
  }
}
