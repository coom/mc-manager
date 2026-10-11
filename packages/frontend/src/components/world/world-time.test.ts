import { formatWorldTime } from './world-time';

describe('formatWorldTime', () => {
  it('maps game ticks to a 24h clock starting at 06:00', () => {
    expect(formatWorldTime(0)).toBe('06:00');
    expect(formatWorldTime(6000)).toBe('12:00');
    expect(formatWorldTime(13000)).toBe('19:00');
    expect(formatWorldTime(18000)).toBe('00:00');
    expect(formatWorldTime(23999)).toBe('05:59');
    expect(formatWorldTime(500)).toBe('06:30');
  });
});
