import mongoose from 'mongoose';
import env from './env.js';
import logger from '../shared/logger/index.js';

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
