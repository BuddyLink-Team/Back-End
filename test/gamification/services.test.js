import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

async function loadService(relative, mocks) {
  const context = vm.createContext({ Date, Set, Map, console });
  const cache = new Map();
  async function get(path) {
    if (cache.has(path)) return cache.get(path);
    const filename = path.split(/[/\\]/).at(-1);
    let module;
    if (mocks[filename]) {
      const exports = mocks[filename];
      module = new vm.SyntheticModule(Object.keys(exports), function() {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      }, {context,identifier:path});
    } else {
      module = new vm.SourceTextModule(await readFile(path,'utf8'), {context,identifier:path});
    }
    cache.set(path,module);
    return module;
  }
  const target = await get(resolve(dirname(fileURLToPath(import.meta.url)), relative));
  await target.link((specifier,parent) => get(resolve(dirname(parent.identifier),specifier)));
  await target.evaluate();
  return target.namespace;
}
const query = value => ({select(){return this;},sort(){return this;},lean: async () => value, distinct:async()=>value});

test('badge unlocks are permanent and timestamps remain unchanged after metrics decrease', async () => {
  let playdates = Array.from({length:10}, (_,i) => ({completedAt:`2026-09-${String(1+i*3).padStart(2,'0')}`, location:{placeId:`p${i%5}`}}));
  let connectionCount = 10;
  let parentStreak = {longestStreak:0};
  const badges = new Map();
  const notified = [];
  const service = await loadService('../../src/modules/gamification/gamification.service.js', {
    'parent.service.js':{default:{updateStreak:async(id,current,longestStreak) => {
      Object.assign(parentStreak,current);
      parentStreak.longestStreak = Math.max(parentStreak.longestStreak,longestStreak);
      return {userId:'user',streak:{...parentStreak}};
    }}},
    'notification.service.js':{default:{notifyBadgeUnlocked:async(userId,badge)=>{notified.push([userId,badge.code]);}}},
    'index.js':{default:{error(){}}},
    'playdate.service.js':{default:{getCompletedPlaydatesForParent:async()=>playdates}},
    'connection.service.js':{default:{countAcceptedConnections:async()=>connectionCount}},
    'badge.model.js':{default:{}},
    'user-badge.model.js':{default:{find:()=>query([...badges.values()]),updateOne:async(filter,update)=>{
      if(badges.has(filter.badgeCode))return {upsertedCount:0};
      badges.set(filter.badgeCode,update.$setOnInsert);
      return {upsertedCount:1};
    }}},
  });
  const first = await service.default.syncParentAchievements('parent',new Date('2026-10-02'));
  assert.equal(first.badges.filter(b=>b.unlocked).length,6);
  assert.equal(notified.length,6);
  assert.ok(notified.every(([userId])=>userId==='user'));
  assert.equal(first.streak.isCurrentWeekCompleted,true);
  const earnedAt = badges.get('first_playdate').unlockedAt;
  playdates=[];connectionCount=0;
  const later = await service.default.syncParentAchievements('parent',new Date('2026-10-20'));
  assert.equal(later.streak.currentWeeklyStreak,0);
  assert.equal(later.streak.longestStreak,first.streak.longestStreak);
  assert.equal(later.badges.filter(b=>b.unlocked).length,6);
  assert.equal(notified.length,6);
  assert.ok(later.badges.filter(b=>b.unlocked).every(b=>b.progress===b.requirementCount));
  assert.equal(badges.get('first_playdate').unlockedAt,earnedAt);
});

