import { AppError } from '../middleware/error-handler.js';

export interface PageParams { page: number; limit: number; skip: number }

/** `page` ≥ 1, `limit` 1..100 (défaut 50) ; 400 sinon. */
export function parsePage(query: Record<string, unknown>): PageParams {
  const page = parseInt(String(query.page ?? '1'), 10);
  const limit = parseInt(String(query.limit ?? '50'), 10);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError(400, 'Invalid pagination');
  return { page, limit, skip: (page - 1) * limit };
}
