const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../../assets/freshness.js'),'utf8');
function setup(now, snapshot) {
 const tables=['standings-table','transactions-table','bonus-table'].map(id=>({id,classList:{add(c){this[c]=true}},footer:null,closest(){return {insertAdjacentElement:(_,footer)=>this.footer=footer}}}));
 const events={};
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}}
 const data={validation_report:{status:'PASS'},league:{generated_at_utc:'2026-10-27T12:38:21Z'}};
 const ctx={Intl,Date:Clock,setInterval(){},window:{SPARTY_ON_DATA:data,SPARTY_SLEEPER_SNAPSHOT:snapshot,addEventListener:(key,fn)=>events[key]=fn},document:{querySelectorAll:()=>tables,createElement:()=>({}),getElementById:id=>id==='standings-body'?{closest:()=>tables[0]}:id==='bonus-body'?{closest:()=>tables[2]}:null,addEventListener(){}}};
 vm.runInNewContext(source,ctx);
 return {tables,events};
}
test('compact footers distinguish weekly publication and daily check',()=>{
 const s=setup('2026-10-27T14:00:00Z',{checked_at_utc:'2026-10-27T13:05:00Z',fetched_at_utc:'2026-10-20T12:00:00Z'});
 assert.match(s.tables[0].footer.textContent,/Last sync: Oct 27, 8:38 AM EDT/);
 assert.match(s.tables[0].footer.textContent,/Next sync \(scheduled\): Oct 27, 11:13 AM EDT/);
 assert.match(s.tables[1].footer.textContent,/Last sync: Oct 27, 9:05 AM EDT/);
 assert.match(s.tables[1].footer.textContent,/Oct 28, 9:00 AM EDT/);
 assert.equal(s.tables[2].classList['compact-team-pin'],true);
 assert.equal(s.tables[1].classList['compact-team-pin'],undefined);
});
test('fall-back weekend retains 9 AM Eastern after DST changes',()=>{
 const s=setup('2026-10-31T14:00:00Z');
 assert.match(s.tables[1].footer.textContent,/Nov 1, 9:00 AM EST/);
 assert.match(s.tables[0].footer.textContent,/Nov 3, 6:00 AM EST/);
});
test('daily event refreshes its footer without replacing weekly publication',()=>{
 const s=setup('2026-10-27T14:00:00Z');
 s.events['sparty-sleeper-totals']({detail:{fetched_at_utc:'2026-10-27T14:00:00Z'}});
 assert.match(s.tables[1].footer.textContent,/Last update: Oct 27, 10:00 AM EDT/);
 assert.match(s.tables[0].footer.textContent,/8:38 AM EDT/);
});
