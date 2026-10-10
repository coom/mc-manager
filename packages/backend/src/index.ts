import { createServer } from 'http';
import { PrismaClient } from '../generated/prisma/index.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

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

  server.listen(config.port, () => logger.info(`MC Manager backend on http://localhost:${config.port}`));

  const shutdown = async () => {
    logger.info('shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { logger.fatal({ err }, 'failed to start'); process.exit(1); });
