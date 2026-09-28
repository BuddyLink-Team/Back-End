import mongoose from 'mongoose';

/**
 * Clear all collections in database between tests to ensure test isolation.
 */
export async function clearDatabase() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
}

export default { clearDatabase };
