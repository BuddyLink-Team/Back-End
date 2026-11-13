/**
 * Pure safety rules for playdate activities and agendas (BUD-49 Part B).
 * Evaluates risk levels, supervision requirements, safety notes, and gear suggestions.
 */

import { HIGH_RISK_WATER_REGEX, calculateChaperoneRequirement } from '../playdate/playdate.rules.js';
import { catalogGamesNamedBy } from '../playdate/playdate.activities.js';
import { OUTDOOR_PLACE_TYPES, INDOOR_PLACE_TYPES } from '../playdate/playdate.constants.js';

/**
 * Rain or a high chance of rain at the playdate (Open-Meteo forecast of its time slot, else of the day)
 * @param {{ isRaining?: boolean, precipitationProbability?: number }|null} weather
 * @returns {boolean}
 */
export const isBadWeather = (weather) =>
  Boolean(weather && (weather.isRaining || (weather.precipitationProbability && weather.precipitationProbability > 50)));

/**
 * Whether a place is under a roof (the rain only matters on the way there)
 * @param {string|null} placeType
 * @returns {boolean}
 */
export const isIndoorPlace = (placeType) => INDOOR_PLACE_TYPES.includes(placeType) || placeType === 'home';

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 });
// Supervision of the catalog games (playdate.activities.js) as a level: 1 usual, 2 close watch, 3 one adult per child
const CATALOG_SUPERVISION = Object.freeze({ minimal: 1, normal: 1, high_vigilance: 2, dedicated_1to1: 3 });
const SUPERVISION_TEXT = Object.freeze({
  2: 'người lớn ở gần và quan sát các bé liên tục',
  3: 'mỗi bé cần một người lớn kèm 1-1',
});

// Open-air activities, read from the text only when the type of the place does not tell
const OUTDOOR_TEXT_REGEX = /dã ngoại|picnic|ngoài trời|công viên(?! nước)|thả diều|cắm trại/i;
const GREEN_AREA_TEXT_REGEX = /dã ngoại|picnic|công viên(?! nước)|cắm trại/i;
// Place words shared by many catalog games: alone they do not name a game ("Dã ngoại công viên" is not cycling)
const PLACE_WORDS_REGEX = /công viên(?! nước)|sân chơi|khu vui chơi|thư viện|ngoài trời|trong nhà/gi;
// "Theo thông tin trên mạng về {place}: {game} ({link})" (plan-draft.rules.js): only the game is an activity
const SOURCED_ITEM_REGEX = /^Theo thông tin trên mạng về\s.*?:\s+/i;
const SOURCE_LINK_REGEX = /\s*\(https?:\/\/[^)]*\)\s*$/i;

const WEATHER_RULES = Object.freeze({
  HOT_TEMP: 33,
  COLD_TEMP: 20,
  SUN_FROM: '09:00',
  SUN_TO: '16:00',
  HARSH_SUN_FROM: '11:00',
  HARSH_SUN_TO: '14:00',
  EVENING_FROM: '16:00',
  DARK_AFTER: '18:00',
});

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * The game of an agenda item, without the name of the place and the link of its source
 * @param {string} text
 * @returns {string}
 */
export const activityTextOf = (text) =>
  String(text || '').replace(SOURCE_LINK_REGEX, '').replace(SOURCED_ITEM_REGEX, '').trim();

/**
 * Whether the playdate is in the open air: the type of the chosen place decides, the words of the activity
 * only when the place does not tell (no place yet, a sports center)
 * @param {string} placeType
 * @param {string} allTexts
 * @returns {boolean}
 */
const isOutdoorPlaydate = (placeType, allTexts) => {
  if (OUTDOOR_PLACE_TYPES.includes(placeType)) return true;
  if (isIndoorPlace(placeType)) return false;
  return OUTDOOR_TEXT_REGEX.test(allTexts);
};

