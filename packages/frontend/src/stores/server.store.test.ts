import { useServerStore, LOG_CAP } from './server.store';
const line = (i: number) => ({ ts: null, level: 'INFO' as const, thread: null, message: `m${i}`, raw: `m${i}` });

describe('serverStore', () => {
  beforeEach(() => useServerStore.getState().reset());
  it('applies server.status', () => {
    useServerStore.getState().apply({ type: 'server.status', info: { status: 'ready' } as never });
    expect(useServerStore.getState().info?.status).toBe('ready');
  });
  it('replaces logs on log.history and appends on log.line', () => {
    useServerStore.getState().apply({ type: 'log.history', lines: [line(1), line(2)] });
    useServerStore.getState().apply({ type: 'log.line', line: line(3) });
    expect(useServerStore.getState().logs.map((l) => l.message)).toEqual(['m1', 'm2', 'm3']);
  });
  it('caps the log buffer', () => {
    for (let i = 0; i < LOG_CAP + 10; i++) useServerStore.getState().apply({ type: 'log.line', line: line(i) });
    const logs = useServerStore.getState().logs;
    expect(logs).toHaveLength(LOG_CAP);
    expect(logs[0].message).toBe('m10');
  });
  it('tracks backup output and running flag', () => {
    useServerStore.getState().startBackupOutput();
    useServerStore.getState().apply({ type: 'backup.progress', line: 'a' });
    expect(useServerStore.getState().backupRunning).toBe(true);
    useServerStore.getState().apply({ type: 'backup.done', exitCode: 0 });
    expect(useServerStore.getState().backupRunning).toBe(false);
    expect(useServerStore.getState().backupOutput).toEqual(['a']);
  });

  it('starting a manual backup after a restore clears the restore panel state', () => {
    useServerStore.getState().reset();
    useServerStore.getState().startRestoreOutput();
    useServerStore.getState().apply({ type: 'restore.progress', step: 'stop', line: 'x' });
    useServerStore.getState().apply({ type: 'restore.done', ok: true, message: 'ok', safetyBackup: 's.tgz' });
    useServerStore.getState().startBackupOutput();
    expect(useServerStore.getState().restoreResult).toBeNull();
    expect(useServerStore.getState().restoreOutput).toEqual([]);
    expect(useServerStore.getState().restoreRunning).toBe(false);
  });
});

describe('restore messages', () => {
  it('accumulates restore progress with the step prefix and ends with the result', () => {
    useServerStore.getState().reset();
    useServerStore.getState().startRestoreOutput();
    useServerStore.getState().apply({ type: 'restore.progress', step: 'safety', line: 'running a safety backup' });
    useServerStore.getState().apply({ type: 'restore.progress', step: 'extract', line: 'extract world (200/400)' });
    expect(useServerStore.getState().restoreRunning).toBe(true);
    expect(useServerStore.getState().restoreOutput).toEqual(['[safety] running a safety backup', '[extract] extract world (200/400)']);
    useServerStore.getState().apply({ type: 'restore.done', ok: false, message: 'partial restore: boom', safetyBackup: 'world-1.tgz' });
    expect(useServerStore.getState().restoreRunning).toBe(false);
    expect(useServerStore.getState().restoreResult).toEqual({ ok: false, message: 'partial restore: boom', safetyBackup: 'world-1.tgz' });
  });
});
