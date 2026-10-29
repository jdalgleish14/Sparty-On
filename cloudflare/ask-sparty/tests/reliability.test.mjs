import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import worker,{fetchSnapshot,getSnapshot,executePlan,validatePlan,questionScope,deterministicPlan,enforceScope,rateLimit,readQuestion,deadline,parseModelResponse,normalizePlan} from '../worker.mjs';
globalThis.crypto??=webcrypto;
const fixture=new URL('./fixtures/',import.meta.url);
const read=async n=>new Uint8Array(await readFile(new URL(n,fixture)));
let fetches=0;
globalThis.fetch=async url=>{fetches++;return new Response(await read(new URL(url).pathname.split('/').at(-1)));};
const data=await fetchSnapshot();
function plan(q){const scope=questionScope(q,data);return enforceScope(deterministicPlan(scope),scope,data);}
function result(q){return executePlan(data,plan(q),q);}
let serial=0;
async function post(question,env={}){
 return worker.fetch(new Request('https://sparty.example/',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'test-'+serial++},body:JSON.stringify({question})}),env);
}
test('real supplied snapshot passes every integrity check and derives 2026 Week 7',()=>{assert.equal(data.year,2026);assert.equal(data.cutoff,7);assert.equal(data.games.length,2314);});
test('concurrent snapshot reads coalesce into 13 fetches; warm read makes no new fetches',async()=>{fetches=0;const [a,b]=await Promise.all([getSnapshot(),getSnapshot()]);assert.equal(a,b);assert.equal(fetches,13);await getSnapshot();assert.equal(fetches,13);});
test('worst and best stretches agree with independent enumeration over real games',()=>{
 const windows=[];const groups=Map.groupBy(data.games.filter(g=>g.stage==='Regular Season'),g=>g.year+g.owner_id);
 for(const rows of groups.values()){
 rows.sort((a,b)=>a.week-b.week);for(let i=0;i+4<=rows.length;i++){const r=rows.slice(i,i+4);if(r.every((g,j)=>g.week===r[0].week+j))windows.push(r.reduce((n,g)=>n+Math.round(g.points_for*100),0)/100);}}
 assert.equal(Number(result('Who had the lowest scoring 4-game stretch ever?').rows[0][3]),Math.min(...windows));
 assert.equal(Number(result('Who had the highest scoring 4-game stretch ever?').rows[0][3]),Math.max(...windows));
});
test('head-to-head retains year, manager and postseason restrictions',()=>{
 const g=data.games.find(g=>g.year===2025&&g.stage==='Postseason');
 const q=g.owner_name+' against '+g.opponent_owner_name+' in 2025 playoffs',r=result(q);
 const expected=data.games.filter(g=>g.year===2025&&g.stage==='Postseason'&&g.owner_name===r.query.filters.find(f=>f.field==='owner').value&&g.opponent_owner_name===r.query.filters.find(f=>f.field==='opponent_owner').value);
 assert.equal(r.rows.reduce((n,x)=>n+Number(x[1]),0),expected.length);
 assert.match(r.cutoff,/2026 Week 7/);
});
test('year restrictions cannot silently disappear into career totals',()=>{
 assert.throws(()=>enforceScope({table:'owner_careers',operation:'rank',sort_field:'wins',filters:[],direction:'desc',limit:5},questionScope('Who had the most career wins in 2025?',data),data),/not in the published/);
});
test('historical current-standings request fails instead of returning this year',()=>assert.throws(()=>plan('Standings in 2025'),/historical-season/));
test('ties are explicit for rank, aggregation, windows and championships',()=>{
 const d={...data,ai_games:[{year:2025,week:1,owner:'Jack',points_for:10},{year:2025,week:2,owner:'Jack',points_for:20},{year:2025,week:1,owner:'Ryan',points_for:10},{year:2025,week:2,owner:'Ryan',points_for:20}]};
 for(const p of [
 {operation:'rank',sort_field:'points_for'},
 {operation:'aggregate',group_by:['owner'],metric:{op:'sum',field:'points_for'}},
 {operation:'window',window:{length:2,field:'points_for',op:'sum'}}])assert.match(executePlan(d,{table:'regular_games',filters:[],direction:'desc',limit:5,...p},'test').answer,/Tied leader/);
 const d2={...data,championships:[{year:2024,champion_owner_name:'Jack'},{year:2025,champion_owner_name:'Ryan'}]};
 assert.match(executePlan(d2,plan('Who has the most championships?'),'titles').answer,/Tied leader/);
});
test('new-season cutoff and zero-title response are dynamic',async()=>{
 const d={...data,year:2027};assert.match(executePlan(d,plan('Who has the most championships?'),'titles').cutoff,/2027/);
 const r=await post('How many championships does Andres have in 2025?');assert.equal(r.status,200);assert.match((await r.json()).answer,/no recorded championships/);
});
test('unsafe and malformed plans are rejected before evaluating data',()=>{
 const base={table:'all_games',operation:'rank',filters:[],sort_field:'points_for',direction:'desc',limit:5};
 for(const p of [{...base,table:'__proto__'},{...base,sort_field:'execute'},{...base,filters:[null]},{...base,filters:[{field:'year',op:'eq',value:'2025'}]},{...base,direction:'sideways'},{...base,operation:'eval'}])assert.throws(()=>validatePlan(p));
 assert.throws(()=>validatePlan({...base,operation:'aggregate',group_by:[],metric:{op:'count'}}),/distinct/);
});
test('unsupported joins, starts and playoff scenarios fail before AI',async()=>{
 const env={AI:{run(){throw Error('AI should not run');}}};
 for(const q of ['Worst start through six weeks by a team that made playoffs','Who has clinched the playoffs?','Jack against another schedule','Who had the most points after 2020?']){
 const r=await post(q,env);assert.equal(r.status,400);assert.doesNotMatch((await r.json()).error,/AI should/);}
});
test('scope conflicts and lowest direction mismatch are rejected',()=>{
 const p={table:'owner_seasons',operation:'rank',filters:[{field:'year',op:'eq',value:2024}],sort_field:'luck',direction:'desc',limit:5};
 assert.throws(()=>enforceScope(p,questionScope('Who was unluckiest in 2025?',data),data),/conflicts/);
 assert.throws(()=>enforceScope({...p,filters:[]},questionScope('Who was unluckiest?',data),data),/lowest/);
});
test('deterministic presets work while AI is unavailable; open-ended questions fail clearly',async()=>{
 assert.equal((await post('Who had the highest scoring 4-game stretch ever?')).status,200);
 const r=await post('Who had the most expected wins in 2025?',{AI_ENABLED:'false'});assert.equal(r.status,400);assert.match((await r.json()).error,/unavailable/);
});
test('AI plan receives enforced owner/year and repeated question is cached',async()=>{
 let calls=0;const env={AI:{async run(){calls++;return {response:{table:'owner_seasons',operation:'rank',filters:[],sort_field:'expected_wins',direction:'desc',limit:5}};}}};
 const q='Who had the most expected wins in 2025?';const r=await post(q,env);assert.equal(r.status,200);const body=await r.json();assert.equal(body.rows[0][0],'2025');assert.ok(body.query.filters.some(f=>f.field==='year'&&f.value===2025));
 assert.equal((await post(q,env)).status,200);assert.equal(calls,1);
});
test('bad AI response and invented fields fail closed',async()=>{
 for(const response of ['not json',{table:'owner_seasons',operation:'rank',filters:[],sort_field:'made_up',direction:'desc',limit:5}]){
 const r=await post('Rank historical luck '+serial,{AI:{async run(){return {response};}}});assert.equal(r.status,400);}
});
test('CORS disallows other sites; same site preflight works',async()=>{
 const r=await worker.fetch(new Request('https://sparty.example/',{method:'OPTIONS',headers:{origin:'https://jdalgleish14.github.io','access-control-request-method':'POST'}}),{});assert.equal(r.status,204);
 const bad=await worker.fetch(new Request('https://sparty.example/',{method:'POST',headers:{origin:'https://evil.example'}}),{});assert.equal(bad.status,403);
});
test('streamed request byte bound, invalid JSON and type checks',async()=>{
 for(const [body,type,status] of [['x'.repeat(1001),'application/json',413],['{','application/json',400],['{}','text/plain',415]]){
 await assert.rejects(readQuestion(new Request('https://sparty.example/',{method:'POST',headers:{'content-type':type},body})),e=>e.status===status);}
});
test('local rate limit resets next minute',()=>{for(let i=0;i<6;i++)assert.equal(rateLimit('limited',60000),true);assert.equal(rateLimit('limited',60000),false);assert.equal(rateLimit('limited',120000),true);});
test('deadline bounds a hung operation',async()=>await assert.rejects(deadline(new Promise(()=>{}),5,'timeout'),/timeout/));
test('tampered data and report fail hash checks; fetch restored afterwards',async()=>{
 const original=globalThis.fetch;
 for(const target of ['games.json','validation_report.json']){
 globalThis.fetch=async url=>{const name=new URL(url).pathname.split('/').at(-1);const raw=await read(name);return new Response(name===target?new TextDecoder().decode(raw).replace('PASS','FAIL').replace('82.38','82.39'):raw);};
 await assert.rejects(fetchSnapshot(),/validation|manifest|disagrees|pass/i);}
 globalThis.fetch=original;
});

