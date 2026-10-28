const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../../assets/data-refresh.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function setup({protocol='https:', fail=false, storageBlocked=false}={}) {
 let now=100000, latest='v1', failure=fail;
 const events={}, timers=[], urls=[], requests=[], navigations=[], saved=new Map();
 const placeholders=['site-data/site-data.js','assets/app.js','site-data/sparty-records.js'].map(src=>({
  dataset:{spartySrc:src}, replaceWith(script){urls.push(script.src);queueMicrotask(()=>script.onload());}
 }));
 const ctx={URL, AbortController, Promise, console,
  Date:{now:()=>now}, scrollX:0,scrollY:450,scrollTo:()=>{},
  requestAnimationFrame: fn=>fn(),
  sessionStorage:{getItem:k=>saved.get(k),removeItem:k=>saved.delete(k),setItem(k,v){if(storageBlocked)throw Error();saved.set(k,v);}},
  location:{protocol,pathname:'/league/records.html',href:protocol==='file:'?'file:///league/records.html':'https://example.com/league/records.html?owner=jack#scores',replace:u=>navigations.push(u)},
  document:{hidden:false,querySelectorAll:()=>placeholders,createElement:()=>({}),getElementById:()=>null,addEventListener:(n,f)=>events[n]=f},
  setTimeout:()=>1,clearTimeout:()=>{},setInterval:(f,ms)=>timers.push({f,ms}),
  fetch:async(url,options)=>{requests.push({url,options});if(failure)throw Error();return {ok:true,json:async()=>({generated_at_utc:latest,files:{'games.json':{sha256:'abc'}}})};}
 };
 ctx.window={SPARTY_ON_DATA:{league:{generated_at_utc:'v1'}},addEventListener:(n,f)=>events[n]=f};
 vm.runInNewContext(source,ctx);await tick();await tick();
 return {ctx,events,timers,urls,requests,navigations,saved,advance:()=>now+=31000,version:v=>latest=v,fail:v=>failure=v};
}
test('ordered scripts, versioned data URLs and unchanged snapshot',async()=>{
 const s=await setup();
 assert.deepEqual(s.urls.map(u=>new URL(u).pathname),['/league/site-data/site-data.js','/league/assets/app.js','/league/site-data/sparty-records.js']);
 assert.equal(new URL(s.urls[0]).searchParams.get('snapshot'),'v1');
 assert.equal(new URL(s.urls[2]).searchParams.get('snapshot'),'v1');
 assert.equal(new URL(s.urls[1]).searchParams.get('snapshot'),'v1');
 assert.equal(s.requests[0].options.cache,'no-store');
 assert.equal(s.timers[0].ms,300000);
 assert.equal(s.navigations.length,0);
});
test('tab return refresh preserves URL and scroll; prevents duplicate navigation',async()=>{
 const s=await setup();s.advance();s.version('v2');
 await s.events.visibilitychange();await tick();
 const url=new URL(s.navigations[0]);
 assert.equal(url.searchParams.get('_sparty_version'),'v2');
 assert.equal(url.searchParams.get('owner'),'jack');assert.equal(url.hash,'#scores');
 assert.equal(JSON.parse(s.saved.get('sparty-update-scroll')).y,450);
 s.advance();await s.timers[0].f();assert.equal(s.navigations.length,1);
});
test('hidden tabs and failed checks keep the existing page; online event retries',async()=>{
 const s=await setup();s.advance();s.ctx.document.hidden=true;
 await s.timers[0].f();assert.equal(s.requests.length,2);
 s.ctx.document.hidden=false;s.fail(true);await s.events.online();
 assert.equal(s.navigations.length,0);
 s.advance();s.fail(false);s.version('v2');await s.events.online();
 assert.equal(s.navigations.length,1);
});
test('fallback loads data when manifest fails; restricted storage still permits refresh',async()=>{
 const s=await setup({fail:true,storageBlocked:true});assert.equal(s.urls.length,3);
 s.advance();s.fail(false);s.version('v2');await s.events.pageshow();assert.equal(s.navigations.length,1);
});
test('deployment mismatch cannot repeatedly reload the same version',async()=>{
 const s=await setup();s.ctx.location.href+='&_sparty_version=v2';
 // Keep query before hash, as it would appear after location.replace.
 s.ctx.location.href='https://example.com/league/records.html?_sparty_version=v2';
 s.advance();s.version('v2');await s.timers[0].f();assert.equal(s.navigations.length,0);
});
test('local file previews use original data paths without network checks',async()=>{
 const s=await setup({protocol:'file:'});assert.equal(s.requests.length,0);
 assert.equal(s.urls.length,3);assert.equal(new URL(s.urls[0]).search,'');assert.equal(s.timers.length,0);
});
test('every statistics page has the loader and permits same-origin manifest checks',()=>{
 const root=path.join(__dirname,'../../..');
 for(const name of ['index','current-season','seasons','owners','records','head-to-head']) {
  const html=fs.readFileSync(path.join(root,name+'.html'),'utf8');
  assert.match(html,/src="assets\/data-refresh.js\?v=\d+" defer/);
  assert.match(html,/connect-src 'self'/);
  assert.match(html,/data-sparty-src="site-data\/site-data.js"/);
  assert.equal((html.match(/<script src=/g)||[]).length,1);
 }
});
