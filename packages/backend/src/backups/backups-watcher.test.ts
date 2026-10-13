import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { watchBackups } from './backups-watcher.js';

class FakeWatcher extends EventEmitter { closed = false; close() { this.closed = true; } }

function setup() {
  let listener!: (event: string, filename: string | Buffer | null) => void;
  const watcher = new FakeWatcher();
  const watch = vi.fn((_dir: string, l: typeof listener) => { listener = l; return watcher; });
  const onChange = vi.fn();
  const close = watchBackups('/b', onChange, { intervalMs: 2000, watch });
  return { emit: (f: string | Buffer | null) => listener('change', f), watcher, watch, onChange, close };
}

describe('watchBackups', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('watches the given folder and signals an archive change after the interval', () => {
    const { emit, watch, onChange } = setup();
    expect(watch).toHaveBeenCalledWith('/b', expect.any(Function));
    emit('world-20261013-120000.tgz');
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('signals at most once per interval during a burst, and always after the last change', () => {
    const { emit, onChange } = setup();
    emit('a.tgz'); vi.advanceTimersByTime(500);
    emit('a.tgz'); vi.advanceTimersByTime(1000);
    emit('a.tgz'); vi.advanceTimersByTime(500);
    expect(onChange).toHaveBeenCalledTimes(1);
    emit('a.tgz'); vi.advanceTimersByTime(1999);
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ignores the lock, the settings folder and non-archive files', () => {
    const { emit, onChange } = setup();
    for (const f of ['.mc-backup-lock', '.mc-manager', 'notes.txt', '.world.tgz.tmp']) emit(f);
    vi.advanceTimersByTime(10_000);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts .tar.gz, Buffer names and events without a file name', () => {
    const { emit, onChange } = setup();
    emit('b.tar.gz'); vi.advanceTimersByTime(2000);
    emit(Buffer.from('c.tgz')); vi.advanceTimersByTime(2000);
    emit(null); vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('close cancels a pending signal and closes the watcher', () => {
    const { emit, watcher, onChange, close } = setup();
    emit('a.tgz');
    close();
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
    expect(watcher.closed).toBe(true);
  });

  it('stops quietly when the watcher reports an error', () => {
    const { emit, watcher, onChange } = setup();
    emit('a.tgz');
    watcher.emit('error', new Error('folder removed'));
    vi.advanceTimersByTime(5000);
    expect(onChange).not.toHaveBeenCalled();
    expect(watcher.closed).toBe(true);
  });

  it('does not throw when the folder cannot be watched (the Refresh button remains)', () => {
    const onChange = vi.fn();
    const close = watchBackups('/missing', onChange, { watch: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } });
    expect(() => close()).not.toThrow();
  });

  it('a failing listener does not break the next signals', () => {
    const { emit, onChange } = setup();
    onChange.mockImplementationOnce(() => { throw new Error('broadcast failed'); });
    emit('a.tgz'); vi.advanceTimersByTime(2000);
    emit('a.tgz'); vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('watchBackups with the real fs.watch', () => {
  it('signals an archive written in the folder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mc-bkw-'));
    const onChange = vi.fn();
    const close = watchBackups(dir, onChange, { intervalMs: 50 });
    try {
      writeFileSync(path.join(dir, 'world-20261013-120000.tgz'), 'x');
      await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