test('achievements read playdates and connections of the given parent through their services', async () => {
  const calls = [];
  const service = await loadService('../../src/modules/gamification/gamification.service.js', {
    'parent.service.js':{default:{updateStreak:async()=>({streak:{longestStreak:0}})}},
    'playdate.service.js':{default:{getCompletedPlaydatesForParent:async id=>{calls.push(['playdates',id]);return [];}}},
    'connection.service.js':{default:{countAcceptedConnections:async id=>{calls.push(['connections',id]);return 3;}}},
    'notification.service.js':{default:{notifyBadgeUnlocked:async()=>{}}},
    'index.js':{default:{error(){}}},
    'badge.model.js':{default:{}},
    'user-badge.model.js':{default:{find:()=>query([]),updateOne:async()=>({upsertedCount:1})}},
  });
  const result = await service.default.syncParentAchievements('parent');
  assert.deepEqual(calls.sort(),[['connections','parent'],['playdates','parent']]);
  const byCode = Object.fromEntries(result.badges.map(b=>[b.code,b]));
  assert.equal(byCode.social_family.unlocked,false);
  assert.equal(byCode.social_family.progress,3);
  assert.equal(byCode.first_connection.unlocked,false);
  assert.equal(result.streak.isCurrentWeekCompleted,false);
});

test('only completed host / accepted playdates count for achievements', async () => {
  let filter;
  const repository = await loadService('../../src/modules/playdate/playdate.repository.js', {
    'playdate.model.js':{default:{find:criteria=>{filter=criteria;return query([]);}}},
    'parent.model.js':{default:{}},
    'child.model.js':{default:{}},
    'mongoose':{default:{}},
  });
  await repository.default.findCompletedForParent('parent');
  assert.equal(filter.status,'completed');
  assert.equal(filter.$or[0].hostParentId,'parent');
  assert.equal(filter.$or[1].participants.$elemMatch.status,'accepted');
  assert.equal(filter.$or[1].participants.$elemMatch.parentId,'parent');
  assert.equal(filter._id,undefined);
});

async function ratingsModule({ playdate, create, pending = [] }) {
  return loadService('../../src/modules/rating-feedback/rating-feedback.service.js', {
    'parent.service.js':{default:{getParentByUserId:async()=>({_id:'parent'})}},
    'playdate.service.js':{default:{findPlaydateDocById:async()=>playdate,getCompletedPlaydatesForParent:async()=>pending}},
    'rating-feedback.model.js':{default:{create,find:()=>query(['already-rated'])}},
  });
}
test('rating persists authenticated parent ID and ignores supplied identity/tags',async()=>{
  let saved;
  const service=await ratingsModule({playdate:{hostParentId:'parent',status:'completed',participants:[]},create:async doc=>{saved=doc;return doc;}});
  await service.createRating('user','playdate',{rating:5,feedback:'Great',parentId:'attacker',tags:['extra']});
  assert.equal(saved.parentId,'parent');
  assert.equal(saved.rating,5);
  assert.equal(saved.feedback,'Great');
  assert.equal(saved.tags,undefined);
});
test('duplicate-key error becomes a 409 instead of a server error',async()=>{
  const service=await ratingsModule({playdate:{hostParentId:'parent',status:'completed',participants:[]},create:async()=>{throw {code:11000};}});
  await assert.rejects(service.createRating('user','playdate',{rating:5}),{statusCode:409,code:'RATING_ALREADY_EXISTS'});
});
test('forbidden participant is rejected before writing a rating',async()=>{
  let writes=0;
  const service=await ratingsModule({playdate:{hostParentId:'other',status:'completed',participants:[{parentId:'parent',status:'pending'}]},create:async()=>{writes++;}});
  await assert.rejects(service.createRating('user','playdate',{rating:4}),{statusCode:403});
  assert.equal(writes,0);
});

test('badge seeding updates existing definitions instead of only inserting new ones', async () => {
  let operations;
  const repository = await loadService('../../src/modules/gamification/gamification.repository.js', {
    'badge.model.js':{default:{bulkWrite:async ops=>{operations=ops;}}},
    'user-badge.model.js':{default:{}},
  });
  await repository.default.bulkUpsertBadges([{code:'explorer',title:'New title',description:'New text',requirementCount:5,metric:'places'}]);
  // Plain JSON copy: objects built inside the vm context have another Object prototype
  const { filter, update, upsert } = JSON.parse(JSON.stringify(operations[0].updateOne));
  assert.deepEqual(filter,{code:'explorer'});
  assert.deepEqual(update.$set,{title:'New title',description:'New text',requirementCount:5});
  assert.deepEqual(update.$setOnInsert,{code:'explorer'});
  assert.equal(upsert,true);
});
