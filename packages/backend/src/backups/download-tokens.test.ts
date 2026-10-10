import { describe, it, expect, vi, afterEach } from 'vitest';
import { DownloadTokenStore } from './download-tokens.js';

afterEach(() => { vi.useRealTimers(); });

describe('DownloadTokenStore', () => {
  it('issues a 64-hex-char token that can be consumed exactly once', () => {
    const store = new DownloadTokenStore();
    const token = store.issue('w.tgz', 1);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(store.consume(token)).toEqual({ name: 'w.tgz', userId: 1 });
    expect(store.consume(token)).toBeNull();
  });

  it('rejects an unknown token', () => {
    expect(new DownloadTokenStore().consume('nope')).toBeNull();
  });

  it('rejects a token after 60 s', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = new DownloadTokenStore();
    const token = store.issue('w.tgz', 1);
    vi.advanceTimersByTime(60_001);
    expect(store.consume(token)).toBeNull();
  });

  it('sweeps expired tokens on issue()', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = new DownloadTokenStore();
    store.issue('a.tgz', 1);
    vi.advanceTimersByTime(60_001);
    store.issue('b.tgz', 1);
    expect(store.size()).toBe(1);
  });
});
