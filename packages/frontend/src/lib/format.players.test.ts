import { formatPlayersValue } from './format';
describe('formatPlayersValue', () => {
  it('handles null, integers and decimals', () => {
    expect(formatPlayersValue(null)).toBe('—');
    expect(formatPlayersValue(undefined)).toBe('—');
    expect(formatPlayersValue(3)).toBe('3');
    expect(formatPlayersValue(2.5)).toBe('2.5');
  });
});
