import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Subscription from '../../src/modules/subscription/subscription.model.js';
import { grantPremium } from '../helpers/subscriptionHelper.js';

// Children created while Premium are locked past the Free limit once it ends
describe('Child profiles locked after Premium ends', () => {
  const password = 'Password123!';
  const auth = (parent) => ({ Authorization: `Bearer ${parent.token}` });

  const createParent = async (label, coordinates) => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      fullName: `Lock ${label}`,
      email: `lock-${label}-${Date.now()}-${Math.random()}@example.com`,
      password,
    });
    const token = reg.body.data.tokens.accessToken;
    const parentId = reg.body.data.parent.id;
    await Parent.findByIdAndUpdate(parentId, {
      $set: { 'location.coordinates': { type: 'Point', coordinates } },
    });
    return { token, parentId };
  };

  const addChild = async (parent, displayName) => {
    const res = await request(app)
      .post('/api/v1/children')
      .set(auth(parent))
      .send({ displayName, dateOfBirth: '2020-01-01', gender: 'girl' });
    expect(res.status).toBe(201);
    return res.body.data.id;
  };

  const expirePremium = (parentId) =>
    Subscription.updateOne({ parentId }, { $set: { endDate: new Date(Date.now() - 60 * 1000) } });

  const setup = async (label) => {
    const owner = await createParent(`${label}-owner`, [105.0, 20.0]);
    await grantPremium(owner.parentId);
    const childIds = [];
    for (const name of ['First', 'Second', 'Third']) {
      childIds.push(await addChild(owner, `${label} ${name}`));
    }
    const viewer = await createParent(`${label}-viewer`, [105.0, 20.01]);
    await addChild(viewer, `${label} Viewer Kid`);
    return { owner, viewer, childIds };
  };

  const discoveredIds = async (parent) => {
    const res = await request(app).get('/api/v1/discovery').set(auth(parent));
    expect(res.status).toBe(200);
    return res.body.data.profiles.map((p) => p.childId.toString());
  };

  it('keeps the oldest child usable and locks the others for discovery and swipes', async () => {
    const { owner, viewer, childIds } = await setup('expire');
    const [first, second, third] = childIds;
    await expirePremium(owner.parentId);

    const mine = await request(app).get('/api/v1/children').set(auth(owner));
    expect(mine.status).toBe(200);
    const lockedById = Object.fromEntries(mine.body.data.map((c) => [c.id, c.isLocked]));
    expect(lockedById).toEqual({ [first]: false, [second]: true, [third]: true });

    // Locked children are hidden from other parents and cannot be swiped on
    const seen = await discoveredIds(viewer);
    expect(seen).toContain(first);
    expect(seen).not.toContain(second);
    expect(seen).not.toContain(third);
    const swipeLocked = await request(app)
      .post('/api/v1/discovery/swipe')
      .set(auth(viewer))
      .send({ targetChildId: second, isLike: false });
    expect(swipeLocked.status).toBe(404);

    // The owner cannot search or swipe for a locked child
    const searchLocked = await request(app).get(`/api/v1/discovery?childId=${second}`).set(auth(owner));
    expect(searchLocked.status).toBe(403);
    expect(searchLocked.body.error.code).toBe('CHILD_PROFILE_LOCKED');

    const [viewerKid] = await discoveredIds(owner);
    const swipeFor = await request(app)
      .post('/api/v1/discovery/swipe')
      .set(auth(owner))
      .send({ targetChildId: viewerKid, isLike: false, forChildId: third });
    expect(swipeFor.status).toBe(403);
    expect(swipeFor.body.error.code).toBe('CHILD_PROFILE_LOCKED');

    // The only usable child is picked without forChildId
    const swipeUsable = await request(app)
      .post('/api/v1/discovery/swipe')
      .set(auth(owner))
      .send({ targetChildId: viewerKid, isLike: false });
    expect(swipeUsable.status).toBe(201);
  });

  it('unlocks every child again when Premium is renewed', async () => {
    const { owner, viewer, childIds } = await setup('renew');
    await expirePremium(owner.parentId);
    await grantPremium(owner.parentId);

    const mine = await request(app).get('/api/v1/children').set(auth(owner));
    expect(mine.body.data.every((c) => c.isLocked === false)).toBe(true);
    expect(await discoveredIds(viewer)).toEqual(expect.arrayContaining(childIds));
  });
});
