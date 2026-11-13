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
import PlaydateLeave from '../../src/modules/playdate/playdate-leave.model.js';
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

const WINDOW_START = new Date('2026-09-01T00:00:00+07:00');
// A real account (deleted by the seed) and a seeded account (kept) are in the database before the seed runs
const TOTAL_PARENTS = SEED_PARENT_COUNT;
const ALL_MODELS = [
  User, Parent, Child, Connection, Swipe, Conversation, Message, Playdate, RescheduleRequest, PlaydateLeave, RatingFeedback, Badge,
  UserBadge, Notification, Block, Report, Subscription, SubscriptionPlan, Payment, UsageQuota, AIChatSession,
  AdminNotification, AuthToken, RefreshToken, PlacesCache, PlacesSyncTile,
];
const idsOf = (docs, field = '_id') => new Set(docs.map((doc) => String(doc[field])));

// Wipes the database: run it on its own database, not the one shared by the other suites
// Every leaf path of a schema, sub-documents and arrays of sub-documents included
const pathsOf = (schema, prefix = '') => {
  const paths = [];
  schema.eachPath((path, type) => {
    if (path === '__v') return;
    if (type.schema) paths.push(...pathsOf(type.schema, `${prefix}${path}.`));
    else if (!path.endsWith('.$*')) paths.push(prefix + path);
  });
  return paths;
};
const valuesAt = (value, parts) => {
  if (!parts.length) return [value];
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, parts));
  return valuesAt(value[parts[0]], parts.slice(1));
};
const isFilled = (value) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.some(isFilled);
  if (typeof value === 'object' && !(value instanceof Date) && !value._bsontype) return Object.keys(value).length > 0;
  return true;
};

