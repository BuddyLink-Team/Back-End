import { describe, it, expect, jest, afterEach } from '@jest/globals';
import axios from 'axios';
import openMeteoAdapter from '../../src/integrations/weather/open-meteo.adapter.js';
import { evaluateSafetyRules } from '../../src/modules/ai-assistant/safety-rules.js';
import { emptyDraft, refreshDraft, evaluateDraftWarnings, safetyContextKey } from '../../src/modules/ai-assistant/plan-draft.rules.js';

afterEach(() => {
  jest.restoreAllMocks();
});

const rain = { isRaining: true, precipitationProbability: 80, maxTemp: 27, scope: 'slot' };
const hot = { isRaining: false, precipitationProbability: 0, maxTemp: 37, scope: 'slot' };
const mild = { isRaining: false, precipitationProbability: 10, maxTemp: 29, scope: 'slot' };

describe('safety notes and items follow the place, the weather and the hours', () => {
  it('rain outdoors: rain gear and a covered fallback, nothing for the sun', () => {
    const safety = evaluateSafetyRules({ activityTitle: 'Dã ngoại công viên', agenda: ['Thả diều'], placeType: 'park', weather: rain, time: '09:00', durationMinutes: 90 });
    expect(safety.itemsToBring).toEqual(expect.arrayContaining(['Ô/áo mưa', 'Quần áo khô dự phòng']));
    expect(safety.itemsToBring).not.toContain('Kem chống nắng');
    expect(safety.itemsToBring).not.toContain('Mũ nón');
    expect(safety.safetyNotes.join(' ')).toContain('Dự báo có mưa vào giờ chơi');
    expect(safety.safetyNotes.join(' ')).not.toContain('nắng gắt');
    expect(safety.riskLevel).toBe('medium');
  });

  it('heat at a park is noted even when no game names the park', () => {
    const safety = evaluateSafetyRules({ activityTitle: 'Chơi đuổi bắt', agenda: ['Trốn tìm'], placeType: 'park', weather: hot, time: '09:30', durationMinutes: 60 });
    expect(safety.safetyNotes.join(' ')).toContain('37°C');
    expect(safety.itemsToBring).toEqual(expect.arrayContaining(['Mũ nón', 'Kem chống nắng', 'Bình nước cá nhân']));
  });

  it('the harsh sun note only when the playdate covers 11:00-14:00', () => {
    const noon = evaluateSafetyRules({ activityTitle: 'Chơi đuổi bắt', placeType: 'playground', weather: mild, time: '10:30', durationMinutes: 90 });
    expect(noon.safetyNotes.join(' ')).toContain('11:00–14:00');
    const late = evaluateSafetyRules({ activityTitle: 'Chơi đuổi bắt', placeType: 'playground', weather: mild, time: '16:30', durationMinutes: 60 });
    expect(late.safetyNotes.join(' ')).not.toContain('nắng gắt');
    expect(late.itemsToBring).not.toContain('Kem chống nắng');
    expect(late.itemsToBring).toContain('Xịt chống muỗi');
  });

  it('the chosen place decides, not the words of the activity', () => {
    const atHome = evaluateSafetyRules({ activityTitle: 'Picnic công viên', agenda: ['Ăn nhẹ'], placeType: 'home', weather: mild, time: '10:00' });
    expect(atHome.itemsToBring).toEqual([]);
    expect(atHome.safetyNotes).toEqual([]);
    const indoorRain = evaluateSafetyRules({ activityTitle: 'Xếp Lego', placeType: 'kids_cafe', weather: rain, time: '10:00' });
    expect(indoorRain.itemsToBring).toEqual(['Ô/áo mưa khi di chuyển']);
    expect(indoorRain.riskLevel).toBe('low');
  });

  it('"kéo co" is not scissors, and a park picnic is not cycling', () => {
    const tug = evaluateSafetyRules({ activityTitle: 'Vận động', agenda: ['Kéo co'], placeType: 'playground', time: '09:00' });
    expect(tug.itemsToBring).not.toContain('Tạp dề');
    expect(tug.safetyNotes.join(' ')).not.toContain('nấu nướng');
    const picnic = evaluateSafetyRules({ activityTitle: 'Dã ngoại công viên', placeType: 'park', time: '09:00' });
    expect(picnic.safetyNotes.join(' ')).not.toContain('Đạp xe');
    const crafts = evaluateSafetyRules({ activityTitle: 'Cắt dán thủ công', placeType: 'workshop' });
    expect(crafts.itemsToBring).toContain('Tạp dề');
  });

  it('the name of the place in a sourced agenda item is not an activity', () => {
    const safety = evaluateSafetyRules({
      activityTitle: 'Vẽ tranh',
      agenda: ['Theo thông tin trên mạng về Khu vui chơi Biển Xanh: Tô tượng (https://example.com/bien-xanh)'],
      placeType: 'kids_cafe',
    });
    expect(safety.hasHighRisk).toBe(false);
    expect(safety.itemsToBring).not.toContain('Áo phao');
    // A water game stays high risk
    const pool = evaluateSafetyRules({ activityTitle: 'Vui chơi', agenda: ['Theo thông tin trên mạng về TiNi: Chơi nước ở hồ bơi mini (https://example.com/tini)'] });
    expect(pool.hasHighRisk).toBe(true);
  });
});

