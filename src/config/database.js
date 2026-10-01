import mongoose from 'mongoose';
import dns from 'dns';
import env from './env.js';
import logger from '../shared/logger/index.js';

const connectDatabase = async () => {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI);
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    if (error.message?.includes('querySrv ECONNREFUSED') || error.code === 'ECONNREFUSED') {
      try {
        dns.setServers(['8.8.8.8', '1.1.1.1']);
        const conn = await mongoose.connect(env.MONGODB_URI);
        logger.info(`MongoDB Connected: ${conn.connection.host}`);
        return;
      } catch (retryError) {
        logger.error(`MongoDB Connection Error: ${retryError.message}`);
        process.exit(1);
      }
    }
    logger.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDatabase;
