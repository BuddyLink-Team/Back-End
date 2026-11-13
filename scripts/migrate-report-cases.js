/**
 * Migration Script: Single-step moderation (reports handled by case)
 *
 * Idempotent migration for reports stored before the claim step was removed:
 * - reports claimed by an admin (status "reviewing") go back to "pending", the open status of the queue
 * - the assignee field, no longer used, is removed
 * Closed reports are left as they are: without `closedCaseId` each one stays a row of its own in the queue.
 *
 * Usage:
 *   node scripts/migrate-report-cases.js           # dry run: prints what would change, writes nothing
 *   node scripts/migrate-report-cases.js --apply   # writes the changes
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/buddylink';
const isApply = process.argv.includes('--apply');

async function migrateReportCases() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGODB_URI);
  const reports = mongoose.connection.db.collection('reports');

  const reviewing = await reports.countDocuments({ status: 'reviewing' });
  const withAssignee = await reports.countDocuments({ assignedTo: { $exists: true } });
  console.log(`Reports in "reviewing" to move back to "pending": ${reviewing}`);
  console.log(`Reports with an assignee field to remove: ${withAssignee}`);

  if (!isApply) {
    console.log('Dry run: nothing was written. Run again with --apply to write the changes.');
    await mongoose.disconnect();
    return;
  }

  // The update keeps updatedAt: the report did not change for its parents
  const moved = await reports.updateMany({ status: 'reviewing' }, { $set: { status: 'pending' } });
  const cleared = await reports.updateMany({ assignedTo: { $exists: true } }, { $unset: { assignedTo: '' } });
  console.log(`Migration finished: ${moved.modifiedCount} reports moved to "pending", ${cleared.modifiedCount} assignees removed.`);
  await mongoose.disconnect();
}

migrateReportCases()
  .then(() => {
    console.log('Migration script completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
