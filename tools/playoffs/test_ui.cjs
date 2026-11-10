const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function run(mutate=()=>{}){
 const nodes=new Map(),initial=new Map();let calls=0;
 for(const m of read('current-season.html').matchAll(/<([a-z0-9]+)\b([^>]*\bid="([^"]+)"[^>]*)>/gi))initial.set(m[3],{tag:m[1],hidden:/\bhidden(?:\s|>|$)/.test(m[2])});
 const element=(tag='div')=>({tag,hidden:false,textContent:'',value:'',children:[],events:{},attributes:{},append(...xs){if(this.tag==='select'&&!this.children.length&&xs[0]?.value)this.value=xs[0].value;this.children.push(...xs);},replaceChildren(){this.children=[];},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,f){this.events[k]=f;}});
 const get=id=>{if(!nodes.has(id)){const state=initial.get(id)||{};const node=element(state.tag);node.hidden=!!state.hidden;nodes.set(id,node);}return nodes.get(id);};
 const context={window:{},setTimeout,clearTimeout,document:{getElementById:get,createElement:element}};vm.createContext(context);
 for(const f of ['tools/playoffs/fixtures/site-data.js','tools/playoffs/fixtures/playoff-predictor.js','assets/playoff-scenarios.js'])vm.runInContext(read(f),context);
 const simulate=context.window.SpartyScenarios.simulate;context.window.SpartyScenarios.simulate=(...args)=>{calls++;return simulate(...args);};
 mutate(context.window);vm.runInContext(read('assets/playoff-predictor.js'),context);return {get,context,calls:()=>calls};
}
async function ready(get){for(let i=0;i<1500;i++){if(!get('team-outlook').hidden&&get('scenario-status').hidden)return;await new Promise(r=>setTimeout(r,10));}throw Error('Outlook did not finish: '+get('scenario-status').textContent);}
function select(get,id){get('playoff-team').value=id;get('playoff-team').events.change();}
function allText(node){return [node.textContent,...node.children.map(allText)].join(' ');}