describe('draft: notes of the model and the rain warning', () => {
  const planned = () => ({
    ...emptyDraft(),
    hostChild: { childId: 'c1', displayName: 'Bin', age: 6, interests: [] },
    hostChildren: [{ childId: 'c1', displayName: 'Bin', age: 6, interests: [] }],
    date: '2099-03-01',
    time: '09:00',
    activity: { key: 'swim', title: 'Bơi lội', placeTypes: ['sports_center'] },
    location: { name: 'Hồ bơi A', placeType: 'sports_center' },
  });

  it('drops what the model added once the activity or the place changes', () => {
    const draft = planned();
    draft.extraSafetyNotes = ['Bé chưa biết bơi cần phao tay'];
    draft.extraItemsToBring = ['Phao tay', 'Áo phao'];
    draft._extraSafetyKey = safetyContextKey(draft);
    refreshDraft(draft, new Date('2099-01-01'));
    expect(draft.safetyNotes).toContain('Bé chưa biết bơi cần phao tay');
    // Already a rule-based item: listed once
    expect(draft.itemsToBring.filter((item) => item === 'Áo phao')).toHaveLength(1);
    expect(draft.itemsToBring).toContain('Phao tay');

    draft.activity = { key: 'lego', title: 'Xếp Lego', placeTypes: ['kids_cafe'] };
    draft.location = { name: 'Kids Cafe B', placeType: 'kids_cafe' };
    refreshDraft(draft, new Date('2099-01-01'));
    expect(draft.safetyNotes).not.toContain('Bé chưa biết bơi cần phao tay');
    expect(draft.itemsToBring).not.toContain('Phao tay');
  });

  it('warns about rain at an outdoor place only', () => {
    const codes = (placeType) =>
      evaluateDraftWarnings({ ...planned(), location: { name: 'X', placeType } }, { now: new Date('2099-01-01'), weather: rain }).map((warning) => warning.code);
    expect(codes('park')).toContain('BAD_WEATHER');
    expect(codes('kids_cafe')).not.toContain('BAD_WEATHER');
    expect(codes('home')).not.toContain('BAD_WEATHER');
  });
});

describe('openMeteoAdapter: forecast of the playdate hours', () => {
  const hours = (date) => Array.from({ length: 24 }, (_, hour) => `${date}T${String(hour).padStart(2, '0')}:00`);
  const data = {
    daily: { time: ['2099-05-01'], weather_code: [95], precipitation_probability_max: [90], temperature_2m_max: [35] },
    hourly: {
      time: hours('2099-05-01'),
      // A storm at 03:00 only
      weather_code: hours('').map((_, hour) => (hour === 3 ? 95 : 1)),
      precipitation_probability: hours('').map((_, hour) => (hour === 3 ? 90 : 5)),
      temperature_2m: hours('').map((_, hour) => (hour === 14 ? 35 : 28)),
    },
  };

  it('a night storm is not rain at 9 a.m., and the day forecast is kept without a time', async () => {
    jest.spyOn(axios, 'get').mockResolvedValue({ data });
    const slot = await openMeteoAdapter.getDailyWeather(41.5, 108.2, '2099-05-01', { time: '09:00', durationMinutes: 90 });
    expect(slot).toEqual({ isRaining: false, precipitationProbability: 5, weatherCode: 1, maxTemp: 28, scope: 'slot' });
    const night = await openMeteoAdapter.getDailyWeather(41.5, 108.2, '2099-05-01', { time: '02:30', durationMinutes: 60 });
    expect(night.isRaining).toBe(true);
    const day = await openMeteoAdapter.getDailyWeather(41.5, 108.2, '2099-05-01');
    expect(day).toEqual({ isRaining: true, precipitationProbability: 90, weatherCode: 95, maxTemp: 35 });
  });
});
