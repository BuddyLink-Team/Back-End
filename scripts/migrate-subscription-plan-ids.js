/**
 * One-off migration: subscriptions reference their plan by _id (planId) instead of its code (planCode).
 *
 * - Creates the plans of SUBSCRIPTION_PLAN_DEFAULTS that are missing (same upsert as the app on start).
 * - Every subscription with a planCode gets the planId of that plan, and planCode is removed.
 *   A subscription with neither field was Free by the old model default: it gets the Free plan.
 * - Creates the indexes { planId: 1 } and { status: 1, planId: 1, endDate: 1 }.
 * Payments keep planSnapshot.planCode (a copy of the plan at checkout time).
 *
 * Usage:
 *   node scripts/migrate-subscription-plan-ids.js                       # dry run on the database of MONGODB_URI
 *   node scripts/migrate-subscription-plan-ids.js --apply               # writes the changes
 *   node scripts/migrate-subscription-plan-ids.js --db buddylink_db     # another database of the same cluster
 *   node scripts/migrate-subscription-plan-ids.js --rollback [--apply]  # back to planCode
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import { pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { SUBSCRIPTION_PLAN_CODES, SUBSCRIPTION_PLAN_DEFAULTS } from '../src/modules/subscription/subscription.constants.js';

const NEW_INDEXES = [{ planId: 1 }, { status: 1, planId: 1, endDate: 1 }];
const BATCH_SIZE = 500;

const argValue = (name) => {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.split('=')[1];
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const countBy = (items, keyOf) =>
  items.reduce((counts, item) => {
    const key = keyOf(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

const bulkInBatches = async (collection, operations) => {
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    await collection.bulkWrite(operations.slice(i, i + BATCH_SIZE), { ordered: false });
  }
};

/** The default plans missing from the database: created with --apply (prices already set are never changed) */
async function ensureDefaultPlans(plansCol, apply) {
  const existing = new Set((await plansCol.find({}, { projection: { planCode: 1 } }).toArray()).map((p) => p.planCode));
  const missing = SUBSCRIPTION_PLAN_DEFAULTS.filter((plan) => !existing.has(plan.planCode));
  if (missing.length) {
    console.log(`Missing plans: ${missing.map((p) => p.planCode).join(', ')}${apply ? ' (created)' : ' (created with --apply)'}`);
    if (apply) {
      const now = new Date();
      for (const plan of missing) {
        await plansCol.updateOne(
          { planCode: plan.planCode },
          { $setOnInsert: { ...plan, createdAt: now, updatedAt: now } },
          { upsert: true }
        );
      }
    }
  }
  return missing;
}

/**
 * planCode -> planId on the subscriptions of a database
 * @param {import('mongodb').Db} db
 * @param {{ apply?: boolean }} [options]
 */
export async function migrateSubscriptionPlanIds(db, { apply = false } = {}) {
  const plansCol = db.collection('subscription_plans');
  const subsCol = db.collection('subscriptions');

  const missingPlans = await ensureDefaultPlans(plansCol, apply);
  const plans = await plansCol.find({}, { projection: { planCode: 1 } }).toArray();
  const idByCode = new Map(plans.map((p) => [p.planCode, p._id]));
  const freePlanId = idByCode.get(SUBSCRIPTION_PLAN_CODES.FREE);

  const onCode = await subsCol.find({ planCode: { $exists: true } }, { projection: { planCode: 1, planId: 1 } }).toArray();
  const withoutPlan = await subsCol.find({ planCode: { $exists: false }, planId: { $exists: false } }, { projection: { _id: 1 } }).toArray();
  const alreadyDone = await subsCol.countDocuments({ planId: { $exists: true }, planCode: { $exists: false } });

  console.log(`Subscriptions on planCode: ${onCode.length} ${JSON.stringify(countBy(onCode, (s) => s.planCode))}`);
  console.log(`Subscriptions with no plan (become Free): ${withoutPlan.length}`);
  console.log(`Subscriptions already on planId: ${alreadyDone}`);

  // A plan created only with --apply has no id yet in a dry run: it is not an unknown code
  const pendingCodes = new Set(missingPlans.map((p) => p.planCode));
  const unknown = onCode.filter((s) => !idByCode.has(s.planCode) && !pendingCodes.has(s.planCode));
  if (unknown.length) {
    console.log(`Unknown plan codes: ${JSON.stringify(countBy(unknown, (s) => s.planCode))}`);
    if (apply) throw new Error('Fix the subscriptions with an unknown plan code first, nothing was migrated');
  }

  const result = { migrated: onCode.length, withoutPlan: withoutPlan.length, alreadyDone, unknown: unknown.length };
  if (!apply) return result;

  await bulkInBatches(subsCol, [
    ...onCode.map((s) => ({
      updateOne: { filter: { _id: s._id }, update: { $set: { planId: idByCode.get(s.planCode) }, $unset: { planCode: '' } } },
    })),
    ...withoutPlan.map((s) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { planId: freePlanId } } } })),
  ]);
  for (const key of NEW_INDEXES) await subsCol.createIndex(key);

  const left = await subsCol.countDocuments({ planCode: { $exists: true } });
  console.log(`Done. Subscriptions still on planCode: ${left}`);
  return result;
}

/**
 * Back to planCode: every subscription on planId gets the code of its plan and loses planId
 * @param {import('mongodb').Db} db
 * @param {{ apply?: boolean }} [options]
 */
export async function rollbackSubscriptionPlanIds(db, { apply = false } = {}) {
  const plans = await db.collection('subscription_plans').find({}, { projection: { planCode: 1 } }).toArray();
  const codeById = new Map(plans.map((p) => [p._id.toString(), p.planCode]));
  const subsCol = db.collection('subscriptions');
  const onId = await subsCol.find({ planId: { $exists: true } }, { projection: { planId: 1 } }).toArray();
  const unknown = onId.filter((s) => !codeById.has(s.planId?.toString()));

  console.log(`Subscriptions on planId: ${onId.length} ${JSON.stringify(countBy(onId, (s) => codeById.get(s.planId?.toString()) || 'unknown'))}`);
  if (unknown.length && apply) throw new Error(`${unknown.length} subscription(s) reference a plan that does not exist, nothing was rolled back`);
  if (!apply) return { rolledBack: onId.length, unknown: unknown.length };

  await bulkInBatches(
    subsCol,
    onId.map((s) => ({
      updateOne: { filter: { _id: s._id }, update: { $set: { planCode: codeById.get(s.planId.toString()) }, $unset: { planId: '' } } },
    }))
  );
  const indexes = await subsCol.indexes();
  for (const index of indexes) {
    if (Object.keys(index.key).includes('planId')) await subsCol.dropIndex(index.name);
  }
  console.log('Done. Subscriptions are back on planCode.');
  return { rolledBack: onId.length, unknown: unknown.length };
}

async function main() {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore if not allowed
  }
  dotenv.config();
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not defined in .env');
  const apply = process.argv.includes('--apply');
  const isRollback = process.argv.includes('--rollback');

  await mongoose.connect(process.env.MONGODB_URI);
  const dbName = argValue('db');
  const db = dbName ? mongoose.connection.client.db(dbName) : mongoose.connection.db;
  console.log(`Target database: ${db.databaseName}`);
  console.log(apply ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no changes written)\n');

  if (isRollback) await rollbackSubscriptionPlanIds(db, { apply });
  else await migrateSubscriptionPlanIds(db, { apply });
  if (!apply) console.log('\nRe-run with --apply to write the changes.');
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  main()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}
