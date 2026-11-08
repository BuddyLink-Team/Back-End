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
  { title: 'Trò chơi chuyền bóng và vận động nhẹ', minAge: 2, maxAge: 12, tags: ['thể thao', 'vận động', 'bóng đá'], defaultMinutes: 20, riskLevel: 'low', supervisionLevel: 'normal', placeTypes: ['park', 'playground', 'sports_center', 'kids_cafe'] },
  { title: 'Thi xếp hình sáng tạo', minAge: 3, maxAge: 12, tags: ['lego', 'xếp hình', 'lắp ráp'], defaultMinutes: 25, riskLevel: 'low', supervisionLevel: 'minimal', placeTypes: ['kids_cafe', 'library', 'workshop', 'home'] },
  { title: 'Vẽ tranh sắc màu theo chủ đề', minAge: 2, maxAge: 14, tags: ['vẽ', 'hội họa', 'thủ công'], defaultMinutes: 25, riskLevel: 'low', supervisionLevel: 'minimal', placeTypes: ['park', 'workshop', 'library', 'kids_cafe', 'home'] },
  { title: 'Đố vui tương tác và kể chuyện cùng bạn', minAge: 3, maxAge: 14, tags: ['đọc sách', 'truyện', 'thư viện'], defaultMinutes: 20, riskLevel: 'low', supervisionLevel: 'minimal', placeTypes: ['library', 'kids_cafe', 'park', 'home'] },
  { title: 'Chơi cầu trượt và nhà bóng', minAge: 1, maxAge: 8, tags: ['sân chơi', 'cầu trượt', 'kids cafe'], defaultMinutes: 25, riskLevel: 'medium', supervisionLevel: 'normal', placeTypes: ['playground', 'kids_cafe', 'park'] },
  { title: 'Thử thách Board game đồng đội', minAge: 5, maxAge: 16, tags: ['board game', 'cờ vua'], defaultMinutes: 30, riskLevel: 'low', supervisionLevel: 'minimal', placeTypes: ['kids_cafe', 'library', 'home'] },
  { title: 'Đua xe đạp mini / patin tự do', minAge: 4, maxAge: 16, tags: ['đạp xe', 'patin'], defaultMinutes: 25, riskLevel: 'medium', supervisionLevel: 'normal', placeTypes: ['park', 'sports_center'] },
  { title: 'Khám phá thiên nhiên và tìm đồ vật', minAge: 3, maxAge: 14, tags: ['dã ngoại', 'ngoài trời'], defaultMinutes: 25, riskLevel: 'low', supervisionLevel: 'normal', placeTypes: ['park', 'playground'] },
]);

// Minutes of one game: shorter for young children (they switch more often)
const GAME_MINUTES_BY_AGE = Object.freeze([
  { underAge: 4, minutes: 12, maxMinutes: 20 },
  { underAge: 8, minutes: 15, maxMinutes: 30 },
  { underAge: Infinity, minutes: 20, maxMinutes: 45 },
]);
// Part of the playdate left for games (the rest: arriving, snacks, breaks)
const PLAY_SHARE = 0.85;
const AGENDA_MIN_GAMES = 2;
const AGENDA_MAX_GAMES = 5;

/**
 * Usual length of one game, and the longest one, for the youngest child
 * @param {number|null} youngestAge
 * @returns {{ minutes: number, maxMinutes: number }}
 */
export const gameMinutesFor = (youngestAge) =>
  GAME_MINUTES_BY_AGE.find((band) => youngestAge === null || youngestAge === undefined ? band.underAge === 8 : youngestAge < band.underAge);

/**
 * How many games fit a playdate (BUD-49 A2): the play time (about 85% of the playdate) divided by the length
 * of a game for the youngest child, as a range of one game. A 1-hour playdate of 5-year-olds: 3-4 games.
 * @param {{ durationMinutes?: number, youngestAge?: number|null }} input
 * @returns {{ min: number, max: number }}
 */
export const agendaSizeFor = ({ durationMinutes = 60, youngestAge = null } = {}) => {
  const playMinutes = Math.max(30, Math.round(durationMinutes * PLAY_SHARE));
  const { minutes } = gameMinutesFor(youngestAge);
  const max = Math.min(AGENDA_MAX_GAMES, Math.max(AGENDA_MIN_GAMES, Math.ceil(playMinutes / minutes)));
  return { min: Math.max(AGENDA_MIN_GAMES, max - 1), max };
};

// Accent free, lower case, words only: "Vẽ tranh màu nước" -> "ve tranh mau nuoc"
export const normalizeText = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Words of every activity name that tell nothing about the game itself
const AGENDA_STOP_WORDS = new Set(['choi', 'cung', 'cac', 'be', 'va', 'tai', 'o', 'tro', 'voi', 'cho', 'nhau', 'ban', 'buoi', 'theo', 'mot', 'nhung', 'the', 'cua']);

