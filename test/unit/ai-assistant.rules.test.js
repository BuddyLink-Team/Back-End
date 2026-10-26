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
} from '../../src/modules/ai-assistant/plan-draft.rules.js';
import { stripSensitive, toMatchItem } from '../../src/modules/ai-assistant/tools/tool-sanitizer.js';
import { AI_AGENDA_NOTE_HEADER, AI_EXTRA_NOTE_HEADER, AI_DEFAULT_SESSION_TITLE } from '../../src/modules/ai-assistant/ai-assistant.constants.js';

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

  it('walks the steps in order and allows skipping the playmates', () => {
    const draft = emptyDraft();
    expect(nextMissingStep(draft)).toBe('child');
    draft.hostChild = { childId: 'c1' };
    expect(nextMissingStep(draft)).toBe('time');
    draft.date = '2099-01-03';
    draft.time = '09:00';
    expect(nextMissingStep(draft)).toBe('playmates');
    draft.playmatesSkipped = true;
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
