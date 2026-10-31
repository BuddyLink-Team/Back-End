import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../../src/modules/user/user.model.js';
import Parent from '../../src/modules/parent/parent.model.js';
import Child from '../../src/modules/child/child.model.js';
import Connection from '../../src/modules/connection/connection.model.js';
import Swipe from '../../src/modules/discovery/discovery.model.js';
import Conversation from '../../src/modules/chat/conversation.model.js';
import Message from '../../src/modules/chat/message.model.js';
import Playdate from '../../src/modules/playdate/playdate.model.js';
import RescheduleRequest from '../../src/modules/playdate/reschedule-request.model.js';
import RatingFeedback from '../../src/modules/rating-feedback/rating-feedback.model.js';
import Badge from '../../src/modules/gamification/badge.model.js';
import UserBadge from '../../src/modules/gamification/user-badge.model.js';
import Notification from '../../src/modules/notification/notification.model.js';
import Block from '../../src/modules/safety/block.model.js';
import Report from '../../src/modules/safety/report.model.js';
import Subscription from '../../src/modules/subscription/subscription.model.js';
import SubscriptionPlan from '../../src/modules/subscription/subscription-plan.model.js';
import Payment from '../../src/modules/subscription/payment.model.js';
import UsageQuota from '../../src/modules/subscription/usage-quota.model.js';
import AIChatSession from '../../src/modules/ai-assistant/ai-assistant.model.js';
import AdminNotification from '../../src/modules/admin/admin-notification.model.js';
import AuthToken from '../../src/modules/auth/auth-token.model.js';
import RefreshToken from '../../src/modules/auth/refresh-token.model.js';
import PlacesCache from '../../src/modules/places/places-cache.model.js';
import PlacesSyncTile from '../../src/modules/places/places-sync-tile.model.js';
import { seedDatabase, SEED_PASSWORD, SEED_PARENT_COUNT, SEED_UNVERIFIED_COUNT, EMAIL_DOMAIN } from '../../scripts/seed.js';
import { migrateChildPairs } from '../../scripts/migrate-bud48-child-pairs.js';

const WINDOW_START = new Date('2026-08-01T00:00:00+07:00');
const WINDOW_END = new Date('2026-11-01T00:00:00+07:00');
const ALL_MODELS = [
  User, Parent, Child, Connection, Swipe, Conversation, Message, Playdate, RescheduleRequest, RatingFeedback, Badge,
  UserBadge, Notification, Block, Report, Subscription, SubscriptionPlan, Payment, UsageQuota, AIChatSession,
  AdminNotification, AuthToken, RefreshToken, PlacesCache, PlacesSyncTile,
];
const idsOf = (docs, field = '_id') => new Set(docs.map((doc) => String(doc[field])));

