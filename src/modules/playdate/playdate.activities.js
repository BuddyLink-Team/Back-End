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
  { key: 'Dã ngoại ngoài trời', title: 'Dã ngoại & vận động tại công viên', tags: ['dã ngoại', 'ngoài trời', 'picnic'], minAge: 2, maxAge: 14, durationMinutes: 180, placeTypes: ['park'], isGeneric: true, riskLevel: 'low', supervisionLevel: 'normal' },
  { key: 'Chơi cát & Tắm biển', title: 'Xây lâu đài cát & tắm biển', tags: ['biển', 'chơi cát'], minAge: 3, maxAge: 14, durationMinutes: 150, placeTypes: [], riskLevel: 'high', supervisionLevel: 'high_vigilance' },
  { key: 'Thả diều', title: 'Thả diều trên bãi cỏ rộng', tags: ['thả diều', 'diều'], minAge: 4, maxAge: 14, durationMinutes: 90, placeTypes: ['park'], riskLevel: 'low', supervisionLevel: 'normal' },
  { key: 'Tham quan vườn thú', title: 'Tham quan vườn thú & thế giới động vật', tags: ['vườn thú', 'động vật', 'khủng long'], minAge: 2, maxAge: 12, durationMinutes: 180, placeTypes: ['park'], riskLevel: 'low', supervisionLevel: 'normal' },
  { key: 'Làm vườn & Trồng cây', title: 'Trồng cây & chăm sóc vườn mini', tags: ['làm vườn', 'trồng cây'], minAge: 3, maxAge: 14, durationMinutes: 90, placeTypes: ['park', 'workshop'], riskLevel: 'low', supervisionLevel: 'normal' },
  { key: 'Đạp xe công viên', title: 'Đạp xe cùng nhau ở công viên', tags: ['đạp xe', 'xe đạp', 'xe cộ'], minAge: 4, maxAge: 16, durationMinutes: 90, placeTypes: ['park'], riskLevel: 'medium', supervisionLevel: 'normal' },
  { key: 'Bơi lội', title: 'Bơi lội & chơi nước cho các bé', tags: ['bơi'], minAge: 4, maxAge: 16, durationMinutes: 90, placeTypes: ['sports_center'], riskLevel: 'high', supervisionLevel: 'dedicated_1to1' },
  { key: 'Bóng đá / Thể thao', title: 'Đá bóng & trò chơi rèn luyện thể chất', tags: ['bóng đá', 'thể thao', 'vận động', 'siêu anh hùng'], minAge: 4, maxAge: 16, durationMinutes: 90, placeTypes: ['sports_center', 'park'], riskLevel: 'medium', supervisionLevel: 'normal' },
  { key: 'Trượt patin', title: 'Trượt patin cùng bạn', tags: ['patin'], minAge: 5, maxAge: 16, durationMinutes: 90, placeTypes: ['park', 'sports_center'], riskLevel: 'medium', supervisionLevel: 'normal' },
  { key: 'Xếp hình Lego', title: 'Buổi chơi xếp hình Lego & giao lưu', tags: ['lego', 'lắp ráp', 'xếp hình'], minAge: 3, maxAge: 12, durationMinutes: 120, placeTypes: ['kids_cafe', 'library'], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Vẽ tranh', title: 'Buổi vẽ tranh sáng tạo ngoài trời', tags: ['vẽ', 'hội họa'], minAge: 2, maxAge: 14, durationMinutes: 90, placeTypes: ['park', 'workshop'], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Thủ công sáng tạo', title: 'Làm đồ thủ công & đất nặn', tags: ['thủ công', 'đất nặn', 'búp bê'], minAge: 3, maxAge: 12, durationMinutes: 90, placeTypes: ['workshop', 'kids_cafe'], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Làm bánh & Nấu ăn', title: 'Lớp học làm bánh mini cho các bé', tags: ['làm bánh', 'nấu ăn'], minAge: 4, maxAge: 14, durationMinutes: 120, placeTypes: ['workshop'], riskLevel: 'medium', supervisionLevel: 'high_vigilance' },
  { key: 'Âm nhạc & Ca hát', title: 'Hát & chơi nhạc cụ cùng nhau', tags: ['âm nhạc', 'ca hát', 'đàn', 'hát'], minAge: 2, maxAge: 14, durationMinutes: 60, placeTypes: ['kids_cafe', 'workshop'], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Thư viện / Đọc sách', title: 'Giao lưu đọc sách & kể chuyện cho bé', tags: ['đọc sách', 'thư viện', 'truyện'], minAge: 3, maxAge: 14, durationMinutes: 60, placeTypes: ['library'], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Ghé thăm viện bảo tàng', title: 'Tham quan bảo tàng cùng các bé', tags: ['bảo tàng', 'khủng long'], minAge: 5, maxAge: 16, durationMinutes: 120, placeTypes: [], riskLevel: 'low', supervisionLevel: 'normal' },
  { key: 'Khám phá khoa học', title: 'Thí nghiệm khoa học vui cho bé', tags: ['khoa học', 'không gian', 'thí nghiệm'], minAge: 5, maxAge: 14, durationMinutes: 90, placeTypes: ['workshop', 'library'], riskLevel: 'low', supervisionLevel: 'normal' },
  { key: 'Khu vui chơi trong nhà (Kids Cafe)', title: 'Vui chơi tại khu vui chơi trong nhà', tags: ['kids cafe', 'khu vui chơi'], minAge: 1, maxAge: 10, durationMinutes: 120, placeTypes: ['kids_cafe', 'playground'], isGeneric: true, riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Trò chơi tương tác / Board games', title: 'Chơi board game & trò chơi tương tác', tags: ['board game', 'cờ vua', 'trò chơi tương tác'], minAge: 5, maxAge: 16, durationMinutes: 90, placeTypes: ['kids_cafe', 'library'], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Xem phim hoạt hình', title: 'Xem phim hoạt hình cùng nhau', tags: ['phim', 'hoạt hình', 'siêu anh hùng'], minAge: 3, maxAge: 12, durationMinutes: 120, placeTypes: [], riskLevel: 'low', supervisionLevel: 'minimal' },
  { key: 'Chơi cầu trượt & xích đu', title: 'Chơi cầu trượt & xích đu ở sân chơi', tags: ['sân chơi', 'cầu trượt', 'xích đu'], minAge: 1, maxAge: 8, durationMinutes: 60, placeTypes: ['playground', 'park'], isGeneric: true, riskLevel: 'medium', supervisionLevel: 'normal' },
]);

