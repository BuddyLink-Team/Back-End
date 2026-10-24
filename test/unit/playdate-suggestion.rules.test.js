import { describe, it, expect } from '@jest/globals';
import {
  suggestTimeSlots,
  suggestActivities,
  preferredPlaceTypes,
  rankPlaces,
  listCalendarDays,
} from '../../src/modules/playdate/playdate-suggestion.rules.js';

const YEAR = 365.25 * 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-28T03:00:00.000Z'); // Wed 28/10 10:00 in Asia/Ho_Chi_Minh
const bornYearsAgo = (years) => new Date(NOW.getTime() - (years + 0.5) * YEAR);
const parent = (days, slots, locations = []) => ({
  preferences: { preferredPlaydateDays: days, preferredTimeSlots: slots, preferredLocations: locations },
});
// Sat 31/10 -> Sun 01/11
const WEEKEND = { from: new Date('2026-10-31T00:00:00.000Z'), to: new Date('2026-11-01T00:00:00.000Z') };

describe('listCalendarDays', () => {
  it('lists every calendar day in the business time zone with its day type', () => {
    const days = listCalendarDays(new Date('2026-10-30T00:00:00.000Z'), new Date('2026-11-02T00:00:00.000Z'));
    expect(days.map((d) => `${d.date}:${d.dayType}`)).toEqual([
      '2026-10-30:weekday',
      '2026-10-31:weekend',
      '2026-11-01:weekend',
      '2026-11-02:weekday',
    ]);
  });
});

describe('suggestTimeSlots', () => {
  it('ranks the slots matching the most parents first', () => {
    const slots = suggestTimeSlots({
      parents: [parent(['weekend'], ['afternoon']), parent(['weekend'], ['afternoon', 'morning'])],
      ...WEEKEND,
      durationMinutes: 120,
      now: NOW,
    });
    // 2 days x 3 slots, all in the future
    expect(slots).toHaveLength(6);
    expect(slots[0]).toEqual({
      date: '2026-10-31',
      time: '15:00',
      durationMinutes: 120,
      dayType: 'weekend',
      timeSlot: 'afternoon',
      matchedParents: 2,
      totalParents: 2,
    });
    expect(slots[1]).toMatchObject({ date: '2026-11-01', time: '15:00', matchedParents: 2 });
    expect(slots[2]).toMatchObject({ date: '2026-10-31', time: '09:00', matchedParents: 1 });
  });

  it('treats parents without preferences as neutral', () => {
    const slots = suggestTimeSlots({
      parents: [parent(['weekend'], ['evening']), parent([], [])],
      ...WEEKEND,
      durationMinutes: 120,
      now: NOW,
    });
    expect(slots[0]).toMatchObject({ timeSlot: 'evening', matchedParents: 1, totalParents: 2 });
  });

  it('drops past slots and slots overlapping a busy interval', () => {
    const today = { from: new Date('2026-10-28T00:00:00.000Z'), to: new Date('2026-10-28T00:00:00.000Z') };
    // 09:00 already passed at 10:00; 15:00-17:00 is busy -> only 18:00 is left
    const slots = suggestTimeSlots({
      parents: [parent([], [])],
      ...today,
      durationMinutes: 120,
      now: NOW,
      busy: [{ start: new Date('2026-10-28T09:00:00.000Z'), end: new Date('2026-10-28T10:00:00.000Z') }],
    });
    expect(slots.map((s) => s.time)).toEqual(['18:00']);
  });

  it('prefers weekend mornings when nobody set preferences', () => {
    const slots = suggestTimeSlots({
      parents: [parent([], []), parent([], [])],
      from: new Date('2026-10-29T00:00:00.000Z'),
      to: new Date('2026-11-01T00:00:00.000Z'),
      durationMinutes: 120,
      now: NOW,
    });
    expect(slots.slice(0, 2).map((s) => `${s.date} ${s.time}`)).toEqual(['2026-10-31 09:00', '2026-11-01 09:00']);
  });
});

