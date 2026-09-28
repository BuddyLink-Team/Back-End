import { describe, it, expect } from '@jest/globals';
import request from 'supertest';
import app from '../src/app.js';

describe('App Endpoints', () => {
  it('should return 404 for unknown endpoints', async () => {
    const response = await request(app).get('/unknown-endpoint');
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('success', false);
  });

  it('should return 200 for /api/v1', async () => {
    const response = await request(app).get('/api/v1');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });
});
