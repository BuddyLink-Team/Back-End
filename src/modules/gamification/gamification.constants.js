export const BADGE_CODES = Object.freeze({
  FIRST_CONNECTION: 'first_connection',
  FIRST_PLAYDATE: 'first_playdate',
  FOUR_WEEK_STREAK: '4_week_streak',
  TEN_PLAYDATES: '10_playdates',
  SOCIAL_FAMILY: 'social_family',
  EXPLORER: 'explorer',
  // Higher milestones of the metrics above
  EIGHT_WEEK_STREAK: '8_week_streak',
  TWELVE_WEEK_STREAK: '12_week_streak',
  TWENTY_FIVE_PLAYDATES: '25_playdates',
  SUPER_CONNECTOR: 'super_connector',
  ADVENTURER: 'adventurer',
  // Playdates the parent organized
  FIRST_HOST: 'first_host',
  GENEROUS_HOST: 'generous_host',
});

// Weeks are Monday-based in Vietnam time
export const GAMIFICATION_TIMEZONE = 'Asia/Ho_Chi_Minh';

// Metric each badge is measured against (see gamification.rules.js)
export const BADGE_METRICS = Object.freeze({
  CONNECTIONS: 'connections',
  PLAYDATES: 'playdates',
  LONGEST_STREAK: 'longestStreak',
  PLACES: 'places',
  // Completed playdates where the parent is the host
  HOSTED: 'hosted',
});

// Badge images on Cloudinary (sources: assets/badges/<code>.svg, uploaded by `npm run badges:upload`,
// which prints these URLs; the version segment changes on every re-upload so browsers fetch the new image)
const CLOUDINARY_BADGES = 'https://res.cloudinary.com/dpotw9bhe/image/upload';
export const BADGE_ICON_URLS = Object.freeze({
  [BADGE_CODES.FIRST_CONNECTION]: `${CLOUDINARY_BADGES}/v1791563083/buddylink/badges/first_connection.svg`,
  [BADGE_CODES.FIRST_PLAYDATE]: `${CLOUDINARY_BADGES}/v1791563087/buddylink/badges/first_playdate.svg`,
  [BADGE_CODES.FOUR_WEEK_STREAK]: `${CLOUDINARY_BADGES}/v1791563073/buddylink/badges/4_week_streak.svg`,
  [BADGE_CODES.TEN_PLAYDATES]: `${CLOUDINARY_BADGES}/v1791563066/buddylink/badges/10_playdates.svg`,
  [BADGE_CODES.SOCIAL_FAMILY]: `${CLOUDINARY_BADGES}/v1791563092/buddylink/badges/social_family.svg`,
  [BADGE_CODES.EXPLORER]: `${CLOUDINARY_BADGES}/v1791563081/buddylink/badges/explorer.svg`,
  [BADGE_CODES.FIRST_HOST]: `${CLOUDINARY_BADGES}/v1791563085/buddylink/badges/first_host.svg`,
  [BADGE_CODES.GENEROUS_HOST]: `${CLOUDINARY_BADGES}/v1791563090/buddylink/badges/generous_host.svg`,
  [BADGE_CODES.EIGHT_WEEK_STREAK]: `${CLOUDINARY_BADGES}/v1791563074/buddylink/badges/8_week_streak.svg`,
  [BADGE_CODES.TWELVE_WEEK_STREAK]: `${CLOUDINARY_BADGES}/v1791563068/buddylink/badges/12_week_streak.svg`,
  [BADGE_CODES.TWENTY_FIVE_PLAYDATES]: `${CLOUDINARY_BADGES}/v1791563071/buddylink/badges/25_playdates.svg`,
  [BADGE_CODES.SUPER_CONNECTOR]: `${CLOUDINARY_BADGES}/v1791563095/buddylink/badges/super_connector.svg`,
  [BADGE_CODES.ADVENTURER]: `${CLOUDINARY_BADGES}/v1791563077/buddylink/badges/adventurer.svg`,
});
export const DEFAULT_BADGE_ICON_URL = `${CLOUDINARY_BADGES}/v1791563079/buddylink/badges/default.svg`;

