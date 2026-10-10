import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { worldDirs, worldSize } from './disk.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('worldDirs', () => {
  it('defaults to world, world_nether and world_the_end', () => {
    expect(worldDirs('/data', {})).toEqual([path.join('/data', 'world'), path.join('/data', 'world_nether'), path.join('/data', 'world_the_end')]);
  });
  it('follows level-name', () => {
    expect(worldDirs('/data', { 'level-name': 'survie' })).toEqual([path.join('/data', 'survie'), path.join('/data', 'survie_nether'), path.join('/data', 'survie_the_end')]);
  });
  it('falls back to world when level-name is empty', () => {
    expect(worldDirs('/data', { 'level-name': '' })[0]).toBe(path.join('/data', 'world'));
  });
});

describe('worldSize', () => {
  it('sums the existing dimension folders (Paper layout) and ignores missing ones', async () => {
    const data = mkdtempSync(path.join(tmpdir(), 'mc-world-'));
    dirs.push(data);
    mkdirSync(path.join(data, 'survie', 'region'), { recursive: true });
    writeFileSync(path.join(data, 'survie', 'region', 'r.0.0.mca'), 'x'.repeat(100));
    mkdirSync(path.join(data, 'survie_nether'));
    writeFileSync(path.join(data, 'survie_nether', 'level.dat'), 'x'.repeat(20));
    mkdirSync(path.join(data, 'world'));
    writeFileSync(path.join(data, 'world', 'ignored'), 'x'.repeat(999));
    expect(await worldSize(data, { 'level-name': 'survie' })).toBe(120);
  });
});