const SAFETY_PRESETS = Object.freeze([
  {
    regex: HIGH_RISK_WATER_REGEX,
    riskLevel: 'high',
    supervisionLevel: 3,
    note: 'Luôn giám sát trực tiếp 1-1 khi trẻ gần khu vực nước, mặc áo phao đạt chuẩn.',
    items: ['Áo phao', 'Kính bơi', 'Khăn tắm', 'Quần áo khô dự phòng'],
  },
  {
    regex: /patin|xe đạp|đạp xe|scooter|trượt ván/i,
    riskLevel: 'medium',
    supervisionLevel: 2,
    note: 'Bắt buộc trang bị mũ bảo hiểm đạt chuẩn, miếng bảo hộ đầu gối và khuỷu tay.',
    items: ['Mũ bảo hiểm', 'Bảo vệ đầu gối và khuỷu tay'],
  },
  {
    regex: /leo núi|bạt nhún|trampoline|cầu trượt cao|nhảy bạt/i,
    riskLevel: 'medium',
    supervisionLevel: 2,
    note: 'Kiểm tra kỹ đệm an toàn và hướng dẫn trẻ tránh va chạm khi chơi bạt nhún / leo trèo.',
    items: ['Tất chống trượt', 'Quần áo co giãn'],
  },
  {
    // "kéo co" is a game, not scissors: only the tool itself counts
    regex: /làm bánh|nấu ăn|thủ công|đất nặn|cắt dán|cây kéo|dùng kéo|(?:^|\s)dao(?=\s|$|[.,;])|nến/i,
    riskLevel: 'medium',
    supervisionLevel: 2,
    note: 'Hỗ trợ trẻ khi sử dụng dụng cụ nấu nướng, kéo hoặc vật liệu thủ công.',
    items: ['Tạp dề', 'Khăn lau ướt'],
  },
]);

/**
 * Evaluate safety precautions, risk level, required supervision and items to bring.
 * @param {Object} input
 * @param {string} [input.activityTitle]
 * @param {string[]} [input.agenda]
 * @param {string} [input.placeType]
 * @param {number|null} [input.youngestAge]
 * @param {number} [input.totalChildren=1]
 * @param {number[]} [input.childAges] - Ages of every child (adults needed: 1 per 2 under 5, 1 per 3 older)
 * @param {{ isRaining?: boolean, precipitationProbability?: number, maxTemp?: number|null, scope?: 'slot'|'day' }} [input.weather]
 * @param {string|null} [input.time] - Start "HH:mm": sun, heat and dark notes follow the hours of the playdate
 * @param {number} [input.durationMinutes=60]
 * @returns {{
 *   riskLevel: 'low'|'medium'|'high',
 *   supervisionLevel: 1|2|3,
 *   hasHighRisk: boolean,
 *   safetyNotes: string[],
 *   itemsToBring: string[],
 *   requiredAdults: number
 * }}
 */
