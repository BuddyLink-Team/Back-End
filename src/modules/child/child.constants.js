export const CHILD_GENDERS = Object.freeze({
  BOY: 'boy',
  GIRL: 'girl',
  OTHER: 'other',
});

// Fields a parent may set on a child profile (parentId, isArchived... are server-controlled)
export const CHILD_EDITABLE_FIELDS = Object.freeze([
  'displayName',
  'dateOfBirth',
  'gender',
  'interests',
  'favoriteActivities',
  'personality',
]);

// Kids activities offered on a child profile. Mirror of ACTIVITIES (value) in
// Front-End/src/constants/activity.constants.js: keep both lists in sync (used by the seed data)
export const CHILD_ACTIVITIES = Object.freeze([
  'Dã ngoại ngoài trời',
  'Chơi cát & Tắm biển',
  'Thả diều',
  'Tham quan vườn thú',
  'Làm vườn & Trồng cây',
  'Đạp xe công viên',
  'Bơi lội',
  'Bóng đá / Thể thao',
  'Trượt patin',
  'Xếp hình Lego',
  'Vẽ tranh',
  'Thủ công sáng tạo',
  'Làm bánh & Nấu ăn',
  'Âm nhạc & Ca hát',
  'Thư viện / Đọc sách',
  'Ghé thăm viện bảo tàng',
  'Khám phá khoa học',
  'Khu vui chơi trong nhà (Kids Cafe)',
  'Trò chơi tương tác / Board games',
  'Xem phim hoạt hình',
]);
