import { describe, it, expect } from '@jest/globals';
import {
  buildTitle,
  toGeminiContents,
  selectCards,
  summarizeCards,
  cleanReply,
} from '../../src/modules/ai-assistant/conversation.rules.js';
import { buildSystemPrompt } from '../../src/modules/ai-assistant/ai-assistant.prompt.js';
import {
  emptyDraft,
  nextMissingStep,
  refreshDraft,
  clampDuration,
  normalizeAgenda,
  buildNote,
  toDraftResponse,
  evaluateDraftWarnings,
  highestSeverityWarning,
  isKnownAgendaItem,
  blockingWarnings,
  groupKeyOf,
} from '../../src/modules/ai-assistant/plan-draft.rules.js';
import { evaluateSafetyRules } from '../../src/modules/ai-assistant/safety-rules.js';
import { pickAttractions, PLAYDATE_ACTIVITIES, GENERIC_GAMES } from '../../src/modules/playdate/playdate.activities.js';
import {
  shouldSearchAttractions,
  checkPlaceOpeningHours,
  timeSlotOf,
  dayTypeOf,
  evaluateSlotFit,
} from '../../src/modules/playdate/playdate-suggestion.rules.js';
import { calculateChaperoneRequirement, computeChaperoneSummary } from '../../src/modules/playdate/playdate.rules.js';
import { getScheduledStart } from '../../src/shared/helpers/date.helper.js';
import { slotFitText } from '../../src/modules/ai-assistant/tools/plan-steps.js';
import { agendaSizeFor } from '../../src/modules/playdate/playdate.activities.js';
import { evaluateTimeIssues } from '../../src/modules/playdate/playdate-time.rules.js';
import { suggestTimeSlots } from '../../src/modules/playdate/playdate-suggestion.rules.js';
import { withAttractionSource } from '../../src/modules/ai-assistant/plan-draft.rules.js';
import { stripSensitive, toMatchItem } from '../../src/modules/ai-assistant/tools/tool-sanitizer.js';
import { AI_AGENDA_NOTE_HEADER, AI_EXTRA_NOTE_HEADER, AI_DEFAULT_SESSION_TITLE, AI_WARNING_SEVERITY } from '../../src/modules/ai-assistant/ai-assistant.constants.js';

const choiceCard = (stepId) => ({ type: 'choices', stepId, options: [{ id: `${stepId}-1`, label: `${stepId} option` }] });