describe('suggestActivities', () => {
  const kid = (displayName, age, interests = [], favoriteActivities = []) => ({
    displayName,
    dateOfBirth: bornYearsAgo(age),
    interests,
    favoriteActivities,
  });

  it('puts the activities shared by every child first, with a reason', () => {
    const result = suggestActivities(
      [kid('Na', 5, ['Lego & Lắp ráp']), kid('Bin', 5, ['Vẽ & Hội họa'], ['Xếp hình Lego'])],
      { now: NOW }
    );
    expect(result[0]).toMatchObject({ key: 'Xếp hình Lego', sharedCount: 2, reason: 'Cả hai bé đều thích xếp hình lego' });
    const drawing = result.find((a) => a.key === 'Vẽ tranh');
    expect(drawing).toMatchObject({ sharedCount: 1, reason: 'Bin thích vẽ tranh' });
  });

  it('names the children who share an activity in a bigger group', () => {
    const result = suggestActivities(
      [kid('Na', 6, ['Âm nhạc & Đàn']), kid('Bin', 6, ['Âm nhạc & Đàn']), kid('Su', 6, ['Khủng long'])],
      { now: NOW }
    );
    expect(result.find((a) => a.key === 'Âm nhạc & Ca hát').reason).toBe('Na và Bin thích âm nhạc & ca hát');
  });

  it('suggests the usual duration of the activity, shorter for young children', () => {
    const lego = (age) =>
      suggestActivities([kid('Na', age, ['Lego & Lắp ráp'])], { now: NOW }).find((a) => a.key === 'Xếp hình Lego');
    expect(lego(6).durationMinutes).toBe(120);
    // Picnic usually lasts 3 hours, at most 2 hours with a 4-year-old and 1.5 hours with a 2-year-old
    const picnic = (age) =>
      suggestActivities([kid('Bé', age, [], ['Dã ngoại ngoài trời'])], { now: NOW }).find((a) => a.key === 'Dã ngoại ngoài trời');
    expect(picnic(7).durationMinutes).toBe(180);
    expect(picnic(4).durationMinutes).toBe(120);
    expect(picnic(2).durationMinutes).toBe(90);
  });

  it('skips activities outside the age range of the group', () => {
    // Patin starts at 5
    const result = suggestActivities([kid('Tí', 3, [], ['Trượt patin'])], { now: NOW });
    expect(result.find((a) => a.key === 'Trượt patin')).toBeUndefined();
  });

  it('falls back to generic age-appropriate activities', () => {
    const result = suggestActivities([kid('Na', 4), kid('Bin', 5)], { now: NOW });
    expect(result.length).toBeGreaterThan(0);
    result.forEach((activity) => {
      expect(activity.sharedCount).toBe(0);
      expect(activity.reason).toBe('Phù hợp với độ tuổi của các bé');
    });
  });
});

describe('place ranking', () => {
  const place = (id, placeType, distanceMeters, coordinates = [108.22, 16.06]) => ({
    id,
    placeId: `osm-node-${id}`,
    name: `Place ${id}`,
    placeType,
    address: 'Đà Nẵng',
    coordinates,
    distanceMeters,
  });

  it('keeps only the place types every parent prefers', () => {
    const types = preferredPlaceTypes([parent([], [], ['park', 'library']), parent([], [], ['park']), parent([], [], [])]);
    expect([...types]).toEqual(['park']);
  });

  it('ranks preferred types first, drops types too old for the youngest child and never exposes a family location', () => {
    const ranked = rankPlaces(
      [place('cafe', 'kids_cafe', 100), place('park', 'park', 900), place('gym', 'sports_center', 50)],
      {
        preferredTypes: new Set(['park']),
        youngestAge: 3,
        families: [
          { parentId: 'me', label: 'Nhà bạn', area: 'Hải Châu', point: [108.22, 16.07] },
          { parentId: 'p2', label: 'Mẹ Lan', area: 'Sơn Trà', point: [108.22, 16.04] },
        ],
      }
    );
    expect(ranked.map((p) => p.id)).toEqual(['park', 'cafe']);
    expect(ranked[0].isPreferredType).toBe(true);
    // 0.01° / 0.02° of latitude from each ward center, 0.1 km precision, labelled per family
    expect(ranked[0].familyDistances).toEqual([
      { parentId: 'me', label: 'Nhà bạn', area: 'Hải Châu', distanceKm: 1.1 },
      { parentId: 'p2', label: 'Mẹ Lan', area: 'Sơn Trà', distanceKm: 2.2 },
    ]);
    // The place's own coordinates (for the map link), never the families' ones
    expect(ranked[0].coordinates).toEqual([108.22, 16.06]);
    expect(JSON.stringify(ranked)).not.toContain('16.07');
    expect(JSON.stringify(ranked)).not.toContain('16.04');
    expect(JSON.stringify(ranked)).not.toContain('distanceMeters');
  });
});