/**
 * Concrete game templates for places without known attractions
 */
export const GENERIC_GAMES = Object.freeze([
  { title: 'Trò chơi chuyền bóng và vận động nhẹ', minAge: 2, maxAge: 12, tags: ['thể thao', 'vận động', 'bóng đá'], defaultMinutes: 20, riskLevel: 'low', supervisionLevel: 'normal' },
  { title: 'Thi xếp hình sáng tạo', minAge: 3, maxAge: 12, tags: ['lego', 'xếp hình', 'lắp ráp'], defaultMinutes: 25, riskLevel: 'low', supervisionLevel: 'minimal' },
  { title: 'Vẽ tranh sắc màu theo chủ đề', minAge: 2, maxAge: 14, tags: ['vẽ', 'hội họa', 'thủ công'], defaultMinutes: 25, riskLevel: 'low', supervisionLevel: 'minimal' },
  { title: 'Đố vui tương tác và kể chuyện cùng bạn', minAge: 3, maxAge: 14, tags: ['đọc sách', 'truyện', 'thư viện'], defaultMinutes: 20, riskLevel: 'low', supervisionLevel: 'minimal' },
  { title: 'Chơi cầu trượt và nhà bóng', minAge: 1, maxAge: 8, tags: ['sân chơi', 'cầu trượt', 'kids cafe'], defaultMinutes: 25, riskLevel: 'medium', supervisionLevel: 'normal' },
  { title: 'Thử thách Board game đồng đội', minAge: 5, maxAge: 16, tags: ['board game', 'cờ vua'], defaultMinutes: 30, riskLevel: 'low', supervisionLevel: 'minimal' },
  { title: 'Đua xe đạp mini / patin tự do', minAge: 4, maxAge: 16, tags: ['đạp xe', 'patin'], defaultMinutes: 25, riskLevel: 'medium', supervisionLevel: 'normal' },
  { title: 'Khám phá thiên nhiên và tìm đồ vật', minAge: 3, maxAge: 14, tags: ['dã ngoại', 'ngoài trời'], defaultMinutes: 25, riskLevel: 'low', supervisionLevel: 'normal' },
]);

