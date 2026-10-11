import { describe, it, expect } from 'vitest';
import { serverTypeOf, modrinthSource, COMPOSE_LINE } from './server-type.js';

describe('serverTypeOf', () => {
  it('maps mod loaders to mods/ and plugin servers to plugins/', () => {
    expect(serverTypeOf(['TYPE=FABRIC'])).toEqual({ loader: 'fabric', dir: 'mods' });
    expect(serverTypeOf(['TYPE=neoforge'])).toEqual({ loader: 'neoforge', dir: 'mods' });
    expect(serverTypeOf(['TYPE=PAPER'])).toEqual({ loader: 'paper', dir: 'plugins' });
    expect(serverTypeOf(['TYPE=Purpur'])).toEqual({ loader: 'purpur', dir: 'plugins' });
  });
  it('returns null for vanilla, unknown types and a missing variable', () => {
    expect(serverTypeOf(['TYPE=VANILLA'])).toBeNull();
    expect(serverTypeOf(['TYPE=CUSTOM'])).toBeNull();
    expect(serverTypeOf(['EULA=TRUE'])).toBeNull();
    expect(serverTypeOf([])).toBeNull();
  });
});

describe('modrinthSource', () => {
  it('detects the managed listing file', () => {
    expect(modrinthSource(['MODRINTH_PROJECTS=@/data/mc-manager/modrinth-projects.txt'])).toEqual({ source: 'file', inlineEntries: [] });
  });
  it('splits an inline list on commas and newlines, trimming blanks', () => {
    expect(modrinthSource(['MODRINTH_PROJECTS=fabric-api, lithium\nkrypton,,'])).toEqual({ source: 'inline', inlineEntries: ['fabric-api', 'lithium', 'krypton'] });
  });
  it('reports another listing file as other, and an empty or missing variable as none', () => {
    expect(modrinthSource(['MODRINTH_PROJECTS=@/extras/mods.txt'])).toEqual({ source: 'other', inlineEntries: [] });
    expect(modrinthSource(['MODRINTH_PROJECTS='])).toEqual({ source: 'none', inlineEntries: [] });
    expect(modrinthSource([])).toEqual({ source: 'none', inlineEntries: [] });
  });
  it('exposes the compose line', () => {
    expect(COMPOSE_LINE).toBe('MODRINTH_PROJECTS: "@/data/mc-manager/modrinth-projects.txt"');
  });
});
