/**
 * Migration Script: Migrate Report Severities
 *
 * Idempotent migration that assigns severity to legacy reports based on their category.
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

import Report from '../src/modules/safety/report.model.js';
import {
  REPORT_SEVERITY,
  CATEGORY_TO_SEVERITY,
} from '../src/modules/safety/safety.constants.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/buddylink';

async function migrateReportSeverities() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const cursor = Report.find({}).cursor();
  let totalProcessed = 0;
  let updatedCount = 0;

  for (let report = await cursor.next(); report != null; report = await cursor.next()) {
    totalProcessed += 1;
    let hasChanges = false;

    // Check severity
    if (!report.severity || !Object.values(REPORT_SEVERITY).includes(report.severity)) {
      const mappedSeverity = CATEGORY_TO_SEVERITY[report.category] || REPORT_SEVERITY.MEDIUM;
      report.severity = mappedSeverity;
      hasChanges = true;
    }

    // Ensure actions & history arrays
    if (!Array.isArray(report.actions)) {
      report.actions = [];
      hasChanges = true;
    }
    if (!Array.isArray(report.history)) {
      report.history = [];
      hasChanges = true;
    }

    if (hasChanges) {
      await report.save();
      updatedCount += 1;
    }
  }

  console.log(`Migration finished: ${totalProcessed} reports scanned, ${updatedCount} reports updated.`);
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

