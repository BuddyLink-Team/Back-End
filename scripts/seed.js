/**
 * BuddyLink demo data seed (Đà Nẵng).
 *
 * Wipes every collection EXCEPT subscription_plans, then inserts realistic data:
 * 50 parents living in the 23 wards of the new Đà Nẵng city (after the 2025 merger with
 * Quảng Nam), 1 admin, and ~10+ documents for every other module.
 *
 * Usage:
 *   node scripts/seed.js            # dry run: prints the target database and what would be wiped
 *   node scripts/seed.js --confirm  # wipe + seed
 *
 * All seeded accounts share the password in SEED_PASSWORD.
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
import { CHILD_ACTIVITIES } from '../src/modules/child/child.constants.js';
import Connection from '../src/modules/connection/connection.model.js';
import Swipe from '../src/modules/discovery/discovery.model.js';
import PlacesCache from '../src/modules/places/places-cache.model.js';
import Conversation from '../src/modules/chat/conversation.model.js';
import Message from '../src/modules/chat/message.model.js';
import Playdate from '../src/modules/playdate/playdate.model.js';
import RescheduleRequest from '../src/modules/playdate/reschedule-request.model.js';
import RatingFeedback from '../src/modules/rating-feedback/rating-feedback.model.js';
import Badge from '../src/modules/gamification/badge.model.js';
import UserBadge from '../src/modules/gamification/user-badge.model.js';
import { BADGE_DEFINITIONS } from '../src/modules/gamification/gamification.constants.js';
import Notification from '../src/modules/notification/notification.model.js';
import Block from '../src/modules/safety/block.model.js';
import Report from '../src/modules/safety/report.model.js';
import Subscription from '../src/modules/subscription/subscription.model.js';
import Payment from '../src/modules/subscription/payment.model.js';
import UsageQuota from '../src/modules/subscription/usage-quota.model.js';
import { SUBSCRIPTION_PLAN_DEFAULTS } from '../src/modules/subscription/subscription.constants.js';
import AIChatSession from '../src/modules/ai-assistant/ai-assistant.model.js';

export const SEED_PASSWORD = '123456';
const EMAIL_DOMAIN = 'mail.buddylink.vn';
const CITY = 'Đà Nẵng';

// Collections wiped before seeding (subscription_plans is intentionally kept)
const MODELS_TO_WIPE = [
  User, AuthToken, RefreshToken, Parent, Child, Connection, Swipe, PlacesCache, Conversation, Message,
  Playdate, RescheduleRequest, RatingFeedback, Badge, UserBadge, Notification, Block, Report,
  Subscription, Payment, UsageQuota, AIChatSession,
];

// ---------------------------------------------------------------------------
// Deterministic randomness (same data on every run)
// ---------------------------------------------------------------------------
let rngState = 20260101;
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
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days, hour = 9, minute = 0) => {
  const d = new Date(NOW.getTime() - days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
};
const daysAhead = (days, hour = 9, minute = 0) => daysAgo(-days, hour, minute);
const toDateOnly = (date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

// 23 wards of Đà Nẵng after the 2025 administrative reorganization, approximate centers [lng, lat]
const WARDS = [
  { name: 'Phường Hải Châu', center: [108.2208, 16.0678], streets: ['Lê Duẩn', 'Trần Phú', 'Phan Châu Trinh', 'Bạch Đằng', 'Lý Tự Trọng'], weight: 4 },
  { name: 'Phường Hòa Cường', center: [108.2185, 16.0415], streets: ['Núi Thành', '2 Tháng 9', 'Xô Viết Nghệ Tĩnh', 'Lê Thanh Nghị', 'Huỳnh Tấn Phát'], weight: 4 },
  { name: 'Phường Thanh Khê', center: [108.1905, 16.0648], streets: ['Điện Biên Phủ', 'Hà Huy Tập', 'Lê Độ', 'Thái Thị Bôi', 'Trường Chinh'], weight: 3 },
  { name: 'Phường An Khê', center: [108.1748, 16.0571], streets: ['Hà Huy Tập', 'Nguyễn Tri Phương', 'Trần Cao Vân', 'Phạm Nhữ Tăng'], weight: 3 },
  { name: 'Phường An Hải', center: [108.2381, 16.0642], streets: ['Ngô Quyền', 'Phạm Văn Đồng', 'Hồ Nghinh', 'Nguyễn Văn Thoại', 'Hà Bổng'], weight: 4 },
  { name: 'Phường Sơn Trà', center: [108.2422, 16.0884], streets: ['Ngô Quyền', 'Yết Kiêu', 'Lê Văn Thứ', 'Hoàng Sa', 'Nguyễn Phan Vinh'], weight: 3 },
  { name: 'Phường Ngũ Hành Sơn', center: [108.2552, 16.0003], streets: ['Lê Văn Hiến', 'Trường Sa', 'Mai Đăng Chơn', 'Nguyễn Đình Chiểu', 'Chương Dương'], weight: 3 },
  { name: 'Phường Hòa Khánh', center: [108.1452, 16.0712], streets: ['Tôn Đức Thắng', 'Âu Cơ', 'Nguyễn Lương Bằng', 'Hồ Tùng Mậu'], weight: 3 },
  { name: 'Phường Hải Vân', center: [108.1302, 16.1201], streets: ['Nguyễn Văn Cừ', 'Nguyễn Tất Thành', 'Lạc Long Quân'], weight: 1 },
  { name: 'Phường Liên Chiểu', center: [108.1501, 16.0902], streets: ['Nguyễn Tất Thành', 'Nguyễn Sinh Sắc', 'Kinh Dương Vương', 'Nguyễn Chánh'], weight: 2 },
  { name: 'Phường Cẩm Lệ', center: [108.2051, 16.0152], streets: ['Ông Ích Đường', 'Cách Mạng Tháng 8', 'Trần Đình Tri', 'Nguyễn Hữu Thọ'], weight: 3 },
  { name: 'Phường Hòa Xuân', center: [108.2251, 16.0031], streets: ['Minh Mạng', 'Nguyễn Phước Lan', 'Võ Chí Công', 'Lê Quang Đạo'], weight: 2 },
  { name: 'Phường Hội An', center: [108.3279, 15.8794], streets: ['Trần Hưng Đạo', 'Lý Thường Kiệt', 'Hai Bà Trưng', 'Phan Chu Trinh'], weight: 2 },
  { name: 'Phường Hội An Đông', center: [108.3602, 15.8851], streets: ['Cửa Đại', 'Lạc Long Quân', 'Âu Cơ'], weight: 1 },
  { name: 'Phường Hội An Tây', center: [108.3101, 15.8802], streets: ['Lý Thái Tổ', 'Hùng Vương', 'Nguyễn Tất Thành'], weight: 1 },
  { name: 'Phường Điện Bàn', center: [108.2503, 15.8902], streets: ['Trần Nhân Tông', 'Hùng Vương', 'Mẹ Thứ'], weight: 1 },
  { name: 'Phường Điện Bàn Đông', center: [108.2802, 15.9301], streets: ['Lạc Long Quân', 'Võ Chí Công', 'Trường Sa'], weight: 1 },
  { name: 'Phường Điện Bàn Bắc', center: [108.2301, 15.9502], streets: ['Quốc lộ 1A', 'Nguyễn Văn Trỗi', 'Phạm Như Xương'], weight: 1 },
  { name: 'Phường An Thắng', center: [108.2203, 15.8601], streets: ['Hùng Vương', 'Trần Hưng Đạo', 'Nguyễn Văn Linh'], weight: 1 },
  { name: 'Phường Tam Kỳ', center: [108.4741, 15.5736], streets: ['Phan Chu Trinh', 'Hùng Vương', 'Trần Cao Vân', 'Nguyễn Hoàng'], weight: 1 },
  { name: 'Phường Quảng Phú', center: [108.4602, 15.6003], streets: ['Huỳnh Thúc Kháng', 'Nguyễn Văn Trỗi', 'Lê Thánh Tông'], weight: 1 },
  { name: 'Phường Hương Trà', center: [108.4903, 15.5602], streets: ['Bạch Đằng', 'Trần Quý Cáp', 'Lý Thường Kiệt'], weight: 1 },
  { name: 'Phường Bàn Thạch', center: [108.5002, 15.5903], streets: ['Duy Tân', 'Phan Bội Châu', 'Tôn Đức Thắng'], weight: 1 },
];

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

const BIOS = [
  'Mẹ của một bé trai hiếu động, cuối tuần hay đưa con ra biển Mỹ Khê đạp xe. Mong tìm bạn cùng tuổi để con bớt dán mắt vào điện thoại.',
  'Hai vợ chồng làm văn phòng ở Hải Châu, bé nhà mình mê Lego và khủng long. Rất vui được làm quen các gia đình gần nhà.',
  'Mình là giáo viên mầm non, thích tổ chức các buổi chơi nhỏ tại nhà với đất nặn và vẽ tranh. Nhà có sân rộng, các bé tha hồ chạy.',
  'Bố bỉm sữa, làm việc tự do nên khá linh hoạt thời gian. Bé gái nhà mình hơi nhút nhát, muốn con có thêm bạn thân.',
  'Gia đình mới chuyển từ Hà Nội vào Đà Nẵng được nửa năm, đang tìm bạn chơi cho bé và cũng muốn quen thêm các phụ huynh ở đây.',
  'Bé nhà mình đang học bơi ở bể Hòa Cường, rất thích nước. Cuối tuần thường đi công viên APEC hoặc cầu Rồng xem phun lửa.',
  'Mẹ hai con, bé lớn học lớp 2, bé nhỏ đi mẫu giáo. Ưu tiên các hoạt động ngoài trời, hạn chế thiết bị điện tử.',
  'Nhà mình ở gần Ngũ Hành Sơn, hay dẫn con đi thư viện và bảo tàng Chăm. Thích những gia đình cùng quan điểm đọc sách cho con mỗi tối.',
  'Làm ngành du lịch ở Hội An nên cuối tuần thường bận, chủ yếu rảnh buổi chiều ngày thường. Bé nhà mình rất mê vẽ.',
  'Bố mẹ đều là kỹ sư, bé thích khoa học và lắp ráp robot. Sẵn sàng tổ chức buổi thí nghiệm vui tại nhà cho các bé.',
  'Mình muốn con lớn lên gần gũi thiên nhiên: dã ngoại, trồng cây, đạp xe. Rất mong được hẹn chơi đều đặn mỗi tuần.',
  'Bé nhà mình hòa đồng nhưng hơi nóng tính, đang tập chia sẻ đồ chơi. Mong gặp các bạn kiên nhẫn để con học hỏi thêm.',
];

const PLACES = [
  { name: 'Công viên Biển Đông', address: 'Đường Võ Nguyên Giáp, Phường An Hải, Thành phố Đà Nẵng', coordinates: [108.2475, 16.0717], placeType: 'park', osmId: 'osm-way-243118562' },
  { name: 'Công viên APEC', address: 'Đường Bạch Đằng, Phường Hải Châu, Thành phố Đà Nẵng', coordinates: [108.2238, 16.0598], placeType: 'park', osmId: 'osm-way-512870334' },
  { name: 'Công viên 29/3', address: 'Đường Điện Biên Phủ, Phường Thanh Khê, Thành phố Đà Nẵng', coordinates: [108.2004, 16.0641], placeType: 'park', osmId: 'osm-way-31876540' },
  { name: 'Sun World Đà Nẵng Wonders', address: '1 Phan Đăng Lưu, Phường Hòa Cường, Thành phố Đà Nẵng', coordinates: [108.2283, 16.0391], placeType: 'playground', osmId: 'osm-way-326440118' },
  { name: 'Bảo tàng Điêu khắc Chăm', address: '02 Đường 2 Tháng 9, Phường Hải Châu, Thành phố Đà Nẵng', coordinates: [108.2232, 16.0605], placeType: 'workshop', osmId: 'osm-way-89221457' },
  { name: 'Thư viện Khoa học Tổng hợp Đà Nẵng', address: 'Đường Lê Duẩn, Phường Hải Châu, Thành phố Đà Nẵng', coordinates: [108.2166, 16.0716], placeType: 'library', osmId: 'osm-way-415206643' },
  { name: 'Khu vui chơi trẻ em Lotte Mart Đà Nẵng', address: '6 Nại Nam, Phường Hòa Cường, Thành phố Đà Nẵng', coordinates: [108.2244, 16.0352], placeType: 'kids_cafe', osmId: 'osm-way-276113902' },
  { name: 'Khu vui chơi Vincom Plaza Ngô Quyền', address: '910A Ngô Quyền, Phường An Hải, Thành phố Đà Nẵng', coordinates: [108.2302, 16.0714], placeType: 'kids_cafe', osmId: 'osm-way-301447251' },
  { name: 'Cung Thể thao Tiên Sơn', address: 'Đường Phan Đăng Lưu, Phường Hòa Cường, Thành phố Đà Nẵng', coordinates: [108.2232, 16.0362], placeType: 'sports_center', osmId: 'osm-way-145532980' },
  { name: 'Công viên Biển Hội An (An Bàng)', address: 'Bãi biển An Bàng, Phường Hội An Đông, Thành phố Đà Nẵng', coordinates: [108.3418, 15.9139], placeType: 'park', osmId: 'osm-way-198604477' },
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

const weightedWards = WARDS.flatMap((ward) => Array(ward.weight).fill(ward));
// The 12 wards of the former Đà Nẵng city core, where most active families live
const coreWards = weightedWards.filter((ward) => WARDS.indexOf(ward) < 12);
const CORE_PARENT_COUNT = 27;

const buildParents = (count) => {
  const usedEmails = new Set();
  const usedPhones = new Set();
  const parents = [];

  for (let i = 0; i < count; i += 1) {
    const isMother = chance(0.7);
    const family = pick(FAMILY_NAMES);
    const middle = pick(isMother ? MIDDLE_FEMALE : MIDDLE_MALE);
    const given = pick(isMother ? GIVEN_FEMALE : GIVEN_MALE);
    const fullName = `${family} ${middle} ${given}`;

    let local = `${stripDiacritics(given)}.${stripDiacritics(family)}${int(80, 96)}`.toLowerCase();
    while (usedEmails.has(local)) local = `${local}${int(1, 9)}`;
    usedEmails.add(local);

    let phone;
    do {
      phone = `${pick(['0905', '0935', '0914', '0983', '0778', '0868'])}${String(int(100000, 999999))}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    // First families live in the city core (they connect and meet each other); the last 23
    // cover every ward once so all of Đà Nẵng is represented
    const ward = i < CORE_PARENT_COUNT ? pick(coreWards) : WARDS[(i - CORE_PARENT_COUNT) % WARDS.length];
    const street = pick(ward.streets);
    const houseNumber = chance(0.25) ? `K${int(10, 480)}/${int(1, 40)}` : String(int(2, 420));
    const coordinates = [
      Number((ward.center[0] + (random() - 0.5) * 0.016).toFixed(6)),
      Number((ward.center[1] + (random() - 0.5) * 0.016).toFixed(6)),
    ];

    const isEmailVerified = chance(0.9);
    const isPhoneVerified = chance(0.7);
    const minAge = int(2, 6);

    parents.push({
      fullName,
      isMother,
      email: `${local}@${EMAIL_DOMAIN}`,
      phone: isPhoneVerified ? phone : null,
      createdAt: daysAgo(int(20, 160), int(7, 22), int(0, 59)),
      location: {
        address: `${houseNumber} ${street}, ${ward.name}, Thành phố ${CITY}`,
        area: ward.name,
        city: CITY,
        coordinates: { type: 'Point', coordinates },
      },
      bio: pick(BIOS),
      preferences: {
        preferredPlaydateDays: pickMany(['weekday', 'weekend'], chance(0.35) ? 2 : 1),
        preferredTimeSlots: pickMany(['morning', 'afternoon', 'evening'], int(1, 2)),
        preferredLocations: pickMany(LOCATION_PREFS, int(2, 4)),
        maxDistanceKm: pick([5, 8, 10, 10, 15, 15, 20]),
        preferredAgeRange: { min: minAge, max: minAge + int(2, 4) },
      },
      privacySettings: {
        isProfileHidden: false,
        connectionPrivacy: chance(0.06) ? 'nobody' : 'everyone',
        messagePrivacy: 'connected_only',
      },
      verification: {
        isEmailVerified,
        isPhoneVerified,
        isVerifiedParent: isEmailVerified && isPhoneVerified,
      },
    });
  }
  return parents;
};

const childDob = (age) => {
  const dob = new Date(NOW.getFullYear() - age, int(0, 11), int(1, 28));
  return toDateOnly(dob);
};

const buildChild = (parentId, createdAt) => {
  const gender = chance(0.5) ? 'boy' : 'girl';
  const nickname = pick(gender === 'boy' ? BOY_NICKNAMES : GIRL_NICKNAMES);
  const givenName = pick(gender === 'boy' ? BOY_NAMES : GIRL_NAMES);
  return {
    parentId,
    // Parents use either the child's given name or the home nickname
    displayName: chance(0.5) ? `Bé ${nickname}` : givenName,
    dateOfBirth: childDob(int(2, 10)),
    gender,
    interests: pickMany(INTERESTS, int(2, 4)),
    favoriteActivities: pickMany(CHILD_ACTIVITIES, int(1, 3)),
    personality: pickMany(PERSONALITY_TRAITS, int(1, 2)),
    createdAt,
  };
};

const DIRECT_CHAT_SCRIPTS = [
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
    'Chị ơi hôm qua bé nhà em về kể suốt về bạn Mây, cảm ơn chị đã dẫn bé đi chơi cùng nha ❤️',
    'Trời bé Mây cũng vậy luôn, cứ hỏi bao giờ gặp lại bạn. Tuần sau mình đi thư viện Lê Duẩn nhé?',
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
    'Hi anh, bé nhà em thích lắp Lego lắm, anh có muốn cho hai bé thử ráp chung một bộ không?',
    'Ý hay đó, nhà anh có bộ thành phố lớn mà chưa ai ráp xong 😂',
    'Vậy chủ nhật này qua nhà anh được không? Em mang thêm bánh cho tụi nhỏ.',
    'Ok em, 9h sáng nhé. Anh gửi địa chỉ qua tin nhắn sau.',
  ],
  [
    'Chị ơi bé nhà chị có hay say nắng không? Em định hẹn ở biển mà sợ trưa nắng quá.',
    'Có em, nên chị toàn đi sáng sớm hoặc sau 4h chiều thôi.',
    'Vậy 16h30 thứ 7 ở Công viên Biển Đông nha chị.',
    'Ok em, chị mang thêm xẻng xô cát cho tụi nhỏ xây lâu đài.',
  ],
];

const GROUP_CHAT_LINES = [
  'Chào cả nhà, mình tạo nhóm này để tiện trao đổi cho buổi hẹn nhé!',
  'Nhà em sẽ tới đúng giờ ạ. Có cần mang gì không mọi người?',
  'Mỗi nhà mang một ít trái cây với nước là được, chị chuẩn bị bánh rồi.',
  'Bé nhà em háo hức từ tối qua luôn 😄',
  'Trời hôm nay đẹp quá, hẹn mọi người lát gặp nha!',
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
export async function seedDatabase({ log = console.log } = {}) {
  for (const Model of MODELS_TO_WIPE) {
    await Model.deleteMany({});
  }
  log('Wiped collections (subscription_plans kept).');

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, await bcrypt.genSalt(10));

  // ---- Users & parents -----------------------------------------------------
  const admin = await User.create({
    email: 'admin@buddylink.vn',
    passwordHash,
    role: 'admin',
    createdAt: daysAgo(200),
  });

  const parentSeeds = buildParents(50);
  const users = await User.insertMany(
    parentSeeds.map((p, i) => ({
      email: p.email,
      phone: p.phone || undefined,
      passwordHash,
      role: 'parent',
      // One account disabled by moderation
      isActive: i !== 47,
      createdAt: p.createdAt,
    })),
  );

  const parents = await Parent.insertMany(
    parentSeeds.map((p, i) => ({
      userId: users[i]._id,
      fullName: p.fullName,
      bio: p.bio,
      location: p.location,
      preferences: p.preferences,
      privacySettings: p.privacySettings,
      verification: p.verification,
      createdAt: p.createdAt,
    })),
  );
  const userOf = (parent) => users[parents.indexOf(parent)];

  // ---- Subscriptions & payments (10 premium families) -------------------------
  // One subscription document per parent (Free until a PayOS payment upgrades it)
  const premiumParents = parents.slice(0, 10);
  const subscriptions = [];
  const payments = [];
  let nextOrderCode = 100001;
  const planSnapshot = (planCode) => {
    const { name, price, currency, durationMonths } = SUBSCRIPTION_PLAN_DEFAULTS.find((p) => p.planCode === planCode);
    return { planCode, name, price, currency, durationMonths };
  };
  const payosPayment = (parent, planCode, status, createdAt) => ({
    parentId: parent._id,
    orderCode: nextOrderCode++,
    planSnapshot: planSnapshot(planCode),
    amount: planSnapshot(planCode).price,
    paymentMethod: 'payos',
    status,
    createdAt,
    // PayOS links stay payable for 15 minutes
    expiresAt: new Date(createdAt.getTime() + 15 * 60 * 1000),
  });
  for (const parent of parents) {
    const isPremium = premiumParents.includes(parent);
    if (!isPremium) {
      subscriptions.push({ parentId: parent._id, planCode: 'free', status: 'active', startDate: parent.createdAt, endDate: null });
      continue;
    }
    const yearly = premiumParents.indexOf(parent) < 3;
    const planCode = yearly ? 'premium_yearly' : 'premium_monthly';
    const startDate = daysAgo(yearly ? int(40, 120) : int(3, 25), int(8, 21));
    const endDate = new Date(startDate.getTime() + (yearly ? 365 : 30) * DAY);
    subscriptions.push({
      parentId: parent._id,
      planCode,
      status: 'active',
      startDate,
      endDate,
      calendarAnchorAt: startDate,
      purchasedMonths: yearly ? 12 : 1,
    });
    payments.push({
      ...payosPayment(parent, planCode, 'success', startDate),
      paidAt: startDate,
      fulfilledAt: startDate,
      transactionId: `PAYOS${startDate.getTime().toString().slice(-9)}${int(100, 999)}`,
      grantResult: { effectiveStartDate: startDate, effectiveEndDate: endDate, monthsGranted: yearly ? 12 : 1 },
    });
  }
  // A failed attempt and a checkout still waiting for payment, for realism
  payments.push(payosPayment(parents[12], 'premium_monthly', 'failed', daysAgo(6, 21, 14)));
  payments.push(payosPayment(parents[15], 'premium_monthly', 'pending', new Date(Date.now() - 5 * 60 * 1000)));
  const insertedSubscriptions = await Subscription.insertMany(subscriptions);
  const subscriptionFor = (parentId) => insertedSubscriptions.find((s) => s.parentId.equals(parentId));
  await Payment.insertMany(payments.map((p) => ({ ...p, subscriptionId: subscriptionFor(p.parentId)._id })));

  // ---- Children (Free plan: 1 child, Premium: 1-2) -----------------------------
  const childDocs = [];
  for (const parent of parents) {
    const count = premiumParents.includes(parent) && chance(0.7) ? 2 : 1;
    for (let c = 0; c < count; c += 1) {
      childDocs.push(buildChild(parent._id, new Date(parent.createdAt.getTime() + (c + 1) * DAY)));
    }
  }
  const children = await Child.insertMany(childDocs);
  const childrenOf = (parent) => children.filter((c) => c.parentId.equals(parent._id));
  const firstChildOf = (parent) => childrenOf(parent)[0];

  // ---- Places ------------------------------------------------------------------
  // deleteMany keeps indexes: drop the legacy googlePlaceId unique index before inserting
  await PlacesCache.syncIndexes();
  await PlacesCache.insertMany(
    PLACES.map((p) => ({
      osmId: p.osmId,
      name: p.name,
      address: p.address,
      coordinates: { type: 'Point', coordinates: p.coordinates },
      placeType: p.placeType,
      lastFetchedAt: daysAgo(int(1, 20)),
    })),
  );

  // ---- Safety: blocks (pairs never connect) ---------------------------------------
  const blockPairs = [
    [parents[30], parents[31], 'Nhắn tin liên tục dù mình đã từ chối khéo.'],
    [parents[33], parents[34], 'Không phù hợp quan điểm nuôi dạy con.'],
    [parents[40], parents[41], 'Đã gặp ngoài đời và không muốn tiếp tục liên lạc.'],
  ];
  await Block.insertMany(
    blockPairs.map(([blocker, blocked, reason], i) => ({
      blockerId: blocker._id,
      blockedId: blocked._id,
      reason,
      createdAt: daysAgo(10 - i * 2, 20),
    })),
  );

  // ---- Connections + matching swipes -------------------------------------------------
  const connectionPlan = [
    [0, 1, 'accepted'], [0, 2, 'accepted'], [1, 3, 'accepted'], [2, 4, 'accepted'], [4, 5, 'accepted'],
    [6, 7, 'accepted'], [8, 9, 'accepted'], [10, 11, 'accepted'], [0, 3, 'accepted'], [5, 12, 'accepted'],
    [13, 14, 'pending'], [15, 16, 'pending'], [17, 18, 'pending'], [19, 2, 'pending'],
    [20, 21, 'declined'], [22, 23, 'declined'],
  ];
  const connections = [];
  const swipes = [];
  for (const [a, b, status] of connectionPlan) {
    const requester = parents[a];
    const recipient = parents[b];
    const requestedAt = daysAgo(int(15, 60), int(8, 22));
    const respondedAt = new Date(requestedAt.getTime() + int(2, 40) * 60 * 60 * 1000);
    connections.push({
      parents: [requester._id, recipient._id],
      requesterId: requester._id,
      recipientId: recipient._id,
      status,
      connectedAt: status === 'accepted' ? respondedAt : null,
      declinedAt: status === 'declined' ? respondedAt : null,
      createdAt: requestedAt,
    });
    // Like = connection request
    swipes.push({ swiperParentId: requester._id, targetChildId: firstChildOf(recipient)._id, targetParentId: recipient._id, isLike: true, createdAt: requestedAt });
    if (status === 'accepted' && chance(0.5)) {
      swipes.push({ swiperParentId: recipient._id, targetChildId: firstChildOf(requester)._id, targetParentId: requester._id, isLike: true, createdAt: respondedAt });
    }
  }
  // Some passes
  for (const [a, b] of [[24, 25], [24, 26], [26, 27], [28, 29], [35, 36], [37, 38]]) {
    swipes.push({ swiperParentId: parents[a]._id, targetChildId: firstChildOf(parents[b])._id, targetParentId: parents[b]._id, isLike: false, createdAt: daysAgo(int(1, 12), int(19, 23)) });
  }
  const insertedConnections = [];
  for (const connection of connections) {
    // create() runs the pre('validate') hook that sorts parents and sets pairKey
    insertedConnections.push(await Connection.create(connection));
  }
  await Swipe.insertMany(swipes);
  const acceptedConnections = insertedConnections.filter((c) => c.status === 'accepted');

  // ---- Direct chats for accepted connections -------------------------------------------
  const directConversations = [];
  for (let i = 0; i < Math.min(acceptedConnections.length, DIRECT_CHAT_SCRIPTS.length); i += 1) {
    const connection = acceptedConnections[i];
    const starter = connection.requesterId;
    const other = connection.recipientId;
    const conversation = await Conversation.create({
      type: 'direct',
      participants: [starter, other],
      createdAt: connection.connectedAt,
    });

    let sentAt = new Date(connection.connectedAt.getTime() + 30 * 60 * 1000);
    let lastMessage = null;
    const lines = DIRECT_CHAT_SCRIPTS[i];
    for (let m = 0; m < lines.length; m += 1) {
      const senderId = m % 2 === 0 ? starter : other;
      const receiverId = m % 2 === 0 ? other : starter;
      const isLast = m === lines.length - 1;
      lastMessage = await Message.create({
        conversationId: conversation._id,
        senderId,
        type: 'text',
        content: lines[m],
        readBy: isLast && i % 2 === 0 ? [] : [{ parentId: receiverId, readAt: new Date(sentAt.getTime() + 5 * 60 * 1000) }],
        createdAt: sentAt,
      });
      sentAt = new Date(sentAt.getTime() + int(3, 90) * 60 * 1000);
    }
    const lastReceiver = lastMessage.senderId.equals(starter) ? other : starter;
    conversation.lastMessage = {
      messageId: lastMessage._id,
      senderId: lastMessage.senderId,
      content: lastMessage.content,
      type: 'text',
      sentAt: lastMessage.createdAt,
    };
    conversation.unreadCounts = { [lastReceiver.toString()]: lastMessage.readBy.length ? 0 : 1 };
    await conversation.save();
    directConversations.push(conversation);
  }

  // ---- Playdates ------------------------------------------------------------------------
  const findParent = (id) => parents.find((p) => p._id.equals(id));
  const playdatePlan = [
    { conn: 0, status: 'completed', day: -21, time: '08:00', place: 1, activity: 'Đạp xe và thả diều ở công viên APEC' },
    { conn: 1, status: 'completed', day: -14, time: '16:30', place: 0, activity: 'Xây lâu đài cát và tắm biển buổi chiều' },
    { conn: 2, status: 'completed', day: -10, time: '15:30', place: 5, activity: 'Đọc truyện tranh và tô màu ở góc thiếu nhi' },
    { conn: 3, status: 'completed', day: -7, time: '09:00', place: 4, activity: 'Tham quan bảo tàng và kể chuyện về người Chăm' },
    { conn: 4, status: 'completed', day: -5, time: '09:30', place: 6, activity: 'Chơi nhà banh và trò chơi vận động trong nhà' },
    { conn: 5, status: 'cancelled', day: -3, time: '17:00', place: 2, activity: 'Chơi bóng đá mini ở công viên 29/3' },
    { conn: 0, status: 'upcoming', day: 3, time: '08:30', place: 3, activity: 'Đi Sun World chơi vòng quay và trò chơi thiếu nhi' },
    { conn: 6, status: 'upcoming', day: 5, time: '15:00', place: 7, activity: 'Ráp Lego chung và xem phim hoạt hình' },
    { conn: 7, status: 'upcoming', day: 8, time: '16:30', place: 0, activity: 'Dã ngoại bờ biển, thổi bong bóng xà phòng' },
    { conn: 8, status: 'upcoming', day: 12, time: '09:00', place: 8, activity: 'Học bơi nhóm và chơi trò chơi dưới nước' },
  ];

  const playdates = [];
  for (const plan of playdatePlan) {
    const connection = acceptedConnections[plan.conn];
    const host = findParent(connection.requesterId);
    const guest = findParent(connection.recipientId);
    const place = PLACES[plan.place];
    const [hh, mm] = plan.time.split(':').map(Number);
    const scheduledDate = plan.day < 0 ? daysAgo(-plan.day, hh, mm) : daysAhead(plan.day, hh, mm);
    const createdAt = new Date(scheduledDate.getTime() - int(3, 9) * DAY);
    const guestStatus = plan.status === 'upcoming' && plan.day > 7 ? 'pending' : 'accepted';

    // Bigger group for one completed playdate
    const participants = [{ parentId: guest._id, childId: firstChildOf(guest)._id, status: guestStatus, invitedAt: createdAt, respondedAt: guestStatus === 'pending' ? null : new Date(createdAt.getTime() + 6 * 60 * 60 * 1000) }];
    if (plan.conn === 0 && plan.status === 'completed') {
      const third = findParent(acceptedConnections[1].recipientId);
      participants.push({ parentId: third._id, childId: firstChildOf(third)._id, status: 'accepted', invitedAt: createdAt, respondedAt: new Date(createdAt.getTime() + DAY) });
    }

    const playdate = await Playdate.create({
      hostParentId: host._id,
      hostChildId: firstChildOf(host)._id,
      participants,
      scheduledDate,
      time: plan.time,
      activity: plan.activity,
      location: { name: place.name, address: place.address, placeId: place.osmId, coordinates: { type: 'Point', coordinates: place.coordinates } },
      note: pick(['Nhớ mang nón và kem chống nắng cho bé nhé.', 'Mỗi nhà mang một ít nước và trái cây.', 'Có chỗ gửi xe máy ngay cổng chính.', '']),
      status: plan.status,
      cancellation: plan.status === 'cancelled'
        ? { cancelledBy: guest._id, reason: 'Bé bị sốt nhẹ từ tối qua, xin hẹn lại tuần sau ạ.', cancelledAt: new Date(scheduledDate.getTime() - 14 * 60 * 60 * 1000) }
        : undefined,
      completedAt: plan.status === 'completed' ? new Date(scheduledDate.getTime() + 2 * 60 * 60 * 1000) : null,
      createdAt,
    });

    // Group chat for every playdate that was accepted at least once
    const members = [host._id, ...participants.filter((p) => p.status === 'accepted').map((p) => p.parentId)];
    if (members.length > 1) {
      const conversation = await Conversation.create({ type: 'playdate', participants: members, playdateId: playdate._id, createdAt });
      let sentAt = new Date(createdAt.getTime() + 60 * 60 * 1000);
      let last = await Message.create({ conversationId: conversation._id, senderId: host._id, type: 'system', content: `${host.fullName} đã tạo buổi hẹn "${plan.activity}"`, readBy: [], createdAt: sentAt });
      const lineCount = int(2, 4);
      for (let l = 0; l < lineCount; l += 1) {
        sentAt = new Date(sentAt.getTime() + int(10, 240) * 60 * 1000);
        const sender = members[l % members.length];
        last = await Message.create({
          conversationId: conversation._id,
          senderId: sender,
          type: 'text',
          content: GROUP_CHAT_LINES[l],
          readBy: members.filter((m) => !m.equals(sender)).map((parentId) => ({ parentId, readAt: new Date(sentAt.getTime() + 20 * 60 * 1000) })),
          createdAt: sentAt,
        });
      }
      conversation.lastMessage = { messageId: last._id, senderId: last.senderId, content: last.content, type: last.type, sentAt: last.createdAt };
      conversation.unreadCounts = Object.fromEntries(members.map((m) => [m.toString(), 0]));
      await conversation.save();
      playdate.chatConversationId = conversation._id;
      await playdate.save();
    }
    playdates.push(playdate);
  }
  const completedPlaydates = playdates.filter((p) => p.status === 'completed');
  const upcomingPlaydates = playdates.filter((p) => p.status === 'upcoming');

  // ---- Reschedule requests ------------------------------------------------------------------
  const rescheduleSeeds = [
    { playdate: upcomingPlaydates[0], status: 'accepted', reason: 'Sáng thứ 7 nhà em có đám giỗ, mình dời sang chủ nhật được không ạ?', shiftDays: 1, time: '08:30' },
    { playdate: upcomingPlaydates[1], status: 'pending', reason: 'Chiều đó bé có lớp vẽ, mình lùi sang 16h được không anh?', shiftDays: 0, time: '16:00' },
    { playdate: upcomingPlaydates[2], status: 'declined', reason: 'Dự báo có mưa, đổi sang khu vui chơi trong nhà nhé?', shiftDays: 0, time: '16:30', place: 7 },
  ];
  await RescheduleRequest.insertMany(
    rescheduleSeeds.map((r) => {
      const requester = r.playdate.participants[0].parentId;
      const place = r.place !== undefined ? PLACES[r.place] : null;
      const createdAt = new Date(r.playdate.createdAt.getTime() + DAY);
      return {
        playdateId: r.playdate._id,
        requestedBy: requester,
        newDate: new Date(r.playdate.scheduledDate.getTime() + r.shiftDays * DAY),
        newStartTime: r.time,
        newLocation: place
          ? { name: place.name, address: place.address, placeId: place.osmId, coordinates: { type: 'Point', coordinates: place.coordinates } }
          : undefined,
        reason: r.reason,
        status: r.status,
        responses: [{ parentId: r.playdate.hostParentId, status: r.status === 'pending' ? 'pending' : r.status, respondedAt: r.status === 'pending' ? null : new Date(createdAt.getTime() + 3 * 60 * 60 * 1000) }],
        resolvedAt: r.status === 'pending' ? null : new Date(createdAt.getTime() + 3 * 60 * 60 * 1000),
        createdAt,
      };
    }),
  );

  // ---- Ratings for completed playdates -----------------------------------------------------
  const FEEDBACKS = [
    { rating: 5, feedback: 'Hai bé chơi rất hợp, về nhà còn đòi gặp lại bạn. Bố mẹ bạn rất thân thiện!', tags: ['Đúng giờ', 'Thân thiện', 'Bé chơi hợp'] },
    { rating: 5, feedback: 'Địa điểm sạch sẽ, an toàn. Mọi người chuẩn bị đồ ăn rất chu đáo.', tags: ['Địa điểm an toàn', 'Chu đáo'] },
    { rating: 4, feedback: 'Buổi chơi vui, chỉ hơi nắng nên lần sau sẽ hẹn sớm hơn.', tags: ['Bé chơi hợp'] },
    { rating: 4, feedback: 'Bé nhà mình hơi nhút nhát lúc đầu nhưng sau đó chơi rất vui.', tags: ['Kiên nhẫn', 'Thân thiện'] },
    { rating: 5, feedback: 'Rất đáng để hẹn lại, hai gia đình nói chuyện hợp nhau lắm.', tags: ['Muốn hẹn lại', 'Thân thiện'] },
    { rating: 3, feedback: 'Đến trễ khoảng 20 phút nên các bé phải chờ, còn lại ổn.', tags: ['Bé chơi hợp'] },
  ];
  const ratings = [];
  for (const playdate of completedPlaydates) {
    const raters = [playdate.hostParentId, ...playdate.participants.map((p) => p.parentId)];
    for (const parentId of raters) {
      const f = pick(FEEDBACKS);
      ratings.push({ playdateId: playdate._id, parentId, rating: f.rating, feedback: f.feedback, tags: f.tags, createdAt: new Date(playdate.completedAt.getTime() + int(1, 20) * 60 * 60 * 1000) });
    }
  }
  await RatingFeedback.insertMany(ratings);

  // ---- Streaks for parents with completed playdates ----------------------------------------
  const isoWeek = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / DAY + 1) / 7)).padStart(2, '0')}`;
  };
  const playdateCount = new Map();
  for (const playdate of completedPlaydates) {
    for (const parentId of [playdate.hostParentId, ...playdate.participants.map((p) => p.parentId)]) {
      const key = parentId.toString();
      const entry = playdateCount.get(key) || { count: 0, last: playdate.scheduledDate };
      entry.count += 1;
      if (playdate.scheduledDate > entry.last) entry.last = playdate.scheduledDate;
      playdateCount.set(key, entry);
    }
  }
  for (const [parentId, { count, last }] of playdateCount) {
    await Parent.updateOne(
      { _id: parentId },
      { $set: { streak: { currentWeeklyStreak: Math.min(count, 3), longestStreak: Math.min(count + 1, 4), lastCompletedPlaydateWeek: isoWeek(last), streakUpdatedAt: last } } },
    );
  }

  // ---- Badges ----------------------------------------------------------------------------
  await Badge.insertMany(BADGES);
  const userBadges = [];
  const awarded = new Set();
  const award = (parentId, badgeCode, unlockedAt) => {
    const key = `${parentId}:${badgeCode}`;
    if (awarded.has(key)) return;
    awarded.add(key);
    userBadges.push({ parentId, badgeCode, unlockedAt, createdAt: unlockedAt });
  };
  for (const connection of acceptedConnections) {
    award(connection.requesterId, 'first_connection', connection.connectedAt);
    award(connection.recipientId, 'first_connection', connection.connectedAt);
  }
  for (const playdate of completedPlaydates) {
    for (const parentId of [playdate.hostParentId, ...playdate.participants.map((p) => p.parentId)]) {
      award(parentId, 'first_playdate', playdate.completedAt);
    }
    award(playdate.hostParentId, 'first_host', playdate.completedAt);
  }
  award(parents[0]._id, 'explorer', completedPlaydates[1].completedAt);
  await UserBadge.insertMany(userBadges);

  // ---- Reports ------------------------------------------------------------------------------
  const cancelledPlaydate = playdates.find((p) => p.status === 'cancelled');
  const reportedMessage = await Message.findOne({ conversationId: directConversations[3]._id, type: 'text' }).sort({ createdAt: -1 });
  const messageReporter = directConversations[3].participants.find((id) => !id.equals(reportedMessage.senderId));
  await Report.insertMany([
    { reporterId: parents[30]._id, reportedUserId: parents[31]._id, targetType: 'user', reason: 'Quấy rối', description: 'Gửi lời mời kết nối nhiều lần và nhắn tin không phù hợp sau khi bị từ chối.', status: 'resolved', adminNotes: 'Đã cảnh cáo tài khoản, theo dõi thêm 30 ngày.', resolvedBy: admin._id, resolvedAt: daysAgo(8), createdAt: daysAgo(10) },
    { reporterId: parents[33]._id, reportedUserId: parents[34]._id, targetType: 'user', reason: 'Thông tin hồ sơ không trung thực', description: 'Ảnh đại diện và độ tuổi của bé có vẻ không đúng thực tế.', status: 'reviewing', adminNotes: 'Đang yêu cầu phụ huynh xác minh lại số điện thoại.', createdAt: daysAgo(5) },
    { reporterId: cancelledPlaydate.hostParentId, reportedUserId: cancelledPlaydate.cancellation.cancelledBy, targetType: 'playdate', targetPlaydateId: cancelledPlaydate._id, reason: 'Không đến buổi hẹn', description: 'Hủy sát giờ mà không báo trước, cả nhà đã ra tới công viên.', status: 'dismissed', adminNotes: 'Lý do hủy hợp lệ (bé bị ốm), không vi phạm.', resolvedBy: admin._id, resolvedAt: daysAgo(2), createdAt: daysAgo(3) },
    { reporterId: messageReporter, reportedUserId: reportedMessage.senderId, targetType: 'message', targetMessageId: reportedMessage._id, reason: 'Báo cáo nhầm', description: 'Lỡ bấm báo cáo khi đang đọc tin nhắn, mong admin bỏ qua giúp.', status: 'dismissed', adminNotes: 'Người báo cáo xác nhận bấm nhầm, đóng báo cáo.', resolvedBy: admin._id, resolvedAt: daysAgo(0, 9), createdAt: daysAgo(1, 21) },
    { reporterId: parents[44]._id, reportedUserId: parents[45]._id, targetType: 'user', reason: 'Ngôn từ không phù hợp', description: 'Dùng từ ngữ thiếu lịch sự trong phần giới thiệu bản thân.', status: 'pending', createdAt: daysAgo(0, 7, 45) },
  ]);

  // ---- Notifications ---------------------------------------------------------------------------
  const notifications = [];
  for (const connection of insertedConnections.slice(0, 8)) {
    const requester = findParent(connection.requesterId);
    const recipient = findParent(connection.recipientId);
    notifications.push({ recipientId: userOf(recipient)._id, type: 'connection_request', title: 'Lời mời kết nối mới', body: `${requester.fullName} muốn kết nối với gia đình bạn.`, data: { senderId: requester._id }, isRead: connection.status !== 'pending', readAt: connection.status !== 'pending' ? connection.connectedAt || connection.declinedAt : null, createdAt: connection.createdAt });
    if (connection.status === 'accepted') {
      notifications.push({ recipientId: userOf(requester)._id, type: 'connection_accepted', title: 'Đã kết nối!', body: `${recipient.fullName} đã chấp nhận lời mời. Hãy gửi lời chào nhé!`, data: { senderId: recipient._id }, isRead: true, readAt: connection.connectedAt, createdAt: connection.connectedAt });
    }
  }
  for (const playdate of upcomingPlaydates) {
    const host = findParent(playdate.hostParentId);
    for (const participant of playdate.participants) {
      notifications.push({ recipientId: userOf(findParent(participant.parentId))._id, type: 'playdate_invite', title: 'Lời mời hẹn chơi', body: `${host.fullName} mời bé tham gia "${playdate.activity}".`, data: { senderId: host._id, playdateId: playdate._id }, isRead: participant.status !== 'pending', createdAt: playdate.createdAt });
    }
    notifications.push({ recipientId: userOf(host)._id, type: 'playdate_reminder', title: 'Sắp đến buổi hẹn', body: `Buổi hẹn tại ${playdate.location.name} lúc ${playdate.time}. Đừng quên chuẩn bị nước và nón cho bé nhé!`, data: { playdateId: playdate._id }, isRead: false, createdAt: new Date(Math.min(NOW.getTime(), playdate.scheduledDate.getTime() - DAY)) });
  }
  for (const badge of userBadges.slice(0, 5)) {
    const parent = findParent(badge.parentId);
    const def = BADGES.find((b) => b.code === badge.badgeCode);
    notifications.push({ recipientId: userOf(parent)._id, type: 'badge_unlocked', title: 'Huy hiệu mới 🎉', body: `Chúc mừng! Bạn vừa mở khóa huy hiệu "${def.title}".`, data: { badgeCode: badge.badgeCode }, isRead: chance(0.5), createdAt: badge.unlockedAt });
  }
  notifications.push({ recipientId: userOf(parents[2])._id, type: 'streak_reminder', title: 'Giữ chuỗi hẹn chơi', body: 'Tuần này bạn chưa có buổi hẹn nào. Hẹn một buổi để giữ chuỗi 2 tuần nhé!', isRead: false, createdAt: daysAgo(1, 18) });
  for (const parent of parents.slice(0, 4)) {
    notifications.push({ recipientId: userOf(parent)._id, type: 'system', title: 'BuddyLink cập nhật địa bàn mới', body: 'Từ nay bạn có thể tìm bạn chơi tại Hội An, Điện Bàn và Tam Kỳ thuộc thành phố Đà Nẵng mới.', isRead: false, createdAt: daysAgo(4, 10) });
  }
  await Notification.insertMany(notifications.filter((n) => n.createdAt <= NOW));

  // ---- Usage quotas (today and this month) --------------------------------------------------------
  const formatDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = formatDay(NOW);
  const thisMonth = today.slice(0, 7);
  const quotas = [];
  for (const parent of parents.slice(10, 20)) {
    quotas.push({ parentId: parent._id, periodType: 'daily', periodValue: today, counters: { discoveryViews: int(1, 4) } });
    quotas.push({ parentId: parent._id, periodType: 'monthly', periodValue: thisMonth, counters: { connectionRequests: int(0, 3), playdatesCreated: int(0, 2), playdatesParticipated: int(0, 2), aiAssistantRequests: int(0, 4) } });
  }
  await UsageQuota.insertMany(quotas);

  // ---- Auth: refresh sessions and recent verification tokens --------------------------------------
  const refreshTokens = [];
  for (const user of users.slice(0, 10)) {
    const createdAt = daysAgo(int(0, 6), int(7, 23));
    refreshTokens.push({ userId: user._id, tokenHash: sha256(crypto.randomUUID()), isRevoked: false, expiresAt: new Date(createdAt.getTime() + 7 * DAY), createdAt });
  }
  refreshTokens.push({ userId: users[11]._id, tokenHash: sha256(crypto.randomUUID()), isRevoked: true, revokedAt: daysAgo(1, 22), expiresAt: daysAhead(5), createdAt: daysAgo(2) });
  await RefreshToken.insertMany(refreshTokens);

  // OTP / reset tokens are short-lived (TTL index removes them after expiresAt)
  await AuthToken.insertMany(
    users.slice(45, 50).map((user, i) => ({
      userId: user._id,
      target: i % 2 === 0 ? user.email : parentSeeds[45 + i].phone || user.email,
      tokenHash: sha256(String(int(100000, 999999))),
      type: i % 2 === 0 ? 'email_verify' : i === 3 ? 'password_reset' : 'phone_otp',
      isUsed: i < 2,
      attempts: i === 4 ? 2 : 0,
      expiresAt: new Date(NOW.getTime() + (i === 3 ? 15 : 10) * 60 * 1000),
      createdAt: new Date(NOW.getTime() - int(1, 4) * 60 * 1000),
    })),
  );

  const counts = {};
  for (const Model of MODELS_TO_WIPE) counts[Model.collection.collectionName] = await Model.countDocuments();
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
    console.log('Dry run. These collections would be wiped (subscription_plans is kept):');
    for (const Model of MODELS_TO_WIPE) {
      console.log(`  - ${Model.collection.collectionName}: ${await Model.estimatedDocumentCount()} documents`);
    }
    console.log('Re-run with --confirm to wipe and seed.');
    return;
  }

  const counts = await seedDatabase();
  console.log('Seeded documents per collection:');
  console.table(counts);
  console.log(`All accounts use the password: ${SEED_PASSWORD} (admin: admin@buddylink.vn)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
