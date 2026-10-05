import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import Child from '../../src/modules/child/child.model.js';

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
