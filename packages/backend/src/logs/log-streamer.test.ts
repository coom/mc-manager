import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { LogStreamer } from './log-streamer.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker, FakeContainer, inspectFixture } from '../docker/fake-docker.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setup(tty: boolean) {
  const docker = new FakeDocker();
  const logs = new PassThrough();
  const c = new FakeContainer(inspectFixture({ Tty: tty }), undefined, logs);
  docker.containers.set('mc', c);
  const svc = new DockerService(docker, 'mc', 'mc-backup');
  return { docker, logs, svc, streamer: new LogStreamer(svc, 3) };
}

describe('LogStreamer', () => {
  it('strips a Docker timestamp prefix and passes the date along', async () => {
    const { logs, streamer } = setup(true);
    const seen: [string, Date | null][] = [];
    streamer.on('line', (l, at) => seen.push([l.message, at]));
    await streamer.start();
    logs.write('2026-10-10T10:00:00.123456789Z [10:00:00] [main/INFO]: stamped\n[10:00:01] [main/INFO]: bare\n');
    await wait(10);
    expect(seen[0][0]).toBe('stamped');
    expect(seen[0][1]?.toISOString()).toBe('2026-10-10T10:00:00.123Z');
    expect(seen[1]).toEqual(['bare', null]);
    expect(streamer.history().map((l) => l.raw)).toEqual(['[10:00:00] [main/INFO]: stamped', '[10:00:01] [main/INFO]: bare']);
    streamer.stop();
  });
  it('emits parsed lines and keeps a bounded history', async () => {
    const { logs, streamer } = setup(true);
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    await streamer.start();
    logs.write('[10:00:00] [main/INFO]: one\n[10:00:01] [main/INFO]: two\n');
    logs.write('[10:00:02] [main/INFO]: thr');
    logs.write('ee\n[10:00:03] [main/INFO]: four\n');
    await wait(10);
    expect(seen).toEqual(['one', 'two', 'three', 'four']);
    expect(streamer.history().map((l) => l.message)).toEqual(['two', 'three', 'four']);
    streamer.stop();
  });

  it('demultiplexes a non-tty stream through DockerLike.demux', async () => {
    const { logs, streamer, docker } = setup(false);
    let demuxed = false;
    docker.demux = (stream, out) => { demuxed = true; stream.pipe(out); };
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    await streamer.start();
    logs.write('[10:00:00] [main/INFO]: x\n');
    await wait(10);
    expect(demuxed).toBe(true);
    expect(seen).toEqual(['x']);
    streamer.stop();
  });

  it('reopens the stream on a start event', async () => {
    const { streamer, svc, docker } = setup(true);
    await streamer.start();
    const fresh = new PassThrough();
    docker.containers.set('mc', new FakeContainer(inspectFixture({ Tty: true }), undefined, fresh));
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    svc.emit('status', 'starting');
    await wait(10);
    fresh.write('[10:00:00] [main/INFO]: after\n');
    await wait(10);
    expect(seen).toEqual(['after']);
    streamer.stop();
  });

  // Replaces svc.logStream with a version whose promises are resolved manually, one per call.
  function deferredStreams(svc: DockerService, streams: PassThrough[]) {
    const resolvers: Array<() => void> = [];
    let i = 0;
    svc.logStream = vi.fn(async () => {
      const stream = streams[i++]!;
      await new Promise<void>((r) => resolvers.push(r));
      return { stream, tty: true };
    });
    return resolvers;
  }

  it('keeps a single live stream on rapid starting then ready events', async () => {
    const { streamer, svc } = setup(true);
    const first = new PassThrough();
    const second = new PassThrough();
    const resolvers = deferredStreams(svc, [first, second]);
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    const startP = streamer.start(); // open #1 pending
    await wait(1);
    svc.emit('status', 'starting'); // open #2 pending
    await wait(1);
    resolvers[0]!();
    resolvers[1]!();
    await startP;
    await wait(10);
    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(false);
    second.write('[10:00:00] [main/INFO]: once\n');
    await wait(10);
    expect(seen).toEqual(['once']);
    expect(streamer.history()).toHaveLength(1);
    streamer.stop();
  });

  it('destroys a late stream when stop() happens during a pending open', async () => {
    const { streamer, svc } = setup(true);
    const late = new PassThrough();
    const resolvers = deferredStreams(svc, [late]);
    const seen: string[] = [];
    streamer.on('line', (l) => seen.push(l.message));
    const startP = streamer.start();
    await wait(1);
    streamer.stop();
    resolvers[0]!();
    await startP;
    expect(late.destroyed).toBe(true);
    late.write('[10:00:00] [main/INFO]: ghost\n');
    await wait(10);
    expect(seen).toEqual([]);
    expect(streamer.history()).toEqual([]);
  });

  it('requests the full tail on first open and tail 0 on reopen', async () => {
    const { streamer, svc } = setup(true);
    const spy = vi.spyOn(svc, 'logStream');
    await streamer.start();
    svc.emit('status', 'starting');
    await wait(10);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([3, 0]);
    streamer.stop();
  });
});