export const evaluateSafetyRules = ({
  activityTitle = '',
  agenda = [],
  placeType = '',
  youngestAge = null,
  totalChildren = 1,
  childAges = [],
  weather = null,
  time = null,
  durationMinutes = 60,
} = {}) => {
  const texts = [activityTitle, ...(Array.isArray(agenda) ? agenda : [])].map(activityTextOf).filter(Boolean);
  const allTexts = texts.join(' ');
  const safetyNotes = new Set();
  const itemsToBring = new Set();
  let maxRisk = 'low';
  let maxSupervision = 1;
  const raiseRisk = (risk) => {
    if (RISK_ORDER[risk] > RISK_ORDER[maxRisk]) maxRisk = risk;
  };

  for (const preset of SAFETY_PRESETS) {
    if (preset.regex.test(allTexts)) {
      safetyNotes.add(preset.note);
      preset.items.forEach((item) => itemsToBring.add(item));
      raiseRisk(preset.riskLevel);
      if (preset.supervisionLevel > maxSupervision) maxSupervision = preset.supervisionLevel;
    }
  }

  // Risk and supervision of the catalog games named by the activity or the agenda (B1): a risky game without
  // a keyword rule above still gets its note
  const coveredByPreset = (text) => SAFETY_PRESETS.some((preset) => preset.riskLevel !== 'low' && preset.regex.test(text));
  texts.forEach((text) => {
    catalogGamesNamedBy(text.replace(PLACE_WORDS_REGEX, ' ')).forEach((game) => {
      if (!game.riskLevel || game.riskLevel === 'low') return;
      raiseRisk(game.riskLevel);
      const level = CATALOG_SUPERVISION[game.supervisionLevel] || 1;
      if (level > maxSupervision) maxSupervision = level;
      if (!coveredByPreset(text)) {
        safetyNotes.add(`${game.title}: ${SUPERVISION_TEXT[Math.max(level, 2)]}.`);
      }
    });
  });

  // Weather and time of day: what the children need depends on where the playdate is, the forecast of its
  // time slot (or of the day) and the hours it covers
  const rainy = isBadWeather(weather);
  const isOutdoor = isOutdoorPlaydate(placeType, allTexts);
  const hasTime = TIME_REGEX.test(String(time || ''));
  const start = hasTime ? toMinutes(time) : null;
  const end = hasTime ? start + (durationMinutes || 60) : null;
  const covers = (from, to) => !hasTime || (start < toMinutes(to) && end > toMinutes(from));
  const temperature = Number.isFinite(weather?.maxTemp) ? Math.round(weather.maxTemp) : null;

  if (isOutdoor) {
    itemsToBring.add('Bình nước cá nhân');
    if (rainy) {
      raiseRisk('medium');
      const chance = weather.precipitationProbability ? ` (khả năng ${Math.round(weather.precipitationProbability)}%)` : '';
      const when = weather.scope === 'slot' ? 'vào giờ chơi' : 'trong ngày';
      safetyNotes.add(
        `Dự báo có mưa ${when}${chance}: sân bãi dễ trơn trượt, nên có phương án chuyển vào chỗ có mái che hoặc trong nhà.`
      );
      ['Ô/áo mưa', 'Quần áo khô dự phòng', 'Giày dép chống trượt'].forEach((item) => itemsToBring.add(item));
    } else {
      const inSun = covers(WEATHER_RULES.SUN_FROM, WEATHER_RULES.SUN_TO);
      if (inSun) {
        itemsToBring.add('Mũ nón');
        itemsToBring.add('Kem chống nắng');
      }
      if (inSun && temperature !== null && temperature >= WEATHER_RULES.HOT_TEMP) {
        safetyNotes.add(
          `Dự báo nắng nóng khoảng ${temperature}°C: cho bé uống nước thường xuyên và nghỉ trong bóng râm sau mỗi 20–30 phút vận động.`
        );
        itemsToBring.add('Khăn lau mồ hôi');
      }
      if (!hasTime) {
        safetyNotes.add('Tránh hoạt động dưới nắng gắt từ 11:00 đến 14:00, bổ sung nước thường xuyên cho trẻ.');
      } else if (covers(WEATHER_RULES.HARSH_SUN_FROM, WEATHER_RULES.HARSH_SUN_TO)) {
        safetyNotes.add('Buổi chơi trùng khung nắng gắt 11:00–14:00: ưu tiên chỗ có bóng râm, đội mũ và bôi kem chống nắng cho bé.');
      }
    }
    if (hasTime && end > toMinutes(WEATHER_RULES.DARK_AFTER)) {
      safetyNotes.add('Buổi chơi kết thúc khi trời đã tối: chọn khu vực đủ ánh sáng và luôn giữ các bé trong tầm mắt.');
    }
    // Mosquitoes: green areas, and any open-air place late in the afternoon
    if (placeType === 'park' || GREEN_AREA_TEXT_REGEX.test(allTexts) || (hasTime && end > toMinutes(WEATHER_RULES.EVENING_FROM))) {
      itemsToBring.add('Xịt chống muỗi');
    }
    if (temperature !== null && temperature <= WEATHER_RULES.COLD_TEMP) {
      itemsToBring.add('Áo khoác ấm');
    }
  } else if (rainy) {
    // Indoors the rain only matters on the way there
    itemsToBring.add('Ô/áo mưa khi di chuyển');
  }

  // Toddlers need direct supervision
  if (youngestAge !== null && youngestAge < 4) {
    if (maxSupervision < 2) maxSupervision = 2;
    safetyNotes.add('Bé nhỏ dưới 4 tuổi cần có người lớn đi kèm và quan sát liên tục.');
  }

  const hasHighRisk = maxRisk === 'high';
  // The supervision the playdate needs, written in the note when it is more than the usual (B1)
  if (maxSupervision >= 2) safetyNotes.add(`Mức giám sát cần thiết: ${SUPERVISION_TEXT[maxSupervision]}.`);

  // Adults coming with the children: the same rule as the chaperones of the group chat (B5)
  const ages = childAges.filter((age) => typeof age === 'number' && !Number.isNaN(age));
  const count = Math.max(1, totalChildren, ages.length);
  const under5Count = ages.length ? ages.filter((age) => age < 5).length : youngestAge !== null && youngestAge < 5 ? count : 0;
  const requiredAdults = calculateChaperoneRequirement({
    totalKids: count,
    under5Count,
    over5Count: count - under5Count,
    hasHighRisk,
  });

  return {
    riskLevel: maxRisk,
    supervisionLevel: maxSupervision,
    hasHighRisk,
    safetyNotes: [...safetyNotes],
    itemsToBring: [...itemsToBring],
    requiredAdults,
  };
};
