import { test } from 'node:test';
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
  let connections = Array.from({length:10}, (_,i) => ({parents:['parent',`other${i}`]}));
  let parentStreak = {longestStreak:0};
  const badges = new Map();
  const service = await loadService('../../src/modules/gamification/gamification.service.js', {
    'parent.model.js':{default:{findByIdAndUpdate:async(id,update) => {
      for (const [key,value] of Object.entries(update.$set)) parentStreak[key.replace('streak.','')] = value;
      parentStreak.longestStreak = Math.max(parentStreak.longestStreak,update.$max['streak.longestStreak']);
      return {streak:{...parentStreak}};
    }}},
    'playdate.model.js':{default:{find:()=>query(playdates)}},
    'connection.model.js':{default:{find:()=>query(connections)}},
    'badge.model.js':{default:{}},
    'user-badge.model.js':{default:{find:()=>query([...badges.values()]),updateOne:async(filter,update)=>{
      if(!badges.has(filter.badgeCode))badges.set(filter.badgeCode,update.$setOnInsert);
    }}},
  });
  const first = await service.syncParentAchievements('parent',new Date('2026-10-02'));
  assert.equal(first.badges.filter(b=>b.unlocked).length,6);
  const earnedAt = badges.get('first_playdate').unlockedAt;
  playdates=[];connections=[];
  const later = await service.syncParentAchievements('parent',new Date('2026-10-20'));
  assert.equal(later.streak.currentWeeklyStreak,0);
  assert.equal(later.badges.filter(b=>b.unlocked).length,6);
  assert.equal(badges.get('first_playdate').unlockedAt,earnedAt);
});

test('only completed host / accepted playdates count for achievements', async () => {
  let filter;
  const service = await loadService('../../src/modules/gamification/gamification.service.js', {
    'parent.model.js':{default:{findByIdAndUpdate:async()=>({streak:{longestStreak:0}})}},
    'playdate.model.js':{default:{find:criteria=>{filter=criteria;return query([]);}}},
    'connection.model.js':{default:{find:()=>query([])}},
    'badge.model.js':{default:{}},
    'user-badge.model.js':{default:{find:()=>query([])}},
  });
  await service.syncParentAchievements('parent');
  assert.equal(filter.status,'completed');
  assert.equal(filter.$or[1].participants.$elemMatch.status,'accepted');
  assert.equal(filter.$or[1].participants.$elemMatch.parentId,'parent');
});

async function ratingsModule({ playdate, create, pending = [] }) {
  return loadService('../../src/modules/rating-feedback/rating-feedback.service.js', {
    'gamification.service.js':{getParent:async()=>({_id:'parent'})},
    'playdate.model.js':{default:{findById:async()=>playdate,find:()=>query(pending)}},
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
