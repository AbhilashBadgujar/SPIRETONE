import { describe, expect, it } from 'vitest';
import { formatNumber } from '../src/lib/format';

describe('GDD §5 number display', () => {
  it.each([
    [0, '0'],
    [2.45, '2.4'],
    [20, '20'],
    [99.96, '99.9'],
    [123.7, '123'],
    [999.9, '999'],
    [1000, '1.00K'],
    [1234, '1.23K'],
    [12345, '12.3K'],
    [123456, '123K'],
    [999999, '999K'],
    [1e6, '1.00M'],
    [1.5e9, '1.50B'],
    [2e12, '2.00T'],
    [1e15, '1.00e15'],
    [1.234e18, '1.23e18'],
    [-1234, '-1.23K'],
  ])('%d -> %s', (n, s) => {
    expect(formatNumber(n)).toBe(s);
  });
});
