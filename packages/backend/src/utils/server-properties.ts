import { readFile } from 'fs/promises';
import path from 'path';

function unescapeValue(v: string): string {
  return v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c));
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

export const KEY_RE = /^[a-z0-9._-]+$/;
export const MAX_PROPERTIES_BYTES = 64 * 1024;
const LINE_RE = /^([^=:\s]+)\s*[=:]\s*(.*)$/;

/** Échappement Java Properties pour une valeur : backslash, séparateurs et marqueurs de commentaire. */
export function escapeValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/:/g, '\\:').replace(/#/g, '\\#').replace(/!/g, '\\!').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/^ /, '\\ ');
}

/**
 * Met à jour des clés dans le texte existant : les lignes connues sont réécrites en place (clé=valeur),
 * commentaires, ordre et lignes inconnues conservés, clés absentes ajoutées à la fin. Sortie en LF avec LF final.
 */
export function updateServerProperties(text: string, values: Record<string, string>): string {
  const pending = new Map(Object.entries(values));
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const out: string[] = [];
  const done = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) { out.push(line); continue; }
    const m = LINE_RE.exec(trimmed);
    const key = m ? unescapeValue(m[1]) : null;
    if (key === null || !Object.hasOwn(values, key)) { out.push(line); continue; }
    if (done.has(key)) continue; // doublon d'une clé mise à jour : supprimé (parse garde la dernière occurrence)
    done.add(key); pending.delete(key);
    out.push(`${key}=${escapeValue(values[key])}`);
  }
  for (const [k, v] of pending) out.push(`${k}=${escapeValue(v)}`);
  return out.join('\n') + '\n';
}

/** Validation du mode brut : commentaires, lignes vides ou `clé=valeur` / `clé:valeur` avec une clé valide. */
export function validateRawProperties(text: string): string | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_PROPERTIES_BYTES) return 'Content exceeds 64 KiB';
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    const m = LINE_RE.exec(t);
    if (!m || !KEY_RE.test(m[1])) return `Invalid line ${i + 1}: expected key=value with a lowercase key`;
  }
  return null;
}

export function maskRconPassword(text: string): string {
  return text.replace(/^(\s*rcon\.password\s*[=:]\s*).*$/gm, '$1********');
}
