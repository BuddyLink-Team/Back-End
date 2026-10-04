import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreak, weekStart, weekKey, locationKey, BADGE_DEFINITIONS } from '../../src/modules/gamification/gamification.rules.js';
import { ensureRatingEligibility } from '../../src/modules/rating-feedback/rating-feedback.rules.js';

const now = new Date('2026-10-02T22:00:00+07:00');
test('no completed playdates means zero streak', () => {
  const result = calculateStreak([], now);
  assert.equal(result.currentWeeklyStreak, 0);
  assert.equal(result.longestStreak, 0);
  assert.equal(result.lastCompletedPlaydateWeek, null);
});
test('multiple playdates in one week count once', () => {
  assert.equal(calculateStreak(['2026-09-28', '2026-09-29', '2026-10-02'], now).currentWeeklyStreak, 1);
});
test('four consecutive completed weeks unlock the streak condition', () => {
  const streak = calculateStreak(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28'], now);
  assert.equal(streak.currentWeeklyStreak, 4);
  assert.equal(streak.longestStreak, 4);
});
test('current unfinished week does not prematurely break a streak', () => {
  assert.equal(calculateStreak(['2026-09-14', '2026-09-21'], now).currentWeeklyStreak, 2);
});
test('a full missed week resets current but preserves longest', () => {
  const streak = calculateStreak(['2026-09-07', '2026-09-14'], now);
  assert.equal(streak.currentWeeklyStreak, 0);
  assert.equal(streak.longestStreak, 2);
});
test('completion after a gap starts a new streak', () => {
  const result = calculateStreak(['2026-09-07', '2026-09-14', '2026-09-28'], now);
  assert.equal(result.currentWeeklyStreak, 1);
  assert.equal(result.longestStreak, 2);
});
test('future completion dates do not count', () => {
  assert.equal(calculateStreak(['2026-10-05'], now).currentWeeklyStreak, 0);
});
test('Vietnam midnight Monday is the weekly boundary', () => {
  assert.equal(weekKey(weekStart('2026-10-04T16:59:59Z')), '2026-W40');
  assert.equal(weekKey(weekStart('2026-10-04T17:00:00Z')), '2026-W41');
});
test('ISO week year works across December and January', () => {
  assert.equal(weekKey(weekStart('2025-12-29T00:00:00+07:00')), '2026-W01');
  assert.equal(weekKey(weekStart('2027-01-01T00:00:00+07:00')), '2026-W53');
});
test('location identity uses place ID or normalized address', () => {
  assert.equal(locationKey({placeId:'abc',address:'x'}), locationKey({placeId:'abc',address:'y'}));
  assert.equal(locationKey({name:'A',address:'  1  Đường ABC '}), locationKey({name:'B',address:'1 đường abc'}));
  assert.equal(locationKey({}), null);
});
test('exactly the six documented badge conditions', () => {
  assert.deepEqual(BADGE_DEFINITIONS.map(b => b.requirementCount), [1,1,4,10,10,5]);
  assert.equal(new Set(BADGE_DEFINITIONS.map(b => b.code)).size, 6);
});
const completed = { hostParentId: 'host', status:'completed', participants:[{parentId:'accepted',status:'accepted'},{parentId:'pending',status:'pending'},{parentId:'declined',status:'declined'}] };
test('host and accepted participant can rate', () => {
  assert.doesNotThrow(() => ensureRatingEligibility(completed, 'host'));
  assert.doesNotThrow(() => ensureRatingEligibility(completed, 'accepted'));
});
test('pending, declined and unrelated parents cannot rate', () => {
  for (const id of ['pending','declined','other']) assert.throws(() => ensureRatingEligibility(completed, id), {statusCode:403,code:'RATING_FORBIDDEN'});
});
test('upcoming and cancelled playdates cannot be rated', () => {
  for (const status of ['upcoming','cancelled']) assert.throws(() => ensureRatingEligibility({...completed,status}, 'host'), {statusCode:409,code:'PLAYDATE_NOT_COMPLETED'});
});
test('missing playdate returns 404', () => {
  assert.throws(() => ensureRatingEligibility(null,'host'), {statusCode:404,code:'PLAYDATE_NOT_FOUND'});
});
