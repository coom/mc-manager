import { readFile } from 'fs/promises';
import path from 'path';

function unescapeValue(v: string): string {
  return v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
}

export function parseServerProperties(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const idx = line.search(/(?<!\\)[=:]/);
    if (idx === -1) { out[unescapeValue(line)] = ''; continue; }
    out[unescapeValue(line.slice(0, idx).trim())] = unescapeValue(line.slice(idx + 1).trim());
  }
  return out;
}

export async function readServerProperties(dataDir: string): Promise<Record<string, string>> {
  const text = await readFile(path.join(dataDir, 'server.properties'), 'utf8');
  return parseServerProperties(text);
}

export function rconSettings(props: Record<string, string>): { enabled: boolean; port: number; password: string | null } {
  const port = parseInt(props['rcon.port'] || '25575', 10);
  return {
    enabled: props['enable-rcon'] === 'true',
    port: Number.isInteger(port) ? port : 25575,
    password: props['rcon.password'] ? props['rcon.password'] : null,
  };
}