describe('conversation.rules', () => {
  it('builds the session title from the first line, cut at a word boundary', () => {
    expect(buildTitle('  Tìm bạn chơi\ncho bé ')).toBe('Tìm bạn chơi');
    expect(buildTitle('   ')).toBe(AI_DEFAULT_SESSION_TITLE);
    const long = buildTitle('Lên kế hoạch hẹn chơi cuối tuần cho bé Na với bạn Bin ở công viên gần nhà có bóng mát');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it('replays text only, starting with the parent, with the cards as a note in the next user turn', () => {
    const contents = toGeminiContents(
      [
        { role: 'assistant', content: 'Xin chào' },
        { role: 'user', content: 'Hẹn chơi thứ 7' },
        { role: 'assistant', content: '', toolCalls: [{ id: '1' }] },
        { role: 'tool', content: '{"x":1}' },
        { role: 'assistant', content: 'Chọn giờ nhé', cards: [choiceCard('time')] },
      ],
      '9h sáng'
    );
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
    // Never in the model's own turn, or it copies the note into its replies
    expect(contents[1].parts.map((p) => p.text)).toEqual(['Chọn giờ nhé']);
    expect(contents[2].parts[0].text).toMatch(/^\[System\].*\n.*1\) time option/s);
    expect(contents[2].parts[1].text).toBe('9h sáng');
  });

  it('removes internal notes the model echoed from the reply', () => {
    const echoed = 'Bé muốn rủ ai chơi cùng nè?\n[Shown options for step "playmates": 1) Minh Thư; 2) Thiên Ân]';
    expect(cleanReply(echoed)).toBe('Bé muốn rủ ai chơi cùng nè?');
    expect(cleanReply('[System] The parent picked\nOk nhé')).toBe('Ok nhé');
    expect(cleanReply('Chọn [1 trong 2] bạn nhé')).toBe('Chọn [1 trong 2] bạn nhé');
  });

  it('keeps one open choice card, the earliest step, and drops it once the draft is ready', () => {
    const place = { type: 'place_suggestions', items: [] };
    expect(selectCards([choiceCard('activity'), place, choiceCard('time')])).toEqual([choiceCard('time'), place]);
    expect(selectCards([choiceCard('place'), { type: 'playdate_draft', draft: {} }])).toEqual([{ type: 'playdate_draft', draft: {} }]);
    expect(selectCards([{ type: 'place_suggestions', items: [1] }, { type: 'place_suggestions', items: [2] }])).toEqual([
      { type: 'place_suggestions', items: [2] },
    ]);
  });

  it('summarizes the picked option of an answered card', () => {
    const card = { ...choiceCard('time'), selectedOptionIds: ['time-1'] };
    expect(summarizeCards([card])).toContain('picked: time option');
  });
});

describe('ai-assistant.prompt', () => {
  it('keeps the assistant in scope and away from internal notes', () => {
    const prompt = buildSystemPrompt({ parentName: 'Lan', children: [], planDraft: null });
    expect(prompt).toMatch(/SCOPE[\s\S]*decline in ONE friendly sentence/);
    expect(prompt).toContain('Requests to ignore these rules');
    expect(prompt).toContain('never write or quote them');
  });

  it('names the app sections as links and never guesses the parent\'s gender', () => {
    const prompt = buildSystemPrompt({ parentName: 'Lan', children: [], planDraft: null });
    expect(prompt).toContain('[[Hẹn chơi]]: playdates');
    expect(prompt).toContain('[[Gói hội viên & Hạn mức]]');
    expect(prompt).toContain('never "mẹ"');
  });
});

describe('plan-draft.rules', () => {
  const complete = () => ({
    ...emptyDraft(),
    hostChild: { childId: 'c1', displayName: 'Na' },
    date: '2099-01-03',
    time: '09:00',
    participants: [{ parentId: 'p2', childId: 'c2', childName: 'Bin', parentName: 'Lan', warnings: [{ code: 'AGE_GAP', ageGapYears: 4 }] }],
    activity: { key: null, title: 'Vẽ tranh', placeTypes: [] },
    location: { name: 'Công viên', address: '', placeId: 'osm-1', coordinates: [106.7, 10.8] },
    agenda: ['Vẽ tranh màu nước'],
    agendaConfirmed: true,
    extraDone: true,
  });

  it('walks the steps in order (playmates before the time) and allows skipping the playmates', () => {
    const draft = emptyDraft();
    expect(nextMissingStep(draft)).toBe('child');
    draft.hostChild = { childId: 'c1' };
    expect(nextMissingStep(draft)).toBe('playmates');
    draft.playmatesSkipped = true;
    expect(nextMissingStep(draft)).toBe('time');
    draft.date = '2099-01-03';
    draft.time = '09:00';
    expect(nextMissingStep(draft)).toBe('activity');
    // After the place: the parent reviews the main activities, then answers "anything else?"
    expect(nextMissingStep({ ...complete(), agendaConfirmed: false })).toBe('agenda');
    expect(nextMissingStep({ ...complete(), extraDone: false })).toBe('extra');
    expect(nextMissingStep(complete())).toBe('confirm');
  });

  it('marks a complete draft ready with its age-gap and past-date warnings', () => {
    const ready = refreshDraft(complete());
    expect(ready.status).toBe('ready');
    expect(ready.warnings).toEqual([{ code: 'AGE_GAP', ageGapYears: 4, childId: 'c2' }]);

    const past = refreshDraft({ ...complete(), date: '2001-01-01' });
    expect(past.warnings.map((w) => w.code)).toContain('PAST_DATE');

    // Too early, or ending after 21:00
    expect(refreshDraft({ ...complete(), time: '06:00' }).warnings.map((w) => w.code)).toContain('UNUSUAL_HOUR');
    expect(refreshDraft({ ...complete(), time: '20:00', durationMinutes: 90 }).warnings.map((w) => w.code)).toContain('UNUSUAL_HOUR');
    expect(refreshDraft({ ...complete(), time: '19:00' }).warnings.map((w) => w.code)).not.toContain('UNUSUAL_HOUR');
  });

  it('clamps the duration and cleans the agenda', () => {
    expect(clampDuration(10)).toBe(30);
    expect(clampDuration(900)).toBe(480);
    expect(clampDuration('abc')).toBe(120);
    expect(normalizeAgenda([' Vẽ  tranh ', 'Vẽ tranh', '', 'a', 'b', 'c', 'd', 'e'])).toEqual(['Vẽ tranh', 'a', 'b', 'c', 'd']);
    expect(normalizeAgenda('not a list')).toEqual([]);
    // Only concrete games: no warm-up or getting to know each other
    expect(normalizeAgenda(['Làm quen, chào hỏi', 'Khởi động nhẹ', 'Thi xếp Lego'])).toEqual(['Thi xếp Lego']);
  });

  it('puts the numbered agenda before the parent note, each under its header', () => {
    expect(buildNote(['Vẽ tranh', 'Picnic'], 'Mang nón\n- Mang nước')).toBe(
      `${AI_AGENDA_NOTE_HEADER}\n1. Vẽ tranh\n2. Picnic\n\n${AI_EXTRA_NOTE_HEADER}\n- Mang nón\n- Mang nước`
    );
    expect(buildNote(['Vẽ tranh'], 'Đến TP. HCM. Mang nón')).toBe(`${AI_AGENDA_NOTE_HEADER}\n1. Vẽ tranh\n\n${AI_EXTRA_NOTE_HEADER}\n- Đến TP. HCM. Mang nón`);
    expect(buildNote([], 'Mang nón')).toBe('Mang nón');
  });

  it('returns the POST /playdates body with a GeoJSON point and an address fallback', () => {
    const response = toDraftResponse(refreshDraft(complete()));
    expect(response).toMatchObject({
      hostChildId: 'c1',
      scheduledDate: '2099-01-03',
      time: '09:00',
      durationMinutes: 120,
      activity: 'Vẽ tranh',
      location: { name: 'Công viên', address: 'Công viên', placeId: 'osm-1', coordinates: { type: 'Point', coordinates: [106.7, 10.8] } },
      participants: [{ parentId: 'p2', childId: 'c2', childName: 'Bin', parentName: 'Lan' }],
    });
    expect(response.participants[0]).not.toHaveProperty('warnings');
    expect(toDraftResponse(null)).toBeNull();
  });
});

describe('tool-sanitizer', () => {
  it('removes sensitive keys at any depth', () => {
    const clean = stripSensitive({
      email: 'a@b.c',
      parent: { phone: '090', fullName: 'Lan', kids: [{ dateOfBirth: '2020-01-01', displayName: 'Bin' }] },
      when: new Date('2026-01-01T00:00:00Z'),
    });
    expect(clean).toEqual({ parent: { fullName: 'Lan', kids: [{ displayName: 'Bin' }] }, when: '2026-01-01T00:00:00.000Z' });
  });

  it('maps a discovery profile to a match card with shared interests and no private data', () => {
    const item = toMatchItem(
      {
        childId: 'c9',
        parentId: 'p9',
        displayName: 'Bin',
        age: 5,
        interests: ['Vẽ', 'Bơi'],
        favoriteActivities: ['Lego'],
        matchScore: 81,
        distanceKm: 2.3,
        parent: { fullName: 'Lan', area: 'Phường 1', city: 'TP.HCM', bio: 'hi', preferences: {} },
      },
      new Set(['vẽ', 'lego'])
    );
    expect(item).toMatchObject({ childId: 'c9', sharedInterests: ['Vẽ', 'Lego'], distanceKm: 2.5, parent: { area: 'Phường 1, TP.HCM' } });
    expect(item.parent).not.toHaveProperty('bio');
    expect(item.parent).not.toHaveProperty('preferences');
  });
});

describe('safety-rules', () => {
  it('flags high risk and 1-on-1 adult ratio for swimming pool', () => {
    const safety = evaluateSafetyRules({
      activityTitle: 'Bơi lội vui vẻ',
      placeType: 'indoor',
      youngestAge: 4,
      totalChildren: 2,
    });
    expect(safety.riskLevel).toBe('high');
    expect(safety.hasHighRisk).toBe(true);
    expect(safety.supervisionLevel).toBe(3);
    expect(safety.requiredAdults).toBe(2);
    expect(safety.itemsToBring).toContain('Áo phao');
  });

  it('suggests sun protection items for outdoor park', () => {
    const safety = evaluateSafetyRules({
      activityTitle: 'Chơi dã ngoại',
      placeType: 'park',
      youngestAge: 5,
    });
    expect(safety.riskLevel).toBe('low');
    expect(safety.itemsToBring).toEqual(expect.arrayContaining(['Mũ nón', 'Bình nước cá nhân', 'Kem chống nắng']));
  });
});

describe('evaluateDraftWarnings', () => {
  it('flags NAP_TIME warning for toddler at 13:00', () => {
    const warnings = evaluateDraftWarnings({
      scheduledDate: '2026-12-01',
      time: '13:00',
      hostChild: { age: 2 },
      participants: [],
      agenda: ['Chơi xếp hình'],
      placeDetails: { openingStatus: 'open' },
    });
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'NAP_TIME', severity: AI_WARNING_SEVERITY.WARN })]));
  });

  it('flags SAFETY_HIGH_RISK with BLOCK severity if not acknowledged', () => {
    const warnings = evaluateDraftWarnings({
      scheduledDate: '2026-12-01',
      time: '09:00',
      hasHighRisk: true,
      safetyAcknowledged: false,
      agenda: ['Bơi lội'],
    });
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SAFETY_HIGH_RISK', severity: AI_WARNING_SEVERITY.BLOCK })]));
    expect(highestSeverityWarning(warnings).severity).toBe(AI_WARNING_SEVERITY.BLOCK);
  });

  it('flags PLACE_CLOSED with BLOCK severity when venue is closed', () => {
    const warnings = evaluateDraftWarnings({
      scheduledDate: '2026-12-01',
      time: '23:00',
      location: { openingHours: 'Mo-Fr 08:00-17:00' },
      agenda: ['Chơi'],
    });
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'PLACE_CLOSED', severity: AI_WARNING_SEVERITY.BLOCK })]));
  });

  it('flags SCHOOL_HOURS for kids >= 6 on weekdays during class time', () => {
    // 2026-12-02 is Wednesday (weekday)
    const warnings = evaluateDraftWarnings({
      scheduledDate: '2026-12-02',
      time: '09:00',
      durationMinutes: 60,
      hostChild: { age: 7 },
      participants: [],
      agenda: ['Vẽ tranh'],
    });
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'SCHOOL_HOURS', severity: AI_WARNING_SEVERITY.WARN })]));
  });

  it('flags OUTDOOR_AFTER_DARK when playing in a park after 18:00', () => {
    const warnings = evaluateDraftWarnings({
      scheduledDate: '2026-12-05',
      time: '18:30',
      durationMinutes: 60,
      location: { placeType: 'park', name: 'Công viên Gia Định' },
      agenda: ['Chạy nhảy'],
    });
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'OUTDOOR_AFTER_DARK', severity: AI_WARNING_SEVERITY.WARN })]));
  });

  it('flags BAD_WEATHER when rainfall probability is high or it is raining', () => {
    const warnings = evaluateDraftWarnings(
      {
        scheduledDate: '2026-12-05',
        time: '10:00',
        durationMinutes: 60,
        agenda: ['Dã ngoại ngoài trời'],
      },
      { weather: { isRaining: true, precipitationProbability: 75 } }
    );
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'BAD_WEATHER', severity: AI_WARNING_SEVERITY.WARN })]));
  });

  it('flags FAR_PLACE when distance to any participant family exceeds 15 km', () => {
    const warnings = evaluateDraftWarnings(
      {
        scheduledDate: '2026-12-05',
        time: '10:00',
        durationMinutes: 60,
        location: { name: 'Thảo Cầm Viên' },
        agenda: ['Tham quan'],
      },
      {
        familyDistances: [
          { familyId: 'f1', distanceKm: 5 },
          { familyId: 'f2', distanceKm: 18.5 },
        ],
      }
    );
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FAR_PLACE', severity: AI_WARNING_SEVERITY.WARN })]));
  });
});

