import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { isValidEntry, slugOf, prefixOf, parseListing, serializeListing, readListing, writeListing } from './listing-file.js';

describe('entry grammar', () => {
  it('accepts the itzg forms', () => {
    for (const e of ['lithium', 'fabric-api', 'lithium:0.14.0', 'lithium:Oa9ZDzZq', 'c2me-fabric:alpha+', 'pl3xmap?', 'fabric:sodium:beta', 'datapack:terralith', 'PAPER:chunky']) expect(isValidEntry(e), e).toBe(true);
  });
  it('rejects spaces, separators, comments and short names', () => {
    for (const e of ['', 'ab', 'li thium', '../x', 'a/b', '#lithium', 'lithium:0.1 4', 'lithium\n', 'a'.repeat(65)]) expect(isValidEntry(e), JSON.stringify(e)).toBe(false);
  });
  it('extracts the slug in lower case, without prefix, version or ?', () => {
    expect(slugOf('Lithium')).toBe('lithium');
    expect(slugOf('lithium:0.14.0')).toBe('lithium');
    expect(slugOf('fabric:sodium:beta')).toBe('sodium');
    expect(slugOf('pl3xmap?')).toBe('pl3xmap');
    expect(slugOf('paper:chunky')).toBe('chunky');
    expect(prefixOf('fabric:sodium')).toBe('fabric');
    expect(prefixOf('lithium:0.14.0')).toBeNull();
  });
});

describe('parseListing / serializeListing', () => {
  it('classifies lines and keeps the raw text of unmanaged ones', () => {
    // Un commentaire d'un seul mot (`# header`) est indiscernable d'une entrée désactivée : seuls les
    // commentaires à plusieurs mots ou de forme non valide sont conservés comme tels.
    const lines = parseListing('# my header\n\nfabric-api\n# lithium\n#krypton\n#  spark\nbad entry\n## note\n');
    expect(lines).toEqual([
      { kind: 'comment', raw: '# my header' },
      { kind: 'blank', raw: '' },
      { kind: 'entry', entry: 'fabric-api', raw: 'fabric-api' },
      { kind: 'disabled', entry: 'lithium', raw: '# lithium' },
      { kind: 'disabled', entry: 'krypton', raw: '#krypton' },
      { kind: 'disabled', entry: 'spark', raw: '#  spark' },
      { kind: 'invalid', raw: 'bad entry' },
      { kind: 'comment', raw: '## note' },
    ]);
  });
  it('tolerates CRLF and trims surrounding spaces of entries', () => {
    const lines = parseListing('fabric-api\r\n  lithium  \r\n');
    expect(lines).toEqual([{ kind: 'entry', entry: 'fabric-api', raw: 'fabric-api' }, { kind: 'entry', entry: 'lithium', raw: '  lithium  ' }]);
    expect(serializeListing(lines)).toBe('fabric-api\nlithium\n');
  });
  it('serializes disabled lines as "# entry" and unmanaged lines verbatim', () => {
    const text = '# my header\nfabric-api\n#krypton\nbad entry\n';
    expect(serializeListing(parseListing(text))).toBe('# my header\nfabric-api\n# krypton\nbad entry\n');
    expect(serializeListing([])).toBe('');
  });
});

describe('readListing / writeListing', () => {
  it('reports a missing file and writes atomically, creating the parent folder', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mc-listing-'));
    const file = path.join(dir, 'mc-manager', 'modrinth-projects.txt');
    expect(await readListing(file)).toEqual({ exists: false, lines: [] });
    await writeListing(file, [{ kind: 'entry', entry: 'lithium', raw: 'lithium' }, { kind: 'disabled', entry: 'spark', raw: '# spark' }]);
    expect(await readFile(file, 'utf8')).toBe('lithium\n# spark\n');
    expect(await readListing(file)).toEqual({ exists: true, lines: [{ kind: 'entry', entry: 'lithium', raw: 'lithium' }, { kind: 'disabled', entry: 'spark', raw: '# spark' }] });
    await writeFile(file, 'a\r\nb\r\n');
    expect((await readListing(file)).lines.map((l) => l.raw)).toEqual(['a', 'b']);
  });
});
