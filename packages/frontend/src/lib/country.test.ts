import { flagEmoji, countryName } from './country';

describe('country helpers', () => {
  it('builds a regional-indicator flag from an ISO code', () => {
    expect(flagEmoji('FR')).toBe('🇫🇷');
    expect(flagEmoji('us')).toBe('🇺🇸');
  });
  it('returns an empty string for a missing or malformed code', () => {
    expect(flagEmoji(null)).toBe('');
    expect(flagEmoji('FRA')).toBe('');
    expect(flagEmoji('1A')).toBe('');
  });
  it('names a country in the requested language, falling back to the code', () => {
    expect(countryName('FR', 'fr')).toBe('France');
    expect(countryName('FR', 'en')).toBe('France');
    expect(countryName('DE', 'en')).toBe('Germany');
    expect(countryName('ZZ', 'en')).toBe('ZZ');
  });
});
