import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import User from '../../src/modules/user/user.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import PlacesCache from '../../src/modules/places/places-cache.model.js';
import Swipe from '../../src/modules/discovery/discovery.model.js';
import UsageQuota from '../../src/modules/subscription/usage-quota.model.js';
import Subscription from '../../src/modules/subscription/subscription.model.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';
import AIChatSession from '../../src/modules/ai-assistant/ai-assistant.model.js';
import geminiAdapter from '../../src/integrations/ai/gemini.adapter.js';
import AppError from '../../src/shared/exceptions/AppError.js';
import { AI_FALLBACK_REPLY, AI_CHOICE_FALLBACK_REPLY, AI_AGENDA_NOTE_HEADER } from '../../src/modules/ai-assistant/ai-assistant.constants.js';
import { geminiText, geminiToolCall } from '../mocks/geminiMock.js';

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
// Isolated area, so other test files' parents and places never show up
const HOME = [106.91, 11.31];
const NEAR = [106.915, 11.31];
// Separate area for the playmate search (only the 5 best matches are returned)
const FINDER_HOME = [107.61, 10.71];
const FINDER_NEAR = [107.615, 10.71];
const TAPPER_HOME = [107.81, 10.91];
const TAPPER_NEAR = [107.815, 10.91];
const SECRET_ADDRESS = 'SECRET-STREET-4242';
// 5 years and 2 months old: age 5 whatever the test date
const FIVE_YEARS_AGO = new Date(new Date().getFullYear() - 5, new Date().getMonth() - 2, 1);

let seq = 0;
const registerParent = async (label, { coordinates = HOME, child = {}, noChild = false } = {}) => {
  seq += 1;
  const email = `ai-${label}-${Date.now()}-${seq}@example.com`;
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: `AI ${label}`, email, password: PASSWORD });
  const parentId = res.body.data.parent.id;
  await Parent.updateOne(
    { _id: parentId },
    {
      $set: {
        'location.coordinates': { type: 'Point', coordinates },
        'location.area': 'Phường Test',
        'location.city': 'TP.HCM',
        'location.address': SECRET_ADDRESS,
        'preferences.maxDistanceKm': 10,
      },
    }
  );
  let childId = null;
  if (!noChild) {
    const created = await Child.create({
      parentId,
      displayName: `Kid ${label}`,
      dateOfBirth: FIVE_YEARS_AGO,
      gender: 'girl',
      interests: ['Vẽ'],
      ...child,
    });
    childId = created._id.toString();
  }
  return { token: res.body.data.tokens.accessToken, parentId, childId, email, userId: res.body.data.user?.id };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted' });

const api = (parent) => ({
  create: () => request(app).post('/api/v1/ai-assistant/sessions').set('Authorization', `Bearer ${parent.token}`),
  list: (query = '') => request(app).get(`/api/v1/ai-assistant/sessions${query}`).set('Authorization', `Bearer ${parent.token}`),
  get: (id) => request(app).get(`/api/v1/ai-assistant/sessions/${id}`).set('Authorization', `Bearer ${parent.token}`),
  remove: (id) => request(app).delete(`/api/v1/ai-assistant/sessions/${id}`).set('Authorization', `Bearer ${parent.token}`),
  send: (id, body) =>
    request(app)
      .post(`/api/v1/ai-assistant/sessions/${id}/messages`)
      .set('Authorization', `Bearer ${parent.token}`)
      .send(typeof body === 'string' ? { content: body } : body),
});

const mockModel = (...responses) => {
  const spy = jest.spyOn(geminiAdapter, 'generateContent');
  responses.forEach((response) => spy.mockResolvedValueOnce(response));
  return spy;
};

const aiUsage = async (parentId) => {
  const quota = await UsageQuota.findOne({ parentId, periodType: 'monthly' }).lean();
  return quota?.counters?.aiAssistantRequests || 0;
};

