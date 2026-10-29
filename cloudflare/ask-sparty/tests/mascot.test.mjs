import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../../../assets/ask.js',import.meta.url),'utf8');
function harness(){
 const nodes=new Map();
 function element(){return {hidden:false,value:'',style:{},textContent:'',children:[],events:{},classList:{add(){},remove(){},toggle(){}},append(...a){this.children.push(...a);},setAttribute(){},addEventListener(k,v){this.events[k]=v;}};}
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 let resolve,reject;const pending=new Promise((r,j)=>{resolve=r;reject=j;});
 const context={document:{hidden:false,getElementById:get,createElement:element,createTextNode:t=>t,addEventListener(){},querySelectorAll(){return[];}},window:{matchMedia:()=>({matches:true,addEventListener(){}})},fetch:()=>pending,AbortController,setInterval:()=>1,clearInterval(){},setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(source,context);return {get,resolve,reject};
}
test('existing website shows conversational answer and runs thinking/success Sparty poses',async()=>{
 const {get,resolve}=harness();get('ask-question').value='What were Jack expected wins in 2025?';
 const task=get('ask-form').events.submit({preventDefault(){}});
 assert.match(get('ask-mascot-sprite').style.backgroundPosition,/-832px/);assert.equal(get('ask-submit').disabled,true);
 resolve({ok:true,json:async()=>({title:'Expected wins',answer:'Jack finished 2025 with 5.18 expected wins.',scope:'2025 regular season',columns:[],rows:[],cutoff:'2026 Week 7',source:'Verified records'})});await task;
 assert.equal(get('ask-result').textContent,'Jack finished 2025 with 5.18 expected wins.');assert.equal(get('ask-speech').hidden,false);assert.equal(get('ask-answer').hidden,false);assert.match(get('ask-mascot-sprite').style.backgroundPosition,/-312px/);assert.equal(get('ask-submit').disabled,false);
});
test('unsupported response retains existing error pose and displays useful explanation',async()=>{
 const {get,resolve}=harness();get('ask-question').value='Which teams clinched?';const task=get('ask-form').events.submit({preventDefault(){}});
 resolve({ok:false,json:async()=>({error:'I cannot verify that yet.'})});await task;
 assert.match(get('ask-mascot-sprite').style.backgroundPosition,/-624px/);assert.equal(get('ask-status').textContent,'I cannot verify that yet.');assert.equal(get('ask-submit').disabled,false);
});

test('approved backend joke and explanation survive website error handling',async()=>{
 const {get,resolve}=harness();get('ask-question').value='Which teams clinched?';const task=get('ask-form').events.submit({preventDefault(){}});
 const message="Don't ask stupid questions, try something different. I cannot verify playoff scenarios yet.";
 resolve({ok:false,json:async()=>({error:message})});await task;
 assert.equal(get('ask-status').textContent,message);assert.match(get('ask-mascot-sprite').style.backgroundPosition,/-624px/);
});
test('website timeout uses approved Wolverine wording and restores submit',async()=>{
 const {get,reject}=harness();get('ask-question').value='Who has the most wins?';const task=get('ask-form').events.submit({preventDefault(){}});
 const error=new Error('aborted');error.name='AbortError';reject(error);await task;
 assert.equal(get('ask-status').textContent,'A Wolverine got in the way. Try again. The question service took too long to respond.');assert.equal(get('ask-submit').disabled,false);
});
