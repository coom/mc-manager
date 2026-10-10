import { EventEmitter } from 'events';
import { PassThrough, type Readable } from 'stream';
import type { LogLine, ServerStatus } from '@mc/common';
import type { DockerService } from '../docker/docker-service.js';
import { parseLogLine } from './parse-line.js';
import { logger } from '../utils/logger.js';

export class LogStreamer extends EventEmitter {
  private buffer: LogLine[] = [];
  private current: Readable | null = null;
  private stopped = false;
  private onStatus = (s: ServerStatus) => { if (s === 'starting' || s === 'ready') void this.open(); };

  constructor(private docker: DockerService, private cap = 500) { super(); }

  history(): LogLine[] { return [...this.buffer]; }

  async start(): Promise<void> {
    this.stopped = false;
    this.docker.on('status', this.onStatus);
    await this.open();
  }

  stop(): void {
    this.stopped = true;
    this.docker.off('status', this.onStatus);
    this.current?.destroy();
    this.current = null;
  }

  private async open(): Promise<void> {
    this.current?.destroy();
    this.current = null;
    if (this.stopped) return;
    let handle: { stream: Readable; tty: boolean };
    try { handle = await this.docker.logStream(this.cap); }
    catch (err) { logger.warn({ err }, 'log stream unavailable'); return; }
    this.current = handle.stream;
    const text = new PassThrough();
    if (handle.tty) handle.stream.pipe(text); else this.docker.demux(handle.stream, text);
    let partial = '';
    text.on('data', (chunk: Buffer) => {
      partial += chunk.toString('utf8');
      let nl: number;
      while ((nl = partial.indexOf('\n')) >= 0) {
        const line = parseLogLine(partial.slice(0, nl));
        partial = partial.slice(nl + 1);
        this.buffer.push(line);
        if (this.buffer.length > this.cap) this.buffer.shift();
        this.emit('line', line);
      }
    });
    handle.stream.once('error', (err) => logger.warn({ err }, 'log stream error'));
  }
}