test('single named opponent ranks other managers, not the opponent themselves',()=>{const r=result('Who has the most wins against Ryan?');const counts=new Map();for(const g of data.games.filter(g=>g.opponent_owner_name==='Ryan'&&g.result==='W'))counts.set(g.owner_name,(counts.get(g.owner_name)||0)+1);assert.equal(Number(r.rows[0][1]),Math.max(...counts.values()));assert.notEqual(r.rows[0][0],'Ryan');});
test('head-to-head HTTP answer is a W-L-T record and source rows remain scoped',async()=>{const r=await post('Jack against Nick in 2025');const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));assert.match(body.answer,/Jack is \d+–\d+–\d+ against Nick/);assert.ok(body.query.filters.some(f=>f.field==='year'&&f.value===2025));});

test('expired snapshot is reverified, versions change, and source failure does not serve stale data',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 const old=await getSnapshot();Date.now=()=>originalNow()+120000;
 try{
 globalThis.fetch=async url=>{const name=new URL(url).pathname.split('/').at(-1);const bytes=await read(name);if(name==='manifest.json'){const m=JSON.parse(new TextDecoder().decode(bytes));m.generated_at_utc='2026-10-29T00:00:00Z';return new Response(JSON.stringify(m));}return new Response(bytes);};
 const updated=await getSnapshot();assert.notEqual(updated.version,old.version);
 Date.now=()=>originalNow()+240000;globalThis.fetch=async()=>{throw Error('offline');};await assert.rejects(getSnapshot(),/offline/);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
test('concurrent AI calls are bounded and capacity failures have Retry-After',async()=>{
 const pending=[];const env={AI:{run(){return new Promise(resolve=>pending.push(resolve));}}};
 const a=post('Rank historical luck for season 2022',env),b=post('Rank historical luck for season 2023',env);
 while(pending.length<2)await new Promise(r=>setTimeout(r,1));
 const blocked=await post('Rank historical luck for season 2024',env);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'60');
 for(const resolve of pending)resolve({response:{table:'owner_seasons',operation:'rank',filters:[],sort_field:'luck',direction:'desc',limit:5}});
 assert.deepEqual((await Promise.all([a,b])).map(r=>r.status),[200,200]);
});

test('model plan accepts JSON objects, plain JSON and markdown/prose wrappers',()=>{
 const p={table:'owner_seasons',operation:'rank',filters:[{field:'year',op:'eq',value:2025}],sort_field:'expected_wins',direction:'desc',limit:5};
 for(const raw of [p,JSON.stringify(p),'```json\n'+JSON.stringify(p)+'\n```','Here is the plan: '+JSON.stringify(p)]){const parsed=parseModelResponse(raw);assert.deepEqual(parsed,p);validatePlan(parsed);}
 for(const raw of ['',undefined,'```json\n{"table":','{"table":"owner_seasons"} {"extra":true}'])assert.throws(()=>parseModelResponse(raw));
});
test('expected wins works with a fenced live-model-style response',async()=>{
 const env={AI:{async run(){return {response:'```json\n'+JSON.stringify({table:'owner_seasons',operation:'rank',filters:[],sort_field:'expected_wins',direction:'desc',limit:5})+'\n```'};}}};
 const r=await post('Which manager had the highest expected wins in 2025?',env);const body=await r.json();assert.equal(r.status,200,JSON.stringify(body));
 const expected=data.ai_seasons.filter(r=>r.year===2025).sort((a,b)=>b.expected_wins-a.expected_wins)[0];assert.equal(body.rows[0][1],expected.owner);
});

test('exact malformed preview response is rejected, not repaired into guessed statistics',()=>{
 const raw='{"/table/owner_seasons/operation/aggregate/filters/:[{field:/year/,op:/eq/,value:2025},{field:/season_status/,op:/eq/,value:/Complete/}]/metric/{op:/max/,field:/expected_wins/}/direction:/desc/limit:/1}';
 assert.throws(()=>parseModelResponse(raw),/unreadable/);
});
test('AI receives a typed JSON schema and a valid example rather than slash/shorthand notation',async()=>{
 const env={AI:{async run(model,payload){
 assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.type,'object');
 assert.ok(payload.response_format.json_schema.properties.table.enum.includes('owner_seasons'));
 const prompt=payload.messages[0].content;assert.ok(prompt.includes('"table":"owner_seasons"'));assert.ok(prompt.includes('use rank'));
 return {response:{table:'owner_seasons',operation:'rank',filters:[],sort_field:'expected_wins',direction:'desc',limit:5}};
 }}};
 const r=await post('Which owner had the most expected wins during 2025?',env);const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));assert.equal(b.rows[0][1],'Kyle');
});

