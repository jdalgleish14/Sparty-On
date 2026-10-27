const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../../assets/freshness.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup(now,{data,ask=false,offline=false,current=false,existing=false}={}) {
 const tables=['standings-table','transactions-table','bonus-table'].map(id=>({id,classList:{add(c){this[c]=true}}}));
 const events={},requests=[],insertions=[],removed=[],timers=[];
 let note=existing?{id:'page-sync'}:null;
 const legacy=[{id:'',remove(){removed.push(this)}}];
 if(note)legacy.push(note);
 const footer={insertAdjacentElement(position,value){insertions.push({position,value});note=value;}};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}}
 const snapshot=data===undefined?{validation_report:{status:'PASS'},league:{generated_at_utc:'2026-10-27T12:38:21Z'}}:data;
 const ctx={Intl,Date:Clock,AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:f=>timers.push(f),
  fetch:async(url,options)=>{requests.push({url,options});if(offline)throw Error('offline');return {ok:true,json:async()=>({generated_at_utc:'2026-10-27T12:38:21Z',files:{'games.json':{sha256:'verified-file-hash'}}})};},
  window:{SPARTY_ON_DATA:ask?undefined:snapshot,addEventListener:(key,fn)=>events[key]=fn},
  document:{hidden:false,querySelector:selector=>selector==='main footer'?footer:null,
   querySelectorAll:selector=>{assert.equal(selector,'main .table-sync');return legacy;},
   createElement:()=>({}),getElementById:id=>id==='page-sync'?note:id==='standings-body'?{closest:()=>tables[0]}:id==='bonus-body'?{closest:()=>tables[2]}:id==='transactions-table'&&current?tables[1]:null,
   addEventListener:(name,fn)=>events[name]=fn}};
 vm.runInNewContext(source,ctx);await tick();
 return {tables,events,requests,insertions,removed,timers,get note(){return note;}};
}
test('one page footnote replaces table sync lines and preserves compact team pins',async()=>{
 const s=await setup('2026-10-27T14:00:00Z');
 assert.equal(s.insertions.length,1);assert.equal(s.insertions[0].position,'afterend');
 assert.equal(s.note.id,'page-sync');assert.equal(s.note.className,'table-sync page-sync');
 assert.match(s.note.textContent,/League results — Last sync: Oct 27, 8:38 AM EDT/);
 assert.match(s.note.textContent,/Next sync \(scheduled\): Oct 27, 11:13 AM EDT/);
 assert.equal(s.removed.length,1);assert.equal(s.requests.length,0);
 assert.equal(s.tables[2].classList['compact-team-pin'],true);
 assert.equal(s.tables[1].classList['compact-team-pin'],undefined);
});
test('current-season footnote distinguishes daily updates from weekly results',async()=>{
 const s=await setup('2026-10-27T14:00:00Z',{current:true});
 assert.match(s.note.textContent,/Transactions \/ Max PF: daily at 9 AM Eastern/);
 assert.equal(s.insertions.length,1);
});
test('next weekly check follows Eastern time through the fall DST change',async()=>{
 const s=await setup('2026-10-31T14:00:00Z');
 assert.match(s.note.textContent,/Nov 3, 6:00 AM EST/);
});
test('Ask Sparty reads only publication metadata and gets the same footnote',async()=>{
 const s=await setup('2026-10-27T14:00:00Z',{ask:true});
 assert.equal(s.requests.length,1);assert.equal(s.requests[0].url,'site-data/manifest.json');
 assert.equal(s.requests[0].options.cache,'no-store');
 assert.match(s.note.textContent,/Oct 27, 8:38 AM EDT/);
});
test('offline metadata and invalid snapshots never break the page or invent a time',async()=>{
 const offline=await setup('2026-10-27T14:00:00Z',{ask:true,offline:true});
 assert.equal(offline.insertions.length,0);
 const invalid=await setup('2026-10-27T14:00:00Z',{data:{validation_report:{status:'FAIL'}}});
 assert.equal(invalid.insertions.length,0);
 const date=await setup('2026-10-27T14:00:00Z',{data:{validation_report:{status:'PASS'},league:{generated_at_utc:'invalid'}}});
 assert.equal(date.insertions.length,0);
});
test('existing page footnote is reused and refresh keeps the actual publication time',async()=>{
 const s=await setup('2026-10-27T14:00:00Z',{existing:true});
 assert.equal(s.insertions.length,0);assert.equal(s.removed.length,1);
 s.events.visibilitychange();s.timers[0]();
 assert.match(s.note.textContent,/Last sync: Oct 27, 8:38 AM EDT/);
});
test('every page loads the common footnote script',()=>{
 const root=path.join(__dirname,'../../..');
 for(const name of ['index','current-season','seasons','owners','records','head-to-head','ask']){
  const html=fs.readFileSync(path.join(root,`${name}.html`),'utf8');
  assert.match(html,/assets\/freshness\.js/);assert.match(html,/<footer>/);
  if(name==='ask')assert.match(html,/connect-src 'self' https:\/\/sparty\.jdalgleish14\.workers\.dev/);
 }
});
