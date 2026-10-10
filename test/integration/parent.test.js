import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import storageAdapter from "../../src/integrations/storage/storage.adapter.js";
import geocodingAdapter from "../../src/integrations/maps/geocoding.adapter.js";
import { PNG_BUFFER } from "../helpers/imageHelper.js";

describe("Parent Profile Integration Flow", () => {
  let accessToken = "";
  const testEmail = `parent-profile-${Date.now()}@example.com`;
  const testPassword = "Password123!";
  const testFullName = "Le Van Parent";

  beforeAll(async () => {
    // Register user to obtain access token
    const res = await request(app).post("/api/v1/auth/register").send({
      fullName: testFullName,
      email: testEmail,
      password: testPassword,
    });
    accessToken = res.body.data.tokens.accessToken;
  });

  describe("GET /api/v1/parent/me", () => {
    it("should retrieve full parent profile with user account details", async () => {
      const res = await request(app)
        .get("/api/v1/parent/me")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe(testFullName);
      expect(res.body.data.email).toBe(testEmail.toLowerCase());
      expect(res.body.data.preferences).toBeDefined();
      expect(res.body.data.privacySettings).toBeDefined();
      expect(res.body.data.verification).toBeDefined();
    });

    it("should return 401 when unauthorized", async () => {
      const res = await request(app).get("/api/v1/parent/me");
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/v1/parent/me", () => {
    it("should update profile bio, full name, and preferences", async () => {
      const updateData = {
        fullName: "Le Van Parent Updated",
        bio: "Loving father enjoying weekends with kids",
        preferences: {
          preferredPlaydateDays: ["weekend"],
          preferredTimeSlots: ["morning", "afternoon"],
          preferredLocations: ["park", "outdoor"],
          maxDistanceKm: 20,
          preferredAgeRange: { min: 2, max: 10 },
        },
        privacySettings: {
          isProfileHidden: false,
          connectionPrivacy: "everyone",
          messagePrivacy: "connected_only",
        },
      };

      const res = await request(app)
        .put("/api/v1/parent/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .send(updateData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe("Le Van Parent Updated");
      expect(res.body.data.bio).toBe(updateData.bio);
      expect(res.body.data.preferences.maxDistanceKm).toBe(20);
      expect(res.body.data.preferences).not.toHaveProperty("languages");
      expect(res.body.data.preferences).not.toHaveProperty("additionalNotes");
    });

    it("should reject invalid preferences parameters", async () => {
      const res = await request(app)
        .put("/api/v1/parent/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          preferences: {
            preferredPlaydateDays: ["invalid_day"],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe("PATCH /api/v1/parent/me/avatar", () => {
    it("should upload new avatar and update parent profile", async () => {
      // Mock Cloudinary upload to prevent real external API call in test
      const uploadSpy = jest
        .spyOn(storageAdapter, "uploadImage")
        .mockResolvedValueOnce({
          url: "https://res.cloudinary.com/test-cloud/image/upload/v12345/avatar.jpg",
          publicId: "buddylink/parents/avatars/avatar123",
        });

      const res = await request(app)
        .patch("/api/v1/parent/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("avatar", PNG_BUFFER, {
          filename: "avatar.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatarUrl).toContain("https://res.cloudinary.com");

      uploadSpy.mockRestore();
    });

    it("should reject non-image file formats", async () => {
      const fakeTextBuffer = Buffer.from("plain text file");

      const res = await request(app)
        .patch("/api/v1/parent/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("avatar", fakeTextBuffer, {
          filename: "test.txt",
          contentType: "text/plain",
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should reject non-image content disguised with an image mimetype", async () => {
      const res = await request(app)
        .patch("/api/v1/parent/me/avatar")
        .set("Authorization", `Bearer ${accessToken}`)
        .attach("avatar", Buffer.from("<svg onload=alert(1)></svg> not a png"), {
          filename: "avatar.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_FILE_TYPE");
    });
  });

  describe("PUT /api/v1/user/me/password", () => {
    it("should reject when current password is incorrect", async () => {
      const res = await request(app)
        .put("/api/v1/user/me/password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          currentPassword: "WrongPassword!",
          newPassword: "NewPassword123!",
          confirmNewPassword: "NewPassword123!",
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    });

    it("should reject when confirmation password does not match", async () => {
      const res = await request(app)
        .put("/api/v1/user/me/password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          currentPassword: testPassword,
          newPassword: "NewPassword123!",
          confirmNewPassword: "MismatchPassword123!",
        });

      expect(res.status).toBe(400);
    });

    it("should reject when new password is the same as old password", async () => {
      const res = await request(app)
        .put("/api/v1/user/me/password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          currentPassword: testPassword,
          newPassword: testPassword,
          confirmNewPassword: testPassword,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("SAME_AS_OLD_PASSWORD");
    });

    it("should successfully change password with valid credentials", async () => {
      const newPassword = "NewValidPassword123!";
      const res = await request(app)
        .put("/api/v1/user/me/password")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          currentPassword: testPassword,
          newPassword: newPassword,
          confirmNewPassword: newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify login works with new password
      const loginRes = await request(app).post("/api/v1/auth/login").send({
        email: testEmail,
        password: newPassword,
      });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
      expect(loginRes.body.data.tokens.accessToken).toBeDefined();
    });
  });

  describe("PUT /api/v1/parent/me location", () => {
    const updateLocation = (location) =>
      request(app).put("/api/v1/parent/me").set("Authorization", `Bearer ${accessToken}`).send({ location });

    it("rebuilds the address from area and city and geocodes the new place", async () => {
      const spy = jest.spyOn(geocodingAdapter, "getCoordinatesByAddress").mockResolvedValue([106.7, 10.78]);
      try {
        const res = await updateLocation({ area: "Phường Bến Nghé", city: "TP. Hồ Chí Minh" });

        expect(res.status).toBe(200);
        expect(res.body.data.location.address).toBe("Phường Bến Nghé, TP. Hồ Chí Minh");
        expect(res.body.data.location.coordinates.coordinates).toEqual([106.7, 10.78]);
        expect(spy).toHaveBeenCalledWith("Phường Bến Nghé", "TP. Hồ Chí Minh");
      } finally {
        spy.mockRestore();
      }
    });

    it("updates the address again when only the area changes", async () => {
      const spy = jest.spyOn(geocodingAdapter, "getCoordinatesByAddress").mockResolvedValue([106.69, 10.77]);
      try {
        const res = await updateLocation({ area: "Phường Đa Kao", city: "TP. Hồ Chí Minh" });

        expect(res.body.data.location.address).toBe("Phường Đa Kao, TP. Hồ Chí Minh");
        expect(res.body.data.location.coordinates.coordinates).toEqual([106.69, 10.77]);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it("does not geocode again when the place is unchanged", async () => {
      const spy = jest.spyOn(geocodingAdapter, "getCoordinatesByAddress").mockResolvedValue([0, 1]);
      try {
        const res = await updateLocation({ area: "Phường Đa Kao", city: "TP. Hồ Chí Minh" });

        expect(res.status).toBe(200);
        expect(res.body.data.location.coordinates.coordinates).toEqual([106.69, 10.77]);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
