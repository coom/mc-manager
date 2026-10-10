import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { BackupService } from './backup-service.js';
import { DockerService } from '../docker/docker-service.js';
import { FakeDocker } from '../docker/fake-docker.js';
import { AppError } from '../middleware/error-handler.js';

// unlink is replaced per test; everything else in fs/promises stays real.
const { unlinkMock } = vi.hoisted(() => ({ unlinkMock: vi.fn() }));
vi.mock('fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs/promises')>();
  return { ...real, unlink: unlinkMock };
});

const errno = (code: string) => Object.assign(new Error(`${code}: permission denied`), { code });

describe('BackupService.remove on a read-only directory', () => {
  let dir: string; let svc: BackupService;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-bk-rm-'));
    writeFileSync(path.join(dir, 'world-20261010-100000.tgz'), 'x');
    svc = new BackupService(dir, new DockerService(new FakeDocker(), 'mc', 'mc-backup'));
    unlinkMock.mockReset();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each(['EACCES', 'EPERM'])('turns %s into an explicit AppError about ownership', async (code) => {
    unlinkMock.mockRejectedValue(errno(code));
    const listChanged = vi.fn(); svc.on('listChanged', listChanged);
    const err = await svc.remove('world-20261010-100000.tgz').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(500);
    expect(err.message).toMatch(/not writable by the backend \(UID 1000\)/);
    expect(listChanged).not.toHaveBeenCalled();
  });

  it('rethrows other errors untouched', async () => {
    unlinkMock.mockRejectedValue(errno('EIO'));
    await expect(svc.remove('world-20261010-100000.tgz')).rejects.toMatchObject({ code: 'EIO' });
  });
});
