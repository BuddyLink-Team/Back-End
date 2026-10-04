import logger from '../../shared/logger/index.js';

// Reconcile when the existing domain models change, without adding new
// connection or playdate workflows. Dynamic import avoids model import cycles.
function parentIds(document, kind) {
  if (!document) return [];
  if (kind === 'connection') return document.parents || [];
  return [document.hostParentId, ...(document.participants || [])
    .filter(participant => participant.status === 'accepted').map(participant => participant.parentId)];
}
async function reconcile(ids) {
  const { syncParentAchievements } = await import('./gamification.service.js');
  for (const id of new Set(ids.filter(Boolean).map(String))) {
    try { await syncParentAchievements(id); }
    catch (error) { logger.error({ err: error, parentId: id }, 'Achievement update failed; weekly job will retry'); }
  }
}
export function attachAchievementHooks(schema, kind) {
  schema.post('save', async function(document) {
    await reconcile(parentIds(document, kind));
  });
  schema.post('insertMany', async function(documents) {
    await reconcile(documents.flatMap(document => parentIds(document, kind)));
  });
  for (const operation of ['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndReplace']) {
    schema.pre(operation, async function() {
      const documents = await this.model.find(this.getFilter()).select('parents hostParentId participants').lean();
      this.achievementDocumentIds = documents.map(document => document._id);
      this.achievementParentIds = documents.flatMap(document => parentIds(document, kind));
      // Preserve badges already earned before connections or attendance change.
      await reconcile(this.achievementParentIds);
    });
    schema.post(operation, async function(result) {
      const ids = [...(this.achievementDocumentIds || [])];
      if (result?._id) ids.push(result._id);
      if (result?.upsertedId) ids.push(result.upsertedId);
      const documents = await this.model.find({ _id: { $in: ids } }).select('parents hostParentId participants').lean();
      await reconcile([...(this.achievementParentIds || []), ...documents.flatMap(document => parentIds(document, kind))]);
    });
  }
}