describe('pickAttractions', () => {
  it('picks attractions within duration budget', () => {
    const picked = pickAttractions({
      attractions: [
        { title: 'Trượt ống', durationMinutes: 30, minAge: 3, maxAge: 10 },
        { title: 'Nhà banh', durationMinutes: 20, minAge: 1, maxAge: 6 },
        { title: 'Leo núi', durationMinutes: 60, minAge: 7, maxAge: 15 },
      ],
      durationMinutes: 60,
      childAges: [4],
    });
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.includes('Leo núi')).toBe(false); // age 4 not in 7-15
  });
});

describe('shouldSearchAttractions', () => {
  it('identifies places that require search, are uncertain, or do not need search', () => {
    expect(shouldSearchAttractions({ placeType: 'kids_cafe', name: 'TiNiWorld' })).toBe('yes');
    expect(shouldSearchAttractions({ placeType: 'sports_center', name: 'Jump Arena Bạt Nhún' })).toBe('yes');
    expect(shouldSearchAttractions({ placeType: 'park', name: 'Công viên 23/9' })).toBe('no');
    expect(shouldSearchAttractions({ placeType: 'library', name: 'Thư viện Khoa học' })).toBe('no');
    expect(shouldSearchAttractions({ placeType: 'home' })).toBe('no');
    expect(shouldSearchAttractions({ placeType: 'workshop', name: 'Nhà Thiếu Nhi Quận 1' })).toBe('uncertain');
  });
});

