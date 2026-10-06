import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';
import Parent from '../../src/modules/parent/parent.model.js';

const registerParent = async (label) => {
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: `Parent ${label}`,
    email: `child-${label}-${Date.now()}@example.com`,
    password: 'Password123!',
  });
  return {
    token: res.body.data.tokens.accessToken,
    parentId: res.body.data.parent.id,
  };
};

const validChild = {
  displayName: 'Be Na',
  dateOfBirth: '2021-05-10',
  gender: 'girl',
  interests: ['Lego'],
};

describe('Child profile security & validation', () => {
  let parentA;
  let parentB;
  let childIdA;

  beforeAll(async () => {
    parentA = await registerParent('a');
    parentB = await registerParent('b');
  });

  it('should require displayName, dateOfBirth and gender when creating', async () => {
    const res = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${parentA.token}`)
      .send({ interests: ['Lego'] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should ignore server-controlled fields (parentId, isArchived) on create', async () => {
    const res = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${parentA.token}`)
      .send({ ...validChild, parentId: parentB.parentId, isArchived: true });

    expect(res.status).toBe(201);
    childIdA = res.body.data.id;

    const stored = await Child.findById(childIdA).lean();
    expect(stored.parentId.toString()).toBe(parentA.parentId);
    expect(stored.isArchived).toBe(false);
  });

  it('should not allow moving a child to another parent via update', async () => {
    const res = await request(app)
      .put(`/api/v1/children/${childIdA}`)
      .set('Authorization', `Bearer ${parentA.token}`)
      .send({ displayName: 'Be Na Na', parentId: parentB.parentId });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Be Na Na');

    const stored = await Child.findById(childIdA).lean();
    expect(stored.parentId.toString()).toBe(parentA.parentId);
  });

  it('should allow partial updates without requiring every field', async () => {
    const res = await request(app)
      .put(`/api/v1/children/${childIdA}`)
      .set('Authorization', `Bearer ${parentA.token}`)
      .send({ personality: ['Năng động'] });

    expect(res.status).toBe(200);
    expect(res.body.data.personality).toEqual(['Năng động']);
  });

  it("should not expose another parent's child profile", async () => {
    const ownRes = await request(app)
      .get(`/api/v1/children/${childIdA}`)
      .set('Authorization', `Bearer ${parentA.token}`);
    expect(ownRes.status).toBe(200);

    const otherRes = await request(app)
      .get(`/api/v1/children/${childIdA}`)
      .set('Authorization', `Bearer ${parentB.token}`);
    expect(otherRes.status).toBe(404);
    expect(otherRes.body.error.code).toBe('CHILD_NOT_FOUND');
  });
});

describe('Child public profile visibility', () => {
  let owner;
  let viewer;
  let childId;

  const getPublicProfile = (token) =>
    request(app).get(`/api/v1/children/${childId}/public-profile`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    owner = await registerParent('public-owner');
    viewer = await registerParent('public-viewer');
    const res = await request(app)
      .post('/api/v1/children')
      .set('Authorization', `Bearer ${owner.token}`)
      .send(validChild);
    childId = res.body.data.id;
  });

  it('should return the public profile without legacy child fields', async () => {
    const res = await getPublicProfile(viewer.token);

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe(validChild.displayName);
    expect(res.body.data).not.toHaveProperty('avatarUrl');
    expect(res.body.data).not.toHaveProperty('schoolLevel');
  });

  it('should hide the profile of a hidden parent from others but not from the owner', async () => {
    await Parent.findByIdAndUpdate(owner.parentId, { $set: { 'privacySettings.isProfileHidden': true } });

    const viewerRes = await getPublicProfile(viewer.token);
    expect(viewerRes.status).toBe(404);
    expect(viewerRes.body.error.code).toBe('CHILD_NOT_FOUND');

    const ownerRes = await getPublicProfile(owner.token);
    expect(ownerRes.status).toBe(200);

    await Parent.findByIdAndUpdate(owner.parentId, { $set: { 'privacySettings.isProfileHidden': false } });
  });

  it('should hide the profile when the owner has blocked the viewer', async () => {
    const blockRes = await request(app)
      .post('/api/v1/safety/block')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ blockedId: viewer.parentId, reason: 'test' });
    expect(blockRes.status).toBeLessThan(300);

    const res = await getPublicProfile(viewer.token);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CHILD_NOT_FOUND');
  });
});
