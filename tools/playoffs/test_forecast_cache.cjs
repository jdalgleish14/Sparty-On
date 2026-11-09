const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');const source=fs.readFileSync(path.join(root,'assets/data-refresh.js'),'utf8');
async function load(protocol,now){
 const loaded=[];const originals=['site-data/site-data.js','site-data/playoff-predictor.js','assets/playoff-scenarios.js','assets/playoff-predictor.js'].map(src=>({dataset:{spartySrc:src},replaceWith(script){loaded.push(script.src);script.onload();}}));
 const date=class extends Date{static now(){return now;}};
 const context={URL,AbortController,Date:date,setTimeout,clearTimeout,setInterval(){},scrollX:0,scrollY:0,scrollTo(){},requestAnimationFrame(f){f();},sessionStorage:{getItem(){return null;},removeItem(){},setItem(){}},location:{protocol,href:protocol==='file:'?'file:///preview/current-season.html':'https://example.test/league/current-season.html',pathname:'/league/current-season.html'},window:{SPARTY_ON_DATA:{league:{generated_at_utc:'unchanged-week8'}} ,addEventListener(){}},document:{hidden:false,querySelectorAll(){return originals;},createElement(){return {};},addEventListener(){},getElementById(){return null;}},fetch:async()=>({ok:true,json:async()=>({generated_at_utc:'unchanged-week8',files:{'games.json':{sha256:'valid'}}})})};
 vm.runInNewContext(source,context);await new Promise(r=>setTimeout(r,10));return loaded.map(src=>new URL(src));
}
test('forecast-only publication gets a fresh request with unchanged core manifest',async()=>{
 const a=await load('https:',100),b=await load('https:',200);
 const forecast=urls=>urls.find(url=>url.pathname.endsWith('/site-data/playoff-predictor.js'));
 assert.notEqual(forecast(a).href,forecast(b).href);assert.equal(forecast(a).searchParams.get('snapshot'),forecast(b).searchParams.get('snapshot'));
 const core=urls=>urls.find(url=>url.pathname.endsWith('/site-data/site-data.js'));
 assert.equal(core(a).href,core(b).href);
 assert.ok(a.findIndex(url=>url.pathname.endsWith('/site-data/playoff-predictor.js'))<a.findIndex(url=>url.pathname.endsWith('/assets/playoff-predictor.js')));
});
test('offline preview keeps local script paths without network cache parameters',async()=>{const urls=await load('file:',100);assert.equal(urls.length,4);assert.ok(urls.every(url=>url.protocol==='file:'&&!url.search));});