const newSession = async (parent) => (await api(parent).create()).body.data.session.id;

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AI assistant (/api/v1/ai-assistant)', () => {
  describe('access and sessions', () => {
    let owner;
    let other;

    beforeAll(async () => {
      owner = await registerParent('owner');
      other = await registerParent('other');
    });

    it('requires a parent token', async () => {
      const anonymous = await request(app).get('/api/v1/ai-assistant/sessions');
      expect(anonymous.status).toBe(401);

      const admin = await registerParent('admin-role');
      await User.updateOne({ email: admin.email }, { $set: { role: 'admin' } });
      const res = await api(admin).list();
      expect(res.status).toBe(403);
    });

    it('creates, lists, reads and soft deletes sessions without using quota', async () => {
      const first = await api(owner).create();
      expect(first.status).toBe(201);
      expect(first.body.data.session).toMatchObject({ title: 'Cuộc trò chuyện mới', messageCount: 0, messageCap: 30 });
      const second = await newSession(owner);

      const list = await api(owner).list('?limit=1');
      expect(list.status).toBe(200);
      expect(list.body.data.sessions).toHaveLength(1);
      expect(list.body.data.sessions[0].id).toBe(second);
      expect(list.body.data.sessions[0]).not.toHaveProperty('messages');
      expect(list.body.data.pagination).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });

      const detail = await api(owner).get(first.body.data.session.id);
      expect(detail.status).toBe(200);
      expect(detail.body.data.session).toMatchObject({ messages: [], planDraft: null });

      const removed = await api(owner).remove(second);
      expect(removed.status).toBe(200);
      expect((await api(owner).get(second)).status).toBe(404);
      expect((await api(owner).list()).body.data.pagination.total).toBe(1);
      expect(await aiUsage(owner.parentId)).toBe(0);
    });

    it("hides another parent's session (404) on read, message and delete", async () => {
      const sessionId = await newSession(owner);
      const spy = mockModel(geminiText('Xin chào'));

      for (const res of [await api(other).get(sessionId), await api(other).send(sessionId, 'Hi'), await api(other).remove(sessionId)]) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('AI_SESSION_NOT_FOUND');
      }
      expect(spy).not.toHaveBeenCalled();
    });

    it('validates input', async () => {
      const sessionId = await newSession(owner);
      expect((await api(owner).get('not-an-id')).status).toBe(400);
      expect((await api(owner).send(sessionId, '   ')).status).toBe(400);
      expect((await api(owner).send(sessionId, 'a'.repeat(2001))).status).toBe(400);
      const badChoice = await api(owner).send(sessionId, { content: 'x', choice: { messageId: 'nope', stepId: 'time' } });
      expect(badChoice.status).toBe(400);
    });
  });

  describe('replies and quota', () => {
    it('stores the turn, names the session after the first message and counts tokens', async () => {
      const parent = await registerParent('reply');
      const sessionId = await newSession(parent);
      mockModel(geminiText('Chào bạn! Mình có thể giúp gì?'), geminiText('Bé 5 tuổi thích vẽ thì thử tô màu nước nhé.'));

      const first = await api(parent).send(sessionId, 'Gợi ý hoạt động cho bé 5 tuổi thích vẽ\nở nhà cuối tuần');
      expect(first.status).toBe(200);
      expect(first.body.data.reply).toMatchObject({ role: 'assistant', content: 'Chào bạn! Mình có thể giúp gì?', cards: [] });
      expect(first.body.data.session).toMatchObject({ title: 'Gợi ý hoạt động cho bé 5 tuổi thích vẽ', messageCount: 1 });
      expect(first.body.data.quota).toMatchObject({ limit: 5, used: 1, remaining: 4 });

      const second = await api(parent).send(sessionId, 'Còn gì khác không?');
      expect(second.status).toBe(200);
      expect(second.body.data.session.title).toBe('Gợi ý hoạt động cho bé 5 tuổi thích vẽ');

      const stored = await AIChatSession.findById(sessionId).lean();
      expect(stored.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect(stored.tokenUsage.totalTokens).toBe(300);
      expect(stored.pendingSince).toBeNull();
      // One unit for the whole session
      expect(await aiUsage(parent.parentId)).toBe(1);
    });

    it('uses one quota unit per session: the 6th session of the month is refused before calling the model', async () => {
      const parent = await registerParent('quota');
      const sessions = [];
      for (let i = 0; i < 5; i += 1) {
        const sessionId = await newSession(parent);
        mockModel(geminiText(`Trả lời ${i}`));
        const res = await api(parent).send(sessionId, `Câu hỏi ${i}`);
        expect(res.status).toBe(200);
        sessions.push(sessionId);
      }
      expect(await aiUsage(parent.parentId)).toBe(5);

      // Follow-up messages in a session that already used its unit stay free
      mockModel(geminiText('Vẫn trả lời được'));
      const followUp = await api(parent).send(sessions[0], 'Hỏi thêm');
      expect(followUp.status).toBe(200);
      expect(followUp.body.data.quota).toMatchObject({ limit: 5, used: 5, remaining: 0 });

      const sixth = await newSession(parent);
      jest.restoreAllMocks();
      const spy = jest.spyOn(geminiAdapter, 'generateContent');
      const refused = await api(parent).send(sixth, 'Câu hỏi 6');
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('QUOTA_EXCEEDED');
      expect(refused.body.error.details.feature).toBe('ai_assistant');
      expect(spy).not.toHaveBeenCalled();
      expect((await AIChatSession.findById(sixth).lean()).pendingSince).toBeNull();

      const my = await request(app).get('/api/v1/subscriptions/my').set('Authorization', `Bearer ${parent.token}`);
      expect(my.body.data.usage.ai_assistant).toMatchObject({ limit: 5, used: 5, remaining: 0, periodType: 'monthly' });
    });

    it('consumes nothing and stores nothing when the model fails, so the retry works', async () => {
      const parent = await registerParent('failure');
      const sessionId = await newSession(parent);
      jest
        .spyOn(geminiAdapter, 'generateContent')
        .mockRejectedValueOnce(new AppError('AI assistant is temporarily unavailable', 502, 'AI_PROVIDER_ERROR'))
        .mockResolvedValueOnce(geminiText('Lần này được rồi'));

      const failed = await api(parent).send(sessionId, 'Xin chào');
      expect(failed.status).toBe(502);
      expect(failed.body.error.code).toBe('AI_PROVIDER_ERROR');
      expect(await aiUsage(parent.parentId)).toBe(0);
      const afterFailure = await AIChatSession.findById(sessionId).lean();
      expect(afterFailure.messages).toHaveLength(0);
      expect(afterFailure.pendingSince).toBeNull();

      const retried = await api(parent).send(sessionId, 'Xin chào');
      expect(retried.status).toBe(200);
      expect(await aiUsage(parent.parentId)).toBe(1);
    });

    it('caps the messages of a session and handles one message at a time', async () => {
      const parent = await registerParent('cap');
      const sessionId = await newSession(parent);
      const spy = jest.spyOn(geminiAdapter, 'generateContent');

      await AIChatSession.updateOne({ _id: sessionId }, { $set: { pendingSince: new Date() } });
      const busy = await api(parent).send(sessionId, 'Xin chào');
      expect(busy.status).toBe(409);
      expect(busy.body.error.code).toBe('AI_SESSION_BUSY');

      // A stale lock is taken over
      await AIChatSession.updateOne({ _id: sessionId }, { $set: { pendingSince: new Date(Date.now() - 5 * 60 * 1000) } });
      spy.mockResolvedValueOnce(geminiText('OK'));
      expect((await api(parent).send(sessionId, 'Xin chào')).status).toBe(200);

      await AIChatSession.updateOne({ _id: sessionId }, { $set: { messageCount: 30 } });
      const full = await api(parent).send(sessionId, 'Thêm nữa');
      expect(full.status).toBe(409);
      expect(full.body.error.code).toBe('AI_SESSION_FULL');
      expect(full.body.error.details).toMatchObject({ cap: 30 });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('gives Premium parents unlimited sessions and a higher message cap', async () => {
      const parent = await registerParent('premium');
      await Subscription.updateOne(
        { parentId: parent.parentId },
        { $set: { planCode: 'premium_monthly', status: 'active', startDate: new Date(), endDate: new Date(Date.now() + 20 * DAY) } }
      );
      const sessionId = await newSession(parent);
      mockModel(geminiText('Chào Premium'));
      const res = await api(parent).send(sessionId, 'Xin chào');
      expect(res.status).toBe(200);
      expect(res.body.data.session.messageCap).toBe(100);
      expect(res.body.data.quota.limit).toBe(-1);
    });

    it('stops after 3 rounds of tool calls and still answers', async () => {
      const parent = await registerParent('rounds');
      const sessionId = await newSession(parent);
      const spy = jest.spyOn(geminiAdapter, 'generateContent').mockResolvedValue(geminiToolCall('getMyChildren'));

      const res = await api(parent).send(sessionId, 'Bé nhà mình thế nào?');
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(4);
      expect(spy.mock.calls[3][0].allowTools).toBe(false);
      expect(res.body.data.reply.content).toBe(AI_FALLBACK_REPLY);
      expect(res.body.data.reply.toolsUsed).toEqual(['getMyChildren']);

      const stored = await AIChatSession.findById(sessionId).lean();
      const tool = stored.messages.find((m) => m.role === 'tool');
      expect(tool).toMatchObject({ toolName: 'getMyChildren' });
      expect(tool.content).toContain('Kid rounds');
      expect(tool.content).not.toContain('dateOfBirth');
      expect(stored.messages.find((m) => m.toolCalls?.length).toolCalls[0].function.name).toBe('getMyChildren');
      // Tool turns are not shown to the parent
      expect((await api(parent).get(sessionId)).body.data.session.messages).toHaveLength(2);
    });
  });

  describe('finding playmates and places', () => {
    let parent;

    beforeAll(async () => {
      parent = await registerParent('finder', { coordinates: FINDER_HOME, child: { interests: ['Vẽ', 'Lego'] } });
      // A child nearby to discover
      await registerParent('nearby', { coordinates: FINDER_NEAR, child: { interests: ['Vẽ'] } });
    });

    it('asks to confirm default criteria, then searches without swiping or using discovery quota', async () => {
      const sessionId = await newSession(parent);
      mockModel(geminiToolCall('findMatches', { confirmed: false }), geminiText('Mình tìm theo tiêu chí này nhé?'));

      const ask = await api(parent).send(sessionId, 'Tìm bạn chơi cho con');
      expect(ask.status).toBe(200);
      const [card] = ask.body.data.reply.cards;
      expect(card).toMatchObject({ type: 'choices', stepId: 'match_criteria', status: 'open', allowCustom: true });
      expect(card.options[0]).toMatchObject({ id: 'criteria:confirm', label: 'Đúng, tìm luôn' });
      expect(card.options[0].data).toMatchObject({ ageMin: 4, ageMax: 6, maxDistanceKm: 10, interests: [] });

      mockModel(geminiText('Đây là các bạn phù hợp với bé.'));
      const found = await api(parent).send(sessionId, {
        content: 'Đúng, tìm luôn',
        choice: { messageId: ask.body.data.reply.id, stepId: 'match_criteria', optionIds: ['criteria:confirm'] },
      });
      expect(found.status).toBe(200);
      const matches = found.body.data.reply.cards.find((c) => c.type === 'match_suggestions');
      expect(matches.items.length).toBeGreaterThan(0);
      const nearby = matches.items.find((item) => item.displayName === 'Kid nearby');
      expect(nearby).toMatchObject({ age: 5, sharedInterests: ['Vẽ'] });
      expect(nearby.parent).toMatchObject({ fullName: 'AI nearby', area: 'Phường Test, TP.HCM' });

      const body = JSON.stringify(found.body);
      expect(body).not.toContain(SECRET_ADDRESS);
      expect(body).not.toContain('dateOfBirth');
      expect(body).not.toMatch(/@example\.com/);

      expect(await Swipe.countDocuments({ swiperParentId: parent.parentId })).toBe(0);
      const daily = await UsageQuota.findOne({ parentId: parent.parentId, periodType: 'daily' }).lean();
      expect(daily?.counters?.discoveryViews || 0).toBe(0);

      // The answered card is read-only, a second tap is refused
      const detail = await api(parent).get(sessionId);
      expect(detail.body.data.session.messages[1].cards[0]).toMatchObject({ status: 'answered', selectedOptionIds: ['criteria:confirm'] });
      const again = await api(parent).send(sessionId, {
        content: 'Đúng, tìm luôn',
        choice: { messageId: ask.body.data.reply.id, stepId: 'match_criteria', optionIds: ['criteria:confirm'] },
      });
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('AI_INVALID_CHOICE');
    });

    it('turns "send them an invitation" after a match list into connection requests, sent on confirm', async () => {
      const sessionId = await newSession(parent);
      mockModel(geminiToolCall('findMatches', { confirmed: true }), geminiText('Có các bạn này nè.'));
      await api(parent).send(sessionId, 'Tìm bạn cho bé');

      mockModel(geminiToolCall('sendConnectionRequests', { names: ['kid NEARBY'] }), geminiText('Bạn xác nhận gửi lời mời nhé.'));
      const ask = await api(parent).send(sessionId, 'Gửi lời mời cho bé Kid nearby đi');
      expect(ask.status).toBe(200);
      const card = ask.body.data.reply.cards.find((c) => c.stepId === 'connect');
      const option = card.options.find((o) => o.label === 'Kid nearby');
      expect(card).toMatchObject({ type: 'choices', selectionMode: 'multiple', preselectedOptionIds: [option.id] });
      // Nothing sent, and no playdate plan started
      expect(await Swipe.countDocuments({ swiperParentId: parent.parentId })).toBe(0);
      expect(ask.body.data.planDraft).toBeNull();

      const spy = mockModel(geminiText('Đã gửi lời mời kết bạn.'));
      const callsBefore = spy.mock.calls.length;
      const sent = await api(parent).send(sessionId, {
        content: 'Gửi lời mời',
        choice: { messageId: ask.body.data.reply.id, stepId: 'connect', optionIds: [option.id] },
      });
      expect(sent.status).toBe(200);
      expect(await Swipe.countDocuments({ swiperParentId: parent.parentId, isLike: true })).toBe(1);
      // Done by code: a single model call without tools
      expect(spy.mock.calls.length - callsBefore).toBe(1);
      expect(spy.mock.calls.at(-1)[0].allowTools).toBe(false);
      await Swipe.deleteMany({ swiperParentId: parent.parentId });
    });

    it('keeps a tapped option that took effect when the model fails, so a retry cannot repeat it', async () => {
      // Own parent and area: the message rate limit is per parent
      const tapper = await registerParent('tapper', { coordinates: TAPPER_HOME });
      await registerParent('tapped', { coordinates: TAPPER_NEAR });
      const sessionId = await newSession(tapper);
      mockModel(geminiToolCall('findMatches', { confirmed: true }), geminiText('Có các bạn này nè.'));
      await api(tapper).send(sessionId, 'Tìm bạn cho bé');
      mockModel(geminiToolCall('sendConnectionRequests', { names: ['kid TAPPED'] }), geminiText('Bạn xác nhận gửi lời mời nhé.'));
      const ask = await api(tapper).send(sessionId, 'Gửi lời mời cho bé Kid tapped đi');
      const card = ask.body.data.reply.cards.find((c) => c.stepId === 'connect');
      const option = card.options.find((o) => o.label === 'Kid tapped');

      jest.restoreAllMocks();
      jest
        .spyOn(geminiAdapter, 'generateContent')
        .mockRejectedValue(new AppError('AI assistant is temporarily unavailable', 502, 'AI_PROVIDER_ERROR'));
      const tap = { content: 'Gửi lời mời', choice: { messageId: ask.body.data.reply.id, stepId: 'connect', optionIds: [option.id] } };
      const sent = await api(tapper).send(sessionId, tap);
      expect(sent.status).toBe(200);
      expect(sent.body.data.reply.content).toBe(AI_CHOICE_FALLBACK_REPLY);
      expect(sent.body.data.answeredCard).not.toBeNull();
      expect(await Swipe.countDocuments({ swiperParentId: tapper.parentId, isLike: true })).toBe(1);

      const retried = await api(tapper).send(sessionId, tap);
      expect(retried.status).toBe(400);
      expect(await Swipe.countDocuments({ swiperParentId: tapper.parentId, isLike: true })).toBe(1);
    });

    it('searches directly when the parent gave criteria', async () => {
      const sessionId = await newSession(parent);
      mockModel(geminiToolCall('findMatches', { confirmed: true, ageMin: 4, ageMax: 6 }), geminiText('Có bạn này nè.'));
      const res = await api(parent).send(sessionId, 'Tìm bạn 4-6 tuổi cho bé');
      expect(res.body.data.reply.cards.map((c) => c.type)).toEqual(['match_suggestions']);
    });

    it('shows nearby places with map links', async () => {
      const [place] = await PlacesCache.insertMany([
        { osmId: `osm-node-${Date.now() + 1}`, name: 'AI Test Park', placeType: 'park', address: '1 Test Road', coordinates: { type: 'Point', coordinates: [107.611, 10.71] } },
      ]);
      try {
        const sessionId = await newSession(parent);
        mockModel(geminiToolCall('findNearbyPlaces', { type: 'park' }), geminiText('Có công viên gần nhà bạn.'));
        const res = await api(parent).send(sessionId, 'Công viên gần nhà');
        const card = res.body.data.reply.cards.find((c) => c.type === 'place_suggestions');
        const item = card.items.find((p) => p.name === 'AI Test Park');
        expect(item).toMatchObject({ address: '1 Test Road', placeType: 'park', coordinates: [107.611, 10.71] });
        expect(item.links.map((link) => link.kind)).toContain('google_maps');
      } finally {
        await PlacesCache.deleteOne({ _id: place._id });
      }
    });
  });

  describe('planning a playdate step by step', () => {
    let host;
    let friend;
    let busyFriend;
    let stranger;
    let park;
    const day = isoDay(6);

    beforeAll(async () => {
      host = await registerParent('host');
      friend = await registerParent('friend', { coordinates: NEAR, child: { displayName: 'Bin' } });
      busyFriend = await registerParent('busy', { coordinates: NEAR, child: { displayName: 'Na' } });
      stranger = await registerParent('stranger', { coordinates: NEAR, child: { displayName: 'Lạ' } });
      await connect(host, friend);
      await connect(host, busyFriend);
      // Na already has a playdate at 09:00 that day
      await Playdate.create({
        hostParentId: busyFriend.parentId,
        hostChildId: busyFriend.childId,
        scheduledDate: new Date(day),
        time: '09:00',
        activity: 'Bơi',
        location: { name: 'Pool', address: 'Somewhere' },
      });
      [park] = await PlacesCache.insertMany([
        { osmId: `osm-node-${Date.now()}`, name: 'AI Plan Park', placeType: 'park', address: '2 Plan Road', coordinates: { type: 'Point', coordinates: [106.912, 11.31] } },
      ]);
    });

    it('fills what the parent said, asks one step at a time and ends with a draft POST /playdates accepts', async () => {
      const sessionId = await newSession(host);
      mockModel(
        geminiToolCall('proposePlaydate', { startNew: true, participantNames: ['bin', 'Lạ'], activity: 'Vẽ tranh', date: day }),
        geminiText('Bạn chọn giờ cho buổi hẹn nhé.')
      );
      const first = await api(host).send(sessionId, `Lên lịch cho bé vẽ tranh với Bin ngày ${day}`);
      expect(first.status).toBe(200);
      const { cards } = first.body.data.reply;
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ type: 'choices', stepId: 'time' });
      expect(cards[0].options.length).toBeGreaterThan(0);
      expect(cards[0].options.every((option) => option.data.date === day)).toBe(true);
      expect(first.body.data.planDraft).toMatchObject({ status: 'collecting', nextStep: 'time', activity: 'Buổi vẽ tranh sáng tạo ngoài trời' });
      expect(first.body.data.planDraft.participants.map((p) => p.childName)).toEqual(['Bin']);
      expect(first.body.data.planDraft.warnings).toEqual([expect.objectContaining({ code: 'INVITEE_NOT_FRIEND', value: 'Lạ' })]);

      // Time picked by tapping: playmates and activity are known, so the place step comes next
      const slot = cards[0].options.find((option) => option.data.time === '09:00') || cards[0].options[0];
      mockModel(geminiText('Giờ chọn địa điểm nhé.'));
      const second = await api(host).send(sessionId, {
        content: `Chọn: ${slot.label}`,
        choice: { messageId: first.body.data.reply.id, stepId: 'time', optionIds: [slot.id] },
      });
      expect(second.status).toBe(200);
      const placeCard = second.body.data.reply.cards[0];
      expect(placeCard).toMatchObject({ type: 'choices', stepId: 'place' });
      const parkOption = placeCard.options.find((option) => option.label === 'AI Plan Park');
      expect(parkOption.links.map((link) => link.kind)).toEqual(expect.arrayContaining(['osm', 'google_maps']));
      // Google Maps searches the place by name and address (its OSM center may show another address)
      expect(parkOption.links.find((link) => link.kind === 'google_maps').href).toBe(
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('AI Plan Park, 2 Plan Road')}`
      );
      expect(JSON.stringify(parkOption)).not.toContain(SECRET_ADDRESS);

      // Place picked: the model writes the main activities, shown for the parent to edit (warm-up items dropped)
      mockModel(
        geminiToolCall('proposePlaydate', { agenda: ['Làm quen, chào hỏi', 'Vẽ tranh màu nước', 'Chơi cầu trượt'] }),
        geminiText('Đây là các hoạt động chính, bạn chỉnh nếu muốn nhé.')
      );
      const third = await api(host).send(sessionId, {
        content: 'Chọn: AI Plan Park',
        choice: { messageId: second.body.data.reply.id, stepId: 'place', optionIds: [parkOption.id] },
      });
      expect(third.status).toBe(200);
      const [agendaCard] = third.body.data.reply.cards;
      expect(agendaCard).toMatchObject({ type: 'choices', stepId: 'agenda', allowCustom: true });
      expect(agendaCard.options.map((o) => o.label)).toEqual(['Vẽ tranh màu nước', 'Chơi cầu trượt']);

      // Edited agenda confirmed: last question before the summary
      mockModel(geminiText('Bạn có muốn thêm gì không?'));
      const fourth = await api(host).send(sessionId, {
        content: 'Dùng các hoạt động này',
        choice: {
          messageId: third.body.data.reply.id,
          stepId: 'agenda',
          custom: { agenda: ['Vẽ tranh màu nước', 'Chơi cầu trượt', 'Ăn nhẹ & picnic'] },
        },
      });
      expect(fourth.status).toBe(200);
      const [extraCard] = fourth.body.data.reply.cards;
      expect(extraCard).toMatchObject({ type: 'choices', stepId: 'extra', allowCustom: true });

      mockModel(geminiText('Bạn kiểm tra và xác nhận nhé.'));
      const fifth = await api(host).send(sessionId, {
        content: 'Không, xem lịch hẹn',
        choice: { messageId: fourth.body.data.reply.id, stepId: 'extra', optionIds: ['extra:none'] },
      });
      expect(fifth.status).toBe(200);
      const draftCard = fifth.body.data.reply.cards.find((c) => c.type === 'playdate_draft');
      expect(draftCard).toMatchObject({ stepId: 'confirm', status: 'open' });
      const { draft } = draftCard;
      expect(draft).toMatchObject({ status: 'ready', nextStep: 'confirm', hostChildId: host.childId, scheduledDate: day, time: slot.data.time });
      expect(draft.endTime).toMatch(/^\d{2}:\d{2}$/);
      expect(draft.note).toBe(`${AI_AGENDA_NOTE_HEADER}\n1. Vẽ tranh màu nước\n2. Chơi cầu trượt\n3. Ăn nhẹ & picnic`);
      expect(draft.location).toMatchObject({ name: 'AI Plan Park', address: '2 Plan Road', coordinates: { type: 'Point', coordinates: [106.912, 11.31] } });
      // The place keeps the details of the place step for the summary
      expect(draft.placeDetails).toMatchObject({ placeType: 'park', osmUrl: expect.stringContaining('openstreetmap.org') });
      expect(draft.placeDetails.familyDistances[0]).toMatchObject({ label: 'Nhà bạn', distanceKm: expect.any(Number) });

      // Nothing was created before the parent confirms
      expect(await Playdate.countDocuments({ hostParentId: host.parentId })).toBe(0);

      // Confirm: created with the POST /playdates rules, the plan is closed, the model only wishes them fun
      const spy = mockModel(geminiText('Chúc các bé chơi vui!'));
      const callsBefore = spy.mock.calls.length;
      const confirmed = await api(host).send(sessionId, {
        content: 'Xác nhận tạo lịch hẹn',
        choice: { messageId: fifth.body.data.reply.id, stepId: 'confirm', optionIds: ['confirm:create'] },
      });
      expect(confirmed.status).toBe(200);
      expect(spy.mock.calls.length - callsBefore).toBe(1);
      expect(confirmed.body.data.planDraft).toBeNull();
      const playdate = await Playdate.findOne({ hostParentId: host.parentId }).lean();
      expect(playdate).toMatchObject({ activity: draft.activity, time: draft.time, note: draft.note });
      expect(playdate.participants.map((p) => p.childId.toString())).toEqual([friend.childId]);

      const detail = await api(host).get(sessionId);
      const answered = detail.body.data.session.messages.flatMap((m) => m.cards).find((c) => c.type === 'playdate_draft');
      expect(answered).toMatchObject({ status: 'answered', playdateId: playdate._id.toString() });

      // A closed plan: the summary cannot be confirmed again
      const again = await api(host).send(sessionId, {
        content: 'Xác nhận tạo lịch hẹn',
        choice: { messageId: fifth.body.data.reply.id, stepId: 'confirm', optionIds: ['confirm:create'] },
      });
      expect(again.status).toBe(400);
      expect(await Playdate.countDocuments({ hostParentId: host.parentId })).toBe(1);
      await Playdate.deleteMany({ hostParentId: host.parentId });
    });

    it('offers only friends who are free at the chosen time, and one question per reply', async () => {
      const sessionId = await newSession(host);
      // The model asks for two steps at once: only the earliest one is shown
      mockModel(
        geminiToolCall([
          { name: 'proposePlaydate', args: { startNew: true, date: day, time: '09:00' } },
          { name: 'suggestActivities', args: {} },
        ]),
        geminiText('Mời bạn nào nhỉ?')
      );
      const res = await api(host).send(sessionId, `Hẹn chơi lúc 9h ngày ${day}`);
      expect(res.status).toBe(200);
      const { cards } = res.body.data.reply;
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ stepId: 'playmates', selectionMode: 'multiple', allowSkip: true });
      const names = cards[0].options.map((option) => option.label);
      expect(names).toContain('Bin');
      expect(names).not.toContain('Na');
      expect(names).not.toContain('Lạ');
      expect(cards[0].options[0].links).toEqual([{ kind: 'child_profile', childId: expect.any(String) }]);

      // Skipping the step is allowed; an option of another card is not
      const wrong = await api(host).send(sessionId, {
        content: 'x',
        choice: { messageId: res.body.data.reply.id, stepId: 'playmates', optionIds: ['playmate:000000000000000000000000'] },
      });
      expect(wrong.status).toBe(400);
      mockModel(geminiText('Các bé chơi gì nhỉ?'));
      const skipped = await api(host).send(sessionId, {
        content: 'Bỏ qua',
        choice: { messageId: res.body.data.reply.id, stepId: 'playmates', optionIds: ['__skip'] },
      });
      expect(skipped.status).toBe(200);
      expect(skipped.body.data.reply.cards[0]).toMatchObject({ stepId: 'activity' });
      expect(skipped.body.data.planDraft.participants).toEqual([]);
    });

    it('invites the children picked in the friend search of the card, friends only', async () => {
      const inviter = await registerParent('inviter');
      await connect(inviter, friend);
      const sessionId = await newSession(inviter);
      mockModel(geminiToolCall('proposePlaydate', { startNew: true, date: day, time: '15:00' }), geminiText('Mời bạn nào nhỉ?'));
      const res = await api(inviter).send(sessionId, `Hẹn chơi lúc 15h ngày ${day}`);
      expect(res.status).toBe(200);
      const [card] = res.body.data.reply.cards;
      expect(card).toMatchObject({ stepId: 'playmates', allowCustom: true, hostChildId: inviter.childId });

      mockModel(geminiText('Các bé chơi gì nhỉ?'));
      const picked = await api(inviter).send(sessionId, {
        content: 'Mời: Bin, Lạ',
        choice: { messageId: res.body.data.reply.id, stepId: 'playmates', custom: { childIds: [friend.childId, stranger.childId] } },
      });
      expect(picked.status).toBe(200);
      expect(picked.body.data.planDraft.participants.map((p) => p.childId)).toEqual([friend.childId]);
      expect(picked.body.data.planDraft.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'INVITEE_NOT_FRIEND', value: stranger.childId })])
      );
      expect(picked.body.data.answeredCard.cards[0]).toMatchObject({ status: 'answered', customAnswer: { text: 'Bin' } });
      expect(picked.body.data.reply.cards[0]).toMatchObject({ stepId: 'activity' });
    });

    it('lists every own child on the child step, with no typed name', async () => {
      const twoKids = await registerParent('twokids');
      await grantPremium(twoKids.parentId);
      await Child.create({ parentId: twoKids.parentId, displayName: 'Bé Hai', dateOfBirth: new Date('2020-01-01'), gender: 'boy' });
      const sessionId = await newSession(twoKids);
      mockModel(geminiToolCall('proposePlaydate', { startNew: true }), geminiText('Hẹn cho bé nào?'));
      const res = await api(twoKids).send(sessionId, 'Lên lịch hẹn chơi');
      expect(res.body.data.reply.cards[0]).toMatchObject({ stepId: 'child', allowCustom: false });
      expect(res.body.data.reply.cards[0].options).toHaveLength(2);
    });

    it('stops the plan right away when the playdate quota is used up', async () => {
      const limited = await registerParent('limited');
      await UsageQuota.create({
        parentId: limited.parentId,
        periodType: 'monthly',
        periodValue: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' }).format(new Date()),
        counters: { playdatesCreated: 3 },
      });
      const sessionId = await newSession(limited);
      const spy = mockModel(geminiToolCall('proposePlaydate', { startNew: true }), geminiText('Bạn đã hết lượt tạo lịch hẹn tháng này.'));
      const res = await api(limited).send(sessionId, 'Lên kế hoạch playdate');
      expect(res.status).toBe(200);
      expect(res.body.data.reply.cards).toEqual([expect.objectContaining({ type: 'quota_notice', feature: 'playdates_created', limit: 3 })]);
      expect(res.body.data.planDraft).toBeNull();
      const toolResult = spy.mock.calls[1][0].contents.at(-1).parts[0].functionResponse.response;
      expect(toolResult.error.code).toBe('PLAYDATE_QUOTA_EXCEEDED');
    });

    afterAll(async () => {
      await PlacesCache.deleteOne({ _id: park?._id });
      await Playdate.deleteMany({ hostParentId: { $in: [host.parentId, busyFriend.parentId] } });
      await Child.deleteOne({ _id: stranger.childId });
    });
  });
});
