import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import playdateService from '../../src/modules/playdate/playdate.service.js';
import { buildChildPairKey } from '../../src/modules/connection/connection.constants.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

const PASSWORD = 'Password123!';
const YEAR = 365.25 * 24 * 60 * 60 * 1000;
// Born `years` (and a half, so the whole-year age is stable) years ago
const bornYearsAgo = (years) => new Date(Date.now() - (years + 0.5) * YEAR);

const registerParent = async (label, children) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Pairing ${label}`,
    email: `pd-pairing-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  await Parent.updateOne(
    { _id: parentId },
    { $set: { location: { area: 'Hải Châu', city: 'Đà Nẵng', address: '1 Secret St', coordinates: { type: 'Point', coordinates: [108.22, 16.06] } } } }
  );
  if (children.length > 1) await grantPremium(parentId);
  const childIds = [];
  for (const child of children) {
    const created = await Child.create({ parentId, gender: 'girl', dateOfBirth: bornYearsAgo(5), ...child });
    childIds.push(created._id.toString());
  }
  return { token: res.body.data.tokens.accessToken, parentId, childIds };
};

const connect = (a, b, childPairs = []) =>
  Connection.create({
    parents: [a.parentId, b.parentId],
    requesterId: a.parentId,
    recipientId: b.parentId,
    status: 'accepted',
    connectedAt: new Date(),
    childPairs: childPairs.map(([x, y, matchScore]) => ({
      childIds: [x, y].sort(),
      pairKey: buildChildPairKey(x, y),
      source: 'discovery',
      matchScore: matchScore ?? null,
    })),
  });

const getFriends = (parent, query) =>
  request(app).get(`/api/v1/playdates/friends${query}`).set('Authorization', `Bearer ${parent.token}`);

describe('GET /playdates/friends?childId= (child-first invite list)', () => {
  it('returns matched playmates before the other friend children, with scores and age warnings', async () => {
    const host = await registerParent('host', [{ displayName: 'Bin', interests: ['lego'] }]);
    const friendA = await registerParent('friend-a', [
      { displayName: 'Na', interests: ['lego'] },
      { displayName: 'Older', dateOfBirth: bornYearsAgo(9) },
    ]);
    const friendB = await registerParent('friend-b', [
      { displayName: 'Gap3', dateOfBirth: bornYearsAgo(8) },
    ]);
    const [binId] = host.childIds;
    await connect(host, friendA, [[binId, friendA.childIds[0], 80]]);
    await connect(host, friendB);

    const res = await getFriends(host, `?childId=${binId}`);
    expect(res.status).toBe(200);
    const { matched, others } = res.body.data;

    expect(matched).toHaveLength(1);
    expect(matched[0].child).toMatchObject({ id: friendA.childIds[0], displayName: 'Na', age: 5 });
    expect(matched[0].source).toBe('discovery');
    expect(matched[0].matchScore).toBeGreaterThanOrEqual(0);
    expect(matched[0].warnings).toEqual([]);

    expect(others.map((o) => o.child.displayName).sort()).toEqual(['Gap3', 'Older']);
    for (let i = 1; i < others.length; i += 1) {
      expect(others[i - 1].matchScore).toBeGreaterThanOrEqual(others[i].matchScore);
    }
    // 3 years apart: no warning; 4 years apart: AGE_GAP
    expect(others.find((o) => o.child.displayName === 'Gap3').warnings).toEqual([]);
    expect(others.find((o) => o.child.displayName === 'Older').warnings).toEqual([{ code: 'AGE_GAP', ageGapYears: 4 }]);

    // Privacy: area/city only, age only
    const body = JSON.stringify(res.body.data);
    expect(body).not.toContain('dateOfBirth');
    expect(body).not.toContain('1 Secret St');
    expect(body).not.toContain('coordinates');
    expect(matched[0].parent.location).toEqual({ area: 'Hải Châu', city: 'Đà Nẵng' });
  });

  it('keeps the old shape without childId and rejects a child of another parent', async () => {
    const host = await registerParent('legacy-host', [{ displayName: 'Own' }]);
    const friend = await registerParent('legacy-friend', [{ displayName: 'Friend Kid' }]);
    await connect(host, friend);

    const legacy = await getFriends(host, '');
    expect(Array.isArray(legacy.body.data)).toBe(true);
    expect(legacy.body.data[0].children[0].displayName).toBe('Friend Kid');

    const foreign = await getFriends(host, `?childId=${friend.childIds[0]}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('CHILD_NOT_FOUND');

    const invalid = await getFriends(host, '?childId=nope');
    expect(invalid.status).toBe(400);
  });
});

describe('Completed playdates pair the children', () => {
  it('adds a playdate pair for every accepted child when the host completes the playdate', async () => {
    const host = await registerParent('complete-host', [{ displayName: 'Host Kid' }]);
    const accepted = await registerParent('complete-accepted', [{ displayName: 'Accepted Kid' }]);
    const declined = await registerParent('complete-declined', [{ displayName: 'Declined Kid' }]);
    const connA = await connect(host, accepted);
    const connD = await connect(host, declined);

    // Already started: insert directly (the API only accepts future playdates)
    const playdate = await Playdate.create({
      hostParentId: host.parentId,
      hostChildId: host.childIds[0],
      scheduledDate: new Date(Date.now() - 2 * 60 * 60 * 1000),
      time: '00:00',
      activity: 'Picnic',
      location: { name: 'Park', address: 'Somewhere' },
      participants: [
        { parentId: accepted.parentId, childId: accepted.childIds[0], status: 'accepted' },
        { parentId: declined.parentId, childId: declined.childIds[0], status: 'declined' },
      ],
    });

    const res = await request(app)
      .patch(`/api/v1/playdates/${playdate._id}/complete`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(res.status).toBe(200);

    const pairs = (await Connection.findById(connA._id).lean()).childPairs;
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ source: 'playdate', pairKey: buildChildPairKey(host.childIds[0], accepted.childIds[0]) });
    expect((await Connection.findById(connD._id).lean()).childPairs).toHaveLength(0);
  });

  it('pairs the children of playdates closed by the daily job, without duplicating existing pairs', async () => {
    const host = await registerParent('job-host', [{ displayName: 'Job Host Kid' }]);
    const guest = await registerParent('job-guest', [{ displayName: 'Job Guest Kid' }]);
    const connection = await connect(host, guest, [[host.childIds[0], guest.childIds[0]]]);

    await Playdate.create({
      hostParentId: host.parentId,
      hostChildId: host.childIds[0],
      scheduledDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      time: '09:00',
      activity: 'Bơi',
      location: { name: 'Pool', address: 'Somewhere' },
      participants: [{ parentId: guest.parentId, childId: guest.childIds[0], status: 'accepted' }],
    });

    await playdateService.closeExpiredPlaydates();

    const pairs = (await Connection.findById(connection._id).lean()).childPairs;
    expect(pairs).toHaveLength(1);
    expect(pairs[0].source).toBe('discovery');
  });
});
