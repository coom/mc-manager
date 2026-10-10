import { createServer } from 'http';
import { PrismaClient } from '../generated/prisma/index.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { DockerService, realDocker } from './docker/docker-service.js';
import type { ServerInfo } from '@mc/common';

process.on('uncaughtException', (err) => logger.error({ err }, 'uncaught exception (kept alive)'));
process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled rejection (kept alive)'));

async function main() {
  if (config.encryptionKey === config.jwtSecret) {
    logger.fatal('ENCRYPTION_KEY must be different from JWT_SECRET');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  const app = createApp();
  const server = createServer(app);
  app.locals.prisma = prisma;

  const docker = new DockerService(realDocker(config.mc.dockerSocket), config.mc.container, config.mc.backupContainer);
  app.locals.docker = docker;
  await docker.start();

  // Construit la réponse de GET /api/server. Les tâches 11 et 12 enrichissent
  // players/mspt/tps/worldBytes/diskFree via app.locals.metrics.
  app.locals.serverInfo = async (): Promise<ServerInfo> => {
    const i = await docker.inspectServer().catch(() => null);
    const stats = await docker.stats().catch(() => ({ cpuPercent: null, memUsed: null, memLimit: null }));
    const startedAt = i?.startedAt ?? null;
    const latest = app.locals.metrics?.latest?.() ?? {};
    return {
      status: i ? i.status : 'unavailable',
      message: i ? undefined : `Container "${config.mc.container}" not found or Docker socket unreachable`,
      containerName: config.mc.container,
      startedAt,
      uptimeSeconds: startedAt ? Math.floor((Date.now() - Date.parse(startedAt)) / 1000) : null,
      version: latest.version ?? null,
      players: latest.players ?? null,
      mspt: latest.mspt ?? null,
      tps: latest.tps ?? null,
      stats,
      worldBytes: latest.worldBytes ?? null,
      diskFree: latest.diskFree ?? null,
    };
  };

  server.listen(config.port, () => logger.info(`MC Manager backend on http://localhost:${config.port}`));

  const shutdown = async () => {
    logger.info('shutting down');
    server.close();
    docker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { logger.fatal({ err }, 'failed to start'); process.exit(1); });