const meaningfulWords = (text) => normalizeText(text).split(' ').filter((word) => word.length >= 2 && !AGENDA_STOP_WORDS.has(word));

/**
 * Whether a text names this game of the catalog or of a place: it contains one of its tags or its whole
 * name, or shares at least two meaningful words with its name
 * @param {string} text
 * @param {{ title?: string, name?: string, key?: string, tags?: string[] }} reference
 * @returns {boolean}
 */
export const namesGame = (text, reference) => {
  const padded = ` ${normalizeText(text)} `;
  const words = new Set(meaningfulWords(text));
  if (!words.size) return false;
  const phrases = [reference.title, reference.name, reference.key, ...(reference.tags || [])].map(normalizeText).filter(Boolean);
  if (phrases.some((phrase) => padded.includes(` ${phrase} `))) return true;
  const nameWords = meaningfulWords(reference.title || reference.name || reference.key || '');
  const shared = nameWords.filter((word) => words.has(word)).length;
  return shared > 0 && shared >= Math.min(2, nameWords.length);
};

/**
 * Whether an agenda item written by the model is a known game (BUD-49 A6): the model may reword a game
 * ("Vẽ tranh màu nước" for "Buổi vẽ tranh sáng tạo"), not invent one
 * @param {string} item
 * @param {Array<Object>} references - Catalog games and the place's attractions
 * @returns {boolean}
 */
export const isKnownAgendaItem = (item, references = []) => references.some((reference) => namesGame(item, reference));

/**
 * Games of the catalog named by a text (activity title or agenda item), for their risk and supervision
 * @param {string} text
 * @returns {Array<Object>}
 */
export const catalogGamesNamedBy = (text) => [...PLAYDATE_ACTIVITIES, ...GENERIC_GAMES].filter((game) => namesGame(text, game));

/**
 * Games for a playdate (BUD-49 A2, A3): the place's real attractions when known, else the generic games
 * that can be played at this type of place; age-appropriate, the most shared interests first, as many as
 * fit the playdate (agendaSizeFor), each one shorter for young children.
 * @param {Object} input
 * @param {Array<{ age?: number|null, interests?: string[], favoriteActivities?: string[] }>} [input.children]
 * @param {number[]} [input.childAges] - When the children are not known
 * @param {number} [input.durationMinutes=60]
 * @param {Array<{ title: string, minAge?: number, maxAge?: number, durationMinutes?: number }>} [input.availableAttractions]
 * @param {string|null} [input.placeType] - Generic games of this place type only
 * @returns {string[]}
 */
export const pickAttractions = ({
  children = [],
  childAges = [],
  durationMinutes = 60,
  availableAttractions = [],
  attractions = [],
  placeType = null,
} = {}) => {
  const effectiveChildren = children.length > 0
    ? children
    : (childAges || []).map((age) => ({ age: typeof age === 'number' ? age : Number(age) }));
  const effectiveAttractions = availableAttractions.length > 0 ? availableAttractions : attractions;

  const ages = effectiveChildren.map((c) => c.age).filter((age) => typeof age === 'number' && !Number.isNaN(age));
  const youngestAge = ages.length ? Math.min(...ages) : null;
  const oldestAge = ages.length ? Math.max(...ages) : null;

  const playMinutes = Math.max(30, Math.round(durationMinutes * PLAY_SHARE));
  const { minutes: itemDuration, maxMinutes } = gameMinutesFor(youngestAge);
  const size = agendaSizeFor({ durationMinutes, youngestAge });

  // Collect all interest/activity tags of the children
  const allTags = effectiveChildren.flatMap((c) => [...(c.interests || []), ...(c.favoriteActivities || [])].map((t) => String(t).toLowerCase()));

  const generic = GENERIC_GAMES.filter((game) => !placeType || !game.placeTypes?.length || game.placeTypes.includes(placeType));
  const candidates = effectiveAttractions.length > 0
    ? effectiveAttractions.map((a) => ({
        title: a.title || a.name,
        minAge: a.minAge ?? 0,
        maxAge: a.maxAge ?? 18,
        durationMinutes: Math.min(a.durationMinutes || itemDuration, maxMinutes),
      }))
    : (generic.length ? generic : GENERIC_GAMES).map((g) => ({
        ...g,
        durationMinutes: Math.min(g.defaultMinutes || itemDuration, maxMinutes),
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
  for (const { item } of scored) {
    if (picked.length >= size.max) break;
    picked.push(item.title);
    currentMinutes += item.durationMinutes;
    if (currentMinutes >= playMinutes && picked.length >= size.min) break;
  }

  return picked.length ? picked : [candidates[0]?.title || 'Vui chơi tự do theo sở thích'];
};

export default PLAYDATE_ACTIVITIES;
