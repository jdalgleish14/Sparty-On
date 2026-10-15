/* Dependency-free DOM/timer harness. Layout math is checked with supplied viewport
   measurements; this does not replace visual browser QA. Run: node --test this-file */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
class Element {
  constructor(classes='') {
    this.classes=new Set(classes.split(' '));this.dataset={};this.attributes={};this.listeners={};this.hidden=false;
    this.children=[];this.textContent='';this.rect={left:270,top:260,width:64,height:66,right:334,bottom:326};
    this.style={setProperty:(k,v)=>{this.style[k]=v;}};
    this.classList={contains:k=>this.classes.has(k),toggle:(k,value)=>value?this.classes.add(k):this.classes.delete(k)};
  }
  set className(value){this.classes=new Set(value.split(' '));}
  get className(){return [...this.classes].join(' ');}
  append(...items){this.children.push(...items);}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){(this.listeners[k] ||= []).push(fn);}
  dispatch(k,event={}){for(const fn of this.listeners[k]||[])fn(event);}
  getBoundingClientRect(){
    if(this.classes.has('sparty-dialogue'))return {...this.rect,width:Math.min(310,this.viewport-16),height:this.children[0]?.textContent.length>100?125:70};
    return this.rect;
  }
}
function setup({records=false,width=390,broken=false,stale=false}={}) {
  let now=0,seq=0;const timers=new Map();
  const body=new Element(),button=new Element(records?'sparty-peek':'home-intro-tap'),header=new Element();
  header.rect={left:0,top:0,width,height:150,right:width,bottom:150};
  const document={body,hidden:false,createElement:()=>{const e=new Element();e.viewport=width;return e;},
    querySelector:s=>s==='.record-intro .sparty-peek'?(records?button:null):s==='.masthead'?header:null,
    getElementById:()=>({hidden:false}),listeners:{},addEventListener(k,fn){(this.listeners[k] ||= []).push(fn);}};
  const context=vm.createContext({document,TextEncoder,performance:{now:()=>now},innerWidth:width,innerHeight:844,
    setTimeout:(fn,delay)=>{const id=++seq;timers.set(id,{at:now+delay,fn});return id;},clearTimeout:id=>timers.delete(id),Math,console});
  context.window=context;context.addEventListener=()=>{};
  vm.runInContext(fs.readFileSync(path.join(root,'site-data/site-data.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'site-data/sparty-records.js'),'utf8'),context);
  if(broken)context.SPARTY_RECORDS.sayings.length=201;
  if(stale)context.SPARTY_ON_DATA.games[0].points_for+=1;
  vm.runInContext(fs.readFileSync(path.join(root,'assets/sparty-dialogue.js'),'utf8'),context);
  if(!records)context.SpartyDialogue.mountHome(button);
  const bubble=body.children[0];
  return {context,button,bubble,advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}}};
}
test('Home cycles all 17 verbatim sayings and avoids the cycle-boundary repeat',()=>{
 const x=setup(),texts=[];
 for(let i=0;i<17;i++){x.button.dispatch('click');texts.push(x.bubble.children[0].textContent);}
 assert.equal(new Set(texts).size,17);
 assert.deepEqual(texts.slice().sort(), [
  'Spartans Will', 'Fuck those Wolverines', 'Victory for MSU', 'MSU we love thy Shadows',
  'On the banks of the Red Cedar...', 'FTP', 'I miss Cassius Winston',
  'Remember Schubby? What a cunt', 'What do you think happens after you die?',
  "Rick's later?", 'I could use a beer', 'WOAH He has trouble with the snap',
  'Touchdown MSU', 'He got it! He got it!', 'Pride comes before the fall',
  'Did you just touch my dick?',
  'A Michigan fan walks into a bar, what does the bartender say? Get the fuck out!'
 ].sort());
 assert.ok(texts.includes("Rick's later?"));
 assert.ok(texts.includes('A Michigan fan walks into a bar, what does the bartender say? Get the fuck out!'));
 const last=texts.at(-1);x.button.dispatch('click');assert.notEqual(x.bubble.children[0].textContent,last);
});
test('Rapid taps replace immediately and restart four-second timer',()=>{
 const x=setup();x.button.dispatch('click');const first=x.bubble.children[0].textContent;
 x.advance(3000);x.button.dispatch('click');assert.notEqual(x.bubble.children[0].textContent,first);
 x.advance(3999);assert.equal(x.bubble.hidden,false);x.advance(1);assert.equal(x.bubble.hidden,true);
});
test('Records intro is fixed, then all 200 facts cycle without repeating',()=>{
 const x=setup({records:true});assert.equal(x.bubble.children[0].textContent,'Tap me for a random stat');
 x.advance(5999);assert.equal(x.bubble.hidden,false);x.advance(1);assert.equal(x.bubble.hidden,true);
 const texts=[];for(let i=0;i<200;i++){x.button.dispatch('click');texts.push(x.bubble.children[0].textContent);}
 assert.equal(new Set(texts).size,200);
 assert.equal(x.bubble.children[1].textContent,'Through 2026 Week 5');
 x.button.dispatch('click');assert.notEqual(texts.at(-1),x.bubble.children[0].textContent);
});
test('Home and Records queues are independent',()=>{
 const x=setup({records:true}),home=new Element('home-intro-tap');x.context.SpartyDialogue.mountHome(home);
 const records=new Set();const homeTexts=new Set();
 for(let i=0;i<17;i++){x.button.dispatch('click');records.add(x.bubble.children[0].textContent);home.dispatch('click');homeTexts.add(x.context.document.body.children[1].children[0].textContent);}
 assert.equal(records.size,17);assert.equal(homeTexts.size,17);
});
test('Invalid and retained older collections are handled safely',()=>{
 const broken=setup({records:true,broken:true});broken.button.dispatch('click');assert.match(broken.bubble.children[0].textContent,/breather/);
 const stale=setup({records:true,stale:true});stale.button.dispatch('click');assert.equal(stale.bubble.children[1].textContent,'Historical snapshot · 2026 Week 5');
});
test('Bubble placement stays within 320/390/768px viewports and below navigation',()=>{
 for(const width of [320,390,768]){
  const x=setup({width});x.button.rect={left:width-70,right:width-6,top:160,bottom:226,width:64,height:66};
  x.button.dispatch('click');const left=parseFloat(x.bubble.style.left),top=parseFloat(x.bubble.style.top),box=x.bubble.getBoundingClientRect();
  assert.ok(left>=8);assert.ok(left+box.width<=width-8);assert.ok(top>=158);assert.ok(top+box.height<=836);
 }
});
test('Escape dismisses and polite live-region semantics are present',()=>{
 const x=setup();x.button.dispatch('click');x.button.dispatch('keydown',{key:'Escape'});assert.equal(x.bubble.hidden,true);
 assert.equal(x.bubble.attributes['aria-live'],'polite');assert.equal(x.button.attributes['aria-controls'],x.bubble.id);
});

test('Records rapid taps restart the six-second timer',()=>{
 const x=setup({records:true});x.button.dispatch('click');const first=x.bubble.children[0].textContent;
 x.advance(5000);x.button.dispatch('click');assert.notEqual(x.bubble.children[0].textContent,first);
 x.advance(5999);assert.equal(x.bubble.hidden,false);x.advance(1);assert.equal(x.bubble.hidden,true);
});
