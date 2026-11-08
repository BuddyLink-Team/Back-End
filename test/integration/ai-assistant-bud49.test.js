import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import User from '../../src/modules/user/user.model.js';
import PlacesCache from '../../src/modules/places/places-cache.model.js';
import AIChatSession from '../../src/modules/ai-assistant/ai-assistant.model.js';
import geminiAdapter from '../../src/integrations/ai/gemini.adapter.js';
import aiAssistantService from '../../src/modules/ai-assistant/ai-assistant.service.js';
import chatService from '../../src/modules/chat/chat.service.js';
import { geminiText, geminiToolCall } from '../mocks/geminiMock.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

/**
 * BUD-49: playmates before the time step, confirmation cards of the playdate tools, retried messages,
 * rebooking after a good rating, chaperones and system messages of the playdate group chat.
 */

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
// Own area, so the parents and places of the other test files never show up
const HOME = [105.21, 9.81];
const NEAR = [105.215, 9.81];
const FIVE_YEARS_AGO = new Date(new Date().getFullYear() - 5, new Date().getMonth() - 2, 1);
const WEEKEND_MORNING = { preferredPlaydateDays: ['weekend'], preferredTimeSlots: ['morning'] };

// Next day of the given type, at least two days ahead
const nextDay = (isWeekend) => {
  for (let offset = 2; offset < 10; offset += 1) {
    const date = new Date(Date.now() + offset * DAY);
    const weekDay = date.getUTCDay();
    if ((weekDay === 0 || weekDay === 6) === isWeekend) return date.toISOString().slice(0, 10);
  }
  return null;
};

