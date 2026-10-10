import { execSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { PrismaClient } from '../generated/prisma/index.js';

export function testPrisma(): PrismaClient {
  const dir = mkdtempSync(path.join(tmpdir(), 'mc-test-'));
  const url = `file:${path.join(dir, 'test.db')}`;
  execSync('npx prisma db push --skip-generate --accept-data-loss', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  return new PrismaClient({ datasources: { db: { url } } });
}