test('entry shows current league forecast and a blank team without running simulations',async()=>{
 const {get,calls}=run();assert.equal(get('playoff-body').children.length,12);assert.equal(get('playoff-content').hidden,false);
 assert.equal(get('playoff-team').value,'');assert.equal(get('team-explorer').hidden,true);assert.equal(get('team-prompt').hidden,false);assert.equal(calls(),0);
 const jack=get('playoff-body').children.find(row=>allText(row).includes('Jack'));assert.match(allText(jack),/95.5%/);
});
test('team view keeps every analysis, uses plain wording, and updates picks automatically',async()=>{
 const {get}=run();select(get,'owner-jack');await ready(get);
 assert.equal(get('team-explorer').hidden,false);assert.match(get('team-heading').textContent,/Jack/);assert.match(get('clinch-path').textContent,/5 more wins guarantee Jack/);
 assert.equal(get('scenario-proof').hidden,true);assert.equal(get('team-cards').children.length,3);assert.match(allText(get('team-cards').children[0]),/95.5%/);
 assert.equal(get('team-schedule').children.length,7);assert.equal(get('seed-bars').children.length,12);assert.ok(get('rooting-list').children.length>0);assert.equal(get('scenario-run').hidden,true);
 const baseline=allText(get('playoff-body'));
 get('scenario-winout').events.click();assert.equal(get('team-outlook').hidden,true);await ready(get);
 assert.match(get('scenario-proof').textContent,/guaranteed a playoff spot/);assert.equal(get('scenario-proof').hidden,false);assert.equal(get('scenario-reset').hidden,false);assert.equal(get('team-cards').children.length,4);assert.equal(allText(get('playoff-body')),baseline);
 select(get,'owner-ryan');assert.match(get('team-heading').textContent,/Ryan/);
 get('scenario-reset').events.click();await ready(get);assert.match(get('team-summary').textContent,/Current forecast/);assert.equal(get('scenario-reset').hidden,true);
 select(get,'');assert.equal(get('team-explorer').hidden,true);assert.equal(get('team-prompt').hidden,false);
});
test('league owner shortcut selects that team and the week picker limits game controls',async()=>{
 const {get}=run();const jack=get('playoff-body').children.find(row=>allText(row).includes('Jack'));
 jack.children[0].children[0].events.click();await ready(get);assert.equal(get('playoff-team').value,'owner-jack');
 const groups=get('scenario-games').children;assert.equal(groups.filter(g=>!g.hidden).length,1);
 get('scenario-week').value='9';get('scenario-week').events.change();assert.equal(groups[0].hidden,true);assert.equal(groups[1].hidden,false);
 const selectGame=groups[1].children[0].children[0];selectGame.value=selectGame.children[1].value;selectGame.events.change();await ready(get);assert.match(get('pick-count').textContent,/1 pick/);
});
test('rooting advice can apply a winner in one click and all games remain accessible',async()=>{
 const {get}=run();select(get,'owner-jack');await ready(get);get('root-week').value='all';get('root-week').events.change();
 assert.equal(get('rooting-list').children.length,35);
 const card=get('rooting-list').children.find(c=>c.children[1]?.children.some(n=>n.tag==='button'));
 assert.ok(card);const pick=card.children[1].children.find(n=>n.tag==='button');pick.events.click();await ready(get);assert.match(get('pick-count').textContent,/1 pick/);
});
test('rapid pick changes are cancelled so the last picks determine the outlook',async()=>{
 const {get}=run();select(get,'owner-jack');await ready(get);get('scenario-winout').events.click();get('scenario-loseout').events.click();await ready(get);
 assert.ok(get('team-schedule').children.every(row=>!row.children[2].textContent.includes('Jack picked')));
 assert.match(get('team-summary').textContent,/With your picks/);
});
test('missing output keeps predictor unavailable',()=>{const {get}=run(w=>w.SPARTY_PLAYOFFS=null);assert.equal(get('playoff-content').hidden,true);assert.match(get('playoff-status').textContent,/waiting/);});
test('new published cutoff hides old predictions',()=>{const {get}=run(w=>w.SPARTY_ON_DATA.league.current_season_through_week++);assert.equal(get('playoff-content').hidden,true);assert.match(get('playoff-status').textContent,/refreshed/);});
test('same-week standings correction hides old predictions',()=>{const {get}=run(w=>w.SPARTY_ON_DATA.current_standings[0].points_for++);assert.equal(get('playoff-content').hidden,true);});
test('score correction with unchanged standings also hides old predictions',()=>{const {get}=run(w=>{w.SPARTY_ON_DATA.games.find(g=>g.year===2026&&g.stage==='Regular Season').points_for++;});assert.equal(get('playoff-content').hidden,true);assert.match(get('playoff-status').textContent,/score correction/);});

test('bracket assigns current standings seeds and preserves fixed paths',()=>{
 const {get,context,calls}=run();const bracket=get('projected-bracket');assert.equal(bracket.hidden,false);assert.equal(calls(),0);
 const rounds=bracket.children.map(section=>section.children[2].children);
 assert.deepEqual(rounds.map(games=>games.length),[4,2,1]);
 const d=context.window.SPARTY_ON_DATA;const seeded=[...d.current_standings].sort((a,b)=>a.rank-b.rank).slice(0,8);const names=new Map(d.owners.map(o=>[o.owner_id,o.owner_name]));
 const expected=[[1,8],[4,5],[2,7],[3,6]];
 rounds[0].forEach((game,i)=>game.children.slice(1).forEach((team,j)=>{
  const seed=expected[i][j];assert.equal(team.children[0].textContent,String(seed));assert.equal(team.children[1].textContent,names.get(seeded[seed-1].owner_id));
 }));
 assert.match(allText(rounds[1][0]),/Winner of Game 1.*Winner of Game 2/);
 assert.match(allText(rounds[1][1]),/Winner of Game 3.*Winner of Game 4/);
 assert.match(allText(rounds[2][0]),/Winner of Semifinal 1.*Winner of Semifinal 2/);
});
test('standings bracket remains available with stale or absent forecasts',()=>{
 for(const mutate of [w=>w.SPARTY_ON_DATA.league.current_season_through_week++,w=>w.SPARTY_PLAYOFFS=null]){
  const {get,calls}=run(mutate);
  assert.equal(get('projected-bracket').hidden,false);assert.equal(get('projected-bracket').children.length,3);assert.match(get('bracket-status').textContent,/If the season ended today/);assert.equal(calls(),0);
 }
});
