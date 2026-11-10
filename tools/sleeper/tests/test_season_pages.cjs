/* Execute real page scripts against synthetic season transitions with a small DOM adapter. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
function page(file,snapshot,scripts){
 const html=read(file),nodes=new Map();
 function element(tag='div'){
  const n={tag,tagName:tag.toUpperCase(),hidden:false,textContent:'',value:'',children:[],options:[],events:{},dataset:{},style:{},attributes:{},classList:{contains:()=>false,add(){},remove(){},toggle(){}},
   append(...children){this.children.push(...children)},replaceChildren(...children){this.children=children},setAttribute(k,v){this.attributes[k]=v},addEventListener(k,v){this.events[k]=v},focus(){},querySelector(){return element()},querySelectorAll(){return []},matches(){return false}};
  let markup='';Object.defineProperty(n,'innerHTML',{get:()=>markup,set(v){markup=v;if(tag==='select'){n.options=[...v.matchAll(/<option[^>]*value="([^"]*)"[^>]*>/g)].map(m=>({value:m[1]}));n.value=n.options[0]?.value||'';}}});
  return n;
 }
 for(const m of html.matchAll(/<([a-z0-9]+)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)){const n=element(m[1]);n.hidden=/\bhidden(?:\s|>|$)/.test(m[2]);nodes.set(m[3],n)}
 const get=id=>nodes.get(id)||null;
 const selectors=new Map();const query=selector=>{if(!selectors.has(selector))selectors.set(selector,element());return selectors.get(selector)};
 const context={window:{SPARTY_ON_DATA:snapshot,addEventListener(){},matchMedia:()=>({matches:true,addEventListener(){}})},document:{getElementById:get,createElement:element,querySelector:query,querySelectorAll:()=>[],addEventListener(){}},setTimeout:()=>1,clearTimeout(){},fetch:()=>Promise.reject(Error('offline')),console,location:{hash:''}};
 vm.createContext(context);for(const f of scripts)vm.runInContext(read(f),context,{filename:f});return {get,context};
}
for(const phase of ['quarterfinal','complete','week1']){
 const snapshot=JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'season_ui_fixture.py'),phase],{maxBuffer:40*1024*1024}));
 for(const [html,script,id] of [['current-season.html','app','homepage'],['seasons.html','seasons','seasons-page'],['owners.html','owners','owners-page'],['records.html','records','records-page'],['head-to-head.html','head-to-head','rivalry-page']]){
  test(`${html} accepts ${phase} and its interactive selection`,()=>{
   const {get}=page(html,structuredClone(snapshot),['assets/season-analytics.js',`assets/${script}.js`]);
   assert.equal(get(id).hidden,false,get('load-status').textContent);assert.equal(get('load-status').hidden,true);
   if(script==='app')assert.match(get('results-title').textContent,phase==='quarterfinal'?/Quarterfinal/:phase==='complete'?/Championship/:/Week 1 results/);
   if(script==='seasons'){
    get('year-select').events.change({target:{value:String(phase==='week1'?2027:2026)}});
    assert.match(get('season-heading').textContent,phase==='week1'?/2027/:/2026/);
    if(phase==='complete')assert.match(get('season-honors').innerHTML,/CHAMPION/);
   }
   if(script==='owners'){
    get('owner-select').events.change({target:{value:'owner-jack'}});assert.equal(get('owner-name').textContent,'Jack');
   }
   if(script==='head-to-head'){
    get('owner-a').events.change({target:{value:'owner-jack'}});get('owner-b').events.change({target:{value:'owner-kyle'}});assert.match(get('rivalry-title').textContent,/Jack vs Kyle/);
   }
  });
 }
 test(`home page accepts ${phase} and selects latest completed stage`,()=>{
  const {get}=page('index.html',structuredClone(snapshot),['assets/home.js']);
  assert.equal(get('ticker-content').hidden,false,get('ticker-status').textContent);
  assert.match(get('ticker-title').textContent,phase==='quarterfinal'?/Quarterfinals/:phase==='complete'?/Championship/:/2027.*Week 1/);
 });
 test(`schedule analysis accepts ${phase} and excludes playoff scores`,()=>{const result=require('../../../assets/schedule-swap.js').build(snapshot);assert.equal(result.weeks,phase==='week1'?1:14);assert.equal(result.teams.length,12);});
 if(phase!=='week1')test(`official bracket renders ${phase} without the predictor`,()=>{
  const {get}=page('current-season.html',structuredClone(snapshot),['assets/postseason.js','assets/playoff-predictor.js']);
  assert.equal(get('projected-bracket').hidden,false);
  assert.equal(get('projected-bracket').children.length,3);
  assert.equal(get('bracket-title').textContent,phase==='complete'?'Final playoff bracket':'Playoff bracket');
  assert.equal(get('playoff-content').hidden,true);
  const text=n=>[n.textContent,...n.children.map(text)].join(' ');
  assert.match(text(get('projected-bracket')),/Final/);
  if(phase==='complete')assert.match(get('bracket-status').textContent,/wins the 2026 championship/);
 });
}
