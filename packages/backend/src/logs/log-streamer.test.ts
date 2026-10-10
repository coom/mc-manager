import { describe, it, expect } from 'vitest';
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
});
