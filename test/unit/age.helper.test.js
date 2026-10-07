import { describe, it, expect } from '@jest/globals';
import { calculateAgeYears } from '../../src/shared/helpers/age.helper.js';

describe('calculateAgeYears', () => {
  const now = new Date('2026-06-15T00:00:00Z');

  it('counts a birthday that already happened this year', () => {
    expect(calculateAgeYears('2020-06-15', now)).toBe(6);
    expect(calculateAgeYears('2020-01-01', now)).toBe(6);
  });

  it('does not count a birthday that is still ahead this year', () => {
    expect(calculateAgeYears('2020-06-16', now)).toBe(5);
    expect(calculateAgeYears('2020-12-31', now)).toBe(5);
  });

  it('returns null for a missing or invalid date', () => {
    expect(calculateAgeYears(null, now)).toBeNull();
    expect(calculateAgeYears('not-a-date', now)).toBeNull();
  });
});
