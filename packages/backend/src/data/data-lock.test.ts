import { describe, it, expect } from 'vitest';
import { DataLock } from './data-lock.js';
import { AppError } from '../middleware/error-handler.js';

describe('DataLock', () => {
  it('is free by default and reports the holder', () => {
    const lock = new DataLock();
    expect(lock.busy).toBeNull();
    const release = lock.acquire('restore');
    expect(lock.busy).toBe('restore');
    release();
    expect(lock.busy).toBeNull();
  });
  it('refuses a second acquire with 409 naming the running operation', () => {
    const lock = new DataLock();
    lock.acquire('backup');
    const err = (() => { try { lock.acquire('restore'); return null; } catch (e) { return e as AppError; } })();
    expect(err).toBeInstanceOf(AppError);
    expect(err?.statusCode).toBe(409);
    expect(err?.message).toBe('Another operation is running: backup');
  });
  it('assertFree throws only while busy', () => {
    const lock = new DataLock();
    expect(() => lock.assertFree()).not.toThrow();
    const release = lock.acquire('properties');
    expect(() => lock.assertFree()).toThrow(AppError);
    release();
    expect(() => lock.assertFree()).not.toThrow();
  });
  it('release is idempotent and never frees a later holder', () => {
    const lock = new DataLock();
    const r1 = lock.acquire('backup');
    r1(); r1();
    const r2 = lock.acquire('restore');
    r1();
    expect(lock.busy).toBe('restore');
    r2();
    expect(lock.busy).toBeNull();
  });
});
