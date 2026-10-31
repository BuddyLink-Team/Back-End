/**
 * Migration Script: Migrate Report Severities
 *
 * Idempotent migration that assigns a severity to legacy reports based on their category.
 * Also initializes actions: [] and history: [] arrays if missing.
 *
 * Usage: node scripts/migrate-report-severities.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { default: safetyService } = await import('../src/modules/safety/safety.service.js');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/buddylink';

async function migrateReportSeverities() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const updatedCount = await safetyService.backfillReportSeverities();

  console.log(`Migration finished: ${updatedCount} reports got a severity.`);
  await mongoose.disconnect();
}

migrateReportSeverities()
  .then(() => {
    console.log('Migration script completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
