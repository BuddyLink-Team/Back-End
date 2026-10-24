/**
 * Activity catalog for playdate activity suggestions (GET /playdates/suggestions/activities).
 *
 * key:        the activity as saved in child.favoriteActivities (CHILD_ACTIVITIES in child.constants.js)
 * title:      filled into the playdate activity when the suggestion is picked
 *             (same text as playdateTitle in Front-End/src/constants/activity.constants.js)
 * tags:       lower-case keywords; a child "likes" the activity when one of their interests or
 *             favorite activities contains a tag (interests come from POPULAR_INTERESTS on the FE)
 * minAge / maxAge: every child of the group must be within this range
 * durationMinutes: usual length of the activity (suggested playdate duration, shorter for toddlers)
 * placeTypes: PLACE_TYPES where the activity usually happens
 * isGeneric:  offered when nothing matches the children's interests
 */
export const PLAYDATE_ACTIVITIES = Object.freeze([
  { key: 'Dã ngoại ngoài trời', title: 'Dã ngoại & vận động tại công viên', tags: ['dã ngoại', 'ngoài trời', 'picnic'], minAge: 2, maxAge: 14, durationMinutes: 180, placeTypes: ['park'], isGeneric: true },
  { key: 'Chơi cát & Tắm biển', title: 'Xây lâu đài cát & tắm biển', tags: ['biển', 'chơi cát'], minAge: 3, maxAge: 14, durationMinutes: 150, placeTypes: [] },
  { key: 'Thả diều', title: 'Thả diều trên bãi cỏ rộng', tags: ['thả diều', 'diều'], minAge: 4, maxAge: 14, durationMinutes: 90, placeTypes: ['park'] },
  { key: 'Tham quan vườn thú', title: 'Tham quan vườn thú & thế giới động vật', tags: ['vườn thú', 'động vật', 'khủng long'], minAge: 2, maxAge: 12, durationMinutes: 180, placeTypes: ['park'] },
  { key: 'Làm vườn & Trồng cây', title: 'Trồng cây & chăm sóc vườn mini', tags: ['làm vườn', 'trồng cây'], minAge: 3, maxAge: 14, durationMinutes: 90, placeTypes: ['park', 'workshop'] },
  { key: 'Đạp xe công viên', title: 'Đạp xe cùng nhau ở công viên', tags: ['đạp xe', 'xe đạp', 'xe cộ'], minAge: 4, maxAge: 16, durationMinutes: 90, placeTypes: ['park'] },
  { key: 'Bơi lội', title: 'Bơi lội & chơi nước cho các bé', tags: ['bơi'], minAge: 4, maxAge: 16, durationMinutes: 90, placeTypes: ['sports_center'] },
  { key: 'Bóng đá / Thể thao', title: 'Đá bóng & trò chơi rèn luyện thể chất', tags: ['bóng đá', 'thể thao', 'vận động', 'siêu anh hùng'], minAge: 4, maxAge: 16, durationMinutes: 90, placeTypes: ['sports_center', 'park'] },
  { key: 'Trượt patin', title: 'Trượt patin cùng bạn', tags: ['patin'], minAge: 5, maxAge: 16, durationMinutes: 90, placeTypes: ['park', 'sports_center'] },
  { key: 'Xếp hình Lego', title: 'Buổi chơi xếp hình Lego & giao lưu', tags: ['lego', 'lắp ráp', 'xếp hình'], minAge: 3, maxAge: 12, durationMinutes: 120, placeTypes: ['kids_cafe', 'library'] },
  { key: 'Vẽ tranh', title: 'Buổi vẽ tranh sáng tạo ngoài trời', tags: ['vẽ', 'hội họa'], minAge: 2, maxAge: 14, durationMinutes: 90, placeTypes: ['park', 'workshop'] },
  { key: 'Thủ công sáng tạo', title: 'Làm đồ thủ công & đất nặn', tags: ['thủ công', 'đất nặn', 'búp bê'], minAge: 3, maxAge: 12, durationMinutes: 90, placeTypes: ['workshop', 'kids_cafe'] },
  { key: 'Làm bánh & Nấu ăn', title: 'Lớp học làm bánh mini cho các bé', tags: ['làm bánh', 'nấu ăn'], minAge: 4, maxAge: 14, durationMinutes: 120, placeTypes: ['workshop'] },
  { key: 'Âm nhạc & Ca hát', title: 'Hát & chơi nhạc cụ cùng nhau', tags: ['âm nhạc', 'ca hát', 'đàn', 'hát'], minAge: 2, maxAge: 14, durationMinutes: 60, placeTypes: ['kids_cafe', 'workshop'] },
  { key: 'Thư viện / Đọc sách', title: 'Giao lưu đọc sách & kể chuyện cho bé', tags: ['đọc sách', 'thư viện', 'truyện'], minAge: 3, maxAge: 14, durationMinutes: 60, placeTypes: ['library'] },
  { key: 'Ghé thăm viện bảo tàng', title: 'Tham quan bảo tàng cùng các bé', tags: ['bảo tàng', 'khủng long'], minAge: 5, maxAge: 16, durationMinutes: 120, placeTypes: [] },
  { key: 'Khám phá khoa học', title: 'Thí nghiệm khoa học vui cho bé', tags: ['khoa học', 'không gian', 'thí nghiệm'], minAge: 5, maxAge: 14, durationMinutes: 90, placeTypes: ['workshop', 'library'] },
  { key: 'Khu vui chơi trong nhà (Kids Cafe)', title: 'Vui chơi tại khu vui chơi trong nhà', tags: ['kids cafe', 'khu vui chơi'], minAge: 1, maxAge: 10, durationMinutes: 120, placeTypes: ['kids_cafe', 'playground'], isGeneric: true },
  { key: 'Trò chơi tương tác / Board games', title: 'Chơi board game & trò chơi tương tác', tags: ['board game', 'cờ vua', 'trò chơi tương tác'], minAge: 5, maxAge: 16, durationMinutes: 90, placeTypes: ['kids_cafe', 'library'] },
  { key: 'Xem phim hoạt hình', title: 'Xem phim hoạt hình cùng nhau', tags: ['phim', 'hoạt hình', 'siêu anh hùng'], minAge: 3, maxAge: 12, durationMinutes: 120, placeTypes: [] },
  { key: 'Chơi cầu trượt & xích đu', title: 'Chơi cầu trượt & xích đu ở sân chơi', tags: ['sân chơi', 'cầu trượt', 'xích đu'], minAge: 1, maxAge: 8, durationMinutes: 60, placeTypes: ['playground', 'park'], isGeneric: true },
]);

export default PLAYDATE_ACTIVITIES;