const RAW_BADGE_DEFINITIONS = [
  { code: BADGE_CODES.FIRST_CONNECTION, title: 'Kết nối đầu tiên', description: 'Có ít nhất 1 kết nối được chấp nhận.', requirementCount: 1, metric: BADGE_METRICS.CONNECTIONS },
  { code: BADGE_CODES.FIRST_PLAYDATE, title: 'Playdate đầu tiên', description: 'Hoàn thành ít nhất 1 Playdate.', requirementCount: 1, metric: BADGE_METRICS.PLAYDATES },
  { code: BADGE_CODES.FOUR_WEEK_STREAK, title: 'Chuỗi 4 tuần', description: 'Hoàn thành Playdate trong ít nhất 4 tuần liên tiếp.', requirementCount: 4, metric: BADGE_METRICS.LONGEST_STREAK },
  { code: BADGE_CODES.TEN_PLAYDATES, title: '10 Playdates', description: 'Hoàn thành ít nhất 10 Playdates.', requirementCount: 10, metric: BADGE_METRICS.PLAYDATES },
  { code: BADGE_CODES.SOCIAL_FAMILY, title: 'Gia đình kết nối', description: 'Có ít nhất 10 kết nối được chấp nhận.', requirementCount: 10, metric: BADGE_METRICS.CONNECTIONS },
  { code: BADGE_CODES.EXPLORER, title: 'Nhà khám phá', description: 'Hoàn thành Playdate tại ít nhất 5 địa điểm khác nhau.', requirementCount: 5, metric: BADGE_METRICS.PLACES },
  { code: BADGE_CODES.FIRST_HOST, title: 'Chủ nhà đầu tiên', description: 'Tổ chức và hoàn thành Playdate đầu tiên của gia đình bạn.', requirementCount: 1, metric: BADGE_METRICS.HOSTED },
  { code: BADGE_CODES.GENEROUS_HOST, title: 'Chủ nhà hiếu khách', description: 'Tổ chức và hoàn thành ít nhất 5 Playdates.', requirementCount: 5, metric: BADGE_METRICS.HOSTED },
  { code: BADGE_CODES.EIGHT_WEEK_STREAK, title: 'Chuỗi 8 tuần', description: 'Hoàn thành Playdate trong ít nhất 8 tuần liên tiếp.', requirementCount: 8, metric: BADGE_METRICS.LONGEST_STREAK },
  { code: BADGE_CODES.TWELVE_WEEK_STREAK, title: 'Chuỗi 12 tuần', description: 'Hoàn thành Playdate trong ít nhất 12 tuần liên tiếp.', requirementCount: 12, metric: BADGE_METRICS.LONGEST_STREAK },
  { code: BADGE_CODES.TWENTY_FIVE_PLAYDATES, title: '25 Playdates', description: 'Hoàn thành ít nhất 25 Playdates.', requirementCount: 25, metric: BADGE_METRICS.PLAYDATES },
  { code: BADGE_CODES.SUPER_CONNECTOR, title: 'Cầu nối cộng đồng', description: 'Có ít nhất 25 kết nối được chấp nhận.', requirementCount: 25, metric: BADGE_METRICS.CONNECTIONS },
  { code: BADGE_CODES.ADVENTURER, title: 'Nhà thám hiểm', description: 'Hoàn thành Playdate tại ít nhất 10 địa điểm khác nhau.', requirementCount: 10, metric: BADGE_METRICS.PLACES },
];

export const BADGE_DEFINITIONS = Object.freeze(
  RAW_BADGE_DEFINITIONS.map((badge) =>
    Object.freeze({ ...badge, iconUrl: BADGE_ICON_URLS[badge.code] || DEFAULT_BADGE_ICON_URL })
  )
);