// Wipes the database: run it on its own database, not the one shared by the other suites
describe('Demo data seed', () => {
  let parents;
  let unverifiedIds;
  let realUser;
  let realParent;

  beforeAll(async () => {
    await mongoose.disconnect();
    await mongoose.connect('mongodb://127.0.0.1:27018/seed_data');
    await mongoose.connection.dropDatabase();

    // A real account signed up before the seed runs, with a legacy phone format and no plan document issue
    realUser = await User.create({ email: 'real.parent@gmail.com', phone: '0901112233', passwordHash: 'real-hash', role: 'parent', createdAt: new Date('2026-10-19T08:00:00Z') });
    realParent = await Parent.create({
      userId: realUser._id,
      fullName: 'Phụ Huynh Thật',
      location: { area: 'Phường Hội An Đông', city: 'Đà Nẵng', address: 'Phường Hội An Đông, Đà Nẵng', coordinates: { type: 'Point', coordinates: [108.364, 15.8786] } },
      preferences: { maxDistanceKm: 30, preferredTimeSlots: ['morning'], preferredPlaydateDays: ['weekend'], preferredLocations: ['park'], preferredAgeRange: { min: 2, max: 8 } },
      verification: { isEmailVerified: true, isPhoneVerified: true, isVerifiedParent: true },
      createdAt: new Date('2026-10-19T08:00:00Z'),
    });
    await Child.create({ parentId: realParent._id, displayName: 'Bé Thật', dateOfBirth: new Date('2021-01-01'), gender: 'girl', createdAt: new Date('2026-10-19T09:00:00Z') });

    await seedDatabase({ log: () => {} });
    parents = await Parent.find({}).lean();
    unverifiedIds = new Set(parents.filter((p) => !p.verification.isVerifiedParent).map((p) => String(p._id)));
  }, 180000);

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
  });

  it('fills every collection', async () => {
    for (const Model of ALL_MODELS) {
      expect({ collection: Model.collection.collectionName, hasData: (await Model.countDocuments()) > 0 }).toEqual({
        collection: Model.collection.collectionName,
        hasData: true,
      });
    }
  });

  it('has the requested parents, 5 of them unverified, the others with a phone', async () => {
    expect(parents).toHaveLength(SEED_PARENT_COUNT);
    expect(unverifiedIds.size).toBe(SEED_UNVERIFIED_COUNT);
    const users = await User.find({ role: 'parent' }).lean();
    expect(users).toHaveLength(SEED_PARENT_COUNT);
    expect(users.every((user) => /^\+84\d{9}$/.test(user.phone))).toBe(true);
    expect(parents.every((p) => p.verification.isVerifiedParent === (p.verification.isEmailVerified && p.verification.isPhoneVerified))).toBe(true);
  });

  it('gives no other data to unverified parents', async () => {
    const unverified = [...unverifiedIds];
    const unverifiedUsers = parents.filter((p) => unverifiedIds.has(String(p._id))).map((p) => p.userId);
    const checks = [
      [Child, { parentId: { $in: unverified } }],
      [Subscription, { parentId: { $in: unverified } }],
      [Payment, { parentId: { $in: unverified } }],
      [UsageQuota, { parentId: { $in: unverified } }],
      [Connection, { parents: { $in: unverified } }],
      [Swipe, { $or: [{ swiperParentId: { $in: unverified } }, { targetParentId: { $in: unverified } }] }],
      [Conversation, { participants: { $in: unverified } }],
      [Message, { senderId: { $in: unverified } }],
      [Playdate, { $or: [{ hostParentId: { $in: unverified } }, { 'participants.parentId': { $in: unverified } }] }],
      [RatingFeedback, { parentId: { $in: unverified } }],
      [UserBadge, { parentId: { $in: unverified } }],
      [Block, { $or: [{ blockerId: { $in: unverified } }, { blockedId: { $in: unverified } }] }],
      [Report, { $or: [{ reporterId: { $in: unverified } }, { reportedUserId: { $in: unverified } }] }],
      [AIChatSession, { parentId: { $in: unverified } }],
      [Notification, { recipientId: { $in: unverifiedUsers } }],
      [RefreshToken, { userId: { $in: unverifiedUsers } }],
      [AuthToken, { userId: { $in: unverifiedUsers } }],
      [AdminNotification, { entityId: { $in: unverifiedUsers } }],
    ];
    for (const [Model, filter] of checks) {
      expect({ collection: Model.collection.collectionName, count: await Model.countDocuments(filter) }).toEqual({
        collection: Model.collection.collectionName,
        count: 0,
      });
    }
  });

  it('keeps the real account as it was, with the phone normalized', async () => {
    const user = await User.findOne({ email: 'real.parent@gmail.com' }).lean();
    expect(user.passwordHash).toBe('real-hash');
    expect(user.phone).toBe('+84901112233');
    const parent = await Parent.findById(realParent._id).lean();
    expect(parent.fullName).toBe('Phụ Huynh Thật');
    expect(await Child.countDocuments({ parentId: realParent._id, displayName: 'Bé Thật' })).toBe(1);
    expect(await Connection.countDocuments({ parents: realParent._id, status: 'accepted' })).toBeGreaterThan(0);
  });

  it('sets the password on seeded accounts', async () => {
    const seeded = await User.findOne({ email: new RegExp(`@${EMAIL_DOMAIN}$`) }).lean();
    const admin = await User.findOne({ role: 'admin' }).lean();
    expect(await bcrypt.compare(SEED_PASSWORD, seeded.passwordHash)).toBe(true);
    expect(await bcrypt.compare(SEED_PASSWORD, admin.passwordHash)).toBe(true);
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);
  });

  it('places most parents in Đà Nẵng and Hội An', () => {
    const outlying = parents.filter((p) => /Điện Bàn|An Thắng/.test(p.location.area));
    const hoiAn = parents.filter((p) => /Hội An/.test(p.location.area));
    expect(outlying.length).toBeLessThanOrEqual(SEED_PARENT_COUNT * 0.2);
    expect(hoiAn.length).toBeGreaterThanOrEqual(SEED_PARENT_COUNT * 0.2);
    expect(parents.every((p) => p.location.city === 'Đà Nẵng')).toBe(true);
  });

  it('spreads the data from August to October', async () => {
    for (const Model of [Parent, Child, Connection, Swipe, Conversation, Message, Playdate, RescheduleRequest, RatingFeedback, UserBadge, Notification, Block, Report, Payment, AIChatSession, AdminNotification]) {
      const [first] = await Model.find({}).sort({ createdAt: 1 }).limit(1).lean();
      const [last] = await Model.find({}).sort({ createdAt: -1 }).limit(1).lean();
      expect({ collection: Model.collection.collectionName, ok: first.createdAt >= WINDOW_START && last.createdAt < WINDOW_END }).toEqual({
        collection: Model.collection.collectionName,
        ok: true,
      });
    }
    for (const month of ['08', '09', '10']) {
      const from = new Date(`2026-${month}-01T00:00:00+07:00`);
      const to = month === '10' ? WINDOW_END : new Date(`2026-${Number(month) + 1 < 10 ? '0' : ''}${Number(month) + 1}-01T00:00:00+07:00`);
      for (const Model of [Parent, Connection, Message, Playdate, Payment, Notification, AIChatSession]) {
        expect(await Model.countDocuments({ createdAt: { $gte: from, $lt: to } })).toBeGreaterThan(0);
      }
    }
    expect(await Playdate.countDocuments({ status: 'upcoming', scheduledDate: { $gt: new Date() } })).toBeGreaterThan(0);
  });

  it('covers every kind of subscription and valid paid plans', async () => {
    const subscriptions = await Subscription.find({}).lean();
    const now = new Date();
    for (const planCode of ['free', 'premium_monthly', 'premium_yearly']) {
      expect(subscriptions.some((s) => s.planCode === planCode)).toBe(true);
    }
    const paid = subscriptions.filter((s) => s.planCode !== 'free');
    expect(paid.every((s) => s.endDate > now && s.lastPaymentId && s.purchasedMonths > 0)).toBe(true);
    // Paid once and not renewed: back on Free with the payment history
    expect(subscriptions.some((s) => s.planCode === 'free' && s.lastPaymentId)).toBe(true);
    const statuses = await Payment.distinct('status');
    expect(statuses.sort()).toEqual(['cancelled', 'creating', 'expired', 'failed', 'pending', 'success']);
  });

  it('respects the Free plan limits for families who never paid', async () => {
    const free = await Subscription.find({ planCode: 'free', lastPaymentId: null }).lean();
    const freeIds = free.map((s) => s.parentId);
    const quotas = await UsageQuota.find({ parentId: { $in: freeIds } }).lean();
    const limits = (await SubscriptionPlan.findOne({ planCode: 'free' }).lean()).features;
    for (const { counters, periodType } of quotas) {
      if (periodType === 'daily') {
        expect(counters.discoveryViews).toBeLessThanOrEqual(limits.discoveryViewLimitPerDay);
      } else {
        expect(counters.connectionRequests).toBeLessThanOrEqual(limits.connectionRequestsLimitPerMonth);
        expect(counters.playdatesCreated).toBeLessThanOrEqual(limits.playdatesLimitPerMonth);
        expect(counters.playdatesParticipated).toBeLessThanOrEqual(limits.playdateParticipationLimitPerMonth);
        expect(counters.aiAssistantRequests).toBeLessThanOrEqual(limits.aiAssistantLimitPerMonth);
      }
    }
    const seeded = await User.find({ email: new RegExp(`@${EMAIL_DOMAIN}$`) }).select('_id').lean();
    const seededParents = idsOf(await Parent.find({ userId: { $in: seeded.map((u) => u._id) } }).select('_id').lean());
    for (const parentId of freeIds.filter((id) => seededParents.has(String(id)))) {
      expect(await Child.countDocuments({ parentId, isArchived: false })).toBeLessThanOrEqual(limits.childProfilesLimit);
    }
  });

  it('only lets connected and unblocked families meet', async () => {
    const connections = await Connection.find({ connectedAt: { $ne: null } }).lean();
    const connected = idsOf(connections, 'pairKey');
    const blocks = await Block.find({}).lean();
    const blocked = new Set(blocks.map((b) => [String(b.blockerId), String(b.blockedId)].sort().join('_')));
    const playdates = await Playdate.find({}).lean();
    for (const playdate of playdates) {
      for (const participant of playdate.participants) {
        const key = [String(playdate.hostParentId), String(participant.parentId)].sort().join('_');
        expect(connected.has(key)).toBe(true);
        expect(blocked.has(key)).toBe(false);
      }
    }
    const active = await Connection.find({ status: { $in: ['pending', 'accepted'] } }).lean();
    expect(active.every((c) => !blocked.has(c.pairKey))).toBe(true);
    expect(await Connection.countDocuments({ status: 'accepted', childPairs: { $size: 0 } })).toBe(0);
  });

  it('follows the playdate and moderation flows', async () => {
    const statuses = await Playdate.distinct('status');
    expect(statuses.sort()).toEqual(['cancelled', 'completed', 'upcoming']);
    const completed = await Playdate.find({ status: 'completed' }).lean();
    expect(completed.every((p) => p.completedAt && p.participants.some((x) => x.status === 'accepted'))).toBe(true);

    const reschedules = await RescheduleRequest.find({}).populate('playdateId').lean();
    expect(reschedules.every((r) => String(r.requestedBy) === String(r.playdateId.hostParentId))).toBe(true);

    const rated = await RatingFeedback.distinct('playdateId');
    expect(await Playdate.countDocuments({ _id: { $in: rated }, status: { $ne: 'completed' } })).toBe(0);

    const reports = await Report.find({}).lean();
    expect([...new Set(reports.map((r) => r.status))].sort()).toEqual(['dismissed', 'pending', 'resolved', 'reviewing']);
    for (const report of reports) {
      expect(report.severity).toBeTruthy();
      if (report.status === 'resolved') expect(report.actions.length).toBeGreaterThan(0);
      if (report.status === 'pending') expect(report.history).toHaveLength(0);
    }
    expect(await User.countDocuments({ isActive: false, banReason: { $ne: null } })).toBeGreaterThan(0);
  });

  it('keeps conversations in sync with their messages', async () => {
    const conversations = await Conversation.find({}).lean();
    for (const conversation of conversations) {
      const messages = await Message.find({ conversationId: conversation._id }).sort({ createdAt: -1 }).lean();
      expect(messages.length).toBeGreaterThan(0);
      expect(String(conversation.lastMessage.messageId)).toBe(String(messages[0]._id));
    }
  });

  it('leaves nothing for the migrations to do', async () => {
    const result = await migrateChildPairs({ apply: false });
    expect(result).toEqual({ legacyIndexDropped: false, swipesBackfilled: 0, swipesSkipped: 0, pairsCreated: 0 });
    expect(await Report.countDocuments({ severity: { $nin: ['low', 'medium', 'high', 'critical'] } })).toBe(0);
  });

  it('changes nothing when a kept document cannot be validated', async () => {
    const before = await Connection.countDocuments();
    const { insertedId } = await Payment.collection.insertOne({ parentId: realParent._id, orderCode: 999001, status: 'unknown_status', amount: 1, expiresAt: new Date(), planSnapshot: { planCode: 'free', name: 'Free', price: 0, durationMonths: 0 } });

    await expect(seedDatabase({ log: () => {} })).rejects.toThrow('Nothing was changed');

    expect(await Connection.countDocuments()).toBe(before);
    expect(await Parent.countDocuments()).toBe(SEED_PARENT_COUNT);
    await Payment.collection.deleteOne({ _id: insertedId });
  }, 60000);

  it('keeps the same parents when it runs again', async () => {
    const before = idsOf(parents);
    await seedDatabase({ log: () => {} });
    const after = await Parent.find({}).select('_id').lean();
    expect(after).toHaveLength(SEED_PARENT_COUNT);
    expect(after.every((p) => before.has(String(p._id)))).toBe(true);
    expect((await User.findOne({ email: 'real.parent@gmail.com' }).lean()).passwordHash).toBe('real-hash');
  }, 180000);
});
