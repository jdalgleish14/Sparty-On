/* Controller integration checks using the real page IDs and header controls.
   These check interactions, not browser layout or native Safari rendering. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const html=fs.readFileSync(path.join(root,'current-season.html'),'utf8');
const source=fs.readFileSync(path.join(root,'assets/schedule-swap-ui.js'),'utf8');
const api=require('../../../assets/schedule-swap.js');
const raw={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'site-data/site-data.js'),'utf8'),raw);
const decode=text=>text.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"');
function setup(mutate){
 const data=JSON.parse(JSON.stringify(raw.window.SPARTY_ON_DATA));if(mutate)mutate(data);
 class Element{
  constructor(){this.events={};this.dataset={};this.attrs={};this.textContent='';this.innerHTML='';this.hidden=false;this.value='';}
  addEventListener(n,f){this.events[n]=f;}
  setAttribute(n,v){this.attrs[n]=v;}
  getAttribute(n){return this.attrs[n];}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
  querySelector(){return this.span;}
 }
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],new Element()]));
 const headers=[...html.matchAll(/<th[^>]+data-swap-sort="([^"]+)"[^>]*><button[^>]*>(.*?)<\/button>/g)].map(m=>{
  const head=new Element(),button=new Element();head.dataset.swapSort=m[1];head.span=new Element();button.textContent=decode(m[2]);button.parentElement=head;return {head,button};
 });
 elements.get('swap-summary-table').querySelectorAll=selector=>headers.map(h=>selector.endsWith('button')?h.button:h.head);
 const events={},win={SPARTY_ON_DATA:data,SpartyScheduleSwap:api,matchMedia:()=>({matches:true}),addEventListener:(n,f)=>events[n]=f};
 elements.get('swap-difficulty-order').value='hard';
 vm.runInNewContext(source,{window:win,document:{getElementById:id=>elements.get(id)||null},console});
 return {data,win,events,headers,get:id=>elements.get(id),plain:id=>decode(elements.get(id).innerHTML),trigger:(id,event,target)=>elements.get(id).events[event]({target})};
}

test('page loads all requested tables after Standings Race and before transactions',()=>{
 const s=setup();assert.equal(s.get('swap-content').hidden,false);assert.equal(s.get('swap-status').hidden,true);
 for(const id of ['swap-summary-body','swap-detail-body','swap-mobile-matrix-body','swap-difficulty-body']) assert.equal((s.get(id).innerHTML.match(/<tr/g)||[]).length,12);
 assert.equal((s.get('swap-matrix-body').innerHTML.match(/<td/g)||[]).length,144);
 assert.equal((s.get('swap-matrix-body').innerHTML.match(/swap-diagonal/g)||[]).length,12);
 assert.ok(html.indexOf('id="race-section"')<html.indexOf('id="schedule-swap-section"'));
 assert.ok(html.indexOf('id="schedule-swap-section"')<html.indexOf('id="transactions-section"'));
 assert.equal(s.headers.length,6);
});

test('selector and summary buttons populate the same team analysis',()=>{
 const s=setup();s.trigger('swap-team','change',{value:'owner-jack'});
 assert.equal(s.get('swap-detail-title').textContent,'Touchy Time');
 assert.match(s.plain('swap-stats'),/Actual4–3Average wins4.42Best6–1Worst3–4Schedule impact−0.42/);
 s.trigger('swap-summary-body','click',{closest:()=>({dataset:{swapTeam:'owner-alex'}})});
 assert.equal(s.get('swap-team').value,'owner-alex');assert.equal(s.get('swap-detail-title').focused,true);assert.equal(s.get('swap-detail').scrolled,true);
 assert.match(s.plain('swap-stats'),/Actual2–5Average wins4.25Best6–1Worst2–5Schedule impact−2.25/);
});

test('numeric summary sorting, reversed difficulty and mobile schedule selection work',()=>{
 const s=setup(),h=s.headers.find(h=>h.head.dataset.swapSort==='averageWins');
 h.button.events.click();assert.match(s.plain('swap-summary-body'),/^Motor City Dan Campbell/);assert.equal(h.head.attrs['aria-sort'],'descending');
 h.button.events.click();assert.match(s.plain('swap-summary-body'),/^Home Grown/);assert.equal(h.head.attrs['aria-sort'],'ascending');
 assert.match(s.plain('swap-difficulty-body'),/^1Room 40/);
 s.get('swap-difficulty-order').value='easy';s.trigger('swap-difficulty-order','change');assert.match(s.plain('swap-difficulty-body'),/^12The Vandercruyssen Empire/);
 const analysis=api.build(s.data);
 for(const team of analysis.teams){
  s.trigger('swap-borrowed','change',{value:team.owner_id});
  assert.equal(s.get('swap-mobile-schedule').textContent,team.team);
  const wins=[...s.get('swap-mobile-matrix-body').innerHTML.matchAll(/<td[^>]*>(\d+) \/ (\d+)/g)].map(m=>+m[1]);
  assert.deepEqual(wins,analysis.teams.map(t=>t.scenarios.find(r=>r.schedule_id===team.owner_id).wins));
 }
});

test('daily rename event escapes labels, preserves identities and rejects wrong mappings',()=>{
 const s=setup();s.trigger('swap-team','change',{value:'owner-jack'});
 const before=s.plain('swap-stats');
 const snapshot={season:2026,teams:s.data.current_standings.map(t=>({owner_id:t.owner_id,team:t.team}))};
 snapshot.teams.find(t=>t.owner_id==='owner-jack').team='Renamed <Team>';
 s.events['sparty-sleeper-totals']({detail:snapshot});assert.equal(s.get('swap-detail-title').textContent,'Renamed <Team>');
 assert.match(s.get('swap-summary-body').innerHTML,/Renamed &lt;Team&gt;/);assert.equal(s.plain('swap-stats'),before);
 snapshot.teams[0].owner_id='unknown';snapshot.teams.find(t=>t.owner_id==='owner-jack').team='Wrong mapping';
 s.events['sparty-sleeper-totals']({detail:snapshot});assert.equal(s.get('swap-detail-title').textContent,'Renamed <Team>');
});

test('desktop cell focus exposes its full record as visible text',()=>{
 const s=setup();s.trigger('swap-matrix-body','focusin',{closest:()=>({getAttribute:()=> 'Touchy Time on Test schedule: 6–1'})});
 assert.equal(s.get('swap-cell-detail').textContent,'Touchy Time on Test schedule: 6–1');
});

test('missing scoring data fails within this section, leaving other sections alone',()=>{
 const s=setup(data=>data.games.splice(data.games.findIndex(g=>g.year===2026),1));
 assert.equal(s.get('swap-content').hidden,true);assert.equal(s.get('swap-status').hidden,false);assert.match(s.get('swap-status').textContent,/incomplete/);
 assert.equal(s.get('race-section').hidden,false);
});
