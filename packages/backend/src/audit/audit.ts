import type { Request } from 'express';
import type { AuditAction } from '@mc/common';
import { logger } from '../utils/logger.js';

export async function audit(req: Request, action: AuditAction, detail?: string): Promise<void> {
  const prisma = req.app.locals.prisma;
  const u = req.user;
  if (!u) return;
  try {
    await prisma.auditLog.create({ data: { userId: u.id, username: u.username, action, detail: detail ?? null, ip: req.ip ?? null } });
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}
