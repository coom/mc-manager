import { EventEmitter } from 'events';
import type { PrismaClient } from '../../generated/prisma/index.js';
import type { LogLine, OnlinePlayer, ServerStatus } from '@mc/common';
import { parsePlayerLine, classifyRefusal } from './parse-player-line.js';
import { readUserCache } from './data-files.js';
import { loadRetentionDays } from './retention.js';
import { lookupCountry } from '../utils/geo.js';
import { logger } from '../utils/logger.js';

/** Fenêtre pendant laquelle un `list` RCON antérieur à la ligne de log ne doit pas contredire celle-ci. */
export const GRACE_MS = 30_000;
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

interface OpenSession { id: number; name: string; uuid: string | null; ip: string | null; country: string | null; joinedAt: Date }
const toOnline = (s: OpenSession): OnlinePlayer => ({ name: s.name, uuid: s.uuid, joinedAt: s.joinedAt.toISOString(), country: s.country, hasIp: s.ip !== null });

export class PlayerJournal extends EventEmitter {
  /** Sessions ouvertes, clé = nom en minuscules. */
  private open = new Map<string, OpenSession>();
  private pendingUuid = new Map<string, string>();
  private recentlyLeft = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private prisma: PrismaClient, private dataDir: string, private now: () => Date = () => new Date()) { super(); }

  online(): OnlinePlayer[] {
    return [...this.open.values()].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).map(toOnline);
  }

  /** IP de la session ouverte d'un joueur (pour `ban-ip` côté serveur) ; jamais envoyée au navigateur. */
  currentIp(name: string): string | null { return this.open.get(name.toLowerCase())?.ip ?? null; }

  /** Au démarrage : ferme en base les sessions restées ouvertes par un arrêt du backend. */
  async start(): Promise<void> {
    const last = await this.prisma.metricSample.findFirst({ orderBy: { at: 'desc' }, select: { at: true } });
    const orphans = await this.prisma.playerSession.findMany({ where: { leftAt: null } });
    for (const s of orphans) {
      const leftAt = last && last.at.getTime() > s.joinedAt.getTime() ? last.at : s.joinedAt;
      await this.prisma.playerSession.update({ where: { id: s.id }, data: { leftAt } });
    }
    if (orphans.length) logger.info({ count: orphans.length }, 'closed orphan player sessions');
  }

  handleLine(line: LogLine): Promise<void> { return this.enqueue(() => this.processLine(line)); }
  reconcile(names: string[]): Promise<void> { return this.enqueue(() => this.doReconcile(names)); }
  closeAll(): Promise<void> { return this.enqueue(async () => { const at = this.now(); for (const key of [...this.open.keys()]) await this.tryClose(key, at); }); }
  onStatus(status: ServerStatus): Promise<void> {
    if (status === 'stopped' || status === 'stopping' || status === 'unavailable') return this.closeAll();
    return Promise.resolve();
  }

  async purge(): Promise<void> {
    const days = await loadRetentionDays(this.prisma);
    if (days <= 0) return;
    const before = new Date(this.now().getTime() - days * 86_400_000);
    await this.prisma.playerSession.deleteMany({ where: { joinedAt: { lt: before }, leftAt: { not: null } } });
    await this.prisma.playerLoginFailure.deleteMany({ where: { createdAt: { lt: before } } });
    await this.prisma.webLogin.deleteMany({ where: { createdAt: { lt: before } } });
  }

  /** Toutes les mutations passent par une file : deux lignes consécutives ne se chevauchent jamais. */
  private enqueue(fn: () => Promise<void>): Promise<void> {
    const p = this.queue.then(fn, fn).catch((err) => logger.warn({ err }, 'player journal step failed'));
    this.queue = p;
    return p;
  }

  /** Le uuid en attente (ligne `UUID of player`) ne sert qu'aux sessions issues du log ; sans lui, usercache.json. */
  private async lookupUuid(name: string, useOnLog: boolean): Promise<string | null> {
    const key = name.toLowerCase();
    if (useOnLog) {
      const pending = this.pendingUuid.get(key);
      if (pending) return pending;
    }
    const cache = await readUserCache(this.dataDir);
    return cache.find((u) => u.name.toLowerCase() === key)?.uuid ?? null;
  }

  private async openSession(name: string, ip: string | null, source: 'log' | 'reconciled', at: Date): Promise<void> {
    const key = name.toLowerCase();
    // Tout est préparé avant la première mutation : un échec ne perd ni la session ni le uuid en attente.
    const uuid = await this.lookupUuid(name, source === 'log');
    const country = ip ? lookupCountry(ip).country : null;
    if (this.open.has(key)) await this.close(key, at);
    const row = await this.prisma.playerSession.create({ data: { uuid, name, ip, country, source, joinedAt: at } });
    if (source === 'log') this.pendingUuid.delete(key);
    const s: OpenSession = { id: row.id, name, uuid, ip, country, joinedAt: at };
    this.open.set(key, s);
    this.recentlyLeft.delete(key);
    this.emit('session', { kind: 'join', player: toOnline(s) });
  }

  /** Écrit en base d'abord : si l'écriture échoue, la session reste ouverte en mémoire comme en base. */
  private async close(key: string, at: Date): Promise<void> {
    const s = this.open.get(key);
    if (!s) return;
    await this.prisma.playerSession.update({ where: { id: s.id }, data: { leftAt: at } });
    this.open.delete(key);
    this.recentlyLeft.set(key, at.getTime());
    this.emit('session', { kind: 'leave', player: toOnline(s), leftAt: at.toISOString() });
  }

  private async tryClose(key: string, at: Date): Promise<void> {
    try { await this.close(key, at); } catch (err) { logger.warn({ err, player: key }, 'failed to close player session'); }
  }

  private async processLine(line: LogLine): Promise<void> {
    const ev = parsePlayerLine(line.message);
    if (!ev) return;
    const at = this.now();
    switch (ev.type) {
      case 'uuid': this.pendingUuid.set(ev.name.toLowerCase(), ev.uuid); return;
      case 'join': await this.openSession(ev.name, ev.ip || null, 'log', at); return;
      case 'leave': await this.close(ev.name.toLowerCase(), at); return;
      case 'refused':
        await this.prisma.playerLoginFailure.create({ data: {
          name: ev.name, ip: ev.ip, country: ev.ip ? lookupCountry(ev.ip).country : null,
          reason: classifyRefusal(ev.message), message: ev.message.slice(0, 200), createdAt: at,
        } });
        return;
    }
  }

  private async doReconcile(names: string[]): Promise<void> {
    const at = this.now();
    const t = at.getTime();
    const wanted = new Map(names.filter((n) => NAME_RE.test(n)).map((n) => [n.toLowerCase(), n]));
    for (const [key, s] of [...this.open]) {
      if (!wanted.has(key) && t - s.joinedAt.getTime() > GRACE_MS) await this.tryClose(key, at);
    }
    for (const [key, name] of wanted) {
      if (this.open.has(key)) continue;
      const left = this.recentlyLeft.get(key);
      if (left !== undefined && t - left <= GRACE_MS) continue;
      try { await this.openSession(name, null, 'reconciled', at); }
      catch (err) { logger.warn({ err, player: name }, 'failed to open reconciled session'); }
    }
  }
}
