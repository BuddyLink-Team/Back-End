/**
 * BuddyLink demo data seed (Đà Nẵng and Hội An), 01/08/2026 to 31/10/2026.
 *
 * Keeps the parents already in the database and adds new ones up to SEED_PARENT_COUNT, 5 of them not
 * verified (these have a user and a parent document only). Everything else is rebuilt following the
 * app's rules: plan quotas, connections before playdates, host-only reschedules, moderation flow.
 *
 * - Accounts outside EMAIL_DOMAIN (real sign-ups): profile, password, child, subscription and payments are kept
 *   as they are; their activity is rebuilt like everyone else's.
 * - Accounts of EMAIL_DOMAIN: same ids, emails and names, the rest is reset (password included).
 * - subscription_plans, places_cache and places_sync_tiles are kept, missing documents are added.
 * - Includes the migrations: normalize-phones, migrate-bud48-child-pairs, migrate-report-severities.
 *   regeocode-parents is not needed: seeded parents use the same ward centers (it calls Nominatim).
 *
 * Usage:
 *   node scripts/seed.js            # dry run: prints the target database and what would be wiped
 *   node scripts/seed.js --confirm  # wipe + seed
 *
 * Seeded accounts share the password in SEED_PASSWORD.
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import User from '../src/modules/user/user.model.js';
import AuthToken from '../src/modules/auth/auth-token.model.js';
import RefreshToken from '../src/modules/auth/refresh-token.model.js';
import Parent from '../src/modules/parent/parent.model.js';
import Child from '../src/modules/child/child.model.js';
import { CHILD_ACTIVITIES, CHILD_GENDERS } from '../src/modules/child/child.constants.js';
import Connection from '../src/modules/connection/connection.model.js';
import Swipe from '../src/modules/discovery/discovery.model.js';
import { calculateChildPairScore, distanceKmBetween } from '../src/modules/discovery/matching.rules.js';
import { buildChildPairKey } from '../src/modules/connection/connection.constants.js';
import PlacesCache from '../src/modules/places/places-cache.model.js';
import PlacesSyncTile from '../src/modules/places/places-sync-tile.model.js';
import { PLACE_SOURCES, PLACES_SYNC_DEFAULTS, PLACES_SYNC_TILE_STATUS } from '../src/modules/places/places.constants.js';
import Conversation from '../src/modules/chat/conversation.model.js';
import Message from '../src/modules/chat/message.model.js';
import Playdate from '../src/modules/playdate/playdate.model.js';
import RescheduleRequest from '../src/modules/playdate/reschedule-request.model.js';
import RatingFeedback from '../src/modules/rating-feedback/rating-feedback.model.js';
import Badge from '../src/modules/gamification/badge.model.js';
import UserBadge from '../src/modules/gamification/user-badge.model.js';
import { BADGE_DEFINITIONS } from '../src/modules/gamification/gamification.constants.js';
import { buildMetrics, calculateStreak } from '../src/modules/gamification/gamification.rules.js';
import Notification from '../src/modules/notification/notification.model.js';
import Block from '../src/modules/safety/block.model.js';
import { CATEGORY_TO_SEVERITY, DEFAULT_BLOCK_REASON, REPORT_CATEGORY_NOTICES } from '../src/modules/safety/safety.constants.js';
import Report from '../src/modules/safety/report.model.js';
import Subscription from '../src/modules/subscription/subscription.model.js';
import SubscriptionPlan from '../src/modules/subscription/subscription-plan.model.js';
import Payment from '../src/modules/subscription/payment.model.js';
import UsageQuota from '../src/modules/subscription/usage-quota.model.js';
import { QUOTA_ACTIONS, SUBSCRIPTION_PLAN_DEFAULTS } from '../src/modules/subscription/subscription.constants.js';
import AIChatSession from '../src/modules/ai-assistant/ai-assistant.model.js';
import { AI_TOOL_NAMES } from '../src/modules/ai-assistant/ai-assistant.constants.js';
import AdminNotification from '../src/modules/admin/admin-notification.model.js';
import { ADMIN_NOTIFICATION_TTL_SECONDS } from '../src/modules/admin/admin.constants.js';
import { normalizePhone } from '../src/shared/helpers/phone.helper.js';
import { migrateChildPairs } from './migrate-bud48-child-pairs.js';

export const SEED_PASSWORD = 'abc123';
export const SEED_PARENT_COUNT = 100;
export const SEED_UNVERIFIED_COUNT = 5;
export const EMAIL_DOMAIN = 'mail.buddylink.vn';
const CITY = 'Đà Nẵng';

// Collections wiped before seeding (subscription_plans, places_cache and places_sync_tiles are kept)
const MODELS_TO_WIPE = [
  User, AuthToken, RefreshToken, Parent, Child, Connection, Swipe, Conversation, Message, Playdate,
  RescheduleRequest, RatingFeedback, Badge, UserBadge, Notification, Block, Report,
  Subscription, Payment, UsageQuota, AIChatSession, AdminNotification,
];
const MODELS_KEPT = [SubscriptionPlan, PlacesCache, PlacesSyncTile];

// Number of subscriptions per kind among the seeded verified families, the others are on Free
const PLAN_MIX = { yearly: 14, renewedMonthly: 8, monthly: 12, expired: 10 };
// Yearly families that meet every week, so the streak and playdate badges are reachable
const POWER_FAMILY_COUNT = 6;

// ---------------------------------------------------------------------------
// Deterministic randomness (same data on every run)
// ---------------------------------------------------------------------------
let rngState = 20260801;
const random = () => {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (min, max) => min + Math.floor(random() * (max - min + 1));
const pick = (list) => list[Math.floor(random() * list.length)];
const chance = (p) => random() < p;
const pickMany = (list, count) => {
  const copy = [...list];
  const out = [];
  while (out.length < count && copy.length) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  return out;
};
const shuffled = (list) => pickMany(list, list.length);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const oid = () => new mongoose.Types.ObjectId();
const sameId = (a, b) => a.toString() === b.toString();

// ---------------------------------------------------------------------------
// Dates: everything happens between WINDOW_START and WINDOW_END, in Vietnam time.
// Only the date of upcoming playdates (and the end of paid plans) is later.
// ---------------------------------------------------------------------------
const NOW = new Date();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const VN_OFFSET = 7 * HOUR;
const WINDOW_START = new Date('2026-08-01T00:00:00+07:00');
const WINDOW_END = new Date(Math.min(NOW.getTime(), new Date('2026-10-31T23:59:00+07:00').getTime()));

const addTime = (date, ms) => new Date(date.getTime() + ms);
const minDate = (...dates) => new Date(Math.min(...dates.map((d) => d.getTime())));
const maxDate = (...dates) => new Date(Math.max(...dates.map((d) => d.getTime())));
const between = (from, to) => new Date(from.getTime() + random() * Math.max(to.getTime() - from.getTime(), 0));
const dayStart = (date) => new Date(Math.floor((date.getTime() + VN_OFFSET) / DAY) * DAY - VN_OFFSET);
const at = (day, hour, minute = 0) => addTime(dayStart(day), (hour * 60 + minute) * MINUTE);
// Same day at a time people are awake, never after the end of the window
const awake = (date) => minDate(at(date, int(7, 22), int(0, 59)), addTime(WINDOW_END, -int(1, 30) * MINUTE));
const capped = (date) => minDate(date, WINDOW_END);
// A moment in one of the months of [from, to], each month equally likely: older accounts stay active
// instead of everything piling up in the last weeks
const MONTH_STARTS = ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((day) => new Date(`${day}T00:00:00+07:00`));
const spread = (from, to) => {
  const ranges = MONTH_STARTS.slice(0, -1)
    .map((start, index) => [maxDate(start, from), minDate(MONTH_STARTS[index + 1], to)])
    .filter(([start, end]) => start < end);
  if (!ranges.length) return between(from, to);
  const [start, end] = pick(ranges);
  return between(start, end);
};
const formatDay = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const formatVnDate = (date) => formatDay(date).split('-').reverse().join('/');
const ageAt = (dob, date) => (date.getTime() - new Date(dob).getTime()) / (365.25 * DAY);

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

// Wards of Đà Nẵng after the 2025 administrative reorganization, approximate centers [lng, lat]
// Ward centers: center of the ward boundary in OpenStreetMap (Nominatim), the same point the app geocodes
// a parent's location to (geocoding.adapter.js), so seeded distances match real ones
const WARDS = [
  { name: 'Phường Hải Châu', center: [108.2195, 16.0590], streets: ['Lê Duẩn', 'Trần Phú', 'Phan Châu Trinh', 'Bạch Đằng', 'Lý Tự Trọng'], weight: 7, cluster: 'da_nang' },
  { name: 'Phường Hòa Cường', center: [108.2175, 16.0416], streets: ['Núi Thành', '2 Tháng 9', 'Xô Viết Nghệ Tĩnh', 'Lê Thanh Nghị', 'Huỳnh Tấn Phát'], weight: 6, cluster: 'da_nang' },
  { name: 'Phường Thanh Khê', center: [108.1966, 16.0684], streets: ['Điện Biên Phủ', 'Hà Huy Tập', 'Lê Độ', 'Thái Thị Bôi', 'Trường Chinh'], weight: 5, cluster: 'da_nang' },
  { name: 'Phường An Khê', center: [108.1855, 16.0500], streets: ['Hà Huy Tập', 'Nguyễn Tri Phương', 'Trần Cao Vân', 'Phạm Nhữ Tăng'], weight: 4, cluster: 'da_nang' },
  { name: 'Phường An Hải', center: [108.2364, 16.0701], streets: ['Ngô Quyền', 'Phạm Văn Đồng', 'Hồ Nghinh', 'Nguyễn Văn Thoại', 'Hà Bổng'], weight: 6, cluster: 'da_nang' },
  { name: 'Phường Sơn Trà', center: [108.2486, 16.1022], streets: ['Ngô Quyền', 'Yết Kiêu', 'Lê Văn Thứ', 'Hoàng Sa', 'Nguyễn Phan Vinh'], weight: 4, cluster: 'da_nang' },
  { name: 'Phường Ngũ Hành Sơn', center: [108.2532, 16.0108], streets: ['Lê Văn Hiến', 'Trường Sa', 'Mai Đăng Chơn', 'Nguyễn Đình Chiểu', 'Chương Dương'], weight: 5, cluster: 'da_nang' },
  { name: 'Phường Hòa Khánh', center: [108.1546, 16.0503], streets: ['Tôn Đức Thắng', 'Âu Cơ', 'Nguyễn Lương Bằng', 'Hồ Tùng Mậu'], weight: 3, cluster: 'da_nang' },
  { name: 'Phường Liên Chiểu', center: [108.1392, 16.0767], streets: ['Nguyễn Tất Thành', 'Nguyễn Sinh Sắc', 'Kinh Dương Vương', 'Nguyễn Chánh'], weight: 2, cluster: 'da_nang' },
  { name: 'Phường Cẩm Lệ', center: [108.2013, 16.0153], streets: ['Ông Ích Đường', 'Cách Mạng Tháng 8', 'Trần Đình Tri', 'Nguyễn Hữu Thọ'], weight: 4, cluster: 'da_nang' },
  { name: 'Phường Hòa Xuân', center: [108.2204, 16.0049], streets: ['Minh Mạng', 'Nguyễn Phước Lan', 'Võ Chí Công', 'Lê Quang Đạo'], weight: 3, cluster: 'da_nang' },
  { name: 'Phường Hội An', center: [108.3325, 15.8794], streets: ['Trần Hưng Đạo', 'Lý Thường Kiệt', 'Hai Bà Trưng', 'Phan Chu Trinh', 'Nguyễn Duy Hiệu'], weight: 18, cluster: 'hoi_an' },
  { name: 'Phường Hội An Đông', center: [108.3640, 15.8786], streets: ['Cửa Đại', 'Lạc Long Quân', 'Âu Cơ', 'Nguyễn Phan Vinh'], weight: 12, cluster: 'hoi_an' },
  { name: 'Phường Hội An Tây', center: [108.3109, 15.8974], streets: ['Lý Thái Tổ', 'Hùng Vương', 'Nguyễn Tất Thành', 'Tôn Đức Thắng'], weight: 10, cluster: 'hoi_an' },
  // A few families outside the two main areas
  { name: 'Phường Điện Bàn', center: [108.2493, 15.8892], streets: ['Trần Nhân Tông', 'Hùng Vương', 'Mẹ Thứ'], weight: 3, cluster: 'other' },
  { name: 'Phường Điện Bàn Đông', center: [108.2703, 15.9316], streets: ['Lạc Long Quân', 'Võ Chí Công', 'Trường Sa'], weight: 3, cluster: 'other' },
  { name: 'Phường An Thắng', center: [108.2254, 15.9060], streets: ['Hùng Vương', 'Trần Hưng Đạo', 'Nguyễn Văn Linh'], weight: 2, cluster: 'other' },
];
const weightedWards = WARDS.flatMap((ward) => Array(ward.weight).fill(ward));

const FAMILY_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Huỳnh', 'Phan', 'Võ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý', 'Trương'];
const MIDDLE_FEMALE = ['Thị', 'Thu', 'Ngọc', 'Thanh', 'Bảo', 'Minh', 'Phương', 'Hoài', 'Khánh', 'Mỹ'];
const MIDDLE_MALE = ['Văn', 'Minh', 'Quốc', 'Đức', 'Hữu', 'Thành', 'Gia', 'Hoàng', 'Anh', 'Công'];
const GIVEN_FEMALE = ['Hà', 'Trang', 'Linh', 'Hương', 'Thảo', 'Nhung', 'Vy', 'Uyên', 'Ngân', 'Quyên', 'Hạnh', 'Diễm', 'Phượng', 'Loan', 'My', 'Thư'];
const GIVEN_MALE = ['Hùng', 'Nam', 'Tuấn', 'Phúc', 'Khoa', 'Long', 'Bảo', 'Huy', 'Trung', 'Tài', 'Sơn', 'Dũng', 'Quang', 'Vinh'];

const BOY_NAMES = ['Gia Bảo', 'Minh Khang', 'Đăng Khoa', 'Nhật Minh', 'Anh Khôi', 'Bảo Nam', 'Hoàng Phúc', 'Quang Huy', 'Thiên Ân', 'Đức Anh'];
const GIRL_NAMES = ['Bảo Ngọc', 'Khánh An', 'Minh Thư', 'Gia Hân', 'Ngọc Diệp', 'An Nhiên', 'Tuệ Lâm', 'Hà My', 'Khánh Vy', 'Thảo Nguyên'];
const BOY_NICKNAMES = ['Bin', 'Bơ', 'Tôm', 'Su Hào', 'Cà Rốt', 'Mít', 'Bắp', 'Gạo', 'Tũn', 'Ken', 'Bo', 'Sóc', 'Nhím', 'Đậu'];
const GIRL_NICKNAMES = ['Na', 'Mây', 'Bông', 'Xoài', 'Cherry', 'Mi', 'Sữa', 'Kem', 'Bống', 'Thỏ', 'Hạt Tiêu', 'Su', 'Mochi', 'Nấm'];

// Same values as the frontend child constants, so discovery filters/matching work
const INTERESTS = [
  'Lego & Lắp ráp', 'Vẽ & Hội họa', 'Khủng long', 'Âm nhạc & Đàn', 'Khoa học & Không gian', 'Đọc sách & Truyện tranh',
  'Siêu anh hùng', 'Nấu ăn tí hon', 'Thủ công & Đất nặn', 'Xe cộ & Tàu hỏa', 'Búp bê & Thời trang', 'Cờ vua & Board game',
];
const PERSONALITY_TRAITS = [
  'Năng động & Thích vận động', 'Sáng tạo & Giàu trí tưởng tượng', 'Điềm tĩnh & Thích quan sát', 'Hòa đồng & Dễ kết bạn',
  'Tò mò & Thích khám phá', 'Nhạy cảm & Biết lắng nghe', 'Hài hước & Vui vẻ', 'Cẩn thận & Kiên nhẫn',
];
const LOCATION_PREFS = ['indoor', 'outdoor', 'park', 'kids_cafe', 'home', 'library', 'museum', 'mall', 'sports_center', 'pool'];

const BIOS = {
  da_nang: [
    'Mẹ của một bé trai hiếu động, cuối tuần hay đưa con ra biển Mỹ Khê đạp xe. Mong tìm bạn cùng tuổi để con bớt dán mắt vào điện thoại.',
    'Hai vợ chồng làm văn phòng ở trung tâm Đà Nẵng, bé nhà mình mê Lego và khủng long. Rất vui được làm quen các gia đình gần nhà.',
    'Gia đình mới chuyển từ Hà Nội vào Đà Nẵng được nửa năm, đang tìm bạn chơi cho bé và cũng muốn quen thêm các phụ huynh ở đây.',
    'Bé nhà mình đang học bơi ở Tiên Sơn, rất thích nước. Cuối tuần thường đi công viên APEC hoặc cầu Rồng xem phun lửa.',
    'Nhà mình hay dẫn con đi thư viện và bảo tàng Chăm. Thích những gia đình cùng quan điểm đọc sách cho con mỗi tối.',
    'Bố mẹ đều là kỹ sư ở Đà Nẵng, bé thích khoa học và lắp ráp robot. Sẵn sàng tổ chức buổi thí nghiệm vui tại nhà cho các bé.',
  ],
  hoi_an: [
    'Nhà mình ở gần phố cổ Hội An, chiều mát hay cho bé đạp xe ven sông Hoài. Mong bé có thêm bạn cùng trang lứa.',
    'Làm ngành du lịch ở Hội An nên cuối tuần thường bận, chủ yếu rảnh buổi chiều ngày thường. Bé nhà mình rất mê vẽ.',
    'Gia đình ở Cẩm Châu, cuối tuần hay đưa con ra biển An Bàng xây lâu đài cát. Rất muốn hẹn thêm các bạn ở Hội An.',
    'Mẹ bé làm gốm ở Thanh Hà nên bé rất thích nặn đất. Nhà có sân nhỏ, các bạn đến chơi lúc nào cũng được.',
    'Bố mẹ đều làm ở Hội An, thích cho con đi làng rau Trà Quế và đồng lúa Cẩm Thanh để gần gũi thiên nhiên.',
    'Bé nhà mình mới học lớp 1 ở Hội An, hơi nhút nhát nên muốn con có nhóm bạn gần nhà chơi đều đặn.',
  ],
  other: [
    'Mình là giáo viên mầm non, thích tổ chức các buổi chơi nhỏ tại nhà với đất nặn và vẽ tranh. Nhà có sân rộng, các bé tha hồ chạy.',
    'Bố bỉm sữa, làm việc tự do nên khá linh hoạt thời gian. Bé gái nhà mình hơi nhút nhát, muốn con có thêm bạn thân.',
    'Mẹ hai con, bé lớn học lớp 2, bé nhỏ đi mẫu giáo. Ưu tiên các hoạt động ngoài trời, hạn chế thiết bị điện tử.',
    'Mình muốn con lớn lên gần gũi thiên nhiên: dã ngoại, trồng cây, đạp xe. Rất mong được hẹn chơi đều đặn mỗi tuần.',
    'Bé nhà mình hòa đồng nhưng hơi nóng tính, đang tập chia sẻ đồ chơi. Mong gặp các bạn kiên nhẫn để con học hỏi thêm.',
  ],
};

// osm-*: the real OpenStreetMap element (checked on openstreetmap.org), coordinates = its center.
// seed-*: no matching OSM element, approximate coordinates, no OpenStreetMap link (Google Maps searches name + address).
const PLACES = [
  { name: 'Công viên Biển Đông', address: 'Đường Võ Nguyên Giáp, Phường An Hải, Thành phố Đà Nẵng', coordinates: [108.24593, 16.06815], placeType: 'park', osmId: 'osm-way-149699484' },
  { name: 'Công viên APEC', address: 'Đường Bạch Đằng, Phường Hải Châu, Thành phố Đà Nẵng', coordinates: [108.22327, 16.0586], placeType: 'park', osmId: 'osm-way-675604354' },
  { name: 'Công viên 29/3', address: 'Đường Điện Biên Phủ, Phường Thanh Khê, Thành phố Đà Nẵng', coordinates: [108.2004, 16.0641], placeType: 'park', osmId: 'seed-cong-vien-29-3' },
  { name: 'Sun World Đà Nẵng Wonders', address: '1 Phan Đăng Lưu, Phường Hòa Cường, Thành phố Đà Nẵng', coordinates: [108.2283, 16.0391], placeType: 'playground', osmId: 'seed-sun-world-da-nang-wonders' },
  { name: 'Bảo tàng Điêu khắc Chăm', address: '02 Đường 2 Tháng 9, Phường Hải Châu, Thành phố Đà Nẵng', coordinates: [108.22317, 16.0602], placeType: 'workshop', osmId: 'osm-way-302872188' },
  { name: 'Thư viện Khoa học Tổng hợp Đà Nẵng', address: 'Đường Lê Duẩn, Phường Hải Châu, Thành phố Đà Nẵng', coordinates: [108.2166, 16.0716], placeType: 'library', osmId: 'seed-thu-vien-khth-da-nang' },
  // Kids areas inside a mall: the OSM element is the mall itself
  { name: 'Khu vui chơi trẻ em Lotte Mart Đà Nẵng', address: '6 Nại Nam, Phường Hòa Cường, Thành phố Đà Nẵng', coordinates: [108.22923, 16.03487], placeType: 'kids_cafe', osmId: 'osm-way-302765734' },
  { name: 'Khu vui chơi Vincom Plaza Ngô Quyền', address: '910A Ngô Quyền, Phường An Hải, Thành phố Đà Nẵng', coordinates: [108.2303, 16.0714], placeType: 'kids_cafe', osmId: 'osm-way-693393717' },
  { name: 'Cung Thể thao Tiên Sơn', address: 'Đường Phan Đăng Lưu, Phường Hòa Cường, Thành phố Đà Nẵng', coordinates: [108.22654, 16.03676], placeType: 'sports_center', osmId: 'osm-way-302765735' },
  { name: 'Công viên Biển Hội An (An Bàng)', address: 'Bãi biển An Bàng, Phường Hội An Đông, Thành phố Đà Nẵng', coordinates: [108.3418, 15.9139], placeType: 'park', osmId: 'seed-cong-vien-bien-an-bang' },
  { name: 'Bãi biển Cửa Đại', address: 'Đường Cửa Đại, Phường Hội An Đông, Thành phố Đà Nẵng', coordinates: [108.3816, 15.8741], placeType: 'park', osmId: 'seed-bai-bien-cua-dai' },
  { name: 'Công viên Đồng Hiệp', address: 'Đường Nguyễn Hoàng, Phường Hội An, Thành phố Đà Nẵng', coordinates: [108.3249, 15.8768], placeType: 'park', osmId: 'seed-cong-vien-dong-hiep-hoi-an' },
  { name: 'Công viên Đất Nung Thanh Hà', address: 'Làng gốm Thanh Hà, Phường Hội An Tây, Thành phố Đà Nẵng', coordinates: [108.2997, 15.8768], placeType: 'workshop', osmId: 'seed-cong-vien-dat-nung-thanh-ha' },
  { name: 'Làng rau Trà Quế', address: 'Đường Hai Bà Trưng, Phường Hội An Tây, Thành phố Đà Nẵng', coordinates: [108.3351, 15.9021], placeType: 'workshop', osmId: 'seed-lang-rau-tra-que' },
  { name: 'Thư viện Thành phố Hội An', address: 'Đường Trần Hưng Đạo, Phường Hội An, Thành phố Đà Nẵng', coordinates: [108.3282, 15.8796], placeType: 'library', osmId: 'seed-thu-vien-hoi-an' },
  { name: 'Khu vui chơi thiếu nhi Hội An', address: 'Đường Lý Thường Kiệt, Phường Hội An, Thành phố Đà Nẵng', coordinates: [108.3331, 15.8823], placeType: 'kids_cafe', osmId: 'seed-khu-vui-choi-hoi-an' },
  { name: 'Trung tâm Thể thao Hội An', address: 'Đường Lý Thường Kiệt, Phường Hội An, Thành phố Đà Nẵng', coordinates: [108.3359, 15.8847], placeType: 'sports_center', osmId: 'seed-trung-tam-the-thao-hoi-an' },
];

// Usual opening hours per place type (OSM opening_hours format)
const OPENING_HOURS = {
  park: '05:00-22:00',
  playground: '06:00-21:00',
  kids_cafe: 'Mo-Su 08:00-21:30',
  library: 'Tu-Su 07:30-17:00',
  museum: 'Mo-Su 08:00-17:00',
  sports_center: 'Mo-Su 06:00-21:00',
  workshop: 'Tu-Su 08:30-17:30',
};

const ACTIVITIES_BY_PLACE = {
  park: ['Đạp xe và thả diều', 'Xây lâu đài cát, chơi vận động ngoài trời', 'Dã ngoại, thổi bong bóng xà phòng', 'Chơi bóng và chạy nhảy buổi chiều'],
  playground: ['Chơi vòng quay và trò chơi thiếu nhi', 'Khám phá khu trò chơi cùng các bạn'],
  kids_cafe: ['Chơi nhà banh và trò chơi vận động trong nhà', 'Ráp Lego chung và tô màu', 'Chơi board game và ăn xế'],
  library: ['Đọc truyện tranh và tô màu ở góc thiếu nhi', 'Nghe kể chuyện và mượn sách'],
  sports_center: ['Học bơi nhóm và chơi trò chơi dưới nước', 'Tập thể thao vui cho bé'],
  workshop: ['Nặn đất và làm đồ thủ công', 'Tham quan và nghe kể chuyện lịch sử', 'Trải nghiệm trồng rau cùng các bạn'],
};
const PLAYDATE_NOTES = ['Nhớ mang nón và kem chống nắng cho bé nhé.', 'Mỗi nhà mang một ít nước và trái cây.', 'Có chỗ gửi xe máy ngay cổng chính.', 'Nhà mình chuẩn bị sẵn khăn và nước lọc rồi.', ''];
const CANCEL_REASONS = ['Bé bị sốt nhẹ từ tối qua, xin hẹn lại tuần sau ạ.', 'Nhà mình có việc đột xuất, xin lỗi cả nhà nhé.', 'Dự báo mưa lớn cả ngày nên mình xin dời sang dịp khác.', 'Bé bị ho, để bé nghỉ cho khỏe rồi mình hẹn lại.'];
// Stored by the auto-close job when nobody accepted (playdateService.closeExpiredPlaydates)
const AUTO_CANCEL_REASON = 'No participant accepted the invitation';
const RESCHEDULE_REASONS = ['Hôm đó nhà mình có đám giỗ, mình dời lịch được không ạ?', 'Chiều đó bé có lớp vẽ, mình đổi giờ nhé.', 'Dự báo có mưa, mình đổi giờ cho chắc nha.', 'Bé tan học muộn hơn, mình lùi giờ một chút được không?'];

const DIRECT_CHAT_SCRIPTS = {
  da_nang: [
    [
      'Chào chị, em thấy bé nhà chị cũng mê khủng long giống bé nhà em 😄',
      'Đúng rồi em, ngày nào cũng đòi xem phim khủng long luôn. Bé nhà em mấy tuổi rồi?',
      'Dạ bé 5 tuổi rưỡi chị. Cuối tuần này nhà chị có rảnh không, mình cho hai đứa ra công viên APEC chơi thử?',
      'Sáng thứ 7 được nè, tầm 8h cho mát nha em.',
      'Ok chị, em đặt lịch trên app luôn nha 👍',
    ],
    [
      'Anh ơi, bé nhà em học bơi ở Tiên Sơn, nghe nói bé nhà anh cũng học ở đó?',
      'Ừ đúng rồi, lớp chiều thứ 3 với thứ 5. Bé nhà em học lớp nào?',
      'Lớp thứ 5 luôn anh! Hôm nào học xong mình cho hai đứa đi ăn kem nha.',
      'Được đó, để anh hỏi mẹ bé lịch tuần sau đã.',
    ],
    [
      'Chị ơi hôm qua bé nhà em về kể suốt về buổi đi chơi, cảm ơn chị đã dẫn bé đi cùng nha ❤️',
      'Trời bé nhà chị cũng vậy luôn, cứ hỏi bao giờ gặp lại bạn. Tuần sau mình đi thư viện Lê Duẩn nhé?',
      'Dạ hay đó chị, ở đó có góc đọc truyện thiếu nhi rất xịn.',
      'Vậy chiều thứ 4 nha, 15h30 chị đón bé xong qua luôn.',
      'Dạ ok chị!',
    ],
    [
      'Chào em, nhà chị ở Hòa Xuân, gần nhà em không?',
      'Dạ em ở Cẩm Lệ chị, chạy qua tầm 10 phút thôi.',
      'Vậy tiện quá, cuối tuần chị hay cho bé đạp xe ở công viên ven sông Cẩm Lệ đó.',
      'Bé nhà em mới tập xe đạp 2 bánh, chắc ghép với bé chị là vui lắm 😆',
    ],
    [
      'Chị ơi bé nhà chị có hay say nắng không? Em định hẹn ở biển mà sợ trưa nắng quá.',
      'Có em, nên chị toàn đi sáng sớm hoặc sau 4h chiều thôi.',
      'Vậy 16h30 thứ 7 ở Công viên Biển Đông nha chị.',
      'Ok em, chị mang thêm xẻng xô cát cho tụi nhỏ xây lâu đài.',
    ],
  ],
  hoi_an: [
    [
      'Chào chị, nhà em ở gần chợ Hội An, thấy bé nhà chị cũng thích vẽ nên nhắn làm quen ạ.',
      'Chào em, bé nhà chị ngày nào cũng đòi vẽ luôn. Cuối tuần em hay cho bé đi đâu?',
      'Dạ em hay ra An Bàng buổi chiều cho mát. Hay mình hẹn một buổi cho hai bé xây lâu đài cát nhé?',
      'Hay đó em, chủ nhật này 16h được không?',
      'Dạ được chị, em đặt lịch trên app luôn nha 🏖️',
    ],
    [
      'Anh ơi, bé nhà em muốn thử làm gốm, nghe nói anh hay cho bé qua Thanh Hà?',
      'Ừ em, ở đó có chỗ cho bé tự nặn, tầm 45 phút là xong một món.',
      'Vậy sáng thứ 7 tuần sau mình cho hai đứa đi chung được không anh?',
      'Được em, đi sớm cho đỡ nắng nha. Anh chở bé qua lúc 8h30.',
    ],
    [
      'Chị ơi trường bé nhà chị có nghỉ thứ 7 không? Em muốn rủ hai đứa đi làng rau Trà Quế.',
      'Nghỉ em ơi. Ý hay đó, bé nhà chị chưa được trồng rau bao giờ 😄',
      'Dạ vậy mình hẹn sáng thứ 7, em đặt chỗ trải nghiệm trước cho.',
      'Cảm ơn em nhiều nha, để chị chuẩn bị nón cho bé.',
    ],
    [
      'Nhà anh chị ở Cửa Đại đúng không ạ? Nhà em cũng gần đó nè.',
      'Đúng rồi em, gần ngã ba Âu Cơ. Bé nhà em đi học ở đâu?',
      'Dạ bé học mẫu giáo trên Lý Thường Kiệt. Chiều nào mát cho hai bé ra biển chơi chung nha anh.',
      'Ok em, chiều thứ 6 nhà anh rảnh đó.',
    ],
  ],
  other: [
    [
      'Hi anh, bé nhà em thích lắp Lego lắm, anh có muốn cho hai bé thử ráp chung một bộ không?',
      'Ý hay đó, nhà anh có bộ thành phố lớn mà chưa ai ráp xong 😂',
      'Vậy chủ nhật này qua nhà anh được không? Em mang thêm bánh cho tụi nhỏ.',
      'Ok em, 9h sáng nhé. Anh gửi địa chỉ qua tin nhắn sau.',
    ],
    [
      'Chào chị, em thấy hai bé nhà mình bằng tuổi nhau nên nhắn làm quen ạ.',
      'Chào em, vui quá. Bé nhà em thích chơi gì nhất?',
      'Dạ bé mê vẽ với chạy nhảy ngoài trời. Khi nào rảnh mình cho hai bé gặp nhau nha chị.',
      'Được em, cuối tuần sau nhà chị rảnh, mình hẹn nhé.',
    ],
  ],
};
const CHAT_FOLLOW_UPS = [
  'Dạo này bé nhà mình thế nào rồi ạ?',
  'Bé nhà mình vẫn nhắc bạn suốt, tuần sau hẹn lại nhé.',
  'Hôm trước vui ghê, lần sau để nhà mình chuẩn bị đồ ăn cho.',
  'Tuần này bé nhà mình thi giữa kỳ, tuần sau mình hẹn nha.',
  'Cuối tuần này trời đẹp đó, nhà mình có muốn đi đâu không?',
];
const GROUP_CHAT_LINES = [
  'Chào cả nhà, mình tạo nhóm này để tiện trao đổi cho buổi hẹn nhé!',
  'Nhà em sẽ tới đúng giờ ạ. Có cần mang gì không mọi người?',
  'Mỗi nhà mang một ít trái cây với nước là được, chị chuẩn bị bánh rồi.',
  'Bé nhà em háo hức từ tối qua luôn 😄',
  'Trời hôm nay đẹp quá, hẹn mọi người lát gặp nha!',
];
const REPORTED_MESSAGE = 'Nhà chị dạy con kiểu đó thì đừng có rủ ai chơi nữa, phiền lắm.';

const FEEDBACKS = [
  { rating: 5, feedback: 'Hai bé chơi rất hợp, về nhà còn đòi gặp lại bạn. Bố mẹ bạn rất thân thiện!', tags: ['Đúng giờ', 'Thân thiện', 'Bé chơi hợp'] },
  { rating: 5, feedback: 'Địa điểm sạch sẽ, an toàn. Mọi người chuẩn bị đồ ăn rất chu đáo.', tags: ['Địa điểm an toàn', 'Chu đáo'] },
  { rating: 5, feedback: 'Rất đáng để hẹn lại, hai gia đình nói chuyện hợp nhau lắm.', tags: ['Muốn hẹn lại', 'Thân thiện'] },
  { rating: 4, feedback: 'Buổi chơi vui, chỉ hơi nắng nên lần sau sẽ hẹn sớm hơn.', tags: ['Bé chơi hợp'] },
  { rating: 4, feedback: 'Bé nhà mình hơi nhút nhát lúc đầu nhưng sau đó chơi rất vui.', tags: ['Kiên nhẫn', 'Thân thiện'] },
  { rating: 3, feedback: 'Đến trễ khoảng 20 phút nên các bé phải chờ, còn lại ổn.', tags: ['Bé chơi hợp'] },
];

// Public sample image used for the image messages and report evidence of the demo data
const SAMPLE_IMAGE_URL = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

// Same strings the app stores when blocking (frontend BLOCK_REASONS, backend DEFAULT_BLOCK_REASON)
const BLOCK_REASONS = [DEFAULT_BLOCK_REASON, 'Không muốn tiếp tục trò chuyện', 'Không muốn tiếp tục kết nối'];

// AI assistant demo conversations for a parent living near `place`: [role, content, toolCall?]
const AI_SESSIONS = [
  (place) => ({
    title: 'Gợi ý chỗ chơi cuối tuần',
    messages: [
      ['user', 'Cuối tuần này cho bé đi chơi ở đâu gần nhà?'],
      ['assistant', `${place.name} khá gần nhà bạn, có không gian rộng và mát vào buổi sáng. Bạn muốn mình lên kế hoạch một buổi hẹn chơi không?`],
    ],
  }),
  () => ({
    title: 'Trò chơi trong nhà ngày mưa',
    messages: [
      ['user', 'Trời mưa thì nên cho 2 bé chơi gì ở nhà?'],
      ['assistant', 'Bạn có thể thử xếp hình Lego theo chủ đề, làm bánh quy đơn giản hoặc dựng "lều" bằng chăn gối để kể chuyện.'],
    ],
  }),
  (place) => ({
    title: 'Tìm địa điểm gần nhà',
    messages: [
      ['user', 'Tìm giúp mình chỗ cho bé chơi gần nhất'],
      ['assistant', '', { name: AI_TOOL_NAMES.FIND_NEARBY_PLACES, arguments: '{"radiusKm":5}' }],
      ['tool', JSON.stringify([{ name: place.name, address: place.address }])],
      ['assistant', `Gần bạn có ${place.name}, địa chỉ ${place.address}.`],
    ],
  }),
  () => ({
    title: 'Hoạt động cho bé nhút nhát',
    messages: [
      ['user', 'Bé nhà mình nhút nhát, buổi hẹn đầu nên chơi gì?'],
      ['assistant', 'Nên chọn hoạt động có đồ chơi chung như vẽ tranh hoặc ráp Lego, thời lượng khoảng 60 đến 90 phút và hẹn với một bạn trước.'],
      ['user', 'Có nên ở lại cùng bé không?'],
      ['assistant', 'Có, buổi đầu bạn nên ở gần để bé yên tâm, rồi lùi ra xa dần khi bé đã chơi vui.'],
    ],
  }),
  () => ({
    title: 'Ý tưởng hoạt động ngoài trời',
    messages: [
      ['user', 'Gợi ý hoạt động ngoài trời cho bé 6 tuổi'],
      ['assistant', '', { name: AI_TOOL_NAMES.SUGGEST_ACTIVITIES, arguments: '{"age":6}' }],
      ['tool', '["Thả diều","Đạp xe công viên","Chơi cát & Tắm biển"]'],
      ['assistant', 'Bé 6 tuổi rất hợp thả diều, đạp xe trong công viên hoặc chơi cát ở biển vào sáng sớm.'],
    ],
  }),
  () => ({
    title: 'Chuẩn bị đồ cho buổi hẹn',
    messages: [
      ['user', 'Đi biển với bé 4 tuổi cần mang gì?'],
      ['assistant', 'Bạn nên mang nón, kem chống nắng, nước, khăn, quần áo thay và bộ xô xẻng để bé chơi cát.'],
    ],
  }),
];

// Reports: what the parent wrote, per category
const REPORT_TEXTS = {
  harassment: { reason: 'Quấy rối', description: 'Gửi lời mời kết nối nhiều lần và nhắn tin không phù hợp sau khi bị từ chối.' },
  inappropriate_content: { reason: 'Ngôn từ không phù hợp', description: 'Dùng từ ngữ thiếu lịch sự khi trò chuyện với gia đình mình.' },
  spam: { reason: 'Quảng cáo, tin rác', description: 'Liên tục gửi tin giới thiệu lớp học thêm và dịch vụ của người quen.' },
  fake_profile: { reason: 'Thông tin hồ sơ không trung thực', description: 'Ảnh đại diện và độ tuổi của bé có vẻ không đúng thực tế.' },
  child_safety: { reason: 'Không đảm bảo an toàn cho trẻ', description: 'Để các bé chơi gần mép nước mà không có người lớn trông, mình rất lo.' },
  no_show: { reason: 'Không đến buổi hẹn', description: 'Đã xác nhận tham gia nhưng không đến và không báo trước, cả nhà đã ra tới nơi.' },
  other: { reason: 'Khác', description: 'Có vài điểm chưa rõ về hồ sơ của gia đình này, mong admin kiểm tra giúp.' },
};
// status + action of each report, oldest first: dates and targets are chosen in seedDatabase
const REPORT_PLAN = [
  { category: 'harassment', status: 'resolved', action: 'warn' },
  { category: 'fake_profile', status: 'dismissed', note: 'Đã kiểm tra hồ sơ, thông tin hợp lệ.' },
  { category: 'spam', status: 'resolved', action: 'warn' },
  { category: 'no_show', status: 'dismissed', target: 'playdate', note: 'Gia đình đã báo bé bị ốm, không vi phạm.' },
  { category: 'inappropriate_content', status: 'resolved', action: 'delete_message', target: 'message' },
  { category: 'harassment', status: 'resolved', action: 'suspend', durationDays: 7 },
  { category: 'other', status: 'resolved', action: 'no_action', note: 'Không đủ căn cứ, đã nhắc nhở nhẹ qua hệ thống.' },
  { category: 'spam', status: 'dismissed', note: 'Người báo cáo xác nhận bấm nhầm, đóng báo cáo.' },
  { category: 'no_show', status: 'resolved', action: 'warn', target: 'playdate' },
  { category: 'child_safety', status: 'resolved', action: 'cancel_playdate', target: 'cancelled_playdate' },
  { category: 'harassment', status: 'resolved', action: 'ban', evidence: true, locked: true },
  { category: 'fake_profile', status: 'resolved', action: 'suspend', durationDays: 45, locked: true },
  { category: 'inappropriate_content', status: 'resolved', action: 'warn', target: 'message' },
  { category: 'other', status: 'dismissed', note: 'Trao đổi riêng giữa hai gia đình, không vi phạm.' },
  { category: 'spam', status: 'reviewing', note: 'Đang yêu cầu phụ huynh giải trình.' },
  { category: 'fake_profile', status: 'reviewing', note: 'Đang yêu cầu phụ huynh xác minh lại số điện thoại.' },
  { category: 'child_safety', status: 'pending', evidence: true },
  { category: 'harassment', status: 'pending' },
  { category: 'inappropriate_content', status: 'pending', evidence: true },
  { category: 'no_show', status: 'pending', target: 'playdate' },
  { category: 'spam', status: 'pending' },
];

// Same badges as the app (title / description / icon / requirement), without the metric used to evaluate them
const BADGES = BADGE_DEFINITIONS.map(({ code, title, description, iconUrl, requirementCount }) => ({
  code,
  title,
  description,
  iconUrl,
  requirementCount,
}));

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
const stripDiacritics = (value) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

const pointOf = (family) => family.parent.location?.coordinates?.coordinates || [0, 0];

const clusterOfPoint = (point) => {
  const nearest = [...WARDS].sort((a, b) => distanceKmBetween(point, a.center) - distanceKmBetween(point, b.center))[0];
  return nearest.cluster;
};

const buildLocation = () => {
  const ward = pick(weightedWards);
  const houseNumber = chance(0.25) ? `K${int(10, 480)}/${int(1, 40)}` : String(int(2, 420));
  return {
    cluster: ward.cluster,
    location: {
      address: `${houseNumber} ${pick(ward.streets)}, ${ward.name}, Thành phố ${CITY}`,
      area: ward.name,
      city: CITY,
      // A parent's saved location is the center of their ward (never their home)
      coordinates: { type: 'Point', coordinates: [...ward.center] },
    },
  };
};

const buildAvatarUrl = (isMother) => `https://randomuser.me/api/portraits/${isMother ? 'women' : 'men'}/${int(1, 95)}.jpg`;

const buildChild = (parentId, createdAt) => {
  const gender = chance(0.5) ? 'boy' : 'girl';
  const nickname = pick(gender === 'boy' ? BOY_NICKNAMES : GIRL_NICKNAMES);
  const givenName = pick(gender === 'boy' ? BOY_NAMES : GIRL_NAMES);
  const age = int(2, 10);
  return {
    _id: oid(),
    parentId,
    // Parents use either the child's given name or the home nickname
    displayName: chance(0.5) ? `Bé ${nickname}` : givenName,
    dateOfBirth: new Date(Date.UTC(WINDOW_END.getUTCFullYear() - age, int(0, 11), int(1, 28))),
    gender,
    interests: pickMany(INTERESTS, int(2, 4)),
    favoriteActivities: pickMany(CHILD_ACTIVITIES, int(1, 3)),
    personality: pickMany(PERSONALITY_TRAITS, int(1, 2)),
    isArchived: false,
    createdAt,
    updatedAt: createdAt,
  };
};

const buildPreferences = (children) => {
  const ages = children.map((child) => ageAt(child.dateOfBirth, WINDOW_END));
  const youngest = ages.length ? Math.floor(Math.min(...ages)) : 3;
  const oldest = ages.length ? Math.ceil(Math.max(...ages)) : 6;
  return {
    preferredPlaydateDays: pickMany(['weekday', 'weekend'], chance(0.35) ? 2 : 1),
    preferredTimeSlots: pickMany(['morning', 'afternoon', 'evening'], int(1, 2)),
    preferredLocations: pickMany(LOCATION_PREFS, int(2, 4)),
    maxDistanceKm: pick([10, 15, 15, 20, 30, 30]),
    preferredAgeRange: { min: Math.max(youngest - 1, 1), max: oldest + 2 },
  };
};

// New accounts are spread over the window, with more sign-ups as the app grows
const randomSignup = () => {
  const roll = random();
  if (roll < 0.25) return awake(between(WINDOW_START, new Date('2026-08-31T23:00:00+07:00')));
  if (roll < 0.6) return awake(between(new Date('2026-09-01T00:00:00+07:00'), new Date('2026-09-30T23:00:00+07:00')));
  return awake(between(new Date('2026-10-01T00:00:00+07:00'), addTime(WINDOW_END, -6 * DAY)));
};

/**
 * Parents and users already in the database, before they are wiped
 */
