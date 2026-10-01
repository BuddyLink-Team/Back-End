import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import mongoose from 'mongoose';
import subscriptionService from '../src/modules/subscription/subscription.service.js';

beforeAll(async () => {
  const mongoUri = 'mongodb://127.0.0.1:27018/testdb';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(mongoUri);
  }
  await subscriptionService.seedSubscriptionPlans();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});

describe('Mongoose test connection', () => {
  it('should be connected to in-memory db', () => {
    expect(mongoose.connection.readyState).toBe(1);
  });
});