let seq = 0;
const registerParent = async (label, { preferences = {}, child = {} } = {}) => {
  seq += 1;
  const email = `bud49-${label}-${Date.now()}-${seq}@example.com`;
  const res = await request(app).post('/api/v1/auth/register').send({ fullName: `Bud ${label}`, email, password: PASSWORD });
  const parentId = res.body.data.parent.id;
  await Parent.updateOne(
    { _id: parentId },
    {
      $set: {
        'location.coordinates': { type: 'Point', coordinates: label === 'host' ? HOME : NEAR },
        'location.area': 'Phường Test',
        'location.city': 'Cần Thơ',
        'preferences.maxDistanceKm': 10,
        ...Object.fromEntries(Object.entries(preferences).map(([key, value]) => [`preferences.${key}`, value])),
      },
    }
  );
  const created = await Child.create({
    parentId,
    displayName: `Kid ${label}`,
    dateOfBirth: FIVE_YEARS_AGO,
    gender: 'girl',
    interests: ['Vẽ'],
    ...child,
  });
  return { token: res.body.data.tokens.accessToken, parentId, childId: created._id.toString(), userId: res.body.data.user?.id };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted' });

const auth = (parent) => ({ Authorization: `Bearer ${parent.token}` });
const newSession = async (parent) =>
  (await request(app).post('/api/v1/ai-assistant/sessions').set(auth(parent))).body.data.session.id;
const send = (parent, sessionId, body) =>
  request(app)
    .post(`/api/v1/ai-assistant/sessions/${sessionId}/messages`)
    .set(auth(parent))
    .send(typeof body === 'string' ? { content: body } : body);

const mockModel = (...responses) => {
  const spy = jest.spyOn(geminiAdapter, 'generateContent');
  responses.forEach((response) => spy.mockResolvedValueOnce(response));
  return spy;
};

const createPlaydate = (host, friend, extra = {}) =>
  Playdate.create({
    hostParentId: host.parentId,
    hostChildId: host.childId,
    participants: [{ parentId: friend.parentId, childId: friend.childId, status: 'accepted' }],
    scheduledDate: new Date(Date.now() + 5 * DAY),
    time: '09:00',
    durationMinutes: 120,
    activity: 'Buổi vẽ tranh sáng tạo ngoài trời',
    location: { name: 'Công viên BUD49', address: '1 Đường Test' },
    ...extra,
  });

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AI assistant planning order and actions (BUD-49)', () => {
  let host;
  let friend;

  beforeAll(async () => {
    host = await registerParent('host', { preferences: WEEKEND_MORNING });
    friend = await registerParent('friend', { preferences: WEEKEND_MORNING, child: { displayName: 'Bin49' } });
    await connect(host, friend);
  });

  afterAll(async () => {
    await Playdate.deleteMany({ hostParentId: { $in: [host.parentId, friend.parentId] } });
  });

  it('asks for the playmates first, then ranks the times for every invited family', async () => {
    const sessionId = await newSession(host);
    mockModel(geminiToolCall('proposePlaydate', { startNew: true, activity: 'Vẽ tranh' }), geminiText('Bé muốn mời bạn nào?'));
    const first = await send(host, sessionId, 'Lên lịch cho bé đi vẽ tranh');
    expect(first.status).toBe(200);
    const [playmatesCard] = first.body.data.reply.cards;
    expect(playmatesCard).toMatchObject({ type: 'choices', stepId: 'playmates' });
    const bin = playmatesCard.options.find((option) => option.label === 'Bin49');

    mockModel(geminiText('Bạn chọn giờ nhé.'));
    const second = await send(host, sessionId, {
      content: 'Chọn: Bin49',
      choice: { messageId: first.body.data.reply.id, stepId: 'playmates', optionIds: [bin.id] },
    });
    expect(second.status).toBe(200);
    const [timeCard] = second.body.data.reply.cards;
    expect(timeCard).toMatchObject({ type: 'choices', stepId: 'time' });
    expect(timeCard.options.length).toBeGreaterThan(0);
    // Both families are counted, and the best slot fits them all (weekend morning)
    expect(timeCard.options.every((option) => option.data.totalParents === 2)).toBe(true);
    expect(timeCard.options[0].description).toBe('2 giờ · Hợp lịch ưu tiên của các gia đình');
    timeCard.options.forEach((option) =>
      expect(option.description).toMatch(/ · (Hợp lịch ưu tiên của các gia đình|Hợp với \d\/2 gia đình|Chưa ai đặt lịch ưu tiên)$/)
    );
  });

  it('warns when the typed time is outside the families’ preferred slots', async () => {
    const sessionId = await newSession(host);
    mockModel(
      geminiToolCall('proposePlaydate', { startNew: true, participantNames: ['Bin49'], date: nextDay(false), time: '19:00' }),
      geminiText('Giờ này hơi khác lịch ưu tiên.')
    );
    const res = await send(host, sessionId, 'Hẹn chơi với Bin49 lúc 19h');
    expect(res.status).toBe(200);
    expect(res.body.data.planDraft.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'NOT_PREFERRED_TIME', severity: 'info', params: { matchedParents: 0, totalParents: 2 } }),
      ])
    );
  });

  it('cancels a playdate only after the parent taps the confirmation card', async () => {
    const playdate = await createPlaydate(host, friend);
    const sessionId = await newSession(host);
    mockModel(
      geminiToolCall('cancelPlaydate', { playdateId: playdate._id.toString(), reason: 'Bé ốm' }),
      geminiText('Bạn xác nhận trên thẻ nhé.')
    );
    const asked = await send(host, sessionId, 'Hủy hẹn với Bin49');
    expect(asked.status).toBe(200);
    const [card] = asked.body.data.reply.cards;
    expect(card).toMatchObject({ type: 'choices', stepId: 'cancel_confirm' });
    expect((await Playdate.findById(playdate._id).lean()).status).toBe('upcoming');

    mockModel(geminiText('Đã hủy buổi hẹn.'));
    const confirmed = await send(host, sessionId, {
      content: 'Xác nhận hủy hẹn',
      choice: { messageId: asked.body.data.reply.id, stepId: 'cancel_confirm', optionIds: [card.options[0].id] },
    });
    expect(confirmed.status).toBe(200);
    expect((await Playdate.findById(playdate._id).lean()).status).toBe('cancelled');
  });

  it('returns the stored turn for a retried message instead of running it again', async () => {
    const sessionId = await newSession(host);
    const spy = mockModel(geminiText('Chào bạn!'));
    const first = await send(host, sessionId, { content: 'Xin chào', clientMessageId: 'local-1' });
    expect(first.status).toBe(200);
    const calls = spy.mock.calls.length;

    const retried = await send(host, sessionId, { content: 'Xin chào', clientMessageId: 'local-1' });
    expect(retried.status).toBe(200);
    expect(retried.body.data).toMatchObject({ replayed: true, reply: { id: first.body.data.reply.id } });
    expect(spy.mock.calls.length).toBe(calls);
    const session = await AIChatSession.findById(sessionId).lean();
    expect(session.messageCount).toBe(1);
  });

  it('prepares a rebooking plan with the same friends after a 5-star rating', async () => {
    const playdate = await createPlaydate(host, friend, {
      scheduledDate: new Date(Date.now() - 2 * DAY),
      status: 'completed',
      completedAt: new Date(Date.now() - DAY),
    });
    const rated = await request(app).post(`/api/v1/playdates/${playdate._id}/ratings`).set(auth(host)).send({ rating: 5 });
    expect(rated.status).toBe(201);

    // The notification is sent in the background
    let notification = null;
    for (let attempt = 0; attempt < 40 && !notification; attempt += 1) {
      notification = await Notification.findOne({ type: 'ai_suggestion', 'data.playdateId': playdate._id.toString() }).lean();
      if (!notification) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(notification).toMatchObject({ title: 'Hẹn lại với Bin49 nhé?' });

    const session = await AIChatSession.findById(notification.data.sessionId).lean();
    expect(session.planDraft.participants.map((participant) => participant.childName)).toEqual(['Bin49']);
    expect(session.planDraft.location).toMatchObject({ name: 'Công viên BUD49' });
    expect(session.messages[0].cards[0]).toMatchObject({ type: 'choices', stepId: 'time' });
    // Nothing is billed before the parent writes
    expect(session.quotaConsumedAt).toBeNull();
  });

  it('skips the rebooking plan when nobody else attended', async () => {
    const lonely = await createPlaydate(host, friend, { participants: [], status: 'completed' });
    expect(await aiAssistantService.prepareRebookingSession({ parentId: host.parentId, playdateId: lonely._id.toString() })).toBeNull();
  });
});

