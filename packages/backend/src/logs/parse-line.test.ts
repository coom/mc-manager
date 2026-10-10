import { describe, it, expect } from 'vitest';
import { parseLogLine } from './parse-line.js';

describe('parseLogLine', () => {
  it('parses the vanilla format', () => {
    expect(parseLogLine('[12:34:56] [Server thread/INFO]: Done (3.2s)! For help, type "help"')).toEqual({
      ts: '12:34:56', level: 'INFO', thread: 'Server thread', message: 'Done (3.2s)! For help, type "help"', raw: '[12:34:56] [Server thread/INFO]: Done (3.2s)! For help, type "help"',
    });
  });
  it('parses WARN with a slash in the thread name', () => {
    expect(parseLogLine('[12:00:00] [Worker-Main-3/WARN]: x').level).toBe('WARN');
  });
  it('falls back to RAW for itzg startup lines', () => {
    expect(parseLogLine('[init] Starting the Minecraft server...')).toMatchObject({ level: 'RAW', ts: null, message: '[init] Starting the Minecraft server...' });
  });
  it('strips a trailing carriage return', () => {
    expect(parseLogLine('[12:00:00] [main/INFO]: hi\r').message).toBe('hi');
  });
});
