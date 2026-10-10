export const stripColors = (s: string) => s.replace(/§[0-9a-fk-or]/gi, '');

export function parseList(raw: string): { online: number; max: number; names: string[] } | null {
  const m = /There are (\d+) of a max of (\d+) players online:?\s*(.*)$/s.exec(stripColors(raw));
  if (!m) return null;
  const names = m[3].split(',').map((n) => n.trim()).filter(Boolean);
  return { online: parseInt(m[1], 10), max: parseInt(m[2], 10), names };
}

export function parseTickQuery(raw: string): { mspt: number; targetRate: number } | null {
  const s = stripColors(raw);
  const avg = /Average time per tick:\s*([\d.]+)\s*ms/i.exec(s);
  if (!avg) return null;
  const rate = /Target tick rate:\s*([\d.]+)/i.exec(s);
  return { mspt: parseFloat(avg[1]), targetRate: rate ? parseFloat(rate[1]) : 20 };
}

export function parseTps(raw: string): number | null {
  const m = /TPS from last 1m, 5m, 15m:\s*\*?([\d.]+)/i.exec(stripColors(raw));
  return m ? parseFloat(m[1]) : null;
}