describe('Playdate chaperones and group chat system messages (BUD-49)', () => {
  let host;
  let friend;
  let playdate;

  beforeAll(async () => {
    host = await registerParent('chap-host');
    friend = await registerParent('chap-friend');
    await connect(host, friend);
    playdate = await createPlaydate(host, friend);
  });

  afterAll(async () => {
    await Playdate.deleteMany({ hostParentId: host.parentId });
  });

  it('returns the playdate with its chaperone summary after a confirmation', async () => {
    const res = await request(app).post(`/api/v1/playdates/${playdate._id}/chaperone`).set(auth(host)).send({ action: 'confirm' });
    expect(res.status).toBe(200);
    expect(res.body.data.chaperoneSummary).toMatchObject({ confirmedChaperones: 1, isChaperoneConfirmedByMe: true });
    expect(res.body.data.chaperoneSummary.missingChaperones).toBe(
      Math.max(0, res.body.data.chaperoneSummary.requiredChaperones - 1)
    );

    const invalid = await request(app).post(`/api/v1/playdates/${playdate._id}/chaperone`).set(auth(host)).send({ action: 'maybe' });
    expect(invalid.status).toBe(400);
  });

  it('posts a system message without a sender', async () => {
    const conversation = await Conversation.create({
      type: 'playdate',
      playdateId: playdate._id,
      participants: [host.parentId, friend.parentId],
    });
    const message = await chatService.postSystemMessage(conversation._id, 'Nhắc lịch hẹn');
    expect(message).toMatchObject({ type: 'system', content: 'Nhắc lịch hẹn', senderId: null });
  });
});

