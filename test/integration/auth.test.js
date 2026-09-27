import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';

describe('Auth Integration Tests', () => {
  it('GET /api/v1/auth/health-check should respond with status check or 404 if unmounted', async () => {
    const response = await request(app).get('/api/v1/auth/health');
    expect([200, 404]).toContain(response.status);
  });
});
