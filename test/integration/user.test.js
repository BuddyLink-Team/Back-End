import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import request from "supertest";
import bcrypt from "bcryptjs";
import app from "../../src/app.js";
import User from "../../src/modules/user/user.model.js";
import storageAdapter from "../../src/integrations/storage/storage.adapter.js";
import { JPEG_BUFFER } from "../helpers/imageHelper.js";

describe("Unified User Profile & Password Flow (/api/v1/user)", () => {
  let parentToken = "";
  let adminToken = "";

  const parentEmail = `user-parent-${Date.now()}@example.com`;
  const adminEmail = `user-admin-${Date.now()}@example.com`;
  const initialPassword = "CommonPassword123!";

  beforeAll(async () => {
    // 1. Register Parent
    const parentReg = await request(app).post("/api/v1/auth/register").send({
      fullName: "Unified Parent User",
      email: parentEmail,
      password: initialPassword,
    });
    parentToken = parentReg.body.data.tokens.accessToken;

    // 2. Create and login Admin
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(initialPassword, salt);
    await User.create({
      email: adminEmail,
      phone: "+84987654321",
      passwordHash,
      role: "admin",
      isActive: true,
    });

    const adminLogin = await request(app).post("/api/v1/auth/admin/login").send({
      email: adminEmail,
      password: initialPassword,
    });
    adminToken = adminLogin.body.data.tokens.accessToken;
  });

  describe("Polymorphic GET /api/v1/user/me", () => {
    it("should return parent profile with preferences when called by parent", async () => {
      const res = await request(app)
        .get("/api/v1/user/me")
        .set("Authorization", `Bearer ${parentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe("Unified Parent User");
      expect(res.body.data.preferences).toBeDefined();
    });

    it("should return admin profile when called by admin", async () => {
      const res = await request(app)
        .get("/api/v1/user/me")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe(adminEmail);
      expect(res.body.data.role).toBe("admin");
    });
  });

  describe("Polymorphic PUT /api/v1/user/me", () => {
    it("should update parent profile details", async () => {
      const res = await request(app)
        .put("/api/v1/user/me")
        .set("Authorization", `Bearer ${parentToken}`)
        .send({
          fullName: "Updated Unified Parent",
          bio: "Polymorphic dispatch test bio",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fullName).toBe("Updated Unified Parent");
      expect(res.body.data.bio).toBe("Polymorphic dispatch test bio");
    });

    it("should update admin phone number", async () => {
      const res = await request(app)
        .put("/api/v1/user/me")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          phone: "+84912345678",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe("+84912345678");
    });
  });

  describe("Unified PATCH /api/v1/user/me/avatar", () => {
    it("should upload avatar for parent user", async () => {
      const uploadSpy = jest
        .spyOn(storageAdapter, "uploadImage")
        .mockResolvedValueOnce({
          url: "https://res.cloudinary.com/test/avatar-unified.jpg",
          publicId: "avatar123",
        });

      const res = await request(app)
        .patch("/api/v1/user/me/avatar")
        .set("Authorization", `Bearer ${parentToken}`)
        .attach("avatar", JPEG_BUFFER, {
          filename: "avatar.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.avatarUrl).toBe("https://res.cloudinary.com/test/avatar-unified.jpg");

      uploadSpy.mockRestore();
    });
  });

  describe("Unified PUT /api/v1/user/me/password", () => {
    it("should change password for parent", async () => {
      const newPassword = "NewParentPassword789!";
      const res = await request(app)
        .put("/api/v1/user/me/password")
        .set("Authorization", `Bearer ${parentToken}`)
        .send({
          currentPassword: initialPassword,
          newPassword,
          confirmNewPassword: newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should change password for admin", async () => {
      const newPassword = "NewAdminPassword789!";
      const res = await request(app)
        .put("/api/v1/user/me/password")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          currentPassword: initialPassword,
          newPassword,
          confirmNewPassword: newPassword,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
