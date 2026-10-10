import { formatMspt, formatPercent, statusTone } from './format';
describe('format', () => {
  it('formatMspt renders one decimal and null as dash', () => { expect(formatMspt(3.456)).toBe('3.5 ms'); expect(formatMspt(null)).toBe('—'); });
  it('formatPercent rounds', () => { expect(formatPercent(12.34)).toBe('12 %'); expect(formatPercent(null)).toBe('—'); });
  it('statusTone maps statuses', () => {
    expect(statusTone('ready')).toBe('ok'); expect(statusTone('starting')).toBe('warn'); expect(statusTone('stopping')).toBe('warn');
    expect(statusTone('unhealthy')).toBe('error'); expect(statusTone('unavailable')).toBe('error'); expect(statusTone('stopped')).toBe('muted');
  });
});
