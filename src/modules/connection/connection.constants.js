export const CONNECTION_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  REMOVED: 'removed',
});

// How a child pair on a connection was created
export const CHILD_PAIR_SOURCES = Object.freeze({
  DISCOVERY: 'discovery',
  PLAYDATE: 'playdate',
  MANUAL: 'manual',
});

/**
 * Order-independent key of two children "minId_maxId" (same idea as the connection pairKey)
 * @param {string|ObjectId} childIdA
 * @param {string|ObjectId} childIdB
 * @returns {string}
 */
export const buildChildPairKey = (childIdA, childIdB) =>
  [childIdA.toString(), childIdB.toString()].sort().join('_');
