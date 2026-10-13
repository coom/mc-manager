import { splitInterval } from './interval';

describe('splitInterval', () => {
  it.each<[string, { amount: number; unit: string }]>([
    ['6h', { amount: 6, unit: 'h' }], ['90m', { amount: 90, unit: 'm' }], ['1440m', { amount: 1, unit: 'd' }],
    ['2d', { amount: 2, unit: 'd' }], ['21600', { amount: 6, unit: 'h' }], ['120s', { amount: 2, unit: 'm' }],
  ])('%s → %j', (v, r) => expect(splitInterval(v)).toEqual(r));
  it.each(['1.5h', '', '0m', '30s', 'abc'])('%j → null', (v) => expect(splitInterval(v)).toBeNull());
});
