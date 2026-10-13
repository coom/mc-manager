import '@/i18n';
import i18n from 'i18next';
import { summarizeNames } from './names-summary';

describe('summarizeNames', () => {
  const t = i18n.getFixedT('en');
  it('lists every name up to the limit', () => expect(summarizeNames(['a.tgz', 'b.tgz'], t)).toBe('a.tgz, b.tgz'));
  it('lists the first ten and counts the rest', () => {
    const names = Array.from({ length: 13 }, (_, i) => `w${i}.tgz`);
    expect(summarizeNames(names, t)).toBe('w0.tgz, w1.tgz, w2.tgz, w3.tgz, w4.tgz, w5.tgz, w6.tgz, w7.tgz, w8.tgz, w9.tgz and 3 more');
  });
});
