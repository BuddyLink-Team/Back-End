/**
 * Pure safety rules for playdate activities and agendas (BUD-49 Part B).
 * Evaluates risk levels, supervision requirements, safety notes, and gear suggestions.
 */

export const HIGH_RISK_WATER_REGEX = /(?<!màu\s|uống\s)(bơi|tắm|hồ bơi|chơi nước|công viên nước|suối|biển)/i;

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

export const calculateChaperoneRequirement = ({ totalKids = 1, under5Count = 0, over5Count = 0, hasHighRisk = false } = {}) => {
  if (hasHighRisk) return Math.max(1, totalKids);
  return Math.max(1, Math.ceil(under5Count / 2) + Math.ceil(over5Count / 3));
};

/**
 * Evaluate safety precautions, risk level, required supervision and items to bring.
 * @param {Object} input
 * @param {string} [input.activityTitle]
 * @param {string[]} [input.agenda]
 * @param {string} [input.placeType]
 * @param {number|null} [input.youngestAge]
 * @param {number} [input.totalChildren=1]
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
  weather = null,
} = {}) => {
  const allTexts = [activityTitle, ...(Array.isArray(agenda) ? agenda : [])].join(' ');
  const safetyNotes = new Set();
  const itemsToBring = new Set();
  let maxRisk = 'low';
  let maxSupervision = 1;

  for (const preset of SAFETY_PRESETS) {
    if (preset.regex.test(allTexts)) {
      safetyNotes.add(preset.note);
      preset.items.forEach((item) => itemsToBring.add(item));
      if (preset.riskLevel === 'high') maxRisk = 'high';
      else if (preset.riskLevel === 'medium' && maxRisk !== 'high') maxRisk = 'medium';
      if (preset.supervisionLevel > maxSupervision) maxSupervision = preset.supervisionLevel;
    }
  }

  // Outdoor place defaults
  if (placeType === 'park' || placeType === 'playground') {
    itemsToBring.add('Mũ nón');
    itemsToBring.add('Bình nước cá nhân');
  }

  // Weather impact: bad weather elevates outdoor risks
  const isBadWeather = Boolean(weather && (weather.isRaining || (weather.precipitationProbability && weather.precipitationProbability > 50)));
  const isOutdoor = placeType === 'park' || placeType === 'playground' || /ngoài trời|công viên|dã ngoại|picnic/i.test(allTexts);
  if (isBadWeather && isOutdoor) {
    if (maxRisk === 'low') maxRisk = 'medium';
    safetyNotes.add('Thời tiết có mưa/xấu, hoạt động ngoài trời dễ trơn trượt; cân nhắc chuẩn bị ô/áo mưa hoặc chuyển vào nhà.');
    itemsToBring.add('Ô/áo mưa');
  }

  // Toddlers need direct supervision
  if (youngestAge !== null && youngestAge < 4) {
    if (maxSupervision < 2) maxSupervision = 2;
    safetyNotes.add('Bé nhỏ dưới 4 tuổi cần có người lớn đi kèm và quan sát liên tục.');
  }

  const hasHighRisk = maxRisk === 'high';

  // Calculate required chaperones / adult ratio
  let requiredAdults = 1;
  const count = Math.max(1, totalChildren);
  if (hasHighRisk) {
    requiredAdults = count; // 1-on-1 for high risk water activities
  } else if (youngestAge !== null && youngestAge < 4) {
    requiredAdults = Math.ceil(count / 2); // 1 adult per 2 toddlers
  } else {
    requiredAdults = Math.ceil(count / 3); // 1 adult per 3 children
  }

  return {
    riskLevel: maxRisk,
    supervisionLevel: maxSupervision,
    hasHighRisk,
    safetyNotes: [...safetyNotes],
    itemsToBring: [...itemsToBring],
    requiredAdults,
  };
};
