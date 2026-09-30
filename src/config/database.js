import dns from 'dns';
import mongoose from 'mongoose';
import env from './env.js';
import logger from '../shared/logger/index.js';

// Resolve DNS SRV query issues on Windows / local resolvers
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore fallback if custom servers cannot be set
}

const connectDatabase = async () => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDatabase;