describe('Several own children in one playdate (BUD-49)', () => {
  let host;
  let sibling;
  let friend;
  const day = new Date(Date.now() + 4 * DAY).toISOString();
  const createBody = (extra = {}) => ({
    hostChildId: host.childId,
    hostChildIds: [host.childId, sibling._id.toString()],
    scheduledDate: day,
    time: '09:00',
    durationMinutes: 60,
    activity: 'Vẽ tranh',
    location: { name: 'Công viên BUD49', address: '1 Đường Test' },
    participants: [{ parentId: friend.parentId, childId: friend.childId }],
    ...extra,
  });

  beforeAll(async () => {
    host = await registerParent('multi-host');
    // The Free plan keeps one child usable: two own children need Premium
    await grantPremium(host.parentId);
    sibling = await Child.create({ parentId: host.parentId, displayName: 'Em Bé', dateOfBirth: FIVE_YEARS_AGO, gender: 'boy' });
    friend = await registerParent('multi-friend');
    await connect(host, friend);
  });

  afterAll(async () => {
    await Playdate.deleteMany({ hostParentId: host.parentId });
  });

  it('creates a playdate with every own child and keeps the main one first', async () => {
    const res = await request(app).post('/api/v1/playdates').set(auth(host)).send(createBody());
    expect(res.status).toBe(201);
    expect(res.body.data.hostChildId).toBe(host.childId);
    expect(res.body.data.hostChildIds).toEqual([host.childId, sibling._id.toString()]);
    expect(res.body.data.hostChildren.map((child) => child.displayName)).toEqual(['Kid multi-host', 'Em Bé']);
  });

  it('refuses a time when one of the own children is already busy', async () => {
    // The sibling alone is in the first playdate at 09:00: a playdate with the sibling at 09:30 clashes
    const res = await request(app)
      .post('/api/v1/playdates')
      .set(auth(host))
      .send(createBody({ hostChildIds: [sibling._id.toString()], hostChildId: sibling._id.toString(), time: '09:30', participants: [] }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SCHEDULE_CONFLICT');
  });

  it('refuses a child of another family as an own child', async () => {
    const res = await request(app).post('/api/v1/playdates').set(auth(host)).send(createBody({ hostChildIds: [host.childId, friend.childId], time: '15:00' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_HOST_CHILD');
  });

  it('lets the AI child step pick several children', async () => {
    const sessionId = await newSession(host);
    mockModel(geminiToolCall('proposePlaydate', { startNew: true }), geminiText('Bé nào đi chơi nhỉ?'));
    const asked = await send(host, sessionId, 'Lên kế hoạch hẹn chơi');
    const [childCard] = asked.body.data.reply.cards;
    expect(childCard).toMatchObject({ stepId: 'child', selectionMode: 'multiple' });

    mockModel(geminiText('Mời bạn nào nhỉ?'));
    const picked = await send(host, sessionId, {
      content: 'Chọn: 2 bé',
      choice: { messageId: asked.body.data.reply.id, stepId: 'child', optionIds: childCard.options.map((option) => option.id) },
    });
    expect(picked.status).toBe(200);
    expect(picked.body.data.planDraft.hostChildIds).toHaveLength(2);
    expect(picked.body.data.reply.cards[0]).toMatchObject({ stepId: 'playmates' });
  });
});

describe('Playmates of locked accounts and places picked by hand (BUD-49)', () => {
  let host;
  let locked;
  let place;

  beforeAll(async () => {
    host = await registerParent('lock-host');
    locked = await registerParent('lock-friend', { child: { displayName: 'BanLock' } });
    await connect(host, locked);
    [place] = await PlacesCache.insertMany([
      {
        osmId: `osm-way-${Date.now()}`,
        name: 'Khu vui chơi BUD49',
        placeType: 'kids_cafe',
        openingHours: 'Mo-Su 08:00-21:00',
        address: '9 Đường Test',
        coordinates: { type: 'Point', coordinates: NEAR },
      },
    ]);
  });

  afterAll(async () => {
    await PlacesCache.deleteOne({ _id: place._id });
    await Playdate.deleteMany({ hostParentId: host.parentId });
  });

  it('hides and refuses the children of a suspended family', async () => {
    const userId = (await Parent.findById(locked.parentId).lean()).userId;
    await User.updateOne({ _id: userId }, { $set: { isActive: false, suspensionUntil: new Date(Date.now() + DAY) } });

    const friends = await request(app).get(`/api/v1/playdates/friends?childId=${host.childId}`).set(auth(host));
    expect(friends.status).toBe(200);
    const names = [...friends.body.data.matched, ...friends.body.data.others].map((entry) => entry.child.displayName);
    expect(names).not.toContain('BanLock');

    const created = await request(app)
      .post('/api/v1/playdates')
      .set(auth(host))
      .send({
        hostChildId: host.childId,
        scheduledDate: new Date(Date.now() + 3 * DAY).toISOString(),
        time: '09:00',
        activity: 'Vẽ tranh',
        location: { name: 'Công viên BUD49', address: '1 Đường Test' },
        participants: [{ parentId: locked.parentId, childId: locked.childId }],
      });
    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('INVALID_PARTICIPANT_CHILD');
  });

  it('keeps the cached details of a place picked in the search by its OpenStreetMap id', async () => {
    const sessionId = await newSession(host);
    mockModel(geminiToolCall('proposePlaydate', { startNew: true, noPlaymates: true, activity: 'Vẽ tranh' }), geminiText('Chọn giờ nhé.'));
    await send(host, sessionId, 'Lên kế hoạch');
    // Answer the remaining steps until the place step
    const session = await AIChatSession.findById(sessionId).lean();
    await AIChatSession.updateOne(
      { _id: sessionId },
      { $set: { 'planDraft.playmatesSkipped': true, 'planDraft.date': new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10), 'planDraft.time': '09:00' } }
    );
    expect(session.planDraft).toBeTruthy();

    // The search modal sends only the name, the address and the OpenStreetMap id
    mockModel(geminiToolCall('proposePlaydate', { placeId: place.osmId }), geminiText('Đã chọn địa điểm.'));
    const res = await send(host, sessionId, 'Chọn Khu vui chơi BUD49');
    expect(res.status).toBe(200);
    expect(res.body.data.planDraft.placeDetails).toMatchObject({ placeType: 'kids_cafe', openingHours: 'Mo-Su 08:00-21:00' });
    expect(res.body.data.planDraft.location).toMatchObject({ name: 'Khu vui chơi BUD49' });
  });
});

describe('Opening hours and time rules in the Create Playdate form (BUD-49 C)', () => {
  let host;
  let closedPlace;
  const day = (() => {
    // Next Saturday at least 3 days ahead: no school-hours rule
    for (let offset = 3; offset < 11; offset += 1) {
      const date = new Date(Date.now() + offset * DAY);
      if (date.getUTCDay() === 6) return date.toISOString().slice(0, 10);
    }
    return null;
  })();

  beforeAll(async () => {
    host = await registerParent('hours-host');
    [closedPlace] = await PlacesCache.insertMany([
      {
        osmId: `osm-node-${Date.now()}`,
        name: 'Khu vui chơi đóng sớm',
        placeType: 'kids_cafe',
        openingHours: 'Mo-Su 08:00-12:00',
        address: '3 Đường Test',
        coordinates: { type: 'Point', coordinates: NEAR },
      },
    ]);
  });

  afterAll(async () => {
    await PlacesCache.deleteOne({ _id: closedPlace._id });
    await Playdate.deleteMany({ hostParentId: host.parentId });
  });

  it('lists every time rule of a chosen time, with the place hours', async () => {
    const res = await request(app)
      .get('/api/v1/playdates/suggestions/time-check')
      .query({ childId: host.childId, date: day, time: '15:00', durationMinutes: 60, placeId: closedPlace.osmId })
      .set(auth(host));
    expect(res.status).toBe(200);
    expect(res.body.data.issues[0]).toMatchObject({ code: 'PLACE_CLOSED', severity: 'block' });
  });

  it('suggests only the times the place is open', async () => {
    const res = await request(app)
      .get('/api/v1/playdates/suggestions/time-slots')
      .query({ childId: host.childId, from: day, to: day, durationMinutes: 60, placeId: closedPlace.osmId })
      .set(auth(host));
    expect(res.status).toBe(200);
    expect(res.body.data.slots.map((slot) => slot.time)).toEqual(['09:00']);
  });

  it('refuses a playdate at a closed place', async () => {
    const res = await request(app)
      .post('/api/v1/playdates')
      .set(auth(host))
      .send({
        hostChildId: host.childId,
        scheduledDate: new Date(`${day}T00:00:00.000Z`).toISOString(),
        time: '15:00',
        durationMinutes: 60,
        activity: 'Vẽ tranh',
        location: { name: closedPlace.name, address: closedPlace.address, placeId: closedPlace.osmId },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLACE_CLOSED');
  });
});