test('named-owner expected wins lookup tolerates omitted display defaults and preserves scope',async()=>{
 const env={AI:{async run(model,payload){
 for(const field of ['table','operation','filters','direction','limit'])assert.ok(payload.response_format.json_schema.required.includes(field));
 return {response:{table:'owner_seasons',operation:'rank',sort_field:'expected_wins'}};
 }}};
 const r=await post('What were Jack’s expected wins in 2025?',env);const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));assert.equal(b.rows.length,1);assert.equal(b.rows[0][1],'Jack');assert.equal(b.rows[0].at(-1),'5.18');
 assert.ok(b.query.filters.some(f=>f.field==='year'&&f.value===2025));assert.ok(b.query.filters.some(f=>f.field==='owner'&&f.value==='Jack'));
});
test('normalizing omitted display fields cannot accept invalid calculation fields',()=>{
 const p=normalizePlan({table:'owner_seasons',operation:'rank',sort_field:'invented'},'Jack expected wins');assert.throws(()=>validatePlan(p));
 const bad=normalizePlan({table:'owner_seasons',operation:'rank',sort_field:'expected_wins',direction:'sideways'},'test');assert.throws(()=>validatePlan(bad));
});

test('numeric text filters normalize by declared field type, without guessing or bypassing validation',()=>{
 const base={table:'owner_seasons',operation:'rank',filters:[{field:'year',op:'eq',value:'2025'},{field:'owner',op:'eq',value:'Jack'}],sort_field:'expected_wins',limit:'5'};
 const p=normalizePlan(base,'Jack expected wins');validatePlan(p);assert.equal(p.filters[0].value,2025);assert.equal(p.filters[1].value,'Jack');assert.equal(p.limit,5);
 for(const value of ['2025abc','','twenty twenty-five',null])assert.throws(()=>validatePlan(normalizePlan({...base,filters:[{field:'year',op:'eq',value}]},'test')));
 const list=normalizePlan({...base,filters:[{field:'year',op:'in',value:['2024','2025']}]},'test');validatePlan(list);assert.deepEqual(list.filters[0].value,[2024,2025]);
});
test('realistic model plan with quoted year returns Jack 5.18',async()=>{
 const env={AI:{async run(){return {response:{table:'owner_seasons',operation:'rank',filters:[{field:'year',op:'eq',value:'2025'},{field:'owner',op:'eq',value:'Jack'}],sort_field:'expected_wins'}};}}};
 const r=await post('Show Jack expected wins for 2025',env);const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));assert.equal(b.rows[0][1],'Jack');assert.equal(b.rows[0].at(-1),'5.18');
});

