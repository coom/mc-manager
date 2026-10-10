import { formatBytes, formatUptime } from './utils';

describe('formatBytes', () => {
  it('formats gigabytes with one decimal', () => expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB'));
  it('formats zero', () => expect(formatBytes(0)).toBe('0 B'));
});

describe('formatUptime', () => {
  it('renders days hours minutes', () => expect(formatUptime(90061)).toBe('1d 1h 1m'));
});