/**
 * Pick 2-5 concrete games fitting within ~85% of playdate duration,
 * filtering age and scoring by shared interests (BUD-49 A2).
 * @param {Object} input
 * @param {Array<{ displayName?: string, age?: number|null, interests?: string[], favoriteActivities?: string[] }>} input.children
 * @param {number} [input.durationMinutes=60]
 * @param {Array<{ title: string, minAge?: number, maxAge?: number, durationMinutes?: number }>} [input.availableAttractions=[]]
 * @returns {string[]}
 */
export const pickAttractions = ({
  children = [],
  childAges = [],
  durationMinutes = 60,
  availableAttractions = [],
  attractions = [],
} = {}) => {
  const effectiveChildren = children.length > 0
    ? children
    : (childAges || []).map((age) => ({ age: typeof age === 'number' ? age : Number(age) }));
  const effectiveAttractions = availableAttractions.length > 0 ? availableAttractions : attractions;

  const ages = effectiveChildren.map((c) => c.age).filter((age) => typeof age === 'number' && !Number.isNaN(age));
  const youngestAge = ages.length ? Math.min(...ages) : null;
  const oldestAge = ages.length ? Math.max(...ages) : null;

  // 85% of total playdate time budget
  const targetMinutes = Math.max(30, Math.round(durationMinutes * 0.85));

  // Cap per-activity duration for younger children (youngestAge < 4 max 20m, youngestAge < 8 max 30m, else 45m)
  const maxPerActivity = youngestAge !== null && youngestAge < 4 ? 20 : youngestAge !== null && youngestAge < 8 ? 30 : 45;
  const itemDuration = youngestAge !== null && youngestAge < 4 ? 15 : youngestAge !== null && youngestAge < 8 ? 20 : 25;

  // Collect all interest/activity tags of the children
  const allTags = effectiveChildren.flatMap((c) => [...(c.interests || []), ...(c.favoriteActivities || [])].map((t) => String(t).toLowerCase()));

  const candidates = effectiveAttractions.length > 0
    ? effectiveAttractions.map((a) => ({
        title: a.title || a.name,
        minAge: a.minAge ?? 0,
        maxAge: a.maxAge ?? 18,
        durationMinutes: Math.min(a.durationMinutes || itemDuration, maxPerActivity),
      }))
    : GENERIC_GAMES.map((g) => ({
        ...g,
        durationMinutes: Math.min(g.defaultMinutes || itemDuration, maxPerActivity),
      }));

  // Filter age
  const ageAppropriate = candidates.filter(
    (item) => (youngestAge === null || item.maxAge >= youngestAge) && (oldestAge === null || item.minAge <= oldestAge)
  );

  const list = ageAppropriate.length ? ageAppropriate : candidates;

  // Score candidates by tags
  const scored = list.map((item) => {
    const text = item.title.toLowerCase();
    const matches = (item.tags || []).filter((tag) => allTags.some((t) => t.includes(tag) || tag.includes(t))).length;
    const nameMatch = allTags.some((t) => text.includes(t)) ? 1 : 0;
    return { item, score: matches + nameMatch };
  });

  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  let currentMinutes = 0;
  const minGames = durationMinutes < 60 ? 2 : 3;
  const maxGames = Math.min(5, Math.max(minGames, 4));

  for (const { item } of scored) {
    if (picked.length >= maxGames) break;
    picked.push(item.title);
    currentMinutes += item.durationMinutes;
    if (currentMinutes >= targetMinutes && picked.length >= minGames) break;
  }

  return picked.length ? picked : [candidates[0]?.title || 'Vui chơi tự do theo sở thích'];
};

export default PLAYDATE_ACTIVITIES;