describe('Demo data seed', () => {
  let parents;
  let unverifiedIds;
  let realUser;
  let realParent;
  let oldSeedParent;
  let oldSeedChild;

  beforeAll(async () => {
    await mongoose.disconnect();
    await mongoose.connect('mongodb://127.0.0.1:27018/seed_data');
    await mongoose.connection.dropDatabase();

    // A real account signed up before the seed runs: the seed deletes it
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

    // A seeded account of a previous seed: its email was never verified there, and it has a child
    const oldSeedUser = await User.create({ email: `old.parent@${EMAIL_DOMAIN}`, phone: '0901112233', passwordHash: 'old-hash', role: 'parent', strikeCount: 2, createdAt: new Date('2026-06-05T08:00:00Z') });
    oldSeedParent = await Parent.create({
      userId: oldSeedUser._id,
      fullName: 'Trần Thị Cũ',
      avatarUrl: 'https://example.com/old-avatar.jpg',
      bio: 'Hồ sơ của lần seed trước.',
      location: { area: 'Phường Tam Kỳ', city: 'Đà Nẵng', address: '12 Hùng Vương, Phường Tam Kỳ', coordinates: { type: 'Point', coordinates: [108.2013, 16.0153] } },
      preferences: { maxDistanceKm: 20, preferredTimeSlots: ['evening'], preferredPlaydateDays: ['weekday'], preferredLocations: ['pool', 'home'], preferredAgeRange: { min: 3, max: 7 } },
      privacySettings: { isProfileHidden: false, connectionPrivacy: 'everyone', messagePrivacy: 'connected_only' },
      verification: { isEmailVerified: false, isPhoneVerified: true, isVerifiedParent: false },
      createdAt: new Date('2026-06-05T08:00:00Z'),
    });
    oldSeedChild = await Child.create({ parentId: oldSeedParent._id, displayName: 'Bé Cũ', dateOfBirth: new Date('2020-03-04'), gender: 'boy', interests: ['Khủng long'], favoriteActivities: ['Thả diều'], personality: ['Hài hước & Vui vẻ'], createdAt: new Date('2026-06-05T09:00:00Z') });

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

  it('fills every field of every model', async () => {
    const neverFilled = [];
    for (const Model of ALL_MODELS) {
      const docs = await Model.collection.find({}).toArray();
      for (const path of pathsOf(Model.schema)) {
        if (!docs.some((doc) => valuesAt(doc, path.split('.')).some(isFilled))) neverFilled.push(`${Model.collection.collectionName}.${path}`);
      }
    }
    expect(neverFilled).toEqual([]);
  });

  it('has the requested seeded accounts, some of the new ones unverified, the others with a phone', async () => {
    expect(parents).toHaveLength(TOTAL_PARENTS);
    expect(await User.countDocuments({ email: new RegExp(`@${EMAIL_DOMAIN}$`) })).toBe(SEED_PARENT_COUNT);
    expect(unverifiedIds.size).toBe(SEED_UNVERIFIED_COUNT);
    const users = await User.find({ role: 'parent' }).lean();
    expect(users).toHaveLength(TOTAL_PARENTS);
    const unverifiedUserIds = idsOf(parents.filter((p) => unverifiedIds.has(String(p._id))), 'userId');
    expect(users.filter((user) => !unverifiedUserIds.has(String(user._id))).every((user) => /^\+84\d{9}$/.test(user.phone))).toBe(true);
    // Every way of being unverified, and one removed account
    const states = new Set(parents.filter((p) => unverifiedIds.has(String(p._id))).map((p) => `${p.verification.isEmailVerified}-${p.verification.isPhoneVerified}`));
    expect([...states].sort()).toEqual(['false-false', 'false-true', 'true-false']);
    expect(await User.countDocuments({ _id: { $in: [...unverifiedUserIds] }, isActive: false, deletedAt: { $ne: null } })).toBe(1);
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
      [PlaydateLeave, { parentId: { $in: unverified } }],
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

  it('deletes the accounts outside the seed domain with everything they own', async () => {
    expect(await User.countDocuments({ _id: realUser._id })).toBe(0);
    expect(await User.countDocuments({ role: 'parent', email: { $not: new RegExp(`@${EMAIL_DOMAIN}$`) } })).toBe(0);
    expect(await Parent.countDocuments({ _id: realParent._id })).toBe(0);
    expect(await Child.countDocuments({ parentId: realParent._id })).toBe(0);
    expect(await Subscription.countDocuments({ parentId: realParent._id })).toBe(0);
    expect(await Connection.countDocuments({ parents: realParent._id })).toBe(0);
  });

  it('keeps the profile and the children of a seeded account already in the database', async () => {
    const parent = await Parent.findById(oldSeedParent._id).lean();
    const before = oldSeedParent.toObject();
    for (const field of ['fullName', 'avatarUrl', 'bio', 'preferences', 'privacySettings']) {
      expect({ field, value: parent[field] }).toEqual({ field, value: before[field] });
    }
    // Same ward, saved as the app saves it: "<ward>, <city>" at the real center of the ward
    expect(parent.location).toEqual({
      address: 'Phường Tam Kỳ, Đà Nẵng',
      area: 'Phường Tam Kỳ',
      city: 'Đà Nẵng',
      coordinates: { type: 'Point', coordinates: [108.4821958, 15.5637942] },
    });
    // Signed up in June: moved into August, with its child one hour later as before
    expect(parent.createdAt >= new Date('2026-08-01T00:00:00+07:00') && parent.createdAt < WINDOW_START).toBe(true);
    const [child] = await Child.find({ parentId: oldSeedParent._id }).lean();
    expect(child.createdAt.getTime() - parent.createdAt.getTime()).toBe(60 * 60 * 1000);
    expect(await User.countDocuments({ role: 'parent', createdAt: { $lt: new Date('2026-08-01T00:00:00+07:00') } })).toBe(0);
    // It owns a child profile: verified, with a phone, the new password and no sanction left
    expect(parent.verification).toEqual({ isEmailVerified: true, isPhoneVerified: true, isVerifiedParent: true });
    const user = await User.findById(oldSeedParent.userId).lean();
    // Legacy phone format normalized to E.164
    expect(user.phone).toBe('+84901112233');
    expect(user.strikeCount).toBeLessThanOrEqual(1);
    expect(await bcrypt.compare(SEED_PASSWORD, user.passwordHash)).toBe(true);
    const children = await Child.find({ parentId: oldSeedParent._id }).lean();
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ _id: oldSeedChild._id, displayName: 'Bé Cũ', gender: 'boy', interests: ['Khủng long'], dateOfBirth: new Date('2020-03-04') });
    expect(await Subscription.countDocuments({ parentId: oldSeedParent._id })).toBe(1);
  });

  it('sets the password on seeded accounts', async () => {
    const seeded = await User.findOne({ email: new RegExp(`@${EMAIL_DOMAIN}$`) }).lean();
    const admin = await User.findOne({ role: 'admin' }).lean();
    expect(await bcrypt.compare(SEED_PASSWORD, seeded.passwordHash)).toBe(true);
    expect(await bcrypt.compare(SEED_PASSWORD, admin.passwordHash)).toBe(true);
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);
  });

  it('places most parents in Đà Nẵng and Hội An, at real points', async () => {
    // Unverified accounts have not filled their profile yet
    const located = parents.filter((p) => !unverifiedIds.has(String(p._id)));
    const outlying = located.filter((p) => /Điện Bàn|An Thắng/.test(p.location.area));
    const hoiAn = located.filter((p) => /Hội An/.test(p.location.area));
    expect(outlying.length).toBeLessThanOrEqual(located.length * 0.2);
    expect(hoiAn.length).toBeGreaterThanOrEqual(located.length * 0.2);
    expect(located.every((p) => p.location.city === 'Đà Nẵng')).toBe(true);
    // No street in the profile form: the address is the ward and the city, the point is the ward center
    expect(located.every((p) => p.location.address === `${p.location.area}, ${p.location.city}`)).toBe(true);
    const points = new Map();
    located.forEach((p) => points.set(p.location.area, new Set([...(points.get(p.location.area) || []), p.location.coordinates.coordinates.join()])));
    expect([...points.values()].every((set) => set.size === 1)).toBe(true);
    // Places are OpenStreetMap elements only
    expect(await PlacesCache.countDocuments({ osmId: { $not: /^osm-(node|way|relation)-\d+$/ } })).toBe(0);
    expect(parents.filter((p) => unverifiedIds.has(String(p._id))).every((p) => p.location.area === '' && p.bio === '')).toBe(true);
  });

  it('spreads the activity from September until now', async () => {
    const now = new Date();
    // Only the accounts kept from the database and their first child may be older than the window
    for (const Model of [Payment, Connection, Swipe, Conversation, Message, Playdate, RescheduleRequest, PlaydateLeave, RatingFeedback, UserBadge, Notification, Block, Report, AIChatSession, AdminNotification]) {
      const [first] = await Model.find({}).sort({ createdAt: 1 }).limit(1).lean();
      const [last] = await Model.find({}).sort({ createdAt: -1 }).limit(1).lean();
      expect({ collection: Model.collection.collectionName, ok: first.createdAt >= WINDOW_START && last.createdAt <= now }).toEqual({
        collection: Model.collection.collectionName,
        ok: true,
      });
    }
    for (const month of ['09', '10']) {
      const from = new Date(`2026-${month}-01T00:00:00+07:00`);
      const to = month === '10' ? new Date('2026-11-01T00:00:00+07:00') : new Date(`2026-${Number(month) + 1 < 10 ? '0' : ''}${Number(month) + 1}-01T00:00:00+07:00`);
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
    expect([...new Set(reports.map((r) => r.status))].sort()).toEqual(['dismissed', 'pending', 'resolved']);
    for (const report of reports) {
      expect(report.severity).toBeTruthy();
      if (report.status === 'resolved') expect(report.actions.length).toBeGreaterThan(0);
      // Not claimed yet: only the Sentinel AI wrote on it
      if (report.status === 'pending') expect(report.history.every((entry) => entry.actorType === 'system')).toBe(true);
      expect(report.sentinelAssessment.assessedAt).toBeTruthy();
    }
    // A family who left: declined with leftAt on the playdate, and kept in playdate_leaves
    const leaves = await PlaydateLeave.find({}).lean();
    for (const leave of leaves) {
      const playdate = await Playdate.findById(leave.playdateId).lean();
      const participant = playdate.participants.find((p) => String(p.parentId) === String(leave.parentId));
      expect(participant).toMatchObject({ status: 'declined', leftAt: leave.leftAt });
      expect(leave.leftAt < leave.scheduledStart).toBe(true);
      expect(leave.isLate).toBe(!leave.safetyExempt && leave.hoursBeforeStart < 24);
    }
    expect(leaves.some((leave) => leave.isLate)).toBe(true);
    expect(leaves.some((leave) => leave.safetyExempt && leave.reason === '')).toBe(true);
    expect(leaves.some((leave) => !leave.isLate && !leave.safetyExempt && leave.reason)).toBe(true);
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
    // A kept child profile without a name
    const { insertedId } = await Child.collection.insertOne({ parentId: oldSeedParent._id, dateOfBirth: new Date('2021-01-01'), gender: 'girl', createdAt: new Date('2026-06-06T09:00:00Z') });

    await expect(seedDatabase({ log: () => {} })).rejects.toThrow('Nothing was changed');

    expect(await Connection.countDocuments()).toBe(before);
    expect(await Parent.countDocuments()).toBe(TOTAL_PARENTS);
    await Child.collection.deleteOne({ _id: insertedId });
  }, 60000);

  it('keeps the same parents when it runs again', async () => {
    const before = idsOf(parents);
    await seedDatabase({ log: () => {} });
    const after = await Parent.find({}).select('_id verification').lean();
    expect(after).toHaveLength(TOTAL_PARENTS);
    expect(after.every((p) => before.has(String(p._id)))).toBe(true);
    // The unverified accounts are the same ones, still without any other data
    const stillUnverified = after.filter((p) => !p.verification.isVerifiedParent).map((p) => String(p._id));
    expect(stillUnverified.sort()).toEqual([...unverifiedIds].sort());
    expect(await Child.countDocuments({ parentId: { $in: stillUnverified } })).toBe(0);
    expect(await Subscription.countDocuments({ parentId: { $in: stillUnverified } })).toBe(0);
    expect(await User.countDocuments({ deletedAt: { $ne: null } })).toBe(1);
  }, 180000);
});
