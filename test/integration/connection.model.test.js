import { describe, it, expect, beforeAll } from '@jest/globals';
import mongoose from 'mongoose';
import Connection from '../../src/modules/connection/connection.model.js';

describe('Connection model uniqueness (pairKey)', () => {
  const parentA = new mongoose.Types.ObjectId();
  const parentB = new mongoose.Types.ObjectId();
  const parentC = new mongoose.Types.ObjectId();

  const buildConnection = (requesterId, recipientId, status = 'pending') => ({
    parents: [requesterId, recipientId],
    requesterId,
    recipientId,
    status,
  });

  beforeAll(async () => {
    // Make sure indexes match the current schema (drops the legacy unique parents index if present)
    await Connection.syncIndexes();
  });

  it('should allow one parent to have active connections with multiple parents', async () => {
    await Connection.create(buildConnection(parentA, parentB));
    const second = await Connection.create(buildConnection(parentA, parentC));

    expect(second._id).toBeDefined();
  });

  it('should derive the same sorted pairKey regardless of direction', async () => {
    const connection = await Connection.findOne({ requesterId: parentA, recipientId: parentB });
    const expectedKey = [parentA.toString(), parentB.toString()].sort().join('_');

    expect(connection.pairKey).toBe(expectedKey);
    expect(connection.parents.map((id) => id.toString())).toEqual(expectedKey.split('_'));
  });

  it('should reject a reverse duplicate while the pair is pending or accepted', async () => {
    await expect(Connection.create(buildConnection(parentB, parentA))).rejects.toMatchObject({ code: 11000 });
  });

  it('should allow re-requesting after the previous request was declined', async () => {
    await Connection.updateOne({ requesterId: parentA, recipientId: parentC }, { $set: { status: 'declined' } });
    const retry = await Connection.create(buildConnection(parentC, parentA));

    expect(retry.status).toBe('pending');
  });
});