describe('BUD-49 review fixes', () => {
  const draftAt = (date, time, extra = {}) => ({
    ...emptyDraft(),
    hostChild: { childId: 'c1', displayName: 'Na', age: 6 },
    date,
    time,
    durationMinutes: 60,
    agenda: ['Vẽ tranh'],
    ...extra,
  });
  const codesOf = (warnings) => warnings.map((warning) => warning.code);

  it('flags the Vietnamese holidays by month and day (30/4, 2/9), not 5/1 or 9/2', () => {
    expect(codesOf(evaluateDraftWarnings(draftAt('2099-04-30', '09:00')))).toContain('HOLIDAY');
    expect(codesOf(evaluateDraftWarnings(draftAt('2099-09-02', '09:00')))).toContain('HOLIDAY');
    expect(codesOf(evaluateDraftWarnings(draftAt('2099-01-05', '09:00')))).not.toContain('HOLIDAY');
    expect(codesOf(evaluateDraftWarnings(draftAt('2099-02-09', '09:00')))).not.toContain('HOLIDAY');
  });

  it('reads opening hours in the business time zone, over the whole playdate', () => {
    const at = (time) => getScheduledStart(new Date('2099-03-04'), time);
    const end = (time, minutes) => new Date(at(time).getTime() + minutes * 60 * 1000);
    // 09:00 Vietnam time is open whatever the time zone of the server
    expect(checkPlaceOpeningHours('Mo-Su 08:00-17:00', at('09:00'), end('09:00', 60))).toMatchObject({ isKnown: true, isOpen: true });
    expect(checkPlaceOpeningHours('Mo-Su 08:00-17:00', at('18:00'), end('18:00', 60))).toMatchObject({ isOpen: false });
    // Closed at lunch: a playdate over the break is not open the whole time
    expect(checkPlaceOpeningHours('Mo-Su 08:00-11:00,13:00-17:00', at('10:00'), end('10:00', 120))).toMatchObject({ isOpen: false });
  });

  it('accepts reworded catalog games and drops invented ones (A6)', () => {
    const references = [...PLAYDATE_ACTIVITIES, ...GENERIC_GAMES, { title: 'Nhà banh khổng lồ' }];
    expect(isKnownAgendaItem('Vẽ tranh màu nước về công viên', references)).toBe(true);
    expect(isKnownAgendaItem('Thi xếp Lego theo chủ đề', references)).toBe(true);
    expect(isKnownAgendaItem('Ăn nhẹ & picnic', references)).toBe(true);
    expect(isKnownAgendaItem('Chơi ở nhà banh khổng lồ', references)).toBe(true);
    expect(isKnownAgendaItem('Bắn súng sơn', references)).toBe(false);
  });

  it('counts the families whose preferred days and time slots contain a start time', () => {
    expect(timeSlotOf('09:00')).toBe('morning');
    expect(timeSlotOf('12:30')).toBeNull();
    expect(timeSlotOf('19:00')).toBe('evening');
    expect(dayTypeOf('2099-03-07')).toBe('weekend');
    const parents = [
      { preferences: { preferredPlaydateDays: ['weekend'], preferredTimeSlots: ['morning'] } },
      { preferences: { preferredPlaydateDays: ['weekend'], preferredTimeSlots: ['afternoon'] } },
      { preferences: {} },
    ];
    expect(evaluateSlotFit({ parents, date: '2099-03-07', time: '09:00' })).toMatchObject({
      matchedParents: 1,
      totalParents: 3,
      parentsWithPreferences: 2,
      timeSlot: 'morning',
    });
  });

  it('counts the host and every invited family in the fit of a time option', () => {
    expect(slotFitText({ matchedParents: 2, totalParents: 2 })).toBe('Hợp lịch ưu tiên của các gia đình');
    expect(slotFitText({ matchedParents: 1, totalParents: 1 })).toBe('Hợp lịch ưu tiên của bạn');
    expect(slotFitText({ matchedParents: 1, totalParents: 3 })).toBe('Hợp với 1/3 gia đình');
    expect(slotFitText({ matchedParents: 0, totalParents: 3 })).toBe('Chưa ai đặt lịch ưu tiên');
  });

  it('warns NOT_PREFERRED_TIME only with a fit of the current time and invitees', () => {
    const draft = draftAt('2099-03-07', '19:00');
    const fit = { matchedParents: 0, totalParents: 2, parentsWithPreferences: 2, date: '2099-03-07', time: '19:00', groupKey: groupKeyOf(draft) };
    expect(codesOf(evaluateDraftWarnings(draft, { slotFit: fit }))).toContain('NOT_PREFERRED_TIME');
    // Computed for another time: ignored until recomputed
    expect(codesOf(evaluateDraftWarnings(draft, { slotFit: { ...fit, time: '09:00' } }))).not.toContain('NOT_PREFERRED_TIME');
    // Families without preferences are neutral
    expect(codesOf(evaluateDraftWarnings(draft, { slotFit: { ...fit, parentsWithPreferences: 0 } }))).not.toContain('NOT_PREFERRED_TIME');
  });

  it('lists the blocking warnings without the acknowledged safety one', () => {
    const warnings = [
      { code: 'PLACE_CLOSED', severity: 'block' },
      { code: 'SAFETY_HIGH_RISK', severity: 'block' },
      { code: 'MEAL_TIME', severity: 'info' },
    ];
    expect(blockingWarnings(warnings).map((w) => w.code)).toEqual(['PLACE_CLOSED']);
  });

  it('resets the safety acknowledgement when the agenda changes', () => {
    const draft = refreshDraft(draftAt('2099-03-04', '09:00', { agenda: ['Bơi lội'] }));
    draft.safetyAcknowledged = true;
    refreshDraft(draft);
    expect(draft.safetyAcknowledged).toBe(true);
    draft.agenda = ['Bơi lội', 'Chơi cầu trượt'];
    refreshDraft(draft);
    expect(draft.safetyAcknowledged).toBe(false);
  });

  it('computes the chaperones needed from accepted children only', () => {
    expect(calculateChaperoneRequirement({ under5Count: 3, over5Count: 3 })).toBe(3);
    expect(calculateChaperoneRequirement({ totalKids: 4, hasHighRisk: true })).toBe(4);
    const young = new Date(new Date().getFullYear() - 3, 0, 1);
    const summary = computeChaperoneSummary(
      {
        activity: 'Vẽ tranh',
        hostChildId: { dateOfBirth: young },
        participants: [
          { status: 'accepted', childId: { dateOfBirth: young } },
          { status: 'pending', childId: { dateOfBirth: young } },
        ],
        chaperones: [{ parentId: 'p1' }],
      },
      'p1'
    );
    expect(summary).toMatchObject({
      requiredChaperones: 1,
      confirmedChaperones: 1,
      isChaperoneSufficient: true,
      isChaperoneConfirmedByMe: true,
      missingChaperones: 0,
      under5Count: 2,
    });
  });
});

