import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../../src/app.js";
import User from "../../src/modules/user/user.model.js";
import Subscription from "../../src/modules/subscription/subscription.model.js";
import SubscriptionPlan from "../../src/modules/subscription/subscription-plan.model.js";
import subscriptionService from "../../src/modules/subscription/subscription.service.js";
import AuthToken from "../../src/modules/auth/auth-token.model.js";
import { hashToken } from "../../src/shared/helpers/token.helper.js";

describe("Authentication & Onboarding Integration Flow", () => {
  let parentAccessToken = "";
  let parentRefreshToken = "";
  const testEmail = `parent-${Date.now()}@example.com`;
  const testPassword = "Password123!";
  const testFullName = "Nguyen Van Parent";
  const testPhone = "+840333134898";

  it("0. Subscription Plans: should verify default plans are seeded", async () => {
    const plans = await SubscriptionPlan.find({});
    expect(plans.length).toBeGreaterThanOrEqual(3);

    const freePlan = await SubscriptionPlan.findOne({ planCode: "free" });
    expect(freePlan).not.toBeNull();
    expect(freePlan.features.childProfilesLimit).toBe(1);
    expect(freePlan.features.discoveryViewLimitPerDay).toBe(5);
    expect(freePlan.features.connectionRequestsLimitPerMonth).toBe(5);
    expect(freePlan.features.playdatesLimitPerMonth).toBe(3);
    expect(freePlan.features.playdateParticipationLimitPerMonth).toBe(3);
    expect(freePlan.features.aiAssistantLimitPerMonth).toBe(5);

    const premiumMonthly = await SubscriptionPlan.findOne({ planCode: "premium_monthly" });
    expect(premiumMonthly.features.discoveryViewLimitPerDay).toBe(-1);
  });

  it("1. Register: should register a new parent and return AuthResponseDTO", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      fullName: testFullName,
      email: testEmail,
      password: testPassword,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    if (res.body.data?.tokens) {
      parentAccessToken = res.body.data.tokens.accessToken;
      parentRefreshToken = res.body.data.tokens.refreshToken;
    }

    expect(res.body.data.user.email).toBe(testEmail.toLowerCase());
    expect(res.body.data.user.role).toBe("parent");
    expect(res.body.data.parent.fullName).toBe(testFullName);
    expect(res.body.data.parent.verification.isEmailVerified).toBe(false);
    expect(res.body.data.parent.verification.isPhoneVerified).toBe(false);
    expect(res.body.data.parent.verification.isVerifiedParent).toBe(false);
    expect(res.body.data.tokens.accessToken).toBeDefined();

    // Verify free subscription was automatically created
    const subscription = await Subscription.findOne({ parentId: res.body.data.parent.id });
    expect(subscription).not.toBeNull();
    expect(subscription.planCode).toBe("free");
    expect(subscription.status).toBe("active");

    // Verify quota summary can be retrieved
    const quotaSummary = await subscriptionService.getQuotaSummary(res.body.data.parent.id);
    expect(quotaSummary.planCode).toBe("free");
    expect(quotaSummary.limits.discoveryViewsPerDay).toBe(5);
    expect(quotaSummary.limits.childProfiles).toBe(1);
    expect(quotaSummary.usage.discoveryViewsToday).toBe(0);

    // Verify consuming quota
    const quotaResult = await subscriptionService.checkAndConsumeQuota(
      res.body.data.parent.id,
      "discovery",
      true
    );
    expect(quotaResult.allowed).toBe(true);
    expect(quotaResult.remaining).toBe(4);
  });

  it("2. Login with Google (OAuth): should authenticate via idToken", async () => {
    const googleEmail = `google-${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/v1/auth/google")
      .send({
        idToken: `mock-google-token:${googleEmail}:Google Parent`,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(googleEmail);
    expect(res.body.data.parent.verification.isEmailVerified).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();

    // Verify free subscription was automatically created for google parent
    const subscription = await Subscription.findOne({ parentId: res.body.data.parent.id });
    expect(subscription).not.toBeNull();
    expect(subscription.planCode).toBe("free");
    expect(subscription.status).toBe("active");
  });

  it("3. Phone Verification: should send and verify phone OTP", async () => {
    // 3.1 Send OTP
    const sendRes = await request(app)
      .post("/api/v1/auth/phone/send-otp")
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ phone: testPhone });

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.success).toBe(true);

    // Retrieve OTP from DB (as smsAdapter logs/mocks)
    const tokenDoc = await AuthToken.findOne({
      target: testPhone,
      type: "phone_otp",
      isUsed: false,
    });
    expect(tokenDoc).toBeTruthy();

    // In a real situation we verify using tokenHash, for test we can set a known OTP
    const knownOtp = "123456";
    tokenDoc.tokenHash = hashToken(knownOtp);
    await tokenDoc.save();

    // 3.2 Verify OTP
    const verifyRes = await request(app)
      .post("/api/v1/auth/phone/verify-otp")
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ phone: testPhone, otp: knownOtp });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.isPhoneVerified).toBe(true);
  });

  it("4. Email Verification: should send and verify email OTP", async () => {
    // 4.1 Send OTP
    const sendRes = await request(app)
      .post("/api/v1/auth/email/send-otp")
      .set("Authorization", `Bearer ${parentAccessToken}`);

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.success).toBe(true);

    const tokenDoc = await AuthToken.findOne({
      target: testEmail.toLowerCase(),
      type: "email_verify",
      isUsed: false,
    });
    expect(tokenDoc).toBeTruthy();

    const knownOtp = "654321";
    tokenDoc.tokenHash = hashToken(knownOtp);
    await tokenDoc.save();

    // 4.2 Verify OTP
    const verifyRes = await request(app)
      .post("/api/v1/auth/email/verify-otp")
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({ otp: knownOtp });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.isEmailVerified).toBe(true);
    // Since phone was verified in step 3, now both are verified -> isVerifiedParent becomes true!
    expect(verifyRes.body.data.isVerifiedParent).toBe(true);
  });

  it("5. Onboarding Preferences: should update parent location and preferences", async () => {
    const res = await request(app)
      .put("/api/v1/parent/preferences/onboarding")
      .set("Authorization", `Bearer ${parentAccessToken}`)
      .send({
        location: {
          address: "123 Nguyen Hue",
          area: "District 1",
          city: "Ho Chi Minh City",
          coordinates: [106.702, 10.776],
        },
        preferences: {
          preferredPlaydateDays: ["weekend"],
          preferredTimeSlots: ["morning", "afternoon"],
          preferredLocations: ["park", "kids_cafe"],
          maxDistanceKm: 10,
          preferredAgeRange: { min: 3, max: 7 },
          languages: ["Vietnamese", "English"],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.location.area).toBe("District 1");
    expect(res.body.data.preferences.preferredLocations).toContain("kids_cafe");
    expect(res.body.data.verification.isVerifiedParent).toBe(true);
  });

  it("6. Parent Login: should authenticate with email and password", async () => {
    const res = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: testPassword,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeDefined();
  });

  it("7. Forgot & Reset Password: should request reset and update password", async () => {
    // 7.1 Forgot Password
    const forgotRes = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: testEmail });

    expect(forgotRes.status).toBe(200);
    expect(forgotRes.body.success).toBe(true);

    const tokenDoc = await AuthToken.findOne({
      target: testEmail.toLowerCase(),
      type: "password_reset",
      isUsed: false,
    });
    expect(tokenDoc).toBeTruthy();

    const resetOtp = "999888";
    tokenDoc.tokenHash = hashToken(resetOtp);
    await tokenDoc.save();

    // 7.2 Reset Password
    const newPassword = "NewSecretPassword456!";
    const resetRes = await request(app)
      .post("/api/v1/auth/reset-password")
      .send({
        email: testEmail,
        token: resetOtp,
        newPassword,
      });

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    // 7.3 Login with new password
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: newPassword,
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    if (loginRes.body.data?.tokens) {
      parentAccessToken = loginRes.body.data.tokens.accessToken;
      parentRefreshToken = loginRes.body.data.tokens.refreshToken;
    }
  });

  it("8. Admin Login: should reject parent role and allow admin role", async () => {
    // 8.1 Reject Parent trying to login as admin
    const rejectRes = await request(app).post("/api/v1/auth/admin/login").send({
      email: testEmail,
      password: "NewSecretPassword456!",
    });

    expect(rejectRes.status).toBe(403);

    // 8.2 Create Admin user and test login
    const adminEmail = `admin-${Date.now()}@buddylink.com`;
    const adminPass = "AdminSecret789!";
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(adminPass, salt);

    await User.create({
      email: adminEmail,
      passwordHash,
      role: "admin",
      isActive: true,
    });

    const adminLoginRes = await request(app)
      .post("/api/v1/auth/admin/login")
      .send({
        email: adminEmail,
        password: adminPass,
      });

    expect(adminLoginRes.status).toBe(200);
    expect(adminLoginRes.body.success).toBe(true);
    expect(adminLoginRes.body.data.user.role).toBe("admin");
  });

  it("9. Refresh Token Rotation & Logout", async () => {
    // 9.1 Refresh Token
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh-token")
      .send({ refreshToken: parentRefreshToken });

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.success).toBe(true);
    expect(refreshRes.body.data.accessToken).toBeDefined();
    const newRefreshToken = refreshRes.body.data.refreshToken;
    expect(newRefreshToken).toBeDefined();

    // 9.2 Old refresh token should be rejected (Revoked via Token Rotation)
    const reuseRes = await request(app)
      .post("/api/v1/auth/refresh-token")
      .send({ refreshToken: parentRefreshToken });

    expect(reuseRes.status).toBe(401);

    // 9.3 Logout
    const logoutRes = await request(app)
      .post("/api/v1/auth/logout")
      .send({ refreshToken: newRefreshToken });

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);
  });

  it("10. Firebase Phone Verification: should verify phone using Firebase ID token", async () => {
    // Register another parent to test Firebase phone verification
    const fbEmail = `fb-parent-${Date.now()}@example.com`;
    const fbPhone = `+84912${Math.floor(100000 + Math.random() * 900000)}`;

    const regRes = await request(app).post("/api/v1/auth/register").send({
      fullName: "Firebase Test Parent",
      email: fbEmail,
      password: "Password123!",
    });
    expect(regRes.status).toBe(201);
    const fbToken = regRes.body.data.tokens.accessToken;

    const verifyFbRes = await request(app)
      .post("/api/v1/auth/phone/verify-firebase")
      .set("Authorization", `Bearer ${fbToken}`)
      .send({
        idToken: `mock-firebase-token:${fbPhone}:mock-fb-uid-123`,
      });

    expect(verifyFbRes.status).toBe(200);
    expect(verifyFbRes.body.success).toBe(true);
    expect(verifyFbRes.body.data.phone).toBe(fbPhone);
    expect(verifyFbRes.body.data.verification.isPhoneVerified).toBe(true);
  });

  it("11. Get Current Parent Profile: should return ParentProfileDTO via /parent/me", async () => {
    const loginRes = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: "NewSecretPassword456!",
    });
    const token = loginRes.body.data.tokens.accessToken;

    const meRes = await request(app)
      .get("/api/v1/parent/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.success).toBe(true);
    expect(meRes.body.data.fullName).toBe(testFullName);
    expect(meRes.body.data.location.area).toBe("District 1");
    expect(meRes.body.data.verification.isVerifiedParent).toBe(true);
  });

  it("12. Validation & Security edge cases", async () => {
    // 12.1 Register with invalid email
    const badEmailRes = await request(app).post("/api/v1/auth/register").send({
      fullName: "Test",
      email: "not-an-email",
      password: "123",
    });
    expect(badEmailRes.status).toBe(400);

    // 12.2 Login with wrong password
    const wrongPassRes = await request(app).post("/api/v1/auth/login").send({
      email: testEmail,
      password: "WrongPassword999!",
    });
    expect(wrongPassRes.status).toBe(401);

    // 12.3 Access protected route without token
    const noTokenRes = await request(app).get("/api/v1/auth/me");
    expect(noTokenRes.status).toBe(401);
  });
});
