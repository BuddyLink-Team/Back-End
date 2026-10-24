import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Block from '../../src/modules/safety/block.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import PlacesCache from '../../src/modules/places/places-cache.model.js';

const PASSWORD = 'Password123!';
const DAY = 24 * 60 * 60 * 1000;
const isoDay = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
// Isolated area so the shared test DB's other places never show up
const HOST_HOME = [105.5, 12.5];
const FRIEND_HOME = [105.52, 12.5];

const registerParent = async (label, { coordinates, preferences, child = {} } = {}) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Suggest ${label}`,
    email: `pd-suggest-${label}-${Date.now()}-${Math.random()}@example.com`,
    password: PASSWORD,
  });
  const parentId = res.body.data.parent.id;
  const set = {};
  if (coordinates) set['location.coordinates'] = { type: 'Point', coordinates };
  if (preferences) set.preferences = preferences;
  if (Object.keys(set).length) await Parent.updateOne({ _id: parentId }, { $set: set });
  const created = await Child.create({
    parentId,
    displayName: `Kid ${label}`,
    dateOfBirth: new Date('2020-01-01'),
    gender: 'girl',
    ...child,
  });
  return { token: res.body.data.tokens.accessToken, parentId, childId: created._id.toString() };
};

const connect = (a, b) =>
  Connection.create({ parents: [a.parentId, b.parentId], requesterId: a.parentId, recipientId: b.parentId, status: 'accepted' });

const suggest = (parent, kind, query) =>
  request(app).get(`/api/v1/playdates/suggestions/${kind}?${new URLSearchParams(query)}`).set('Authorization', `Bearer ${parent.token}`);

describe('Playdate suggestions (/api/v1/playdates/suggestions/*)', () => {
  let host;
  let friend;
  let stranger;

  beforeAll(async () => {
    const weekendMornings = { preferredPlaydateDays: ['weekend'], preferredTimeSlots: ['morning'], preferredLocations: ['park'] };
    host = await registerParent('host', {
      coordinates: HOST_HOME,
      preferences: weekendMornings,
      child: { interests: ['Lego & Lắp ráp'] },
    });
    friend = await registerParent('friend', {
      coordinates: FRIEND_HOME,
      preferences: weekendMornings,
      child: { favoriteActivities: ['Xếp hình Lego'] },
    });
    stranger = await registerParent('stranger', { coordinates: FRIEND_HOME });
    await connect(host, friend);
  });

  it('requires an own childId and children of connected friends only', async () => {
    const missing = await request(app).get('/api/v1/playdates/suggestions/activities').set('Authorization', `Bearer ${host.token}`);
    expect(missing.status).toBe(400);

    const foreign = await suggest(host, 'activities', { childId: friend.childId });
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('CHILD_NOT_FOUND');

    const notFriend = await suggest(host, 'activities', { childId: host.childId, participantChildIds: stranger.childId });
    expect(notFriend.status).toBe(403);
    expect(notFriend.body.error.code).toBe('NOT_CONNECTED_FRIEND');
  });

  it('refuses the child of a friend in a block relationship', async () => {
    const blocker = await registerParent('blocker');
    const blockedFriend = await registerParent('blocked-friend');
    await connect(blocker, blockedFriend);
    await Block.create({ blockerId: blockedFriend.parentId, blockedId: blocker.parentId });

    const res = await suggest(blocker, 'activities', { childId: blocker.childId, participantChildIds: blockedFriend.childId });
    expect(res.status).toBe(403);
  });

  it('suggests activities both children like', async () => {
    const res = await suggest(host, 'activities', { childId: host.childId, participantChildIds: friend.childId });
    expect(res.status).toBe(200);
    expect(res.body.data.activities[0]).toMatchObject({
      key: 'Xếp hình Lego',
      sharedCount: 2,
      reason: 'Cả hai bé đều thích xếp hình lego',
    });
  });

  it('suggests weekend mornings without the slots where a child is already busy', async () => {
    // Next Saturday and Sunday (at least 2 days ahead, so never in the past)
    const saturdayOffset = ((6 - new Date(Date.now() + 2 * DAY).getUTCDay() + 7) % 7) + 2;
    const from = isoDay(saturdayOffset);
    const to = isoDay(saturdayOffset + 1);

    // The friend's child already has a playdate on Saturday morning
    await Playdate.create({
      hostParentId: friend.parentId,
      hostChildId: friend.childId,
      scheduledDate: new Date(from),
      time: '09:30',
      activity: 'Bơi',
      location: { name: 'Pool', address: 'Somewhere' },
    });

    const res = await suggest(host, 'time-slots', {
      childId: host.childId,
      participantChildIds: friend.childId,
      from,
      to,
    });
    expect(res.status).toBe(200);
    const { slots } = res.body.data;
    expect(slots.length).toBeLessThanOrEqual(8);
    expect(slots[0]).toMatchObject({ date: to, time: '09:00', timeSlot: 'morning', matchedParents: 2, totalParents: 2 });
    expect(slots.find((s) => s.date === from && s.time === '09:00')).toBeUndefined();
  });

  it('rejects a time-slot range longer than 14 days', async () => {
    const res = await suggest(host, 'time-slots', { childId: host.childId, from: isoDay(1), to: isoDay(20) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('suggests places near both families with map data, without exposing a family location', async () => {
    const places = await PlacesCache.insertMany([
      { osmId: `osm-node-${Date.now()}1`, name: 'Suggest Park', placeType: 'park', coordinates: { type: 'Point', coordinates: [105.5103, 12.5007] } },
      { osmId: `osm-node-${Date.now()}2`, name: 'Suggest Cafe', placeType: 'kids_cafe', coordinates: { type: 'Point', coordinates: [105.5104, 12.5007] } },
    ]);
    try {
      const res = await suggest(host, 'places', { childId: host.childId, participantChildIds: friend.childId });
      expect(res.status).toBe(200);
      const names = res.body.data.places.map((p) => p.name);
      // Both parents prefer parks: the park comes first even though the cafe is as close
      expect(names.slice(0, 2)).toEqual(['Suggest Park', 'Suggest Cafe']);
      // Same distance as Discovery: MongoDB $geoNear from each family's saved ward center
      const [park] = res.body.data.places;
      const geoNearKm = async (parentId) => {
        const [row] = await Parent.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: park.coordinates },
              distanceField: 'distanceMeters',
              spherical: true,
              query: { _id: new mongoose.Types.ObjectId(parentId) },
            },
          },
        ]);
        return Math.round(row.distanceMeters / 100) / 10;
      };
      expect(park.familyDistances).toEqual([
        { parentId: host.parentId, label: 'Nhà bạn', area: '', distanceKm: await geoNearKm(host.parentId) },
        { parentId: friend.parentId, label: 'Suggest friend', area: '', distanceKm: await geoNearKm(friend.parentId) },
      ]);
      // The place's own map coordinates and OpenStreetMap link (to open it on a map)
      expect(res.body.data.places[0].coordinates).toEqual([105.5103, 12.5007]);
      expect(res.body.data.places[0].osmUrl).toMatch(/openstreetmap\.org\/node\/\d+$/);

      // Never a family's coordinates ([105.5, 12.5], [105.52, 12.5]) nor their midpoint [105.51, 12.5]
      const coordinates = res.body.data.places.map((p) => p.coordinates);
      expect(coordinates).not.toContainEqual([105.5, 12.5]);
      expect(coordinates).not.toContainEqual([105.52, 12.5]);
      expect(coordinates).not.toContainEqual([105.51, 12.5]);
      expect(JSON.stringify(res.body.data)).not.toContain('midpoint');
    } finally {
      await PlacesCache.deleteMany({ _id: { $in: places.map((p) => p._id) } });
    }
  });

  it('needs at least one family location for place suggestions', async () => {
    const homeless = await registerParent('no-location');
    const res = await suggest(homeless, 'places', { childId: homeless.childId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LOCATION_REQUIRED');
  });
});