describe('BUD-49 Jira follow-up rules', () => {
  const codes = (issues) => issues.map((issue) => issue.code);

  it('fits the number of games to the duration and the youngest child (A2)', () => {
    expect(agendaSizeFor({ durationMinutes: 60, youngestAge: 5 })).toEqual({ min: 3, max: 4 });
    expect(agendaSizeFor({ durationMinutes: 60, youngestAge: 9 })).toEqual({ min: 2, max: 3 });
    expect(agendaSizeFor({ durationMinutes: 240, youngestAge: 5 }).max).toBe(5);
  });

  it('picks the generic games of the place type (A3)', () => {
    const picked = pickAttractions({ childAges: [5], durationMinutes: 60, placeType: 'library' });
    expect(picked).not.toContain('Khám phá thiên nhiên và tìm đồ vật');
    expect(picked).not.toContain('Đua xe đạp mini / patin tự do');
  });

  it('writes a real attraction with its source (A4)', () => {
    const location = { name: 'TiNiWorld', attractions: [{ title: 'Nhà banh khổng lồ', sourceUrl: 'https://example.com/tini' }] };
    expect(withAttractionSource('Chơi ở nhà banh khổng lồ', location)).toBe(
      'Theo thông tin trên mạng về TiNiWorld: Chơi ở nhà banh khổng lồ (https://example.com/tini)'
    );
    expect(withAttractionSource('Thi xếp Lego', location)).toBe('Thi xếp Lego');
  });

  it('uses the catalog risk, writes the supervision and counts adults like the group chat (B1, B5)', () => {
    const safety = evaluateSafetyRules({
      activityTitle: 'Chơi cầu trượt & xích đu ở sân chơi',
      agenda: [],
      placeType: 'playground',
      youngestAge: 3,
      totalChildren: 3,
      childAges: [3, 3, 6],
    });
    expect(safety.riskLevel).toBe('medium');
    expect(safety.safetyNotes).toEqual(expect.arrayContaining([expect.stringContaining('Mức giám sát cần thiết')]));
    // 1 adult per 2 children under 5, 1 per 3 older: 1 + 1
    expect(safety.requiredAdults).toBe(2);
  });

  it('checks every time rule of a playdate in one place (C)', () => {
    const now = new Date('2099-03-01T00:00:00.000Z');
    expect(codes(evaluateTimeIssues({ date: '2099-03-04', time: '12:30', durationMinutes: 60, ages: [3], now }))).toEqual(
      expect.arrayContaining(['NAP_TIME', 'MEAL_TIME'])
    );
    expect(codes(evaluateTimeIssues({ date: '2099-03-04', time: '09:00', durationMinutes: 60, ages: [7], now }))).toContain('SCHOOL_HOURS');
    const closed = evaluateTimeIssues({
      date: '2099-03-04',
      time: '18:00',
      durationMinutes: 60,
      ages: [7],
      place: { placeType: 'kids_cafe', openingHours: 'Mo-Su 08:00-17:00' },
      now,
    });
    expect(closed[0]).toMatchObject({ code: 'PLACE_CLOSED', severity: 'block' });
  });

  it('never suggests a time that breaks a rule (C, D5)', () => {
    const parent = { preferences: { preferredPlaydateDays: ['weekday', 'weekend'], preferredTimeSlots: ['morning', 'afternoon', 'evening'] } };
    // Wednesday 4 to Thursday 5 March 2099: school days for a 7-year-old
    const slots = suggestTimeSlots({
      parents: [parent],
      from: new Date('2099-03-04T05:00:00.000Z'),
      to: new Date('2099-03-05T05:00:00.000Z'),
      durationMinutes: 60,
      ages: [7],
      place: { placeType: 'kids_cafe', openingHours: 'Mo-Su 08:00-17:00' },
      now: new Date('2099-03-01T00:00:00.000Z'),
      limit: 10,
    });
    // 09:00 and 15:00 are school hours, 18:00 is after closing time
    expect(slots).toEqual([]);

    const weekend = suggestTimeSlots({
      parents: [parent],
      from: new Date('2099-03-07T05:00:00.000Z'),
      to: new Date('2099-03-07T05:00:00.000Z'),
      durationMinutes: 60,
      ages: [7],
      place: { placeType: 'kids_cafe', openingHours: 'Mo-Su 08:00-17:00' },
      now: new Date('2099-03-01T00:00:00.000Z'),
      limit: 10,
    });
    expect(weekend.map((slot) => slot.time)).toEqual(['09:00', '15:00']);
  });
});
