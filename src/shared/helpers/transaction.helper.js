import mongoose from 'mongoose';

const TRANSACTION_TOPOLOGIES = new Set(['ReplicaSetWithPrimary', 'ReplicaSetNoPrimary', 'Sharded']);

/**
 * Start a MongoDB transaction when the deployment supports it (replica set or sharded cluster).
 * A standalone server (local dev, in-memory tests) has no transactions: callers then run without a session.
 * @returns {Promise<import('mongoose').ClientSession|null>} Session with an open transaction, or null
 */
export const startTransactionIfSupported = async () => {
  const topologyType = mongoose.connection?.client?.topology?.description?.type;
  if (!TRANSACTION_TOPOLOGIES.has(topologyType)) return null;

  try {
    const session = await mongoose.startSession();
    session.startTransaction();
    return session;
  } catch {
    return null;
  }
};
