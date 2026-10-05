import { describe, it, expect, jest } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/app.js';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import AuthToken from '../../src/modules/auth/auth-token.model.js';
import RefreshToken from '../../src/modules/auth/refresh-token.model.js';
import subscriptionService from '../../src/modules/subscription/subscription.service.js';
import { hashToken } from '../../src/shared/helpers/token.helper.js';

const uniqueEmail = (label) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

const register = async (overrides = {}) => {
  const email = overrides.email || uniqueEmail('sec');
  const res = await request(app).post('/api/v1/auth/register').send({
    fullName: 'Security Parent',
    email,
    password: 'Password123!',
    ...overrides,
  });
  return { res, email, token: res.body.data?.tokens?.accessToken, refreshToken: res.body.data?.tokens?.refreshToken };
};

describe('Auth security hardening', () => {
  it('OTP: should invalidate the code after too many wrong attempts', async () => {
    const { token } = await register();
    const phone = `+8490${Math.floor(1000000 + Math.random() * 8999999)}`;

    await request(app).post('/api/v1/auth/phone/send-otp').set('Authorization', `Bearer ${token}`).send({ phone });
    const tokenDoc = await AuthToken.findOne({ target: phone, type: 'phone_otp', isUsed: false });
    tokenDoc.tokenHash = hashToken('123456');
    await tokenDoc.save();

    for (let i = 0; i < 5; i += 1) {
      const wrongRes = await request(app)
        .post('/api/v1/auth/phone/verify-otp')
        .set('Authorization', `Bearer ${token}`)
        .send({ phone, otp: '000000' });
      expect(wrongRes.status).toBe(400);
    }

    // The correct code no longer works once the attempt limit was reached
    const correctRes = await request(app)
      .post('/api/v1/auth/phone/verify-otp')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone, otp: '123456' });
    expect(correctRes.status).toBe(400);
    expect(correctRes.body.error.code).toBe('INVALID_OTP');
  });

  it('OTP: a phone code issued to one user cannot be used by another user', async () => {
    const owner = await register();
    const attacker = await register();
    const phone = `+8491${Math.floor(1000000 + Math.random() * 8999999)}`;

    await request(app).post('/api/v1/auth/phone/send-otp').set('Authorization', `Bearer ${owner.token}`).send({ phone });
    const tokenDoc = await AuthToken.findOne({ target: phone, type: 'phone_otp', isUsed: false });
    tokenDoc.tokenHash = hashToken('654321');
    await tokenDoc.save();

    const res = await request(app)
      .post('/api/v1/auth/phone/verify-otp')
      .set('Authorization', `Bearer ${attacker.token}`)
      .send({ phone, otp: '654321' });
    expect(res.status).toBe(400);
  });

  it('Admin login: a parent attempt must not create a session', async () => {
    const { email } = await register();
    const user = await User.findOne({ email });
    const sessionsBefore = await RefreshToken.countDocuments({ userId: user._id });

    const res = await request(app).post('/api/v1/auth/admin/login').send({ email, password: 'Password123!' });
    expect(res.status).toBe(403);

    const sessionsAfter = await RefreshToken.countDocuments({ userId: user._id });
    expect(sessionsAfter).toBe(sessionsBefore);
  });

  it('Register: should roll back user and parent when a later step fails', async () => {
    const email = uniqueEmail('rollback');
    const spy = jest
      .spyOn(subscriptionService, 'createFreeSubscription')
      .mockRejectedValueOnce(new Error('subscription store down'));

    const res = await request(app).post('/api/v1/auth/register').send({
      fullName: 'Rollback Parent',
      email,
      password: 'Password123!',
    });
    spy.mockRestore();

    expect(res.status).toBe(500);
    expect(await User.findOne({ email })).toBeNull();

    // The same email can register again afterwards
    const retry = await register({ email });
    expect(retry.res.status).toBe(201);
  });

  it('Email: Gmail dots are preserved so local and Google sign-in map to the same account', async () => {
    const email = `first.last.${Date.now()}@gmail.com`;
    const { res } = await register({ email });
    expect(res.body.data.user.email).toBe(email);

    const googleRes = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: `mock-google-token:${email}:First Last` });
    expect(googleRes.status).toBe(200);
    expect(googleRes.body.data.user.id).toBe(res.body.data.user.id);
  });

  it('Google: should reject accounts whose email is not verified by Google', async () => {
    const res = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: `mock-google-token:${uniqueEmail('unverified')}:Someone:unverified` });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('GOOGLE_EMAIL_NOT_VERIFIED');
  });

  it('Google: linking an unverified local account drops the pre-set password and its sessions', async () => {
    // Attacker registers the victim's address first (email never verified)
    const victimEmail = uniqueEmail('victim');
    const attacker = await register({ email: victimEmail });

    // Victim signs in with Google
    const googleRes = await request(app)
      .post('/api/v1/auth/google')
      .send({ idToken: `mock-google-token:${victimEmail}:Victim` });
    expect(googleRes.status).toBe(200);

    // Attacker's password and refresh token no longer work
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: victimEmail, password: 'Password123!' });
    expect(loginRes.status).toBe(401);

    const refreshRes = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken: attacker.refreshToken });
    expect(refreshRes.status).toBe(401);
  });

  it('Change password: revokes other sessions and returns a fresh token pair', async () => {
    const { token, refreshToken } = await register();

    const res = await request(app)
      .put('/api/v1/user/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Password123!', newPassword: 'NewPassword456!', confirmNewPassword: 'NewPassword456!' });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeDefined();
    expect(res.body.data.tokens.refreshToken).toBeDefined();

    const oldRefresh = await request(app).post('/api/v1/auth/refresh-token').send({ refreshToken });
    expect(oldRefresh.status).toBe(401);

    const newRefresh = await request(app)
      .post('/api/v1/auth/refresh-token')
      .send({ refreshToken: res.body.data.tokens.refreshToken });
    expect(newRefresh.status).toBe(200);
  });
});