const loadExistingAccounts = async () => {
  const [users, parents] = await Promise.all([User.find({}).lean(), Parent.find({}).lean()]);
  const parentIds = parents.map((parent) => parent._id);
  const [children, subscriptions, payments] = await Promise.all([
    Child.find({ parentId: { $in: parentIds } }).lean(),
    Subscription.find({ parentId: { $in: parentIds } }).lean(),
    Payment.find({ parentId: { $in: parentIds } }).lean(),
  ]);
  return {
    admin: users.find((user) => user.role === 'admin') || null,
    usersById: new Map(users.map((user) => [user._id.toString(), user])),
    parents,
    children,
    subscriptions,
    payments,
  };
};

const isSeedEmail = (email) => email.endsWith(`@${EMAIL_DOMAIN}`);

/**
 * One entry per parent: existing accounts first, then new ones up to SEED_PARENT_COUNT
 */
const buildFamilies = (existing, passwordHash) => {
  const usedEmails = new Set();
  const usedPhones = new Set();
  const uniquePhone = () => {
    let phone;
    do {
      phone = `+84${pick(['905', '935', '914', '983', '778', '868'])}${String(int(100000, 999999))}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    return phone;
  };

  const families = [];
  for (const parent of existing.parents) {
    const user = existing.usersById.get(parent.userId.toString());
    if (!user) continue;
    // normalize-phones: every stored phone is E.164 (a number that would collide stays as it is, like in that script)
    const normalized = normalizePhone(user.phone);
    const phone = normalized && usedPhones.has(normalized) ? user.phone : normalized;
    if (phone) usedPhones.add(phone);
    usedEmails.add(user.email.split('@')[0]);
    families.push({
      isKept: !isSeedEmail(user.email),
      user: { ...user, phone: phone || undefined },
      parent,
      // 'other' is no longer a value of the child form: such a profile becomes boy or girl
      children: existing.children
        .filter((child) => sameId(child.parentId, parent._id))
        .map((child) => (Object.values(CHILD_GENDERS).includes(child.gender) ? child : { ...child, gender: pick(Object.values(CHILD_GENDERS)) })),
    });
  }

  for (const family of families) {
    if (family.isKept) {
      family.cluster = clusterOfPoint(pointOf(family));
      continue;
    }
    // Same identity, the rest is reset to the current rules (no missing phone, every account in the window)
    const isMother = !MIDDLE_MALE.includes(family.parent.fullName.split(' ')[1]);
    const { cluster, location } = buildLocation();
    family.cluster = cluster;
    family.isMother = isMother;
    family.user = { ...family.user, phone: family.user.phone || uniquePhone(), passwordHash, isActive: true, strikeCount: 0, suspensionUntil: null, banReason: null, deletedAt: null };
    family.parent = { ...family.parent, location, bio: pick(BIOS[cluster]), avatarUrl: chance(0.7) ? buildAvatarUrl(isMother) : '', streak: undefined };
    family.children = family.children.filter((child) => !child.isArchived);
  }

  const newCount = Math.max(SEED_PARENT_COUNT - families.length, 0);
  for (let i = 0; i < newCount; i += 1) {
    const isMother = chance(0.7);
    const family = pick(FAMILY_NAMES);
    const middle = pick(isMother ? MIDDLE_FEMALE : MIDDLE_MALE);
    const given = pick(isMother ? GIVEN_FEMALE : GIVEN_MALE);

    let local = `${stripDiacritics(given)}.${stripDiacritics(family)}${int(80, 96)}`.toLowerCase();
    while (usedEmails.has(local)) local = `${local}${int(1, 9)}`;
    usedEmails.add(local);

    const { cluster, location } = buildLocation();
    const userId = oid();
    families.push({
      isKept: false,
      isNew: true,
      isMother,
      cluster,
      user: {
        _id: userId,
        email: `${local}@${EMAIL_DOMAIN}`,
        phone: uniquePhone(),
        passwordHash,
        role: 'parent',
        // A few parents signed up with Google
        googleId: i % 12 === 5 ? `seed-google-sub-${String(104857600000 + i)}` : undefined,
      },
      parent: {
        _id: oid(),
        userId,
        fullName: `${family} ${middle} ${given}`,
        location,
        bio: pick(BIOS[cluster]),
        avatarUrl: chance(0.7) ? buildAvatarUrl(isMother) : '',
      },
      children: [],
    });
  }
  return families;
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
export async function seedDatabase({ log = console.log } = {}) {
  const { calculateCalendarEndDate } = await import('../src/modules/subscription/subscription.service.js');
  const { safetyRepository } = await import('../src/modules/safety/safety.repository.js');

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, await bcrypt.genSalt(10));
  const existing = await loadExistingAccounts();
  const families = buildFamilies(existing, passwordHash);
  log(`Existing parents kept: ${existing.parents.length}, new parents: ${families.filter((f) => f.isNew).length}.`);

  // Plans are kept between seeds (admins may have changed prices): only create the missing ones
  for (const plan of SUBSCRIPTION_PLAN_DEFAULTS) {
    await SubscriptionPlan.updateOne({ planCode: plan.planCode }, { $setOnInsert: plan }, { upsert: true });
  }
  const plans = await SubscriptionPlan.find({}).lean();
  const planOf = (planCode) => plans.find((plan) => plan.planCode === planCode);
  const freeFeatures = planOf('free').features;

  const admin = { ...(existing.admin || { _id: oid(), email: 'admin@buddylink.vn', role: 'admin', createdAt: addTime(WINDOW_START, -30 * DAY) }), passwordHash };

  // ---- Who is verified --------------------------------------------------------------------------
  // Real accounts keep their state and count towards the unverified total
  const keptUnverified = families.filter((f) => f.isKept && !f.parent.verification?.isVerifiedParent).length;
  const seedFamilies = families.filter((f) => !f.isKept);
  const unverifiedCount = Math.max(SEED_UNVERIFIED_COUNT - keptUnverified, 0);
  const unverified = seedFamilies.slice(seedFamilies.length - unverifiedCount);
  unverified.forEach((family, index) => {
    family.isUnverified = true;
    family.children = [];
    family.parent.avatarUrl = '';
    // Signed up recently and stopped at the OTP step; a Google account already has its email verified
    const isEmailVerified = index % 2 === 0 || Boolean(family.user.googleId);
    family.parent.verification = { isEmailVerified, isPhoneVerified: false, isVerifiedParent: false };
  });
  const verifiedSeedFamilies = seedFamilies.filter((f) => !f.isUnverified);
  verifiedSeedFamilies.forEach((family) => {
    family.parent.verification = { isEmailVerified: true, isPhoneVerified: true, isVerifiedParent: true };
  });
  const actors = () => families.filter((f) => !f.isUnverified && f.user.isActive !== false && !f.user.deletedAt && f.parent.verification?.isVerifiedParent);

  // ---- Plans and sign-up dates --------------------------------------------------------------------------
  // Two children need a paid plan: those families get one first (an expired one leaves the second child locked)
  const planOrder = [
    ...shuffled(verifiedSeedFamilies.filter((f) => f.children.length > 1)),
    ...shuffled(verifiedSeedFamilies.filter((f) => f.children.length <= 1)),
  ];
  const kinds = [
    ...Array(PLAN_MIX.yearly).fill('yearly'),
    ...Array(PLAN_MIX.renewedMonthly).fill('renewedMonthly'),
    ...Array(PLAN_MIX.monthly).fill('monthly'),
    ...Array(PLAN_MIX.expired).fill('expired'),
  ];
  planOrder.forEach((family, index) => {
    family.planKind = kinds[index] || 'free';
  });
  let powerLeft = POWER_FAMILY_COUNT;
  for (const family of planOrder) {
    switch (family.planKind) {
      case 'yearly':
        family.isPower = powerLeft > 0;
        powerLeft -= 1;
        family.signupAt = family.isPower
          ? awake(between(WINDOW_START, new Date('2026-08-03T00:00:00+07:00')))
          : awake(between(WINDOW_START, new Date('2026-10-10T00:00:00+07:00')));
        break;
      case 'renewedMonthly':
      case 'expired':
        family.signupAt = awake(between(WINDOW_START, new Date('2026-09-05T00:00:00+07:00')));
        break;
      case 'monthly':
        family.signupAt = awake(between(WINDOW_START, new Date('2026-10-20T00:00:00+07:00')));
        break;
      default:
        family.signupAt = randomSignup();
    }
  }
  unverified.forEach((family) => {
    family.signupAt = awake(between(addTime(WINDOW_END, -20 * DAY), addTime(WINDOW_END, -DAY)));
  });
  families.filter((f) => f.isKept).forEach((family) => {
    family.signupAt = new Date(family.parent.createdAt);
  });

  // ---- Subscriptions and payments ---------------------------------------------------------------------------
  const subscriptions = [];
  const payments = existing.payments.filter((payment) => families.some((f) => f.isKept && sameId(f.parent._id, payment.parentId)));
  const usedOrderCodes = new Set(payments.map((payment) => payment.orderCode));
  let nextOrderCode = 100001;
  const planSnapshot = (planCode) => {
    const { name, price, currency, durationMonths } = planOf(planCode);
    return { planCode, name, price, currency, durationMonths };
  };
  const payosPayment = (family, planCode, status, createdAt) => {
    while (usedOrderCodes.has(nextOrderCode)) nextOrderCode += 1;
    const orderCode = nextOrderCode;
    usedOrderCodes.add(orderCode);
    const linkId = `seedpl${String(orderCode).padStart(26, '0')}`;
    const description = `BL${orderCode}`;
    const { price } = planSnapshot(planCode);
    return {
      _id: oid(),
      parentId: family.parent._id,
      subscriptionId: family.subscriptionId,
      orderCode,
      // Idempotency-Key sent by the checkout page (one per plan and browser tab)
      idempotencyKey: `seed-${family.parent._id}-${orderCode}`,
      planSnapshot: planSnapshot(planCode),
      amount: price,
      paymentMethod: 'payos',
      status,
      createdAt,
      updatedAt: createdAt,
      // 'creating': PayOS has not answered yet, so there is no link
      ...(status === 'creating'
        ? {}
        : {
            paymentLinkId: linkId,
            checkoutUrl: `https://pay.payos.vn/web/${linkId}`,
            qrCode: `00020101021238570010A000000727012700069704220113VQRQSEED${orderCode}0208QRIBFTTA530370454${String(price).length.toString().padStart(2, '0')}${price}5802VN62${String(description.length + 4).padStart(2, '0')}08${String(description.length).padStart(2, '0')}${description}6304SEED`,
            bankInfo: { bin: '970422', accountNumber: 'VQRQSEED0001', accountName: 'CONG TY BUDDYLINK', description },
          }),
      // PayOS links stay payable for 15 minutes
      expiresAt: addTime(createdAt, 15 * MINUTE),
    };
  };
  const successfulPayment = (family, planCode, paidAt, effectiveStart, effectiveEnd, months) => ({
    ...payosPayment(family, planCode, 'success', paidAt),
    paidAt,
    fulfilledAt: paidAt,
    transactionId: `PAYOS${paidAt.getTime().toString().slice(-9)}${int(100, 999)}`,
    lastReconciledAt: addTime(paidAt, 20 * 1000),
    grantResult: { effectiveStartDate: effectiveStart, effectiveEndDate: effectiveEnd, monthsGranted: months },
    rawWebhookData: { code: '00', desc: 'success', amount: planSnapshot(planCode).price, currency: 'VND', transactionDateTime: paidAt.toISOString() },
  });

  for (const family of families) {
    if (family.isUnverified) continue;
    if (family.isKept) {
      const kept = existing.subscriptions.find((subscription) => sameId(subscription.parentId, family.parent._id));
      family.subscriptionId = kept?._id || oid();
      subscriptions.push(kept || { _id: family.subscriptionId, parentId: family.parent._id, planCode: 'free', status: 'active', startDate: family.signupAt, endDate: null, createdAt: family.signupAt, updatedAt: family.signupAt });
      if (kept && kept.planCode !== 'free' && kept.endDate) family.premium = { from: new Date(kept.startDate), until: new Date(kept.endDate) };
      continue;
    }

    family.subscriptionId = oid();
    const base = { _id: family.subscriptionId, parentId: family.parent._id, status: 'active', createdAt: family.signupAt };
    const buyAt = (from, to) => awake(between(maxDate(from, family.signupAt), to));

    if (family.planKind === 'yearly') {
      const paidAt = family.isPower ? addTime(family.signupAt, int(1, 8) * HOUR) : buyAt(family.signupAt, minDate(addTime(family.signupAt, 12 * DAY), addTime(WINDOW_END, -2 * DAY)));
      const startDate = maxDate(paidAt, family.signupAt);
      const endDate = calculateCalendarEndDate(startDate, 12);
      const payment = successfulPayment(family, 'premium_yearly', startDate, startDate, endDate, 12);
      payments.push(payment);
      subscriptions.push({ ...base, planCode: 'premium_yearly', startDate, endDate, calendarAnchorAt: startDate, purchasedMonths: 12, lastPaymentId: payment._id, updatedAt: startDate });
      family.premium = { from: startDate, until: endDate };
    } else if (family.planKind === 'monthly') {
      const startDate = buyAt(new Date('2026-10-05T00:00:00+07:00'), addTime(WINDOW_END, -2 * DAY));
      const endDate = calculateCalendarEndDate(startDate, 1);
      const payment = successfulPayment(family, 'premium_monthly', startDate, startDate, endDate, 1);
      payments.push(payment);
      subscriptions.push({ ...base, planCode: 'premium_monthly', startDate, endDate, calendarAnchorAt: startDate, purchasedMonths: 1, lastPaymentId: payment._id, updatedAt: startDate });
      family.premium = { from: startDate, until: endDate };
    } else if (family.planKind === 'renewedMonthly') {
      // Pays again before each month ends: same anchor, one more purchased month
      const anchor = buyAt(family.signupAt, addTime(family.signupAt, 5 * DAY));
      let months = 1;
      let end = calculateCalendarEndDate(anchor, months);
      const startDate = anchor;
      let payment = successfulPayment(family, 'premium_monthly', anchor, anchor, end, 1);
      payments.push(payment);
      while (end <= WINDOW_END) {
        const renewedAt = capped(addTime(end, -int(1, 4) * DAY));
        months += 1;
        const previousEnd = end;
        end = calculateCalendarEndDate(anchor, months);
        payment = successfulPayment(family, 'premium_monthly', renewedAt, previousEnd, end, 1);
        payments.push(payment);
      }
      subscriptions.push({ ...base, planCode: 'premium_monthly', startDate, endDate: end, calendarAnchorAt: anchor, purchasedMonths: months, lastPaymentId: payment._id, updatedAt: payment.createdAt });
      family.premium = { from: anchor, until: end };
    } else if (family.planKind === 'expired') {
      // One paid month, not renewed: downgraded to Free by the expiry job (subscriptionRepository.downgradeToFree)
      const anchor = buyAt(family.signupAt, addTime(family.signupAt, 7 * DAY));
      const end = calculateCalendarEndDate(anchor, 1);
      const payment = successfulPayment(family, 'premium_monthly', anchor, anchor, end, 1);
      payments.push(payment);
      const downgradedAt = addTime(end, int(5, 55) * MINUTE);
      subscriptions.push({ ...base, planCode: 'free', startDate: downgradedAt, endDate: null, calendarAnchorAt: null, purchasedMonths: 0, lastPaymentId: payment._id, updatedAt: downgradedAt });
      family.premium = { from: anchor, until: end };
      family.expiredAt = end;
    } else {
      subscriptions.push({ ...base, planCode: 'free', startDate: family.signupAt, endDate: null, updatedAt: family.signupAt });
    }
  }

  // Every other payment outcome, spread over the window, from families on Free
  const freeFamilies = verifiedSeedFamilies.filter((f) => f.planKind === 'free');
  const PAYMENT_FAILURES = [
    { status: 'failed', failureReason: 'Payment failed or cancelled via PayOS Webhook' },
    { status: 'cancelled', failureReason: 'Payment cancelled on PayOS' },
    { status: 'expired', failureReason: 'Payment link expired' },
  ];
  for (const [index, family] of pickMany(freeFamilies, Math.min(15, freeFamilies.length)).entries()) {
    const planCode = chance(0.75) ? 'premium_monthly' : 'premium_yearly';
    const createdAt = awake(spread(family.signupAt, addTime(WINDOW_END, -DAY)));
    const failure = PAYMENT_FAILURES[index % PAYMENT_FAILURES.length];
    payments.push({ ...payosPayment(family, planCode, failure.status, createdAt), failureReason: failure.failureReason });
  }
  const recentBuyers = pickMany(freeFamilies, 2);
  if (recentBuyers[0]) payments.push(payosPayment(recentBuyers[0], 'premium_monthly', 'pending', addTime(WINDOW_END, -5 * MINUTE)));
  if (recentBuyers[1]) payments.push({ ...payosPayment(recentBuyers[1], 'premium_monthly', 'creating', addTime(WINDOW_END, -MINUTE)), failureReason: 'PayOS call pending/timeout: timeout of 15000ms exceeded' });

  // ---- Children (Free plan: 1 child, paid plans: up to 3) ---------------------------------------------------
  for (const family of verifiedSeedFamilies) {
    const wanted = family.premium ? (family.planKind === 'expired' ? 2 : pick([1, 2, 2, 3])) : 1;
    const start = family.children.length;
    for (let c = start; c < wanted; c += 1) {
      family.children.push(buildChild(family.parent._id, new Date()));
    }
    family.children.forEach((child, c) => {
      // Second and third children are added once the plan allows them
      const earliest = c === 0 ? addTime(family.signupAt, int(10, 300) * MINUTE) : addTime(family.premium?.from || family.signupAt, int(1, 3) * DAY);
      child.createdAt = capped(earliest);
      child.updatedAt = child.createdAt;
    });
    // A deleted profile on some larger families
    if (family.children.length === 3 && chance(0.5)) family.children[2].isArchived = true;
  }
  families.forEach((family) => {
    if (family.isUnverified) return;
    family.activeChildren = family.children.filter((child) => !child.isArchived);
    if (!family.isKept) family.parent.preferences = buildPreferences(family.activeChildren);
  });

  // Privacy: a few families do not accept connection requests (not the ones who meet every week)
  verifiedSeedFamilies.forEach((family) => {
    const noRequests = !family.isPower && chance(0.05);
    family.parent.privacySettings = { isProfileHidden: false, connectionPrivacy: noRequests ? 'nobody' : 'everyone', messagePrivacy: 'connected_only' };
  });

  // ---- Quotas: the same limits the app enforces, so usage_quotas ends up matching the data --------------------
  const isPremiumAt = (family, date) => Boolean(family.premium && date >= family.premium.from && date < family.premium.until);
  const consumeQuota = (family, action, date) => {
    const { periodType, counterField, limitKey } = QUOTA_ACTIONS[action];
    const periodValue = periodType === 'daily' ? formatDay(date) : formatDay(date).slice(0, 7);
    const limit = isPremiumAt(family, date) ? -1 : freeFeatures[limitKey];
    family.usage ||= new Map();
    const key = `${periodType}|${periodValue}`;
    const counters = family.usage.get(key) || {};
    if (limit !== -1 && (counters[counterField] || 0) >= limit) return false;
    counters[counterField] = (counters[counterField] || 0) + 1;
    family.usage.set(key, counters);
    return true;
  };
  const refundQuota = (family, action, date) => {
    const { periodType, counterField } = QUOTA_ACTIONS[action];
    const counters = family.usage?.get(`${periodType}|${periodType === 'daily' ? formatDay(date) : formatDay(date).slice(0, 7)}`);
    if (counters?.[counterField]) counters[counterField] -= 1;
  };
  // A Free family only uses its oldest child: the others are locked by the plan limit
  const usableChildAt = (family, date) => {
    const ready = family.activeChildren.filter((child) => child.createdAt <= date);
    if (!ready.length) return null;
    return isPremiumAt(family, date) ? pick(ready) : ready[0];
  };

  // ---- Connections and swipes -------------------------------------------------------------------------------
  const notifications = [];
  const adminNotifications = [];
  const notify = (family, type, title, body, data, createdAt) => {
    if (createdAt > WINDOW_END) return;
    const age = WINDOW_END.getTime() - createdAt.getTime();
    const isRead = age > 3 * DAY ? chance(0.92) : chance(0.3);
    notifications.push({ recipientId: family.user._id, type, title, body, data: data || {}, isRead, readAt: isRead ? addTime(createdAt, int(5, 600) * MINUTE) : null, createdAt });
  };
  const notifyAdmin = (category, type, severity, title, message, entityType, entityId, createdAt) => {
    // Older ones would be deleted by the TTL index right away
    if (createdAt.getTime() <= NOW.getTime() - (ADMIN_NOTIFICATION_TTL_SECONDS - DAY / 1000) * 1000) return;
    adminNotifications.push({
      category, type, severity, title, message, entityType, entityId,
      readBy: WINDOW_END.getTime() - createdAt.getTime() > 5 * DAY ? [admin._id] : [],
      createdAt,
      updatedAt: createdAt,
    });
  };

  const connections = [];
  const swipes = [];
  const swipeKeys = new Set();
  const pairKeys = new Set();
  const pairKeyOf = (a, b) => [a.parent._id.toString(), b.parent._id.toString()].sort().join('_');
  const familyById = new Map(families.map((family) => [family.parent._id.toString(), family]));
  const familyOf = (parentId) => familyById.get(parentId.toString());

  const addSwipe = (family, forChild, targetFamily, targetChild, isLike, createdAt) => {
    const key = `${family.parent._id}:${forChild._id}:${targetChild._id}`;
    if (swipeKeys.has(key)) return false;
    if (!consumeQuota(family, 'discovery', createdAt)) return false;
    swipeKeys.add(key);
    swipes.push({ swiperParentId: family.parent._id, forChildId: forChild._id, targetChildId: targetChild._id, targetParentId: targetFamily.parent._id, isLike, createdAt });
    return true;
  };

  const connect = (requester, recipient, requestedAt, forcedStatus) => {
    const pairKey = pairKeyOf(requester, recipient);
    if (pairKeys.has(pairKey)) return null;
    if (recipient.parent.privacySettings?.connectionPrivacy === 'nobody') return null;
    const requesterChild = usableChildAt(requester, requestedAt);
    const recipientChild = usableChildAt(recipient, requestedAt);
    if (!requesterChild || !recipientChild) return null;
    if (!consumeQuota(requester, 'connectionRequest', requestedAt)) return null;
    if (!addSwipe(requester, requesterChild, recipient, recipientChild, true, requestedAt)) {
      refundQuota(requester, 'connectionRequest', requestedAt);
      return null;
    }
    pairKeys.add(pairKey);

    const isRecent = WINDOW_END.getTime() - requestedAt.getTime() < 5 * DAY;
    const roll = random();
    const status = forcedStatus || (isRecent ? (roll < 0.6 ? 'pending' : 'accepted') : roll < 0.72 ? 'accepted' : roll < 0.84 ? 'declined' : roll < 0.9 ? 'pending' : 'removed');
    const respondedAt = capped(addTime(requestedAt, int(1, 40) * HOUR));
    const wasAccepted = status === 'accepted' || status === 'removed';
    const removedAt = status === 'removed' ? capped(addTime(respondedAt, int(3, 25) * DAY)) : null;
    const connection = {
      _id: oid(),
      parents: pairKey.split('_'),
      pairKey,
      requesterId: requester.parent._id,
      recipientId: recipient.parent._id,
      status,
      connectedAt: wasAccepted ? respondedAt : null,
      declinedAt: status === 'declined' ? respondedAt : null,
      removedAt,
      // The Like above paired these two children (BUD-48 child pairing)
      childPairs: [
        {
          childIds: [requesterChild._id.toString(), recipientChild._id.toString()].sort(),
          pairKey: buildChildPairKey(requesterChild._id, recipientChild._id),
          source: 'discovery',
          matchScore: calculateChildPairScore(requesterChild, requester.parent, recipientChild, recipient.parent),
          createdAt: requestedAt,
        },
      ],
      createdAt: requestedAt,
      updatedAt: removedAt || (status === 'pending' ? requestedAt : respondedAt),
    };
    connections.push(connection);

    notify(recipient, 'connection_request', 'Lời mời kết nối mới', `${requester.parent.fullName} đã gửi lời mời kết nối đến bạn: ${requesterChild.displayName} ↔ bé ${recipientChild.displayName} của bạn.`, { senderId: requester.parent._id }, requestedAt);
    if (wasAccepted) {
      notify(requester, 'connection_accepted', 'Lời mời kết nối đã được chấp nhận', `${recipient.parent.fullName} đã đồng ý kết nối với bạn. Giờ hai bạn đã có thể trò chuyện!`, { senderId: recipient.parent._id }, respondedAt);
      notifyAdmin('connections', 'new_connection', 'info', 'Kết nối mới được thiết lập', 'Hai phụ huynh vừa kết nối thành công với nhau.', 'Connection', connection._id, respondedAt);
      // The other parent liked back when they accepted from Discovery
      if (chance(0.3)) addSwipe(recipient, recipientChild, requester, requesterChild, true, respondedAt);
    }
    if (removedAt) {
      notifyAdmin('connections', 'connection_removed', 'info', 'Kết nối đã bị huỷ', 'Một kết nối giữa hai gia đình đã bị xoá.', 'Connection', connection._id, removedAt);
    }
    return connection;
  };

  const verifiedActors = actors();
  const candidatesFor = (family) =>
    verifiedActors
      .filter((other) => other !== family && distanceKmBetween(pointOf(family), pointOf(other)) <= (family.parent.preferences?.maxDistanceKm || 15))
      .map((other) => ({ other, score: random() + (other.cluster === family.cluster ? 0.4 : 0) }))
      .sort((a, b) => b.score - a.score)
      .map(({ other }) => other);

  // Families who meet every week connect early, the others over time
  for (const family of shuffled(verifiedActors)) {
    const wanted = family.isPower ? int(12, 18) : family.premium ? int(3, 8) : int(1, 5);
    let sent = 0;
    for (const other of candidatesFor(family)) {
      if (sent >= wanted) break;
      const from = maxDate(family.signupAt, other.signupAt, addTime(family.signupAt, DAY));
      if (from >= WINDOW_END) continue;
      const requestedAt = family.isPower && sent < 10 ? awake(between(from, addTime(from, 10 * DAY))) : awake(spread(from, WINDOW_END));
      if (requestedAt < from || requestedAt > WINDOW_END) continue;
      const connection = connect(family, other, requestedAt, family.isPower && sent < 10 ? 'accepted' : undefined);
      if (connection) sent += 1;
    }
  }

  // Real accounts also have friends and requests waiting for them, after they signed up
  for (const family of verifiedActors.filter((f) => f.isKept)) {
    const inviters = candidatesFor(family).filter((other) => !other.isKept && !other.isPower);
    let added = 0;
    for (const other of inviters) {
      if (added >= 4) break;
      const requestedAt = awake(between(addTime(family.signupAt, 2 * HOUR), addTime(WINDOW_END, -2 * DAY)));
      if (requestedAt < family.signupAt) continue;
      if (connect(other, family, requestedAt, added < 3 ? 'accepted' : 'pending')) added += 1;
    }
  }

  // Passes: profiles seen in Discovery and skipped
  for (const family of verifiedActors) {
    const wanted = int(2, family.premium ? 14 : 8);
    let done = 0;
    for (const other of shuffled(candidatesFor(family))) {
      if (done >= wanted) break;
      if (pairKeys.has(pairKeyOf(family, other))) continue;
      const from = maxDate(family.signupAt, other.signupAt);
      const swipedAt = awake(spread(from, WINDOW_END));
      if (swipedAt < from || swipedAt > WINDOW_END) continue;
      const forChild = usableChildAt(family, swipedAt);
      const targetChild = usableChildAt(other, swipedAt);
      if (forChild && targetChild && addSwipe(family, forChild, other, targetChild, false, swipedAt)) done += 1;
    }
  }

  // ---- Blocks: blocking ends the connection, standalone blocks never connected --------------------------------
  const blocks = [];
  const blockedKeys = new Set();
  const addBlock = (blockerId, blockedId, createdAt) => {
    blockedKeys.add([blockerId.toString(), blockedId.toString()].sort().join('_'));
    blocks.push({ blockerId, blockedId, reason: pick(BLOCK_REASONS), createdAt, updatedAt: createdAt });
  };
  const removedConnections = connections.filter((c) => c.status === 'removed');
  for (const connection of pickMany(removedConnections, Math.min(6, removedConnections.length))) {
    addBlock(connection.requesterId, connection.recipientId, connection.removedAt);
  }
  let standaloneBlocks = 0;
  for (const family of shuffled(verifiedActors.filter((f) => !f.isKept && !f.isPower))) {
    if (standaloneBlocks >= 6) break;
    const other = candidatesFor(family).find((o) => !o.isKept && !pairKeys.has(pairKeyOf(family, o)) && !blockedKeys.has(pairKeyOf(family, o)));
    if (!other) continue;
    pairKeys.add(pairKeyOf(family, other));
    addBlock(family.parent._id, other.parent._id, awake(between(maxDate(family.signupAt, other.signupAt), WINDOW_END)));
    standaloneBlocks += 1;
  }

  // ---- Direct chats ---------------------------------------------------------------------------------------------
  const conversations = [];
  const messages = [];
  const addMessage = (conversationId, senderId, type, content, createdAt, readers, extra = {}) => {
    const message = {
      _id: oid(),
      conversationId,
      senderId,
      type,
      content,
      // The sender has read their own message, as in chatService.sendMessage
      readBy: [{ parentId: senderId, readAt: createdAt }, ...readers.map((parentId) => ({ parentId, readAt: capped(addTime(createdAt, int(1, 180) * MINUTE)) }))],
      createdAt,
      ...extra,
    };
    messages.push(message);
    return message;
  };
  const finishConversation = (conversation, conversationMessages) => {
    const last = conversationMessages[conversationMessages.length - 1];
    conversation.lastMessage = { messageId: last._id, senderId: last.senderId, content: last.content, type: last.type, sentAt: last.createdAt };
    conversation.updatedAt = last.createdAt;
    conversation.unreadCounts = Object.fromEntries(
      conversation.participants.map((id) => [
        id.toString(),
        conversationMessages.filter((m) => !m.readBy.some((entry) => sameId(entry.parentId, id))).length,
      ]),
    );
    conversations.push(conversation);
  };

  const connectionFor = new Map(connections.map((connection) => [connection.pairKey, connection]));
  const acceptedConnections = connections.filter((c) => c.status === 'accepted');
  const everAccepted = connections.filter((c) => c.connectedAt);
  const conversationByPair = new Map();

  for (const connection of everAccepted) {
    if (!chance(0.72)) continue;
    const starter = connection.requesterId;
    const other = connection.recipientId;
    const requester = familyOf(starter);
    const start = capped(addTime(connection.connectedAt, int(20, 1500) * MINUTE));
    if (start >= WINDOW_END) continue;
    const conversationId = oid();
    const conversation = { _id: conversationId, type: 'direct', participants: [starter, other], pairKey: connection.pairKey, isActive: true, createdAt: start };
    const conversationMessages = [];
    const lines = pick(DIRECT_CHAT_SCRIPTS[requester.cluster] || DIRECT_CHAT_SCRIPTS.other);
    const limit = connection.removedAt || WINDOW_END;
    let sentAt = start;
    let index = 0;
    const isUnreadTail = WINDOW_END.getTime() - start.getTime() < 3 * DAY && chance(0.6);
    for (const line of lines) {
      if (sentAt >= limit) break;
      const senderId = index % 2 === 0 ? starter : other;
      const receiverId = index % 2 === 0 ? other : starter;
      const isLastLine = index === lines.length - 1;
      conversationMessages.push(addMessage(conversationId, senderId, 'text', line, sentAt, isLastLine && isUnreadTail ? [] : [receiverId]));
      sentAt = addTime(sentAt, int(3, 200) * MINUTE);
      index += 1;
    }
    // Photo or emoji shared at the end of some chats
    if (sentAt < limit && chance(0.3)) {
      const shared = chance(0.5) ? { type: 'image', content: '[Hình ảnh]', mediaUrl: SAMPLE_IMAGE_URL } : { type: 'emoji', content: '🥰' };
      conversationMessages.push(addMessage(conversationId, other, shared.type, shared.content, sentAt, [starter], shared.mediaUrl ? { mediaUrl: shared.mediaUrl } : {}));
    }
    // Older friends keep talking in the following weeks
    let followUpAt = addTime(sentAt, int(4, 14) * DAY);
    while (followUpAt < limit && chance(0.55)) {
      const senderId = chance(0.5) ? starter : other;
      const receiverId = sameId(senderId, starter) ? other : starter;
      conversationMessages.push(addMessage(conversationId, senderId, 'text', pick(CHAT_FOLLOW_UPS), at(followUpAt, int(7, 21), int(0, 59)), [receiverId]));
      followUpAt = addTime(followUpAt, int(5, 16) * DAY);
    }
    const inOrder = conversationMessages.filter((m) => m.createdAt <= WINDOW_END).sort((a, b) => a.createdAt - b.createdAt);
    if (!inOrder.length) continue;
    finishConversation(conversation, inOrder);
    conversationByPair.set(connection.pairKey, { conversation, messages: inOrder });
  }

  // ---- Playdates ---------------------------------------------------------------------------------------------------
  const playdates = [];
  const reschedules = [];
  const ratings = [];
  const busy = new Map();
  const isFree = (childId, start, end) => !(busy.get(childId.toString()) || []).some(([s, e]) => start < e && s < end);
  const reserve = (childId, start, end) => {
    const key = childId.toString();
    busy.set(key, [...(busy.get(key) || []), [start, end]]);
  };
  const youngestAge = (children, date) => Math.min(...children.map((child) => ageAt(child.dateOfBirth, date)));

  const choosePlace = (familiesInvolved, children, date) => {
    const center = [
      familiesInvolved.reduce((sum, f) => sum + pointOf(f)[0], 0) / familiesInvolved.length,
      familiesInvolved.reduce((sum, f) => sum + pointOf(f)[1], 0) / familiesInvolved.length,
    ];
    const young = youngestAge(children, date) < 4;
    const allowed = PLACES.filter((place) => !young || !['sports_center', 'workshop'].includes(place.placeType));
    const nearest = [...allowed].sort((a, b) => distanceKmBetween(center, a.coordinates) - distanceKmBetween(center, b.coordinates));
    return pick(nearest.slice(0, 5));
  };
  const placeLocation = (place) => ({ name: place.name, address: place.address, placeId: place.osmId, coordinates: { type: 'Point', coordinates: place.coordinates } });
  const pickTime = (family) => {
    const slot = pick(family.parent.preferences?.preferredTimeSlots?.length ? family.parent.preferences.preferredTimeSlots : ['morning', 'afternoon']);
    if (slot === 'morning') return pick(['08:00', '08:30', '09:00', '09:30']);
    if (slot === 'afternoon') return pick(['15:00', '15:30', '16:00', '16:30']);
    return pick(['17:30', '18:00']);
  };
  const asDateAt = (day, time) => {
    const [hh, mm] = time.split(':').map(Number);
    return at(day, hh, mm);
  };
  const toWeekend = (date) => {
    const weekday = new Date(date.getTime() + VN_OFFSET).getUTCDay();
    return weekday === 0 || weekday === 6 ? date : addTime(date, (6 - weekday) * DAY);
  };

  const createPlaydate = ({ host, guests, day, status }) => {
    const time = pickTime(host);
    const scheduledDate = asDateAt(day, time);
    const hostChild = usableChildAt(host, scheduledDate);
    if (!hostChild) return null;
    const invited = guests.map((family) => ({ family, child: usableChildAt(family, scheduledDate) })).filter((guest) => guest.child);
    if (!invited.length) return null;
    const allChildren = [hostChild, ...invited.map((guest) => guest.child)];
    const youngest = youngestAge(allChildren, scheduledDate);
    const durationMinutes = youngest < 3 ? pick([60, 90]) : youngest < 5 ? pick([90, 120]) : pick([90, 120, 150, 180]);
    const end = addTime(scheduledDate, durationMinutes * MINUTE);
    if (!allChildren.every((child) => isFree(child._id, scheduledDate, end))) return null;

    // Invited after both parents connected, a few days before the playdate
    const earliest = maxDate(...guests.map((g) => connectionFor.get(pairKeyOf(host, g))?.connectedAt || host.signupAt), host.signupAt);
    const createdAt = status === 'upcoming'
      ? awake(between(maxDate(earliest, addTime(WINDOW_END, -7 * DAY)), addTime(WINDOW_END, -HOUR)))
      : minDate(maxDate(addTime(scheduledDate, -int(2, 8) * DAY), addTime(earliest, 30 * MINUTE)), addTime(scheduledDate, -6 * HOUR));
    if (createdAt < earliest || createdAt > WINDOW_END) return null;
    if (!consumeQuota(host, 'playdateCreate', createdAt)) return null;

    const participants = invited.map(({ family, child }) => {
      const respondedAt = minDate(addTime(createdAt, int(1, 30) * HOUR), addTime(scheduledDate, -HOUR), WINDOW_END);
      const roll = random();
      const answer = status === 'upcoming' ? (roll < 0.6 ? 'accepted' : roll < 0.9 ? 'pending' : 'declined') : roll < 0.9 ? 'accepted' : 'declined';
      const accepted = answer === 'accepted' && consumeQuota(family, 'playdateParticipate', respondedAt);
      const finalStatus = answer === 'pending' ? 'pending' : accepted ? 'accepted' : 'declined';
      return {
        parentId: family.parent._id,
        childId: child._id,
        status: finalStatus,
        invitedAt: createdAt,
        respondedAt: finalStatus === 'pending' ? null : respondedAt,
        quotaConsumedAt: finalStatus === 'accepted' ? respondedAt : null,
      };
    });
    const hasAccepted = participants.some((p) => p.status === 'accepted');

    let finalStatus = status;
    let cancellation;
    if (status === 'past') {
      if (!hasAccepted) {
        finalStatus = 'cancelled';
        // Closed at midnight by the auto-close job
        const closedAt = addTime(dayStart(scheduledDate), DAY);
        cancellation = { cancelledBy: null, cancelledByAdmin: false, reason: AUTO_CANCEL_REASON, cancelledAt: closedAt };
      } else if (chance(0.12)) {
        finalStatus = 'cancelled';
        const cancelledAt = maxDate(addTime(scheduledDate, -int(3, 30) * HOUR), addTime(createdAt, 30 * MINUTE));
        cancellation = { cancelledBy: host.parent._id, cancelledByAdmin: false, reason: pick(CANCEL_REASONS), cancelledAt };
        // Joining a cancelled playdate gives the participation quota back
        participants.filter((p) => p.status === 'accepted').forEach((p) => refundQuota(familyOf(p.parentId), 'playdateParticipate', p.quotaConsumedAt));
      } else {
        finalStatus = 'completed';
      }
    }

    const place = choosePlace([host, ...guests], allChildren, scheduledDate);
    const completedAt = finalStatus === 'completed' ? capped(chance(0.6) ? addTime(end, int(0, 60) * MINUTE) : addTime(dayStart(scheduledDate), DAY)) : null;
    const startedReminders = finalStatus === 'completed';
    const playdate = {
      _id: oid(),
      hostParentId: host.parent._id,
      hostChildId: hostChild._id,
      participants,
      scheduledDate,
      time,
      durationMinutes,
      activity: pick(ACTIVITIES_BY_PLACE[place.placeType]),
      location: placeLocation(place),
      note: pick(PLAYDATE_NOTES),
      status: finalStatus === 'past' ? 'completed' : finalStatus,
      cancellation: cancellation || undefined,
      completedAt,
      reminders: { h24SentAt: startedReminders ? addTime(scheduledDate, -DAY) : null, h1SentAt: startedReminders ? addTime(scheduledDate, -HOUR) : null },
      createdAt,
      updatedAt: completedAt || cancellation?.cancelledAt || createdAt,
    };
    if (playdate.updatedAt > WINDOW_END) playdate.updatedAt = WINDOW_END;
    playdates.push(playdate);
    if (finalStatus !== 'cancelled') allChildren.forEach((child) => reserve(child._id, scheduledDate, end));

    notifyAdmin('playdates', 'created', 'info', 'Buổi hẹn chơi mới được tạo', `Buổi hẹn "${playdate.activity}" vừa được tạo bởi ${host.parent.fullName}.`, 'Playdate', playdate._id, createdAt);
    guests.forEach((family) => {
      notify(family, 'playdate_invite', 'Lời mời tham gia Playdate', `${host.parent.fullName} đã mời bạn và bé tham gia "${playdate.activity}".`, { senderId: host.parent._id, playdateId: playdate._id }, createdAt);
    });
    if (cancellation && cancellation.cancelledAt <= WINDOW_END) {
      notifyAdmin('playdates', 'cancelled', 'info', 'Buổi hẹn chơi đã bị huỷ', `Buổi hẹn "${playdate.activity}" đã bị huỷ: ${cancellation.reason}.`, 'Playdate', playdate._id, cancellation.cancelledAt);
    }
    if (finalStatus === 'completed') {
      const recipients = [host, ...participants.filter((p) => p.status === 'accepted').map((p) => familyOf(p.parentId))];
      recipients.forEach((family) => {
        notify(family, 'playdate_reminder', 'Nhắc lịch Playdate', `"${playdate.activity}" diễn ra lúc ${time} ngày ${formatVnDate(scheduledDate)} tại ${place.name}.`, { playdateId: playdate._id }, addTime(scheduledDate, -DAY));
        notify(family, 'playdate_reminder', 'Playdate sắp bắt đầu', `"${playdate.activity}" sẽ bắt đầu lúc ${time} tại ${place.name}. Chuẩn bị lên đường nhé!`, { playdateId: playdate._id }, addTime(scheduledDate, -HOUR));
      });
    }
    return playdate;
  };

  const friendsOf = (family, date) =>
    acceptedConnections
      .filter((c) => c.connectedAt <= date && (sameId(c.requesterId, family.parent._id) || sameId(c.recipientId, family.parent._id)))
      .map((c) => familyOf(sameId(c.requesterId, family.parent._id) ? c.recipientId : c.requesterId))
      .filter((friend) => friend && verifiedActors.includes(friend));

  const lastPastDay = addTime(dayStart(NOW), -DAY);

  // Families who meet every week, on the weekend
  for (const family of verifiedActors.filter((f) => f.isPower)) {
    for (let week = maxDate(family.signupAt, new Date('2026-08-08T00:00:00+07:00')); week <= lastPastDay; week = addTime(week, 7 * DAY)) {
      const day = toWeekend(week);
      if (day > lastPastDay) break;
      const friends = shuffled(friendsOf(family, addTime(day, -DAY)));
      // Premium friends first: they have no monthly limit
      friends.sort((a, b) => Number(isPremiumAt(b, day)) - Number(isPremiumAt(a, day)));
      for (const friend of friends) {
        const [host, guest] = chance(0.6) ? [family, friend] : [friend, family];
        const count = playdates.length;
        const playdate = createPlaydate({ host, guests: [guest], day, status: 'past' });
        if (playdate?.status === 'completed') break;
        if (playdates.length === count) continue;
      }
    }
  }

  // Everyone else meets now and then
  for (const connection of shuffled(everAccepted)) {
    const a = familyOf(connection.requesterId);
    const b = familyOf(connection.recipientId);
    if (!verifiedActors.includes(a) || !verifiedActors.includes(b)) continue;
    const key = connection.pairKey;
    if (blockedKeys.has(key)) continue;
    const meetings = pick([0, 1, 1, 1, 2, 2, 3]);
    const limit = minDate(connection.removedAt || lastPastDay, lastPastDay);
    for (let m = 0; m < meetings; m += 1) {
      const from = addTime(connection.connectedAt, 2 * DAY);
      if (from >= limit) break;
      const candidate = spread(from, limit);
      const day = chance(0.75) ? toWeekend(candidate) : candidate;
      if (day > limit) continue;
      const [host, guest] = chance(0.5) ? [a, b] : [b, a];
      // Sometimes another friend of the host joins
      const others = friendsOf(host, addTime(day, -3 * DAY)).filter((friend) => friend !== guest && friend !== host);
      const guests = others.length && chance(0.15) ? [guest, pick(others)] : [guest];
      createPlaydate({ host, guests, day, status: 'past' });
    }
  }

  // Upcoming playdates, in the next two weeks
  const upcomingDay = (offsetDays) => addTime(dayStart(NOW), offsetDays * DAY);
  const recentlyActive = shuffled(acceptedConnections.filter((c) => !blockedKeys.has(c.pairKey)));
  for (const connection of recentlyActive.slice(0, Math.ceil(recentlyActive.length * 0.28))) {
    const a = familyOf(connection.requesterId);
    const b = familyOf(connection.recipientId);
    if (!verifiedActors.includes(a) || !verifiedActors.includes(b)) continue;
    const [host, guest] = chance(0.5) ? [a, b] : [b, a];
    createPlaydate({ host, guests: [guest], day: upcomingDay(int(2, 14)), status: 'upcoming' });
  }
  // Real accounts have something on their calendar
  for (const family of verifiedActors.filter((f) => f.isKept)) {
    const friend = friendsOf(family, WINDOW_END)[0];
    if (friend) createPlaydate({ host: friend, guests: [family], day: upcomingDay(int(3, 10)), status: 'upcoming' });
  }

  const completedPlaydates = playdates.filter((p) => p.status === 'completed');
  const upcomingPlaydates = playdates.filter((p) => p.status === 'upcoming');
  const cancelledPlaydates = playdates.filter((p) => p.status === 'cancelled');

  // Children who played together become a pair on their parents' connection (connection.listener.js)
  for (const playdate of completedPlaydates) {
    for (const participant of playdate.participants.filter((p) => p.status === 'accepted')) {
      const connection = connectionFor.get([playdate.hostParentId.toString(), participant.parentId.toString()].sort().join('_'));
      if (connection?.status !== 'accepted') continue;
      const pairKey = buildChildPairKey(playdate.hostChildId, participant.childId);
      if (connection.childPairs.some((pair) => pair.pairKey === pairKey)) continue;
      connection.childPairs.push({
        childIds: [playdate.hostChildId.toString(), participant.childId.toString()].sort(),
        pairKey,
        source: 'playdate',
        matchScore: null,
        createdAt: playdate.completedAt,
      });
    }
  }

  // ---- Group chats: invitees join once they accept --------------------------------------------------------------
  for (const playdate of playdates) {
    const accepted = playdate.participants.filter((p) => p.status === 'accepted');
    if (!accepted.length) continue;
    const members = [playdate.hostParentId, ...accepted.map((p) => p.parentId)];
    const conversationId = oid();
    const conversation = { _id: conversationId, type: 'playdate', participants: members, playdateId: playdate._id, isActive: playdate.status !== 'cancelled', createdAt: playdate.createdAt };
    const conversationMessages = [];
    const host = familyOf(playdate.hostParentId);
    conversationMessages.push(addMessage(conversationId, playdate.hostParentId, 'system', `${host.parent.fullName} đã tạo buổi hẹn "${playdate.activity}"`, playdate.createdAt, members.slice(1)));
    let sentAt = addTime(playdate.createdAt, int(1, 8) * HOUR);
    const limit = minDate(playdate.scheduledDate, WINDOW_END);
    const lineCount = int(2, 4);
    for (let l = 0; l < lineCount && sentAt < limit; l += 1) {
      const sender = members[l % members.length];
      const isUnread = playdate.status === 'upcoming' && l === lineCount - 1 && chance(0.5);
      conversationMessages.push(addMessage(conversationId, sender, 'text', GROUP_CHAT_LINES[l], sentAt, isUnread ? [] : members.filter((m) => !sameId(m, sender))));
      sentAt = addTime(sentAt, int(30, 600) * MINUTE);
    }
    finishConversation(conversation, conversationMessages);
    playdate.chatConversationId = conversationId;
    conversationByPair.set(`playdate:${playdate._id}`, { conversation, messages: conversationMessages });
  }

  // ---- Reschedule requests (host only; every accepted participant votes) ----------------------------------------------
  const rescheduleTargets = [
    ...pickMany(completedPlaydates.filter((p) => p.scheduledDate.getTime() - p.createdAt.getTime() > 2 * DAY), 12).map((playdate) => ({ playdate, status: pick(['accepted', 'accepted', 'declined', 'cancelled']) })),
    ...pickMany(upcomingPlaydates.filter((p) => p.participants.some((x) => x.status === 'accepted')), 8).map((playdate, index) => ({ playdate, status: ['pending', 'pending', 'pending', 'accepted', 'declined', 'cancelled', 'pending', 'accepted'][index] })),
  ];
  for (const { playdate, status } of rescheduleTargets) {
    const voters = playdate.participants.filter((p) => p.status === 'accepted');
    if (!voters.length) continue;
    const createdAt = minDate(addTime(playdate.createdAt, int(6, 40) * HOUR), addTime(playdate.scheduledDate, -2 * HOUR), addTime(WINDOW_END, -2 * HOUR));
    if (createdAt <= playdate.createdAt) continue;
    const resolvedAt = status === 'pending' ? null : capped(addTime(createdAt, int(1, 12) * HOUR));
    // An accepted request is what the playdate shows now; the others proposed another day
    const isApplied = status === 'accepted';
    const newDate = isApplied ? playdate.scheduledDate : addTime(playdate.scheduledDate, DAY);
    const answer = status === 'accepted' || status === 'declined' ? status : 'pending';
    reschedules.push({
      playdateId: playdate._id,
      requestedBy: playdate.hostParentId,
      newDate,
      newStartTime: playdate.time,
      newDurationMinutes: playdate.durationMinutes,
      newLocation: playdate.location,
      reason: pick(RESCHEDULE_REASONS),
      status,
      responses: voters.map((voter) => ({ parentId: voter.parentId, status: answer, respondedAt: answer === 'pending' ? null : resolvedAt })),
      resolvedAt,
      createdAt,
      updatedAt: resolvedAt || createdAt,
    });
    if (isApplied && playdate.chatConversationId) {
      const chat = conversationByPair.get(`playdate:${playdate._id}`);
      const notice = addMessage(playdate.chatConversationId, playdate.hostParentId, 'system', 'Lịch hẹn đã được cập nhật', resolvedAt, voters.map((voter) => voter.parentId));
      chat.messages.push(notice);
      chat.messages.sort((a, b) => a.createdAt - b.createdAt);
      const position = conversations.indexOf(chat.conversation);
      conversations.splice(position, 1);
      finishConversation(chat.conversation, chat.messages);
    }
  }

  // ---- Ratings ----------------------------------------------------------------------------------------------------------
  for (const playdate of completedPlaydates) {
    const raters = [playdate.hostParentId, ...playdate.participants.filter((p) => p.status === 'accepted').map((p) => p.parentId)];
    for (const parentId of raters) {
      if (!chance(0.62)) continue;
      const createdAt = addTime(playdate.completedAt, int(1, 48) * HOUR);
      if (createdAt > WINDOW_END) continue;
      const { rating, feedback, tags } = pick(FEEDBACKS);
      ratings.push({ playdateId: playdate._id, parentId, rating, feedback, tags, createdAt });
    }
  }

  // ---- Streaks and badges, with the same rules as the app -------------------------------------------------------------
  const userBadges = [];
  const completedOf = (parentId) =>
    completedPlaydates
      .filter((p) => sameId(p.hostParentId, parentId) || p.participants.some((x) => sameId(x.parentId, parentId) && x.status === 'accepted'))
      .sort((a, b) => a.completedAt - b.completedAt);
  for (const family of verifiedActors) {
    const parentId = family.parent._id;
    const done = completedOf(parentId);
    const ownConnections = everAccepted.filter((c) => sameId(c.requesterId, parentId) || sameId(c.recipientId, parentId));
    const { longestStreak, currentWeeklyStreak, lastCompletedPlaydateWeek } = calculateStreak(done.map((p) => p.completedAt), NOW);
    if (done.length) {
      family.parent.streak = { currentWeeklyStreak, longestStreak, lastCompletedPlaydateWeek, streakUpdatedAt: done[done.length - 1].completedAt };
    } else {
      family.parent.streak = { currentWeeklyStreak: 0, longestStreak: 0, lastCompletedPlaydateWeek: null, streakUpdatedAt: null };
    }
    // Each badge is unlocked by the first event that reaches its requirement
    const events = [...done.map((p) => p.completedAt), ...ownConnections.map((c) => c.connectedAt)].sort((a, b) => a - b);
    const unlocked = new Set();
    for (const eventAt of events) {
      const soFar = done.filter((p) => p.completedAt <= eventAt);
      const metrics = buildMetrics({
        parentId,
        playdates: soFar,
        connectionCount: ownConnections.filter((c) => c.connectedAt <= eventAt && !(c.removedAt && c.removedAt <= eventAt)).length,
        longestStreak: calculateStreak(soFar.map((p) => p.completedAt), eventAt).longestStreak,
      });
      for (const badge of BADGE_DEFINITIONS) {
        if (unlocked.has(badge.code) || metrics[badge.metric] < badge.requirementCount) continue;
        unlocked.add(badge.code);
        userBadges.push({ parentId, badgeCode: badge.code, unlockedAt: eventAt, createdAt: eventAt });
        notify(family, 'badge_unlocked', 'Bạn vừa mở khóa huy hiệu mới!', `Huy hiệu "${badge.title}": ${badge.description}`, { badgeCode: badge.code }, eventAt);
      }
    }
    // Reminder sent on a recent weekday to those with a running streak
    if (currentWeeklyStreak > 0 && chance(0.5)) {
      notify(family, 'streak_reminder', 'Giữ chuỗi hẹn chơi', `Bạn đang có chuỗi ${currentWeeklyStreak} tuần. Hẹn một buổi trong tuần này để giữ chuỗi nhé!`, {}, at(addTime(WINDOW_END, -int(0, 3) * DAY), 18));
    }
  }

  // ---- Reports, following the moderation flow (claim, sanction, close) ------------------------------------------------
  const reports = [];
  const lockedFamilies = new Set();
  const hasUpcoming = (family) => upcomingPlaydates.some((p) => sameId(p.hostParentId, family.parent._id) || p.participants.some((x) => sameId(x.parentId, family.parent._id)));
  const reportable = (family) => family && !family.isKept && !family.isPower && !lockedFamilies.has(family) && !family.isUnverified;
  const usedReportPairs = new Set();
  const span = WINDOW_END.getTime() - WINDOW_START.getTime() - 25 * DAY;
  const closedPlan = REPORT_PLAN.filter((plan) => ['resolved', 'dismissed'].includes(plan.status));

  const chooseUserTarget = (notBefore, wantLocked) => {
    const pool = shuffled(everAccepted.filter((c) => c.connectedAt < addTime(WINDOW_END, -2 * DAY)));
    for (const connection of pool) {
      if (usedReportPairs.has(connection.pairKey)) continue;
      const a = familyOf(connection.requesterId);
      const b = familyOf(connection.recipientId);
      const [reporter, reported] = chance(0.5) ? [a, b] : [b, a];
      if (!reportable(reported) || !verifiedActors.includes(reporter)) continue;
      if (wantLocked && hasUpcoming(reported)) continue;
      if (connection.connectedAt > notBefore) continue;
      usedReportPairs.add(connection.pairKey);
      return { reporter, reported };
    }
    return null;
  };

  for (const plan of REPORT_PLAN) {
    const isOpen = plan.status === 'pending' || plan.status === 'reviewing';
    const position = closedPlan.indexOf(plan);
    const createdAt = isOpen
      ? awake(addTime(WINDOW_END, -(plan.status === 'pending' ? int(0, 2) : int(2, 6)) * DAY))
      : awake(new Date(WINDOW_START.getTime() + 18 * DAY + (span * position) / Math.max(closedPlan.length, 1)));
    const base = { _id: oid(), category: plan.category, severity: CATEGORY_TO_SEVERITY[plan.category], ...REPORT_TEXTS[plan.category], evidenceUrls: plan.evidence ? [SAMPLE_IMAGE_URL] : [], actions: [], history: [] };
    let target = null;

    if (plan.target === 'message') {
      const chats = shuffled([...conversationByPair.values()].filter(({ conversation, messages: list }) => conversation.type === 'direct' && list.length >= 4 && list[1].createdAt < createdAt));
      for (const chat of chats) {
        const message = chat.messages[1];
        const reported = familyOf(message.senderId);
        const reporterId = chat.conversation.participants.find((id) => !sameId(id, message.senderId));
        if (!reportable(reported) || !verifiedActors.includes(familyOf(reporterId))) continue;
        message.content = REPORTED_MESSAGE;
        target = { reporter: familyOf(reporterId), reported, targetType: 'message', targetMessageId: message._id, message };
        break;
      }
    } else if (plan.target === 'playdate') {
      const pool = shuffled(completedPlaydates.filter((p) => p.scheduledDate < createdAt));
      for (const playdate of pool) {
        const declined = playdate.participants.find((p) => p.status === 'accepted');
        const reported = declined && familyOf(declined.parentId);
        if (!reported || !reportable(reported) || !verifiedActors.includes(familyOf(playdate.hostParentId))) continue;
        target = { reporter: familyOf(playdate.hostParentId), reported, targetType: 'playdate', targetPlaydateId: playdate._id };
        break;
      }
    } else if (plan.target === 'cancelled_playdate') {
      const playdate = shuffled(cancelledPlaydates.filter((p) => p.participants.some((x) => x.status !== 'pending') && p.cancellation?.reason !== AUTO_CANCEL_REASON && p.createdAt < createdAt))[0];
      if (playdate) {
        const participant = playdate.participants[0];
        // The moderator cancelled it (playdateService.cancelPlaydateByAdmin)
        playdate.cancellation = { cancelledBy: null, cancelledByAdmin: true, reason: 'Hủy bởi Quản trị viên do vi phạm an toàn', cancelledAt: addTime(createdAt, 4 * HOUR) };
        playdate.updatedAt = playdate.cancellation.cancelledAt;
        target = { reporter: familyOf(participant.parentId), reported: familyOf(playdate.hostParentId), targetType: 'playdate', targetPlaydateId: playdate._id, cancelled: playdate };
      }
    }
    if (!target) {
      const pair = chooseUserTarget(createdAt, plan.locked);
      if (!pair) continue;
      target = { ...pair, targetType: 'user' };
    }

    const report = {
      ...base,
      reporterId: target.reporter.parent._id,
      reportedUserId: target.reported.parent._id,
      targetType: target.targetType,
      targetMessageId: target.targetMessageId || null,
      targetPlaydateId: target.targetPlaydateId || null,
      status: plan.status,
      createdAt,
      updatedAt: createdAt,
    };
    notifyAdmin('safety', 'new_violation_report', 'critical', 'Báo cáo vi phạm mới cần xử lý', `Báo cáo vi phạm mới: ${report.reason}.`, 'Report', report._id, createdAt);

    if (plan.status !== 'pending') {
      const claimedAt = capped(addTime(createdAt, int(1, 10) * HOUR));
      report.assignedTo = admin._id;
      report.history.push({ eventType: 'claim', fromStatus: 'pending', toStatus: 'reviewing', by: admin._id, at: claimedAt, note: 'Tiếp nhận xử lý vụ việc' });
      report.updatedAt = claimedAt;
      if (plan.status === 'reviewing') report.adminNotes = plan.note || '';
    }

    if (plan.status === 'resolved' || plan.status === 'dismissed') {
      const actedAt = addTime(createdAt, int(11, 30) * HOUR);
      const closedAt = addTime(actedAt, int(1, 4) * HOUR);
      const reportedFamily = target.reported;
      const notice = REPORT_CATEGORY_NOTICES[plan.category];
      const applied = (type, note, durationDays = null) => {
        report.actions.push({ type, params: { durationDays, reason: note }, performedBy: admin._id, performedAt: actedAt, note });
        report.history.push({ eventType: 'action_applied', fromStatus: 'reviewing', toStatus: 'reviewing', by: admin._id, at: actedAt, note, metadata: { actionType: type, durationDays } });
      };
      const tellReported = (title, body) => notify(reportedFamily, 'system', title, body, { reportId: report._id }, actedAt);

      switch (plan.action) {
        case 'warn':
          applied('warn', 'Đã cảnh cáo tài khoản, theo dõi thêm 30 ngày.');
          reportedFamily.user.strikeCount = (reportedFamily.user.strikeCount || 0) + 1;
          tellReported('Cảnh cáo vi phạm an toàn', `Bạn nhận được 1 cảnh cáo do vi phạm quy chuẩn cộng đồng: ${notice}. Vui lòng tuân thủ quy tắc để giữ an toàn cho cộng đồng.`);
          break;
        case 'delete_message':
          applied('delete_message', 'Đã gỡ tin nhắn vi phạm.');
          target.message.isDeleted = true;
          tellReported('Tin nhắn đã bị gỡ bỏ', `Một tin nhắn của bạn đã bị Quản trị viên gỡ do vi phạm quy chuẩn cộng đồng: ${notice}.`);
          break;
        case 'cancel_playdate':
          applied('cancel_playdate', 'Hủy bởi Quản trị viên do vi phạm an toàn');
          notifyAdmin('playdates', 'cancelled', 'warning', 'Buổi hẹn bị huỷ bởi Quản trị viên', `Buổi hẹn "${target.cancelled.activity}" đã bị huỷ: ${target.cancelled.cancellation.reason}.`, 'Playdate', target.cancelled._id, target.cancelled.cancellation.cancelledAt);
          break;
        case 'suspend': {
          const until = addTime(actedAt, plan.durationDays * DAY);
          applied('suspend', `Tạm đình chỉ ${plan.durationDays} ngày.`, plan.durationDays);
          // An ended suspension leaves the account active again (suspension-expiry.job.js)
          if (until > NOW) {
            reportedFamily.user.isActive = false;
            reportedFamily.user.suspensionUntil = until;
            lockedFamilies.add(reportedFamily);
          }
          tellReported('Tài khoản bị tạm đình chỉ', `Tài khoản của bạn bị tạm đình chỉ ${plan.durationDays} ngày, đến ${formatVnDate(until)}, do vi phạm quy chuẩn cộng đồng: ${notice}.`);
          notifyAdmin('users', 'account_locked', 'warning', 'Tài khoản đã bị khoá', `Tài khoản ${reportedFamily.user.email} đã được khoá.`, 'User', reportedFamily.user._id, actedAt);
          break;
        }
        case 'ban':
          applied('ban', notice);
          reportedFamily.user.isActive = false;
          reportedFamily.user.suspensionUntil = null;
          reportedFamily.user.banReason = notice;
          lockedFamilies.add(reportedFamily);
          notifyAdmin('users', 'account_locked', 'warning', 'Tài khoản đã bị khoá', `Tài khoản ${reportedFamily.user.email} đã được khoá.`, 'User', reportedFamily.user._id, actedAt);
          break;
        case 'no_action':
          applied('no_action', plan.note);
          break;
        default:
          applied('dismiss', plan.note);
      }

      report.status = plan.status;
      report.resolution = plan.status === 'dismissed' ? 'dismissed' : plan.action === 'no_action' ? 'no_action' : 'action_taken';
      report.adminNotes = plan.note || report.actions[report.actions.length - 1].note;
      report.resolvedBy = admin._id;
      report.resolvedAt = closedAt;
      report.history.push({ eventType: 'status_change', fromStatus: 'reviewing', toStatus: plan.status, by: admin._id, at: closedAt, note: report.adminNotes });
      report.updatedAt = closedAt;
    }
    reports.push(report);
  }

  // Locked accounts (real ones too) leave their upcoming invitations waiting, no new session is opened for them
  const hasSession = (family) => !lockedFamilies.has(family) && verifiedActors.includes(family);

  // ---- Announcements ----------------------------------------------------------------------------------------------------
  const ANNOUNCEMENTS = [
    { at: new Date('2026-08-15T09:00:00+07:00'), title: 'BuddyLink ra mắt tại Hội An', body: 'Từ nay bạn có thể tìm bạn chơi cho bé tại Hội An và các phường lân cận thuộc thành phố Đà Nẵng.' },
    { at: new Date('2026-09-12T10:00:00+07:00'), title: 'Tuần lễ gia đình an toàn', body: 'Luôn hẹn ở nơi công cộng cho buổi đầu tiên và báo cáo ngay nếu thấy điều gì chưa ổn nhé.' },
    { at: new Date('2026-10-10T09:30:00+07:00'), title: 'Trợ lý AI đã biết lên kế hoạch hẹn chơi', body: 'Hãy thử nhờ Trợ lý gợi ý địa điểm và hoạt động phù hợp với độ tuổi của bé.' },
  ];
  for (const announcement of ANNOUNCEMENTS) {
    verifiedActors.filter((f) => f.signupAt <= announcement.at).forEach((family) => {
      notify(family, 'system', announcement.title, announcement.body, {}, announcement.at);
    });
  }

  // ---- Places ---------------------------------------------------------------------------------------------------------------
  // Written with the other documents, after the validation below
  const writePlaces = async () => {
    // places_cache is kept (the places sync fills it from OpenStreetMap): only the hand-added places are written here
    await PlacesCache.bulkWrite(
      PLACES.map((p) => ({
        updateOne: {
          filter: { osmId: p.osmId },
          update: {
            $set: {
              name: p.name,
              address: p.address,
              coordinates: { type: 'Point', coordinates: p.coordinates },
              placeType: p.placeType,
              // Never removed by a places sync (the kids areas in a mall are not kid-friendly places in OSM)
              source: PLACE_SOURCES.MANUAL,
              openingHours: OPENING_HOURS[p.placeType] || '',
              lastFetchedAt: between(addTime(WINDOW_END, -20 * DAY), WINDOW_END),
            },
          },
          upsert: true,
        },
      })),
    );
    // An empty database gets the cells of these places, synced long enough ago to be refreshed on the next search
    if ((await PlacesSyncTile.estimatedDocumentCount()) === 0) {
      const size = PLACES_SYNC_DEFAULTS.CELL_SIZE_DEG;
      const cells = new Map();
      for (const place of PLACES) {
        const row = Math.floor(place.coordinates[1] / size);
        const col = Math.floor(place.coordinates[0] / size);
        const key = `${size}:${row}:${col}`;
        const cell = cells.get(key) || { key, cellSizeDeg: size, bbox: [row * size, col * size, (row + 1) * size, (col + 1) * size], placesCount: 0 };
        cell.placesCount += 1;
        cells.set(key, cell);
      }
      const syncedAt = new Date('2026-08-05T02:00:00+07:00');
      await PlacesSyncTile.insertMany([...cells.values()].map((cell) => ({ ...cell, status: PLACES_SYNC_TILE_STATUS.DONE, startedAt: syncedAt, syncedAt, createdAt: syncedAt, updatedAt: syncedAt })));
    }
  };

  // ---- AI assistant: one quota unit per session ---------------------------------------------------------------------------------
  const aiSessions = [];
  for (const family of verifiedActors) {
    const count = family.premium ? int(1, 6) : int(0, 3);
    for (let s = 0; s < count; s += 1) {
      const startedAt = awake(spread(family.signupAt, addTime(WINDOW_END, -HOUR)));
      if (startedAt < family.signupAt || !consumeQuota(family, 'aiAssistant', startedAt)) continue;
      const nearest = [...PLACES].sort((a, b) => distanceKmBetween(pointOf(family), a.coordinates) - distanceKmBetween(pointOf(family), b.coordinates));
      const script = pick(AI_SESSIONS)(pick(nearest.slice(0, 3)));
      const toolName = script.messages.find(([, , toolCall]) => toolCall)?.[2]?.name;
      const sessionMessages = script.messages.map(([role, content, toolCall], m) => ({
        role,
        content,
        ...(toolCall ? { toolCalls: [{ id: `call_seed_${s}_${m}`, type: 'function', function: toolCall }] } : {}),
        ...(role === 'tool' ? { toolCallId: `call_seed_${s}_${m - 1}`, toolName } : {}),
        ...(role === 'assistant' && toolName && !toolCall ? { toolsUsed: [toolName] } : {}),
        timestamp: addTime(startedAt, m * 40 * 1000),
      }));
      const promptTokens = 180 + sessionMessages.length * 60 + int(0, 80);
      const completionTokens = 90 + sessionMessages.length * 35 + int(0, 50);
      const lastMessageAt = sessionMessages[sessionMessages.length - 1].timestamp;
      // Some conversations were deleted by the parent
      const isDeleted = chance(0.12);
      aiSessions.push({
        parentId: family.parent._id,
        title: script.title,
        messages: sessionMessages,
        messageCount: sessionMessages.filter((m) => m.role === 'user').length,
        quotaConsumedAt: addTime(startedAt, 40 * 1000),
        lastMessageAt,
        tokenUsage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
        isActive: !isDeleted,
        deletedAt: isDeleted ? capped(addTime(lastMessageAt, int(1, 72) * HOUR)) : null,
        createdAt: startedAt,
        updatedAt: lastMessageAt,
      });
    }
  }

  // ---- Admin notifications about accounts and payments ------------------------------------------------------------------------------
  for (const family of families) {
    if (family.isUnverified) continue;
    if (family.signupAt >= WINDOW_START) {
      notifyAdmin('users', 'new_signup', 'info', 'Đăng ký tài khoản mới', `Phụ huynh ${family.parent.fullName} vừa tạo tài khoản trên hệ thống.`, 'User', family.user._id, family.signupAt);
    }
    if (family.expiredAt && family.expiredAt <= WINDOW_END) {
      notifyAdmin('payments', 'subscription_expired', 'info', 'Thuê bao đã hết hạn', `Gói Premium Monthly của phụ huynh ${family.parent.fullName} đã hết hạn.`, 'Subscription', family.subscriptionId, family.expiredAt);
    }
  }
  for (const payment of payments) {
    if (payment.status === 'success') {
      notifyAdmin('payments', 'payment_succeeded', 'info', 'Thanh toán thành công', `Đơn hàng #${payment.orderCode} (${Number(payment.amount).toLocaleString('vi-VN')} ₫) đã thanh toán thành công.`, 'Payment', payment._id, new Date(payment.createdAt));
    } else if (['failed', 'cancelled'].includes(payment.status)) {
      notifyAdmin('payments', 'payment_failed', 'warning', 'Thanh toán thất bại', `Giao dịch đơn hàng #${payment.orderCode} đã thất bại hoặc bị huỷ.`, 'Payment', payment._id, new Date(payment.createdAt));
    }
  }
  notifyAdmin('system', 'cron_job_failed', 'critical', 'Lỗi tác vụ định kỳ hệ thống (Cron Job)', 'Tác vụ "SubscriptionExpiryJob" gặp sự cố: connect ETIMEDOUT.', 'System', null, new Date('2026-09-18T03:05:00+07:00'));
  notifyAdmin('system', 'cron_job_failed', 'critical', 'Lỗi tác vụ định kỳ hệ thống (Cron Job)', 'Tác vụ "PlaydateAutoCloseJob" gặp sự cố: connection pool cleared.', 'System', null, new Date('2026-10-11T00:00:30+07:00'));

  // ---- Usage quotas: what the data above consumed ---------------------------------------------------------------------------------------
  const quotas = [];
  for (const family of verifiedActors) {
    for (const [key, counters] of family.usage || []) {
      const [periodType, periodValue] = key.split('|');
      const periodDate = new Date(`${periodType === 'daily' ? periodValue : `${periodValue}-15`}T12:00:00+07:00`);
      const stamp = minDate(periodDate, WINDOW_END);
      quotas.push({ parentId: family.parent._id, periodType, periodValue, counters, createdAt: stamp, updatedAt: stamp });
    }
  }

  // ---- Auth: sessions and short-lived tokens (TTL indexes delete them once expired, so they are all recent) -------------------------------
  const refreshTokens = [];
  for (const family of verifiedActors.filter(hasSession)) {
    if (!chance(0.65)) continue;
    const createdAt = awake(between(addTime(WINDOW_END, -6 * DAY), WINDOW_END));
    const isRevoked = chance(0.1);
    refreshTokens.push({ userId: family.user._id, tokenHash: sha256(crypto.randomUUID()), isRevoked, revokedAt: isRevoked ? capped(addTime(createdAt, int(1, 20) * HOUR)) : null, expiresAt: addTime(createdAt, 7 * DAY), createdAt, updatedAt: createdAt });
  }
  // A password reset just requested, and an OTP resent after changing the phone number
  const authTokens = pickMany(verifiedActors.filter((f) => !f.isKept && hasSession(f)), 6).map((family, i) => {
    const type = ['password_reset', 'phone_otp', 'email_verify'][i % 3];
    return {
      userId: family.user._id,
      target: type === 'phone_otp' ? family.user.phone : family.user.email,
      tokenHash: sha256(String(int(100000, 999999))),
      type,
      isUsed: i < 2,
      attempts: i === 4 ? 2 : 0,
      expiresAt: addTime(NOW, (type === 'password_reset' ? 15 : 10) * MINUTE),
      createdAt: addTime(NOW, -int(1, 4) * MINUTE),
    };
  });

  // ---- Insert ---------------------------------------------------------------------------------------------------------------------------------
  // Children of Free families who expired stay in the database (locked by the plan, like in the app)
  const documents = [
    [User, [
      { ...admin, updatedAt: admin.updatedAt || admin.createdAt },
      ...families.map((family) => {
        const createdAt = family.signupAt;
        const lastChange = family.user.updatedAt && family.isKept ? family.user.updatedAt : createdAt;
        return { isActive: true, ...family.user, createdAt, updatedAt: lastChange };
      }),
    ]],
    [Parent, families.map((family) => ({
      ...family.parent,
      createdAt: family.signupAt,
      updatedAt: family.isKept ? family.parent.updatedAt : family.signupAt,
    }))],
    [Child, families.flatMap((family) => family.children)],
    [Subscription, subscriptions],
    [Payment, payments],
    [Connection, connections],
    [Swipe, swipes],
    [Block, blocks],
    [Conversation, conversations],
    [Message, messages],
    [Playdate, playdates],
    [RescheduleRequest, reschedules],
    [RatingFeedback, ratings],
    [Badge, BADGES],
    [UserBadge, userBadges],
    [Report, reports],
    [Notification, notifications],
    [AdminNotification, adminNotifications],
    [UsageQuota, quotas],
    [AIChatSession, aiSessions],
    [RefreshToken, refreshTokens],
    [AuthToken, authTokens],
  ];

  // Nothing is deleted until every document is known to be valid: a kept document with an old value
  // must stop the seed here, not after the wipe
  for (const [Model, docs] of documents) {
    for (const doc of docs) {
      const error = new Model(doc).validateSync();
      if (error) throw new Error(`Invalid ${Model.modelName} ${doc._id || ''}: ${error.message}. Nothing was changed.`);
    }
  }

  for (const Model of MODELS_TO_WIPE) {
    await Model.deleteMany({});
  }
  log('Wiped collections (subscription_plans, places_cache and places_sync_tiles kept).');

  // Migrations on indexes: deleteMany keeps them, so the old ones (e.g. BUD-48 swipes) are replaced here
  for (const Model of [...MODELS_TO_WIPE, ...MODELS_KEPT]) {
    await Model.syncIndexes();
  }

  await writePlaces();
  for (const [Model, docs] of documents) {
    await Model.insertMany(docs);
  }

  // ---- Migrations: nothing is left for them to do, and whatever a kept document needed is applied here -----------------------------------------
  await migrateChildPairs({ apply: true });
  await safetyRepository.backfillReportSeverities();

  // Demo accounts of each plan (all use SEED_PASSWORD)
  const PLAN_LABELS = { yearly: 'Premium (năm)', renewedMonthly: 'Premium (tháng, đã gia hạn)', monthly: 'Premium (tháng)', expired: 'Hết hạn, về Free', free: 'Free' };
  log('Demo accounts by plan:');
  for (const [kind, label] of Object.entries(PLAN_LABELS)) {
    const inKind = verifiedSeedFamilies.filter((family) => family.planKind === kind);
    log(`  - ${label} (${inKind.length}): ${inKind.slice(0, 3).map((family) => family.user.email).join(', ')}`);
  }
  log(`  - Chưa xác thực (${unverified.length}): ${unverified.slice(0, 3).map((family) => family.user.email).join(', ')}`);

  const counts = {};
  for (const Model of [...MODELS_TO_WIPE, ...MODELS_KEPT]) counts[Model.collection.collectionName] = await Model.countDocuments();
  return counts;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore if not allowed
  }
  dotenv.config();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not defined in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`Target database: ${mongoose.connection.name} @ ${mongoose.connection.host}`);

  if (!process.argv.includes('--confirm')) {
    console.log('Dry run. These collections would be wiped and rebuilt (existing parents, their ids and emails are kept):');
    for (const Model of MODELS_TO_WIPE) {
      console.log(`  - ${Model.collection.collectionName}: ${await Model.estimatedDocumentCount()} documents`);
    }
    console.log('Kept, only missing documents are added:');
    for (const Model of MODELS_KEPT) {
      console.log(`  - ${Model.collection.collectionName}: ${await Model.estimatedDocumentCount()} documents`);
    }
    const realAccounts = await User.countDocuments({ role: 'parent', email: { $not: new RegExp(`@${EMAIL_DOMAIN.replace('.', '\\.')}$`) } });
    console.log(`Accounts outside @${EMAIL_DOMAIN} keep their profile and password, their activity is rebuilt: ${realAccounts}`);
    console.log('Re-run with --confirm to wipe and seed.');
    return;
  }

  const counts = await seedDatabase();
  console.log('Seeded documents per collection:');
  console.table(counts);
  console.log(`Seeded accounts use the password: ${SEED_PASSWORD} (admin: admin@buddylink.vn)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
