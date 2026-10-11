import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { AppError, errorHandler } from './error-handler.js';

function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
  return res as unknown as Response & { statusCode: number; body: { error: string; details?: string; code?: string } };
}

describe('errorHandler', () => {
  it('includes the machine-readable code when the AppError carries one', () => {
    const res = fakeRes();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorHandler(new AppError(409, 'Entry already listed', undefined, 'duplicate'), {} as Request, res, (() => undefined) as NextFunction);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'Entry already listed', details: undefined, code: 'duplicate' });
  });
  it('omits code when absent', () => {
    const res = fakeRes();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    errorHandler(new AppError(400, 'bad'), {} as Request, res, (() => undefined) as NextFunction);
    expect(res.body).toEqual({ error: 'bad', details: undefined });
  });
});
