const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const api=require('../../assets/playoff-scenarios.js');const context={window:{}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'fixtures/playoff-predictor.js'),'utf8'),context);const p=context.window.SPARTY_PLAYOFFS;
test('scenario bank is reproducible and every simulated game has one winner',async()=>{
 const a=await api.simulate(p,{},500),b=await api.simulate(p,{},500);assert.deepEqual(a.ranks,b.ranks);
 for(let t=0;t<a.trials;t++){assert.deepEqual([...a.ranks.slice(t*12,t*12+12)].sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));a.games.forEach((g,j)=>assert.ok([g.a,g.b].includes(a.outcomes[t*a.games.length+j])));}
 const sums=a.ids.map(id=>api.summary(a,id).probability).reduce((a,b)=>a+b);assert.ok(Math.abs(sums-8)<1e-9);
});
test('winning-out picks condition all own game scores and produce the right final wins',async()=>{
 const {ids,games}=api.setup(p),target=ids.indexOf('owner-jack'),picks={};for(const g of games)if(g.a===target||g.b===target)picks[g.key]='owner-jack';
 const bank=await api.simulate(p,picks,1000);const expected=p.standings_signature[target][1]+p.remaining_schedule.length;
 for(let t=0;t<bank.trials;t++)assert.equal(bank.wins[t*12+target],expected);
 const summary=api.summary(bank,'owner-jack');assert.equal(summary.probability,1);assert.ok(summary.rooting.every(g=>g.a!==target&&g.b!==target));assert.equal(api.proof(p,picks,'owner-jack').status,'Clinched under these picks');
});
test('invalid picks and cancelled calculations fail clearly',async()=>{
 await assert.rejects(api.simulate(p,{'bogus':'owner-jack'},100),/Invalid game/);await assert.rejects(api.simulate(p,{},100,()=>true),/Cancelled/);
});
test('conditional score model agrees with filtered baseline on a representative game',async()=>{
 const game=api.setup(p).games[0],id=p.standings_signature[game.a][0],baseline=await api.simulate(p,{},10000),forced=await api.simulate(p,{[game.key]:id},10000);
 let n=0,made=0;for(let t=0;t<baseline.trials;t++)if(baseline.outcomes[t*baseline.games.length]===game.a){n++;made+=baseline.ranks[t*12+game.a]<=8;}
 const measured=api.summary(forced,id).probability;assert.ok(Math.abs(measured-made/n)<.04);assert.ok(n>1000);
});
test('proof bounds never infer certainty from model percentages',()=>{for(const id of api.setup(p).ids)assert.equal(api.proof(p,{},id).status,'Not established by the scenario proof');});
