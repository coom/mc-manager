import yauzl from 'yauzl';
import type { JarMeta, ModsDir } from '@mc/common';

export type JarLoader = 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'paper';
export interface JarInfo { found: { loader: JarLoader; meta: JarMeta | null }[] }
/** Au-delà, le descripteur est ignoré (meta null) : un jar piégé ne doit pas remplir la mémoire. */
export const DESCRIPTOR_LIMIT = 1024 * 1024;

export class JarError extends Error {
  code = 'not_a_jar' as const;
  constructor(message: string) { super(message); this.name = 'JarError'; }
}

const DESCRIPTORS: Record<string, JarLoader> = {
  'fabric.mod.json': 'fabric',
  'quilt.mod.json': 'quilt',
  'META-INF/neoforge.mods.toml': 'neoforge',
  'META-INF/mods.toml': 'forge',
  'paper-plugin.yml': 'paper',
  'plugin.yml': 'paper',
};

const str = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null);
const unquote = (s: string): string => s.trim().replace(/^(["'])(.*)\1$/, '$2').trim();
const tomlKey = (text: string, key: string): string | null => { const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(text); return m ? str(m[1]) : null; };
const yamlKey = (text: string, key: string): string | null => { const m = new RegExp(`^${key}\\s*:\\s*(.+)$`, 'm').exec(text); return m ? str(unquote(m[1])) : null; };

/** Métadonnées du descripteur ; null si le contenu n'est pas exploitable (jamais d'exception). */
export function parseDescriptor(loader: JarLoader, text: string): JarMeta | null {
  try {
    if (loader === 'fabric') { const j = JSON.parse(text) as Record<string, unknown>; return { id: str(j.id), name: str(j.name), version: str(j.version) }; }
    if (loader === 'quilt') {
      const j = JSON.parse(text) as { quilt_loader?: Record<string, unknown>; metadata?: Record<string, unknown> };
      return { id: str(j.quilt_loader?.id), name: str(j.metadata?.name), version: str(j.quilt_loader?.version) };
    }
    if (loader === 'forge' || loader === 'neoforge') return { id: tomlKey(text, 'modId'), name: tomlKey(text, 'displayName'), version: tomlKey(text, 'version') };
    const name = yamlKey(text, 'name');
    return { id: name, name, version: yamlKey(text, 'version') };
  } catch { return null; }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true }, (err, zf) => (err || !zf ? reject(err ?? new Error('no zipfile')) : resolve(zf))));
}

/** Lit une entrée jusqu'à DESCRIPTOR_LIMIT octets ; null si elle dépasse. */
function readEntry(zf: yauzl.ZipFile, entry: yauzl.Entry): Promise<string | null> {
  return new Promise((resolve, reject) => {
    if (entry.uncompressedSize > DESCRIPTOR_LIMIT) { resolve(null); return; }
    zf.openReadStream(entry, (err, stream) => {
      if (err || !stream) { reject(err ?? new Error('no stream')); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => { size += c.length; if (size > DESCRIPTOR_LIMIT) { stream.destroy(); resolve(null); return; } chunks.push(c); });
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      stream.on('error', reject);
    });
  });
}

/** Parcourt l'archive sans rien extraire sur le disque et renvoie les descripteurs trouvés dans l'ordre de l'archive. */
export async function inspectJar(file: string): Promise<JarInfo> {
  let zf: yauzl.ZipFile;
  try { zf = await openZip(file); }
  catch (err) { throw new JarError(`Not a zip archive: ${(err as Error).message}`); }
  const found: JarInfo['found'] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('error', (err: Error) => reject(new JarError(`Corrupt archive: ${err.message}`)));
      zf.on('end', resolve);
      zf.on('entry', (entry: yauzl.Entry) => {
        const loader = DESCRIPTORS[entry.fileName];
        if (!loader) { zf.readEntry(); return; }
        readEntry(zf, entry)
          .then((text) => { found.push({ loader, meta: text === null ? null : parseDescriptor(loader, text) }); zf.readEntry(); })
          .catch((err) => reject(new JarError(`Corrupt entry ${entry.fileName}: ${(err as Error).message}`)));
      });
      zf.readEntry();
    });
  } finally { zf.close(); }
  return { found };
}

const FAMILY: Record<string, JarLoader[]> = {
  fabric: ['fabric', 'quilt'], quilt: ['quilt', 'fabric'],
  forge: ['forge', 'neoforge'], neoforge: ['neoforge', 'forge'],
  paper: ['paper'], spigot: ['paper'], bukkit: ['paper'], purpur: ['paper'], folia: ['paper'],
};

/** Le descripteur compatible avec le serveur (le loader exact d'abord, puis sa famille), ou null. */
export function pickLoader(info: JarInfo, dir: ModsDir, serverLoader: string): { loader: JarLoader; meta: JarMeta | null } | null {
  const accepted = FAMILY[serverLoader] ?? (dir === 'plugins' ? ['paper'] : []);
  for (const l of accepted) { const hit = info.found.find((f) => f.loader === l); if (hit) return hit; }
  return null;
}
