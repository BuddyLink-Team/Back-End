export const GAMIFICATION_TIMEZONE = 'Asia/Ho_Chi_Minh';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const OFFSET_MS = 7 * 60 * 60 * 1000;

// Monday-based ISO weeks in Vietnam, including ISO week-year boundaries.
export function weekStart(date) {
  const local = new Date(new Date(date).getTime() + OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() - (local.getUTCDay() + 6) % 7);
  return local.getTime() - OFFSET_MS;
}
export function weekKey(start) {
  const thursday = new Date(start + OFFSET_MS + 3 * 86400000);
  const year = thursday.getUTCFullYear();
  const first = weekStart(new Date(Date.UTC(year, 0, 4) - OFFSET_MS));
  return `${year}-W${String(Math.round((start - first) / WEEK_MS) + 1).padStart(2, '0')}`;
}
export function calculateStreak(dates, now = new Date()) {
  const weeks = [...new Set(dates.filter(date => date && new Date(date) <= now)
    .map(weekStart))].sort((a, b) => a - b);
  let run = 0, longestStreak = 0, previous = null;
  for (const week of weeks) {
    run = previous !== null && week - previous === WEEK_MS ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = week;
  }
  const current = weekStart(now);
  const last = weeks.at(-1);
  let currentWeeklyStreak = 0;
  // An unfinished current week does not break the streak until next Monday.
  if (last === current || last === current - WEEK_MS) {
    let expected = last;
    for (let i = weeks.length - 1; i >= 0 && weeks[i] === expected; i--) {
      currentWeeklyStreak++;
      expected -= WEEK_MS;
    }
  }
  return {
    currentWeeklyStreak, longestStreak,
    lastCompletedPlaydateWeek: last === undefined ? null : weekKey(last),
    streakUpdatedAt: now,
  };
}

export const BADGE_DEFINITIONS = Object.freeze([
  { code: 'first_connection', title: 'Kết nối đầu tiên', description: 'Có ít nhất 1 kết nối được chấp nhận.', requirementCount: 1, metric: 'connections' },
  { code: 'first_playdate', title: 'Playdate đầu tiên', description: 'Hoàn thành ít nhất 1 Playdate.', requirementCount: 1, metric: 'playdates' },
  { code: '4_week_streak', title: 'Chuỗi 4 tuần', description: 'Hoàn thành Playdate trong ít nhất 4 tuần liên tiếp.', requirementCount: 4, metric: 'longestStreak' },
  { code: '10_playdates', title: '10 Playdates', description: 'Hoàn thành ít nhất 10 Playdates.', requirementCount: 10, metric: 'playdates' },
  { code: 'social_family', title: 'Gia đình kết nối', description: 'Có ít nhất 10 kết nối được chấp nhận.', requirementCount: 10, metric: 'connections' },
  { code: 'explorer', title: 'Nhà khám phá', description: 'Hoàn thành Playdate tại ít nhất 5 địa điểm khác nhau.', requirementCount: 5, metric: 'places' },
]);

export function locationKey(location = {}) {
  if (location.placeId?.trim()) return `place:${location.placeId.trim()}`;
  const normalize = value => (value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const address = normalize(location.address);
  const name = normalize(location.name);
  return address ? `address:${address}` : name ? `name:${name}` : null;
}

export function completedParticipation(parentId) {
  return {
    status: 'completed',
    $or: [
      { hostParentId: parentId },
      { participants: { $elemMatch: { parentId, status: 'accepted' } } },
    ],
  };
}
