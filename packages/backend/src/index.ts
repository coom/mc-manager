import { createServer } from 'http';
import { PrismaClient } from '../generated/prisma/index.js';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { DockerService, realDocker } from './docker/docker-service.js';
import type { ServerInfo } from '@mc/common';
import { attachWebSocket } from './ws/ws-server.js';
import { broadcast, markAuthenticated } from './ws/ws-broadcast.js';
import { RconService, realRcon } from './rcon/rcon-service.js';
import { readServerProperties, rconSettings } from './utils/server-properties.js';
import { LogStreamer } from './logs/log-streamer.js';
import { PlayerJournal } from './players/player-journal.js';
import { PlayerAdmin } from './players/player-admin.js';
import { MetricsCollector } from './metrics/collector.js';
import { BackupService } from './backups/backup-service.js';
import { RestoreService } from './backups/restore-service.js';
import { PropertiesService } from './server-properties/properties-service.js';
import { ModsService } from './mods/mods-service.js';
import { WorldService } from './world/world-service.js';
import { realModrinth } from './mods/modrinth-client.js';
import { worldSize, diskFree } from './metrics/disk.js';
import { buildServerInfo } from './server-info.js';

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
  const wss = attachWebSocket(server, prisma);
  app.locals.wss = wss;

  // Construit la réponse de GET /api/server : l'état vient de docker.getStatus() (qui garde
  // 'stopping' pendant un arrêt), inspect ne sert qu'à startedAt.
  app.locals.serverInfo = (): Promise<ServerInfo> => buildServerInfo({
    getStatus: () => docker.getStatus(),
    inspectServer: () => docker.inspectServer(),
    stats: () => docker.stats(),
    latest: () => app.locals.metrics?.latest?.(),
    containerName: config.mc.container,
  });

  docker.on('status', () => {
    void app.locals.serverInfo().then((info: ServerInfo) => broadcast(wss, { type: 'server.status', info }));
  });
  const logs = new LogStreamer(docker, 500);
  app.locals.logs = logs;
  logs.on('line', (line) => broadcast(wss, { type: 'log.line', line }));
  wss.on('authenticated', (socket) => {
    markAuthenticated(socket);
    void app.locals.serverInfo().then((info: ServerInfo) => socket.send(JSON.stringify({ type: 'server.status', info })));
    socket.send(JSON.stringify({ type: 'log.history', lines: logs.history() }));
  });
  // Journal joueurs : abonné avant docker.start()/logs.start() pour ne manquer aucune ligne.
  app.locals.dataDir = config.mc.dataDir;
  const journal = new PlayerJournal(prisma, config.mc.dataDir);
  await journal.start();
  app.locals.journal = journal;
  logs.on('line', (line, at) => void journal.handleLine(line, at));
  docker.on('status', (s) => void journal.onStatus(s));
  journal.on('session', (e) => broadcast(wss, { type: 'player.session', ...e }));
  // serverInfo et les listeners sont en place : les événements de start() peuvent partir.
  await docker.start();
  const rcon = new RconService(realRcon, docker, { host: config.mc.rconHost, portFallback: config.mc.rconPort },
    async () => rconSettings(await readServerProperties(config.mc.dataDir)));
  app.locals.rcon = rcon;
  await rcon.start();
  const playerAdmin = new PlayerAdmin(rcon);
  app.locals.playerAdmin = playerAdmin;
  playerAdmin.on('listsChanged', () => broadcast(wss, { type: 'player.lists.changed' }));
  await logs.start();

  const metrics = new MetricsCollector(prisma, {
    status: () => docker.getStatus(),
    stats: () => docker.stats(),
    rcon: (cmd) => rcon.send(cmd),
    // server.properties relu à chaque mesure (toutes les 5 min) pour suivre level-name.
    worldSize: async () => worldSize(config.mc.dataDir, await readServerProperties(config.mc.dataDir).catch(() => ({}))),
    diskFree: () => diskFree(config.mc.dataDir),
    broadcast: (msg) => broadcast(wss, msg),
    serverInfo: () => app.locals.serverInfo(),
    onPlayers: (names) => void journal.reconcile(names),
  }, { intervalMs: 15_000, diskIntervalMs: 5 * 60_000 });
  app.locals.metrics = metrics;
  metrics.start();
  // Purge quotidienne du journal selon la rétention configurée.
  const purgeJournal = () => journal.purge().catch((err) => logger.warn({ err }, 'journal purge failed'));
  void purgeJournal();
  const purgeTimer = setInterval(() => void purgeJournal(), 86_400_000);

  const backups = new BackupService(config.mc.backupsDir, docker);
  app.locals.backups = backups;
  backups.on('progress', (line) => broadcast(wss, { type: 'backup.progress', line }));
  backups.on('done', (exitCode) => broadcast(wss, { type: 'backup.done', exitCode }));
  backups.on('listChanged', () => broadcast(wss, { type: 'backup.list.changed' }));
  const restore = new RestoreService({ dataDir: config.mc.dataDir, backups, docker });
  app.locals.restore = restore;
  // Marqueur laissé par une restauration interrompue (crash, arrêt) : signalé dans les logs et dans l'interface.
  await restore.start();
  restore.on('progress', (e) => broadcast(wss, { type: 'restore.progress', ...e }));
  restore.on('done', (e) => { broadcast(wss, { type: 'restore.done', ...e }); broadcast(wss, { type: 'backup.list.changed' }); });
  app.locals.properties = new PropertiesService({ dataDir: config.mc.dataDir, docker, lock: backups.dataLock });
  // Monde (lot 5) : réglages appliqués à chaud par RCON, rien d'écrit dans /data.
  app.locals.world = new WorldService({ rcon, docker, properties: app.locals.properties });
  // Mods (lot 3) : liste Modrinth gérée dans /data/mc-manager, jars manuels renommés dans mods/ ; écritures sous le même verrou.
  app.locals.mods = new ModsService({ dataDir: config.mc.dataDir, docker, modrinth: realModrinth(), prisma, lock: backups.dataLock, broadcast: (msg) => broadcast(wss, msg), gameVersion: () => metrics.latest().version });
  // Purge des uploads de jars interrompus (mc-manager/tmp/*.part).
  await app.locals.mods.start();
  // Version : lue dans les logs au passage à ready ("Starting minecraft server version 1.21.1")
  logs.on('line', (l) => { const m = /Starting minecraft server version (\S+)/.exec(l.message); if (m) metrics.setVersion(m[1]); });

  server.listen(config.port, () => logger.info(`MC Manager backend on http://localhost:${config.port}`));

  const shutdown = async () => {
    logger.info('shutting down');
    if (restore.status().running) logger.warn({ step: restore.status().step }, 'a restore is in progress and will be interrupted: check the Backups page after restart');
    wss.close();
    server.close();
    metrics.stop();
    clearInterval(purgeTimer);
    logs.stop();
    rcon.stop();
    docker.stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { logger.fatal({ err }, 'failed to start'); process.exit(1); });
