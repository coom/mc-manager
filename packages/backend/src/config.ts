import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Required secret. Fails closed rather than falling back to a published
 * default: JWT_SECRET signs every session, and ENCRYPTION_KEY protects the
 * stored secrets (TOTP secrets, etc.). A default that only aborts when
 * NODE_ENV is exactly "production" still ships a known signing key to any
 * deployment that runs the backend directly, under pm2 or under systemd.
 */
function requireSecret(name: 'JWT_SECRET' | 'ENCRYPTION_KEY'): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    console.error(`[FATAL] ${name} is not set. Generate one with: openssl rand -hex 32`);
    process.exit(1);
  }
  if (value.length < 32) {
    console.error(`[FATAL] ${name} is too short (${value.length} chars). Use at least 32; generate one with: openssl rand -hex 32`);
    process.exit(1);
  }
  return value;
}

export interface McConfig {
  container: string;
  backupContainer: string;
  rconHost: string;
  rconPort: number;
  dataDir: string;
  backupsDir: string;
  dockerSocket: string;
}

export function buildMcConfig(env: Record<string, string | undefined>): McConfig {
  const container = env.MC_CONTAINER?.trim();
  if (!container) throw new Error('MC_CONTAINER is not set');
  const backupContainer = env.MC_BACKUP_CONTAINER?.trim();
  if (!backupContainer) throw new Error('MC_BACKUP_CONTAINER is not set');
  const port = parseInt(env.MC_RCON_PORT || '25575', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MC_RCON_PORT is invalid');
  return {
    container,
    backupContainer,
    rconHost: env.MC_RCON_HOST?.trim() || container,
    rconPort: port,
    dataDir: env.MC_DATA_DIR || '/mc/data',
    backupsDir: env.MC_BACKUPS_DIR || '/mc/backups',
    dockerSocket: env.DOCKER_SOCKET || '/var/run/docker.sock',
  };
}

function loadMc(): McConfig {
  try {
    return buildMcConfig(process.env);
  } catch (err) {
    console.error(`[FATAL] ${(err as Error).message}`);
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'file:./data/mc-manager.db',
  jwtSecret: requireSecret('JWT_SECRET'),
  encryptionKey: requireSecret('ENCRYPTION_KEY'),
  jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  mc: loadMc(),
};
