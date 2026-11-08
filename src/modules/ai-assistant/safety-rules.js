/**
 * Pure safety rules for playdate activities and agendas (BUD-49 Part B).
 * Evaluates risk levels, supervision requirements, safety notes, and gear suggestions.
 */

import { HIGH_RISK_WATER_REGEX, calculateChaperoneRequirement } from '../playdate/playdate.rules.js';
import { catalogGamesNamedBy } from '../playdate/playdate.activities.js';

/**
 * Rain or a high chance of rain that day (Open-Meteo forecast)
 * @param {{ isRaining?: boolean, precipitationProbability?: number }|null} weather
 * @returns {boolean}
 */
export const isBadWeather = (weather) =>
  Boolean(weather && (weather.isRaining || (weather.precipitationProbability && weather.precipitationProbability > 50)));

const RISK_ORDER = Object.freeze({ low: 0, medium: 1, high: 2 });
// Supervision of the catalog games (playdate.activities.js) as a level: 1 usual, 2 close watch, 3 one adult per child
const CATALOG_SUPERVISION = Object.freeze({ minimal: 1, normal: 1, high_vigilance: 2, dedicated_1to1: 3 });
const SUPERVISION_TEXT = Object.freeze({
  2: 'người lớn ở gần và quan sát các bé liên tục',
  3: 'mỗi bé cần một người lớn kèm 1-1',
});

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
    regex: /làm bánh|nấu ăn|thủ công|đất nặn|kéo|dao|nến/i,
    riskLevel: 'medium',
    supervisionLevel: 2,
    note: 'Hỗ trợ trẻ khi sử dụng dụng cụ nấu nướng, kéo hoặc vật liệu thủ công.',
    items: ['Tạp dề', 'Khăn lau ướt'],
  },
  {
    regex: /dã ngoại|picnic|ngoài trời|công viên|thả diều/i,
    riskLevel: 'low',
    supervisionLevel: 1,
    note: 'Tránh hoạt động dưới nắng gắt từ 11:00 đến 14:00, bổ sung nước thường xuyên cho trẻ.',
    items: ['Mũ nón', 'Bình nước cá nhân', 'Kem chống nắng', 'Xịt chống muỗi'],
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
 * @param {Object} [input.weather]
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
} = {}) => {
  const texts = [activityTitle, ...(Array.isArray(agenda) ? agenda : [])].filter(Boolean);
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
    catalogGamesNamedBy(text).forEach((game) => {
      if (!game.riskLevel || game.riskLevel === 'low') return;
      raiseRisk(game.riskLevel);
      const level = CATALOG_SUPERVISION[game.supervisionLevel] || 1;
      if (level > maxSupervision) maxSupervision = level;
      if (!coveredByPreset(text)) {
        safetyNotes.add(`${game.title}: ${SUPERVISION_TEXT[Math.max(level, 2)]}.`);
      }
    });
  });

  // Outdoor place defaults
  if (placeType === 'park' || placeType === 'playground') {
    itemsToBring.add('Mũ nón');
    itemsToBring.add('Bình nước cá nhân');
  }

  // Weather impact: bad weather elevates outdoor risks
  const rainy = isBadWeather(weather);
  const isOutdoor = placeType === 'park' || placeType === 'playground' || /ngoài trời|công viên|dã ngoại|picnic/i.test(allTexts);
  if (rainy && isOutdoor) {
    raiseRisk('medium');
    safetyNotes.add('Thời tiết có mưa/xấu, hoạt động ngoài trời dễ trơn trượt; cân nhắc chuẩn bị ô/áo mưa hoặc chuyển vào nhà.');
    itemsToBring.add('Ô/áo mưa');
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
