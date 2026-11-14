/**
 * Copy the seeded accounts (@mail.buddylink.vn) of another database of the same cluster into the database
 * of MONGODB_URI: users, parents, children and their current subscription (the seed reads it to keep
 * each account on its plan). The seeded accounts already in the target are removed first, with their
 * children and subscriptions. The admin and accounts of other domains are not touched.
 *
 * Run the seed afterwards: it keeps these accounts and rebuilds everything else.
 *
 * Usage:
 *   node scripts/import-seed-accounts.js --from buddylink_db           # dry run
 *   node scripts/import-seed-accounts.js --from buddylink_db --apply   # writes the changes
 */
/* eslint-disable no-console -- CLI script output */
import dns from 'node:dns';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

const EMAIL_DOMAIN = 'mail.buddylink.vn';
const SEED_EMAIL = new RegExp(`@${EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);

const argValue = (name) => {
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (inline) return inline.split('=')[1];
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const seedAccountsOf = async (db) => {
  const users = await db.collection('users').find({ role: { $ne: 'admin' }, email: SEED_EMAIL }).toArray();
  const parents = await db.collection('parents').find({ userId: { $in: users.map((u) => u._id) } }).toArray();
  const parentIds = parents.map((p) => p._id);
  const children = await db.collection('children').find({ parentId: { $in: parentIds } }).toArray();
  const subscriptions = await db.collection('subscriptions').find({ parentId: { $in: parentIds } }).toArray();
  return { users, parents, children, subscriptions };
};

/**
 * Plan of each account as the seed of the source gave it. A Premium month bought by the seed has ended since
 * and the account is on Free again: such an account only has that one successful payment (a Free account of
 * the seed also has failed / pending checkouts), so it gets its Premium month back. The other Free accounts
 * drop the reference to their last payment, so the seed keeps them on Free.
 */
const restoreSeedPlans = async (db, subscriptions) => {
  const restored = [];
  for (const sub of subscriptions) {
    if (sub.planCode !== 'free' || !sub.lastPaymentId) {
      restored.push(sub);
      continue;
    }
    const payments = await db.collection('payments').find({ parentId: sub.parentId }).toArray();
    const onlyPaidMonth = payments.length === 1 && payments[0].status === 'success' && payments[0].planSnapshot?.planCode === 'premium_monthly';
    restored.push(onlyPaidMonth
      ? { ...sub, planCode: 'premium_monthly', purchasedMonths: 1 }
      : { ...sub, lastPaymentId: null });
  }
  return restored;
};

const summary = (accounts) => {
  const plans = {};
  for (const sub of accounts.subscriptions) {
    const kind = sub.planCode === 'free' && sub.lastPaymentId ? 'free (expired)' : sub.planCode;
    plans[kind] = (plans[kind] || 0) + 1;
  }
  return `${accounts.users.length} users, ${accounts.parents.length} parents, ${accounts.children.length} children, subscriptions: ${JSON.stringify(plans)}`;
};

async function main() {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore if not allowed
  }
  dotenv.config();
  const from = argValue('from');
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not defined in .env');
  if (!from) throw new Error('Missing --from <source database name>');

  await mongoose.connect(process.env.MONGODB_URI);
  const target = mongoose.connection.db;
  const source = mongoose.connection.client.db(from);
  if (source.databaseName === target.databaseName) throw new Error('Source and target are the same database');

  console.log(apply ? 'Mode: APPLY (writing changes)\n' : 'Mode: DRY RUN (no changes written)\n');
  const incoming = await seedAccountsOf(source);
  incoming.subscriptions = await restoreSeedPlans(source, incoming.subscriptions);
  const current = await seedAccountsOf(target);
  console.log(`Source ${from}: ${summary(incoming)}`);
  console.log(`Target ${target.databaseName}, removed first: ${summary(current)}`);
  if (!incoming.users.length) throw new Error(`No seeded account in ${from}`);

  // Phones and emails must stay unique against the accounts of the target that are kept (admin, other domains)
  const kept = await target.collection('users').find({ _id: { $nin: current.users.map((u) => u._id) } }, { projection: { email: 1, phone: 1 } }).toArray();
  const keptEmails = new Set(kept.map((u) => u.email));
  const keptPhones = new Set(kept.map((u) => u.phone).filter(Boolean));
  const clashes = incoming.users.filter((u) => keptEmails.has(u.email) || (u.phone && keptPhones.has(u.phone)));
  if (clashes.length) throw new Error(`Email or phone already used in the target by another account: ${clashes.map((u) => u.email).join(', ')}`);

  if (!apply) {
    console.log('\nRe-run with --apply to copy them, then run: node scripts/seed.js --confirm');
    return;
  }

  const currentParentIds = current.parents.map((p) => p._id);
  await target.collection('subscriptions').deleteMany({ parentId: { $in: currentParentIds } });
  await target.collection('children').deleteMany({ parentId: { $in: currentParentIds } });
  await target.collection('parents').deleteMany({ _id: { $in: currentParentIds } });
  await target.collection('users').deleteMany({ _id: { $in: current.users.map((u) => u._id) } });

  for (const [name, docs] of Object.entries(incoming)) {
    if (docs.length) await target.collection(name).insertMany(docs);
  }
  console.log(`\nCopied: ${summary(incoming)}`);
  console.log('Next: node scripts/seed.js --confirm');
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
