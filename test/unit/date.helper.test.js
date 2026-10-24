import { describe, it, expect } from '@jest/globals';
import { intervalsOverlap, getScheduledEnd, addMinutesToTime } from '../../src/shared/helpers/date.helper.js';

const at = (hhmm) => new Date(`2026-11-01T${hhmm}:00.000Z`);

describe('intervalsOverlap (half-open [start, end))', () => {
  it('detects partial overlaps, containment and identical intervals', () => {
    expect(intervalsOverlap(at('10:00'), at('12:00'), at('11:00'), at('13:00'))).toBe(true);
    expect(intervalsOverlap(at('10:00'), at('14:00'), at('11:00'), at('12:00'))).toBe(true);
    expect(intervalsOverlap(at('10:00'), at('12:00'), at('10:00'), at('12:00'))).toBe(true);
  });

  it('does not count touching edges or separate intervals as a conflict', () => {
    expect(intervalsOverlap(at('10:00'), at('12:00'), at('12:00'), at('14:00'))).toBe(false);
    expect(intervalsOverlap(at('12:00'), at('14:00'), at('10:00'), at('12:00'))).toBe(false);
    expect(intervalsOverlap(at('08:00'), at('09:00'), at('10:00'), at('11:00'))).toBe(false);
  });

  it('handles an interval across midnight', () => {
    const lateStart = new Date('2026-11-01T23:00:00.000Z');
    const lateEnd = new Date('2026-11-02T01:00:00.000Z');
    expect(intervalsOverlap(lateStart, lateEnd, new Date('2026-11-02T00:30:00.000Z'), new Date('2026-11-02T02:00:00.000Z'))).toBe(true);
    expect(intervalsOverlap(lateStart, lateEnd, new Date('2026-11-02T01:00:00.000Z'), new Date('2026-11-02T02:00:00.000Z'))).toBe(false);
  });
});

describe('getScheduledEnd / addMinutesToTime', () => {
  it('adds the duration to the start in the business time zone', () => {
    // 09:30 in UTC+7 = 02:30Z, + 90 minutes
    expect(getScheduledEnd('2026-10-10T00:00:00.000Z', '09:30', 90).toISOString()).toBe('2026-10-10T04:00:00.000Z');
  });

  it('formats the end time and wraps past midnight', () => {
    expect(addMinutesToTime('09:00', 120)).toBe('11:00');
    expect(addMinutesToTime('23:00', 120)).toBe('01:00');
    expect(addMinutesToTime('10:15', 45)).toBe('11:00');
    expect(addMinutesToTime('bad', 30)).toBeNull();
  });
});
