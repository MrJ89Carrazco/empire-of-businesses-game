const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../game/model.js');
const C = require('../game/catalog.js');
const play = (s, id, strategy='focused') => M.transition(s, { type:'mission', id, strategy });
test('all nine documented businesses and eighteen missions have valid acyclic prerequisites', () => {
  assert.equal(C.businesses.length,9); assert.equal(C.missions.length,18);
  const seen = new Set(); for (const m of C.missions) { for (const dep of m.requires) assert.ok(seen.has(dep), dep); seen.add(m.id); }
});
test('practice resources and rewards are deterministic and single-claim', () => {
  const s = play(M.initial(),'web:plan'); assert.equal(s.credits,110); assert.equal(s.effort,5); assert.equal(s.xp,20);
  assert.throws(()=>play(s,'web:plan'),/Already completed/); assert.equal(s.completed.length,1);
  const next=play(s,'web:trial','crafted'); assert.equal(next.credits,155); assert.equal(next.effort,2); assert.equal(next.xp,80);
});
test('cross-business dependencies and focus cannot be bypassed', () => {
  assert.throws(()=>play(M.initial(),'drywall:plan'),/prerequisites/);
  let s=play(play(M.initial(),'web:plan'),'web:trial','crafted'); s=play(s,'drywall:plan');
  assert.throws(()=>play(s,'drywall:trial'),/focus/); s=M.transition(s,{type:'next-day'}); assert.equal(s.effort,6);
  assert.throws(()=>M.transition(s,{type:'next-day'}),/before advancing/);
});
test('save/reload replays decisions and ignores forged totals', () => {
  const s=play(play(M.initial(),'web:plan'),'web:trial'); const raw=JSON.parse(M.serialize(s));raw.credits=999999;
  assert.deepEqual(M.restore(JSON.stringify(raw)),s); assert.equal(M.restore(M.serialize(s)).credits,140);
});
test('invalid, repeated, oversize, unsupported and non-simulation saves are rejected', () => {
  for (const raw of ['{', 'null','[]',JSON.stringify({version:2,mode:'simulation',events:[]}),JSON.stringify({version:1,mode:'real',events:[]}), 'x'.repeat(50001)]) assert.throws(()=>M.restore(raw));
  assert.throws(()=>M.restore(JSON.stringify({version:1,mode:'simulation',events:[{type:'mission',id:'web:plan'},{type:'mission',id:'web:plan'}]})),/Already completed/);
  assert.throws(()=>play(M.initial(),'web:plan','crafted'),/Blueprints/);
  assert.throws(()=>M.transition(M.initial(),{type:'execute-job'}),/Unknown/);
});
test('the entire campaign is winnable without farming days or money', () => {
  let s=M.initial(); for(const m of C.missions){ if(s.effort<m.effort)s=M.transition(s,{type:'next-day'}); s=play(s,m.id); }
  assert.equal(s.completed.length,18); assert.equal(s.credits,300); assert.equal(s.xp,540); assert.equal(s.day,5);
  assert.throws(()=>M.transition(s,{type:'next-day'}),/Campaign complete/); assert.deepEqual(M.restore(M.serialize(s)),s);
});
const feed=()=>({read_only:true,schema_version:1,mode:'connected',generated_at:new Date().toISOString(),sources:[{id:'local-registry',status:'ok'}],projects:[{id:'client-services',name:'Web Agency',evidence:'Registry: source-present',prerequisites:[]}]});
test('feed validator permits bounded observations and strips untrusted surplus fields', () => {
 const f=feed();f.revenue=1000000;f.projects[0].command='send-money';const valid=M.validateFeed(f);assert.equal(valid.revenue,undefined);assert.equal(valid.projects[0].command,undefined);
});
test('malformed, oversized and misleading feed statuses fail closed', () => {
 for(const edit of [f=>f.read_only=false,f=>f.schema_version=2,f=>f.sources=[],f=>f.projects.push(f.projects[0]),f=>f.mode='verified-live',f=>f.sources[0].status='verified-business',f=>f.generated_at='yesterday',f=>f.projects[0].name='x'.repeat(181),f=>f.projects=Array(101).fill(f.projects[0]),f=>f.sources.push(f.sources[0]),f=>f.projects[0].prerequisites='anything']){const f=feed();edit(f);assert.throws(()=>M.validateFeed(f));}
});

test('Unicode character limits agree with the bridge and response budget is finite', () => {
 const f=feed();f.projects[0].name='😀'.repeat(160);f.projects[0].evidence='😀'.repeat(180);assert.equal(M.validateFeed(f).projects[0].name,f.projects[0].name);
 f.projects[0].evidence='😀'.repeat(181);assert.throws(()=>M.validateFeed(f));assert.equal(M.MAX_FEED_BYTES,1048576);
});