test('conversational wording retains evidence and numeric results without extra AI',()=>{
 const q='Who had the highest-scoring 4-game stretch ever?',r=result(q);
 assert.match(r.answer,/Schubert had the highest-scoring 4-game stretch/);assert.match(r.answer,/648.96 points/);assert.equal(r.evidence.length,4);assert.equal(r.rows[0][3],'648.96');
 const scope=questionScope('Jack expected wins in 2025',data);
 const p=enforceScope({table:'owner_seasons',operation:'rank',filters:[],sort_field:'expected_wins',direction:'desc',limit:5},scope,data);
 const a=executePlan(data,p,'Jack expected wins');assert.match(a.answer,/Jack’s weekly scores translated to 5.18 expected wins in 2025/);assert.ok(a.evidence.length);assert.equal(a.cutoff,'2026 Week 7');
});

test('aggregate expected-wins lookup uses scoring language rather than recorded results',()=>{
 const scope=questionScope('Jack expected wins in 2025',data);
 const p=enforceScope({table:'owner_seasons',operation:'aggregate',filters:[],group_by:['owner'],metric:{op:'sum',field:'expected_wins'},direction:'desc',limit:5},scope,data);
 const r=executePlan(data,p,'Jack expected wins');assert.equal(r.answer,'Jack’s weekly scores translated to 5.18 expected wins in 2025.');
});

 test('approved Sparty errors preserve explanations and distinguish service failures',async()=>{
 const unsupported=await post('Which teams have clinched the playoffs?',{});const a=await unsupported.json();assert.match(a.error,/^Don't ask stupid questions, try something different\./);assert.match(a.error,/playoff|support|verif/i);
 const unavailable=await post('Show expected wins for Jack in 2025',{AI_ENABLED:'false'});const b=await unavailable.json();assert.match(b.error,/^A Wolverine got in the way\. Try again\./);assert.match(b.error,/unavailable/);
 });

test('zero-title questions include every historical nonwinner rather than the leader',async()=>{
 const expected=data.owner_careers.filter(o=>!data.championships.some(c=>c.champion_owner_name===o.owner_name)).map(o=>[o.owner_name,'0']).sort((a,b)=>a[0].localeCompare(b[0]));
 for(const q of ['Who has no championships?','Who has zero titles?','Which owners have never won a championship?','Who has not won a title?','Which owners are without championships?']){
  const r=await post(q,{}),b=await r.json();assert.equal(r.status,200,b.error);assert.deepEqual(b.rows,expected);assert.ok(!b.rows.some(r=>r[0]==='Spencer'));assert.match(b.scope,/All historical owners/);
 }
 const r=await post('Who has no championships in 2025?',{});assert.equal(r.status,400);
 const leader=await post('Who has the most championships?',{});assert.match((await leader.json()).answer,/Spencer/);
});