describe('Profile phone & preferences rules', () => {
  it('should let several users clear their phone number (no duplicate null)', async () => {
    const first = await register({ phone: `09${Math.floor(10000000 + Math.random() * 89999999)}` });
    const second = await register({ phone: `09${Math.floor(10000000 + Math.random() * 89999999)}` });

    for (const account of [first, second]) {
      const res = await request(app)
        .put('/api/v1/user/me')
        .set('Authorization', `Bearer ${account.token}`)
        .send({ phone: '' });
      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBeNull();
    }
  });

  it('should reset phone verification when the phone number changes', async () => {
    const { token, email } = await register();
    const user = await User.findOne({ email });
    await Parent.updateOne(
      { userId: user._id },
      { $set: { 'verification.isPhoneVerified': true, 'verification.isEmailVerified': true, 'verification.isVerifiedParent': true } }
    );

    const res = await request(app)
      .put('/api/v1/parent/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: `09${Math.floor(10000000 + Math.random() * 89999999)}` });

    expect(res.status).toBe(200);
    expect(res.body.data.verification.isPhoneVerified).toBe(false);
    expect(res.body.data.verification.isVerifiedParent).toBe(false);
  });

  it('should reject out-of-range coordinates and an inverted age range', async () => {
    const { token } = await register();

    const coordsRes = await request(app)
      .put('/api/v1/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ location: { city: 'Ha Noi', coordinates: [500, 10] } });
    expect(coordsRes.status).toBe(400);

    const ageRes = await request(app)
      .put('/api/v1/parent/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { preferredAgeRange: { min: 8, max: 3 } } });
    expect(ageRes.status).toBe(400);
    expect(ageRes.body.error.code).toBe('INVALID_PREFERENCES');

    const distanceRes = await request(app)
      .put('/api/v1/parent/preferences/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferences: { maxDistanceKm: -5 } });
    expect(distanceRes.status).toBe(400);
  });
});

describe('Legacy role normalization', () => {
  it('should convert upper-case roles to lower case', async () => {
    const email = uniqueEmail('legacy');
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await User.collection.insertOne({ email, passwordHash, role: 'ADMIN', isActive: true, deletedAt: null });

    const { default: userService } = await import('../../src/modules/user/user.service.js');
    await userService.normalizeLegacyRoles();

    const stored = await User.collection.findOne({ email });
    expect(stored.role).toBe('admin');
  });
});

describe('Session transport', () => {
  it('should only accept the access token from the Authorization header', async () => {
    const { token } = await register();

    const cookieRes = await request(app).get('/api/v1/auth/me').set('Cookie', `accessToken=${token}`);
    expect(cookieRes.status).toBe(401);

    const headerRes = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(headerRes.status).toBe(200);
  });
});
