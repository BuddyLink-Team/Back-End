import { describe, it, expect, jest, afterEach } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import env from '../../src/config/env.js';
import googleAuthAdapter from '../../src/integrations/google/google-auth.adapter.js';

describe('Google sign-in with the OAuth access token of the web button', () => {
  const originalClientId = env.GOOGLE.CLIENT_ID;
  afterEach(() => {
    jest.restoreAllMocks();
    env.GOOGLE.CLIENT_ID = originalClientId;
  });

  it('signs in with an access token (POST /auth/google { accessToken })', async () => {
    const email = `google-access-${Date.now()}@example.com`;
    const res = await request(app).post('/api/v1/auth/google').send({ accessToken: `mock-google-token:${email}:Access Parent` });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
  });

  it('needs an idToken or an accessToken', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({});
    expect(res.status).toBe(400);
  });

  it('refuses a token issued to another app', async () => {
    env.GOOGLE.CLIENT_ID = 'our-client.apps.googleusercontent.com';
    jest.spyOn(googleAuthAdapter.client, 'getTokenInfo').mockResolvedValue({ aud: 'other-app', azp: 'other-app', sub: '1' });
    await expect(googleAuthAdapter.verifyAccessToken('real-looking-token')).rejects.toMatchObject({ code: 'INVALID_GOOGLE_TOKEN' });
  });

  it('reads the account of a token issued to this app', async () => {
    env.GOOGLE.CLIENT_ID = 'our-client.apps.googleusercontent.com';
    jest.spyOn(googleAuthAdapter.client, 'getTokenInfo').mockResolvedValue({ aud: env.GOOGLE.CLIENT_ID, sub: '42' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ sub: '42', email: 'a@example.com', name: 'An', picture: '', email_verified: true }),
    });
    await expect(googleAuthAdapter.verifyAccessToken('real-looking-token')).resolves.toMatchObject({
      googleId: '42',
      email: 'a@example.com',
      isEmailVerified: true,
    });
  });
});
