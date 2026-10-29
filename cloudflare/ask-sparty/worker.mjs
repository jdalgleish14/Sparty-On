// Ask Sparty reliability release. Read-only; no deployment is performed by tests.
const SITE_BASE='https://jdalgleish14.github.io/Sparty-On/';
const SITE_ORIGIN=new URL(SITE_BASE).origin;
const MODEL='@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const RELEASE='reliability-9';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
async function sourceFetch(url,options){return fetch(url,{...options,signal:AbortSignal.timeout(8000)});}
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Sparty On · Question pilot</title><style>
:root{font:16px Arial,sans-serif;color-scheme:light dark}body{max-width:760px;margin:0 auto;padding:24px 16px;line-height:1.5}h1{font-size:27px;margin:16px 0 5px}h2{font-size:20px}small,.note{color:#687a70}header{border-top:5px solid #b08d57;border-bottom:4px solid #18453b;padding-bottom:15px}form{display:grid;gap:10px;margin:22px 0}label{font-weight:700}input,button{font:inherit;padding:11px;border-radius:7px}input{border:1px solid #82988a;min-width:0}button{background:#18453b;color:#fff;border:0;cursor:pointer;min-height:44px}button:disabled{opacity:.55}#examples button{background:transparent;color:inherit;border:1px solid #91a299;font-size:13px;margin:4px;padding:8px}#answer{border:1px solid #81998b;border-top:3px solid #b08d57;border-radius:9px;padding:16px;margin:18px 0}#answer[hidden]{display:none}.scroller{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:530px;font-size:13px}td,th{text-align:left;padding:9px;border-bottom:1px solid #91a299}td:nth-child(n+3),th:nth-child(n+3){text-align:right}p{margin:9px 0}strong{font-weight:800}</style>
<header><small>SPARTY ON · LEAGUE HISTORY</small><h1>Ask Sparty</h1><p>Ask a question about the published league and workbook history.</p></header>
<main><form id="ask"><label for="question">Your question</label><input id="question" maxlength="180" required placeholder="Which team had the most luck in a completed season?"><button type="submit" id="submit">Ask the league data</button></form><div id="examples"><button type="button">Who had the highest-scoring 4-game stretch ever?</button><button type="button">Which team had the most luck in a completed season?</button><button type="button">Who had the most expected wins in 2025?</button><button type="button">Which year had the highest average team score?</button><button type="button">Who had the lowest-scoring 4-game stretch ever?</button><button type="button">Who has the most championships?</button></div><section id="answer" aria-live="polite" hidden></section><p class="note">The AI plans a question; code checks it and calculates from published records. If the requested measure is unclear or missing, it asks for a clearer question.</p><p><a href="?check=1">Check the published data connection</a></p></main>
<script>
const input=document.getElementById('question'),form=document.getElementById('ask'),out=document.getElementById('answer'),submit=document.getElementById('submit');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toFixed(2);
document.querySelectorAll('#examples button').forEach(b=>b.onclick=()=>{input.value=b.textContent;form.requestSubmit()});
form.onsubmit=async event=>{event.preventDefault();submit.disabled=true;out.hidden=false;out.textContent='Checking the verified games…';try{
 const r=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:input.value})});const v=await r.json();
 if(!r.ok){out.textContent=v.error||'No answer available.';return;}
 const table=(cols,rows)=>cols.length&&rows.length?'<div class="scroller"><table><thead><tr>'+cols.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+esc(cell)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'';
 out.innerHTML='<h2>'+esc(v.title)+'</h2><p><strong>'+esc(v.answer)+'</strong></p><p>'+esc(v.scope)+'</p>'+table(v.columns||[],v.rows||[])+(v.evidence?.length?'<h2>Supporting records</h2>'+table(v.evidence_columns,v.evidence):'')+'<p class="note">Data cutoff: '+esc(v.cutoff)+' · '+esc(v.source)+(v.source_url?' · <a href="'+esc(v.source_url)+'" target="_blank" rel="noopener">Full source file</a>':'')+'</p>';
 }catch(_){out.textContent='The question could not be checked right now. Please try again.'}finally{submit.disabled=false}};
</script></html>`;

async function fetchSnapshot() {
  if (SITE_BASE.includes('YOUR-PUBLISHED-')) throw Error('Set SITE_BASE at the top of worker.js to your published homepage URL.');
  const base = new URL(SITE_BASE);
  if (base.protocol !== 'https:') throw Error('The published site URL must use HTTPS.');
  const paths = ['manifest.json', 'validation_report.json', 'games.json', 'season_summaries.json', 'owner_careers.json', 'head_to_head.json', 'championships.json', 'current_standings.json'];
  const responses = await Promise.all(paths.map(name => sourceFetch(new URL('site-data/' + name, base), { headers: { 'accept': 'application/json' } })));
  const missing=paths.filter((_,i)=>!responses[i].ok);
  if (missing.length) throw Error('Missing published files in site-data: '+missing.join(', '));
  const [manifest, report] = await Promise.all([responses[0].json(), responses[1].clone().json()]);
  if (report.status !== 'PASS' || report.source_sha256 !== manifest.source_sha256 ||
      report.publication_cutoff.current_season_through_week !== manifest.publication_cutoff.current_season_through_week)
    throw Error('Published snapshot did not pass validation.');
  // Verify original response bytes, not a reserialized JSON document.
  const reportRaw=new Uint8Array(await responses[1].clone().arrayBuffer());
  const reportEntry=manifest.files?.['validation_report.json'];
  if(!reportEntry||reportRaw.length!==reportEntry.bytes||await sha(reportRaw)!==reportEntry.sha256)
    throw Error('Validation report disagrees with the manifest.');
  const data={};
  for(let i=2;i<paths.length;i++){
    const name=paths[i],bytes=new Uint8Array(await responses[i].arrayBuffer()),entry=manifest.files?.[name];
    if (!entry || bytes.byteLength!==entry.bytes) throw Error(name+' size disagrees with the manifest.');
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(digest!==entry.sha256) throw Error(name+' disagrees with the manifest.');
    data[name.slice(0,-5)]=JSON.parse(new TextDecoder().decode(bytes));
  }
  if (!Array.isArray(data.games) || data.games.length !== report.counts.game_rows) throw Error('Incomplete game data.');
  const cutoff = report.publication_cutoff.current_season_through_week;
  const aiPaths=['ai_manifest.json','ai_games.json','ai_all_games.json','ai_seasons.json','ai_league_years.json'];
  const aiResponses=await Promise.all(aiPaths.map(name=>sourceFetch(new URL('site-data/'+name,base),{headers:{accept:'application/json'}})));
  const missingAi=aiPaths.filter((_,i)=>!aiResponses[i].ok);
  if(missingAi.length)throw Error('Upload the workbook query files to site-data: '+missingAi.join(', '));
  const aiManifest=await aiResponses[0].json();
  if(aiManifest.source_sha256!==manifest.source_sha256||aiManifest.publication_cutoff.current_season_through_week!==cutoff)
    throw Error('Workbook query data does not match the published site export.');
  for(let i=1;i<aiPaths.length;i++){
    const name=aiPaths[i],raw=new Uint8Array(await aiResponses[i].arrayBuffer()),entry=aiManifest.files[name];
    if(!entry||entry.bytes!==raw.byteLength)throw Error('Workbook query file size mismatch: '+name);
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==entry.sha256)throw Error('Workbook query file hash mismatch: '+name);
    const rows=JSON.parse(new TextDecoder().decode(raw));
    if(!Array.isArray(rows)||rows.length!==entry.rows)throw Error('Workbook query row count mismatch: '+name);
    data[name.slice(0,-5)]=rows;
  }
  if(data.ai_games.length!==data.games.filter(x=>x.stage==='Regular Season').length||data.ai_all_games.length!==data.games.length||data.ai_seasons.length!==data.season_summaries.length)
    throw Error('Workbook query records disagree with the site export.');
  const years=[...new Set(data.current_standings.map(r=>r.year))];
  if(years.length!==1||!Number.isInteger(years[0]))throw Error('Current season identity is inconsistent.');
  return { ...data, cutoff, year:years[0], version:await sha(new TextEncoder().encode(JSON.stringify([manifest,aiManifest]))) };
}
const TABLES={
  regular_games:{source:'ai_games.json',label:'one row per team per regular-season week',fields:'year week team owner opponent opponent_owner points_for points_against margin result weekly_rank top_half bottom_half all_play_wins expected_wins win_streak loss_streak era season_status'},
  all_games:{source:'games.json',label:'one row per team per game, including playoffs; game_id is shared by opponents',fields:'game_id year stage week round team owner opponent opponent_owner points_for points_against margin result'},
  combined_games:{source:'ai_all_games.json',label:'one row per team per regular or postseason game with combined career and rivalry streaks',fields:'year stage week_or_round team owner opponent opponent_owner points_for points_against margin result era win_streak loss_streak rivalry_win_streak matchup_total season_status'},
  owner_seasons:{source:'ai_seasons.json',label:'one played season per owner; luck = actual wins minus expected wins',fields:'year owner team games_played wins losses win_percentage points_for points_against average_points_for average_opponent_score average_margin expected_wins luck top_half bottom_half top_half_percentage scores_100_plus scores_120_plus scores_140_plus scores_below_90 scores_below_80 score_std_dev average_top_3 average_bottom_3 close_wins close_losses wins_bottom_half losses_top_half second_place_losses era season_status'},
  league_seasons:{source:'ai_league_years.json',label:'one year per league with league scoring trends',fields:'year teams matchups average_score average_winning_score average_losing_score average_margin average_matchup_total percent_games_under_5 percent_games_under_10 percent_games_under_20 percent_scores_100_plus highest_week_total lowest_week_total highest_week_average lowest_week_average era season_status'},
  owner_careers:{source:'owner_careers.json',label:'one all-games career summary per owner',fields:'owner seasons games_played wins losses ties win_percentage points_for points_against average_points_for average_margin'},
  championships:{source:'championships.json',label:'one champion per completed year',fields:'year owner runner_up champion_score runner_up_score'},
  current_standings:{source:'current_standings.json',label:'current regular-season standings',fields:'year rank owner team games_played wins losses points_for points_against average_points_for'}
};
const validateField=(t,f)=>{if(typeof f!=='string'||!TABLES[t].fields.split(' ').includes(f))throw Error('That measure is not in the published data.');return f};
const format=v=>v==null?'—':typeof v==='number'?(Number.isInteger(v)?String(v):v.toFixed(2)):String(v);
function rowsFor(d,t){
  if(t==='regular_games')return d.ai_games;
  if(t==='combined_games')return d.ai_all_games;
  if(t==='owner_seasons')return d.ai_seasons;
  if(t==='league_seasons')return d.ai_league_years;
  if(t==='all_games')return d.games.map(r=>({...r,owner:r.owner_name,opponent:r.opponent_team,opponent_owner:r.opponent_owner_name}));
  if(t==='owner_careers')return d.owner_careers.map(r=>({...r,owner:r.owner_name}));
  if(t==='championships')return d.championships.map(r=>({...r,owner:r.champion_owner_name,runner_up:r.runner_up_owner_name}));
  return d.current_standings.map(r=>({...r,owner:d.owner_careers.find(o=>o.owner_id===r.owner_id)?.owner_name}));
}
const cmp=(a,b)=>typeof a==='string'&&typeof b==='string'?a.toLowerCase().localeCompare(b.toLowerCase()):a===b?0:a<b?-1:1;
function evidence(rows,t,requested){
  const valid=TABLES[t].fields.split(' '),cols=[...new Set([...requested,'year','week','owner','team','opponent','points_for','points_against'].filter(f=>valid.includes(f)))].slice(0,9);
  return {evidence_columns:cols,evidence:rows.slice(0,25).map(r=>cols.map(f=>format(r[f])))};
}
function aggregate(rows,m){
  if(m.op==='count')return rows.length;
  if(m.op==='count_distinct')return new Set(rows.map(r=>r[m.field]).filter(v=>v!=null)).size;
  const values=rows.map(r=>r[m.field]).filter(v=>typeof v==='number'&&Number.isFinite(v));
  if(!values.length)throw Error('No numeric values matched that measure.');
  if(m.op==='sum')return values.reduce((a,b)=>a+b,0);
  if(m.op==='avg')return values.reduce((a,b)=>a+b,0)/values.length;
  if(m.op==='min')return Math.min(...values);
  if(m.op==='max')return Math.max(...values);
  throw Error('That calculation is not supported.');
}
function applyFilters(rows,t,filters){
  if(!Array.isArray(filters)||filters.length>8)throw Error('Please simplify that question.');
  return rows.filter(r=>filters.every(f=>{
    const field=validateField(t,f.field),v=f.value;
    if(!['eq','ne','gt','gte','lt','lte','in'].includes(f.op)||!(f.op==='in'?Array.isArray(v)&&v.length<=12&&v.every(x=>['string','number'].includes(typeof x)):['string','number'].includes(typeof v)))throw Error('That filter could not be checked.');
    if(r[field]==null)return false;
    if(f.op==='in')return v.some(x=>cmp(r[field],x)===0);
    const n=cmp(r[field],v);
    return f.op==='eq'?n===0:f.op==='ne'?n!==0:f.op==='gt'?n>0:f.op==='gte'?n>=0:f.op==='lt'?n<0:n<=0;
  }));
}
function executePlan(data,plan,question){
  const p=plan,t=p?.table;
  if(!Object.hasOwn(TABLES,t)||!['rank','aggregate','window'].includes(p.operation))throw Error('I cannot verify that question from the published data yet. Try naming a measure and a time period.');
  validatePlan(p);
  const filters=[...p.filters];
  if(['owner_seasons','league_seasons'].includes(t)&&!filters.some(f=>f.field==='season_status'))filters.push({field:'season_status',op:'eq',value:/\b(current|this season|so far)\b/i.test(question)?'Current':'Complete'});
  const rows=applyFilters(rowsFor(data,t),t,filters);
  if(!rows.length)throw Error('No published records match those conditions.');
  const limit=Number.isInteger(p.limit)?Math.max(1,Math.min(p.limit,15)):5,sign=p.direction==='asc'?1:-1;
  let result;
  if(p.operation==='rank'){
    const field=validateField(t,p.sort_field),sorted=rows.filter(r=>r[field]!=null).sort((a,b)=>sign*cmp(a[field],b[field])||cmp(a.year??0,b.year??0)||cmp(a.owner??'',b.owner??''));
    if(!sorted.length)throw Error('No values were published for that measure.');
    const tied=sorted.filter(r=>cmp(r[field],sorted[0][field])===0).length;
    const shown=sorted.slice(0,limit),cols=[...new Set(['year','week','owner','team','opponent','stage',field].filter(f=>TABLES[t].fields.split(' ').includes(f)))];
    result={prose:rankSentence(shown[0],field,p,tied,data,rows.length),answer:(tied>1?'Tied leader ('+tied+' records): ':'')+format(shown[0][field])+' · '+[shown[0].owner,shown[0].team,shown[0].year,shown[0].week?'Week '+shown[0].week:null].filter(Boolean).join(' · '),columns:cols,rows:shown.map(r=>cols.map(f=>format(r[f]))),...evidence(shown,t,[field])};
  }else if(p.operation==='aggregate'){
    const groups=Array.isArray(p.group_by)?p.group_by:[],metric=p.metric||{};
    if(groups.length>2||!['sum','avg','min','max','count','count_distinct'].includes(metric.op))throw Error('That grouping or measure is not available.');
    groups.forEach(f=>validateField(t,f));if(metric.op!=='count')validateField(t,metric.field);
    if(!['count','count_distinct'].includes(metric.op)&&typeof rows.find(r=>r[metric.field]!=null)?.[metric.field]!=='number')throw Error('That measure needs a numeric field.');
    const buckets=new Map();for(const r of rows){const k=JSON.stringify(groups.map(f=>r[f]));if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);}
    const ranked=[...buckets].map(([k,items])=>({names:JSON.parse(k),value:aggregate(items,metric),items})).sort((a,b)=>sign*(a.value-b.value)||JSON.stringify(a.names).localeCompare(JSON.stringify(b.names)));
    const shown=ranked.slice(0,limit),top=shown[0],tied=ranked.filter(r=>Math.abs(r.value-top.value)<1e-9).length;
    result={prose:aggregateSentence(top,groups,metric,p,tied,data),answer:(tied>1?'Tied leader ('+tied+' groups): ':'')+(top.names.length?top.names.map(format).join(' · ')+' · ':'')+format(top.value),columns:[...groups,metric.op+' '+(metric.field||'rows'),'Source rows'],rows:shown.map(x=>[...x.names.map(format),format(x.value),x.items.length]),...evidence(top.items,t,[...groups,metric.field].filter(Boolean)),note:top.items.length>25?'Showing 25 of '+top.items.length+' supporting rows.':''};
  }else{
    if(t!=='regular_games')throw Error('Consecutive weeks use regular-season game records.');
    const w=p.window||{},field=validateField(t,w.field),n=w.length;
    if(!Number.isInteger(n)||n<2||n>14||!['sum','avg'].includes(w.op)||typeof rows.find(r=>r[field]!=null)?.[field]!=='number')throw Error('Ask for a numerical measure across 2–14 consecutive weeks.');
    if(w.start_week!=null&&(!Number.isInteger(w.start_week)||w.start_week<1||w.start_week>14))throw Error('That start week is invalid.');
    const buckets=new Map();for(const r of rows){const k=r.year+'|'+r.owner;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);}
    const windows=[];for(const arr of buckets.values()){
      arr.sort((a,b)=>a.week-b.week);
      for(let i=0;i+n<=arr.length;i++){const slice=arr.slice(i,i+n);
        if(w.start_week!=null&&slice[0].week!==w.start_week)continue;
        if(slice.every((x,j)=>!j||x.week===slice[j-1].week+1))windows.push({items:slice,value:aggregate(slice,{op:w.op,field})});
      }
    }
    windows.sort((a,b)=>sign*(a.value-b.value)||a.items[0].year-b.items[0].year||a.items[0].owner.localeCompare(b.items[0].owner));
    if(!windows.length)throw Error('No consecutive weeks matched those conditions.');
    const shown=windows.slice(0,limit),top=shown[0],tied=windows.filter(r=>Math.abs(r.value-top.value)<1e-9).length;
    result={prose:windowSentence(top,w,p,tied),answer:(tied>1?'Tied leader ('+tied+' stretches): ':'')+top.items[0].owner+' · '+top.items[0].year+' · Weeks '+top.items[0].week+'–'+top.items.at(-1).week+' · '+format(top.value),columns:['Owner','Year','Weeks',w.op+' '+field],rows:shown.map(x=>[x.items[0].owner,x.items[0].year,x.items[0].week+'–'+x.items.at(-1).week,format(x.value)]),...evidence(top.items,t,[field])};
  }
  if(result.prose){result.answer=result.prose;delete result.prose;}
  return {title:questionTitle(p),...result,scope:t.replaceAll('_',' ')+(t==='owner_careers'?' · regular season and postseason; no minimum-games cutoff':'')+' · '+rows.length+' matching source rows'+(result.note?' · '+result.note:''),source:'Verified data: '+TABLES[t].source,source_url:'https://jdalgleish14.github.io/Sparty-On/site-data/'+TABLES[t].source,cutoff:data.year+' Week '+data.cutoff, query:plan, snapshot:data.version};
}

function validatePlan(p){
  if(!p||typeof p!=='object'||!Object.hasOwn(TABLES,p.table)||!['rank','aggregate','window'].includes(p.operation))throw Error('I cannot verify that operation.');
  if(!['asc','desc'].includes(p.direction)||!Number.isInteger(p.limit)||p.limit<1||p.limit>15||!Array.isArray(p.filters)||p.filters.length>8)throw Error('The calculation plan is incomplete. Please rephrase.');
  for(const f of p.filters){
    if(!f||typeof f!=='object')throw Error('Invalid filter.');
    validateField(p.table,f.field);
    if(!['eq','ne','gt','gte','lt','lte','in'].includes(f.op))throw Error('Invalid comparison.');
    const vals=f.op==='in'?f.value:[f.value];
    if(!Array.isArray(vals)||!vals.length||vals.length>12||!vals.every(v=>typeof v==='string'?v.length<=180:typeof v==='number'&&Number.isFinite(v)))throw Error('Invalid filter value.');
    const numeric=['year','week','week_or_round','rank'].includes(f.field)||!['team','owner','opponent','opponent_owner','stage','round','result','era','season_status','game_id','runner_up'].includes(f.field);
    if(vals.some(v=>numeric?typeof v!=='number':typeof v!=='string'))throw Error('Filter value has the wrong type for '+f.field+'.');
  }
  if(p.operation==='rank')validateField(p.table,p.sort_field);
  if(p.operation==='aggregate'){
    if(!Array.isArray(p.group_by)||p.group_by.length>2||!p.metric||!['sum','avg','min','max','count','count_distinct'].includes(p.metric.op))throw Error('Invalid aggregation.');
    p.group_by.forEach(f=>validateField(p.table,f));
    if(p.metric.op!=='count')validateField(p.table,p.metric.field);
    if(p.table==='all_games'&&p.metric.op==='count'&&!p.group_by.includes('owner')&&!p.filters.some(f=>f.field==='owner'&&f.op==='eq'))throw Error('Use distinct game_id to count matchups, or name one owner to count their games.');
  }
  if(p.operation==='window'){
    if(p.table!=='regular_games'||!p.window||!Number.isInteger(p.window.length)||p.window.length<2||p.window.length>14||!['sum','avg'].includes(p.window.op))throw Error('Invalid consecutive-week calculation.');
    validateField(p.table,p.window.field);
  }
}
function zeroTitleQuestion(question){
 const q=question.toLowerCase().replace(/[’]/g,"'");
 return /\b(championships?|titles?)\b/.test(q)&&/\b(no|zero|0|without|never|hasn't|haven't|has not|have not|not won|yet to win)\b/.test(q);
}
function zeroTitleAnswer(question,data){
 // Reuse normal scope validation; remove only the supported negative phrases.
 const scope=questionScope(question.replace(/\b(without|has not|have not|not won)\b/gi,'zero'),data);
 if(scope.year!==null||scope.stage)throw Error('Ask who has no career championships without a year or stage restriction.');
 const current=/\b(current|active)\b/.test(scope.q);
 let owners=data.owner_careers.filter(o=>!current||data.current_standings.some(r=>r.owner_id===o.owner_id));
 if(scope.people.length)owners=owners.filter(o=>scope.people.includes(o.owner_name));
 const winners=new Set(data.championships.map(r=>r.champion_owner_name));
 const names=owners.filter(o=>!winners.has(o.owner_name)).map(o=>o.owner_name).sort();
 return {title:'Owners with no championships',answer:names.length?names.join(', ')+(names.length===1?' has':' have')+' no championships in the published completed-season history.':'None of the matching owners have zero championships in the published completed-season history.',scope:(current?'Current owners':'All historical owners')+' · career titles from completed championship records',columns:['Owner','Championships'],rows:names.map(n=>[n,'0']),cutoff:data.year+' Week '+data.cutoff,source:'Verified data: owner_careers.json, championships.json'+(current?', current_standings.json':''),snapshot:data.version};
}
function questionScope(question,data){
  const q=question.toLowerCase();
  if(/\b(clinch\w*|eliminat\w*|probabilit\w*|odds|schedule|draft|qualif\w*)\b|made (?:the )?playoffs|eventually|best start|worst start|start through|through (?:\w+ )?weeks/.test(q))throw Error('I cannot verify that yet. Starts, schedule swaps, playoff scenarios and draft positioning need dedicated verified calculations.');
  if(/\b(before|after|since|until|between|except|excluding|without|not|only if)\b/.test(q))throw Error('Please simplify: that time range or exclusion needs an explicit supported calculation.');
  const years=[...new Set(q.match(/\b20\d\d\b/g)||[])].map(Number);
  if(years.length>1)throw Error('Please ask about one season at a time.');
  const current=/\b(this season|current season|so far)\b/.test(q);
  if(current&&years.length&&years[0]!==data.year)throw Error('Please choose either the current season or the named year.');
  const year=years[0]??(current?data.year:null);
  if(year!==null&&!data.ai_seasons.some(r=>r.year===year))throw Error('That season is outside the published results.');
  const post=/\b(playoffs?|postseason)\b/.test(q),regular=/\bregular[ -]season\b/.test(q);
  if(post&&regular)throw Error('Please choose regular season or postseason.');
  if(/\b(final|finals|championship game)\b/.test(q))throw Error('Please ask about championships won, or postseason games. Championship-game-only filtering needs a dedicated operation.');
  const names=data.owner_careers.map(r=>r.owner_name);
  const people=names.filter(n=>new RegExp('\\b'+n.toLowerCase()+'\\b').test(q)).sort((a,b)=>q.indexOf(a.toLowerCase())-q.indexOf(b.toLowerCase()));
  return {q,year,stage:post?'Postseason':regular?'Regular Season':null,people};
}
function deterministicPlan(scope){
  const {q,year,stage,people}=scope,filters=[];
  if(year!==null)filters.push({field:'year',op:'eq',value:year});
  if(people.length===1&&!/\b(against|versus|vs|beat)\b/.test(q))filters.push({field:'owner',op:'eq',value:people[0]});
  const direction=/\b(lowest|fewest|worst|smallest|closest|unluckiest|least)\b/.test(q)?'asc':'desc';
  const base={filters,direction,limit:5};
  if(/\b(stretch|streak|consecutive)\b/.test(q)&&/scor|point|margin|differential/.test(q)){
    if(stage==='Postseason')throw Error('Consecutive scoring stretches currently use regular-season weeks only.');
    const words={two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14};
    const m=q.match(/\b(\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen)[ -]+(?:game|week)s?\b/),length=m&&(words[m[1]]||Number(m[1]));
    if(!length||length<2||length>14)throw Error('Specify a stretch of 2–14 consecutive regular-season weeks.');
    return {...base,table:'regular_games',operation:'window',window:{length,field:/margin|differential/.test(q)?'margin':'points_for',op:/average/.test(q)?'avg':'sum'}};
  }
  if(/\b(championships?|titles?)\b/.test(q)){
    if(stage)throw Error('Please ask about titles won without a stage restriction.');
    if(/\b(no|zero|0|never|winless)\b/.test(q))throw Error('Please ask: Which owners have no championships?');
    if(/\b(fewest|least|lowest)\b/.test(q))throw Error('The championship table contains winners only; it cannot rank managers with zero titles.');
    return {...base,table:'championships',operation:'aggregate',group_by:['owner'],metric:{op:'count'}};
  }
  if(/\b(standings|standing|rankings)\b/.test(q))return {...base,table:'current_standings',operation:'rank',sort_field:'rank',direction:'asc',limit:15};
  if(/\b(against|versus|vs|beat)\b/.test(q)&&people.length===1){
    filters.push({field:'opponent_owner',op:'eq',value:people[0]},{field:'result',op:'eq',value:'W'});
    if(stage)filters.push({field:'stage',op:'eq',value:stage});
    if(!/\b(wins|beat|victories)\b/.test(q))throw Error('Specify wins against the named manager, or name two managers for a head-to-head record.');
    return {...base,table:'all_games',operation:'aggregate',group_by:['owner'],metric:{op:'count'}};
  }
  if(/\b(head.to.head|against|versus|vs\.?|beat)\b/.test(q)&&people.length===2){
    if(/scor|point|margin|average|percent|rate/.test(q))return null;
    filters.push({field:'owner',op:'eq',value:people[0]},{field:'opponent_owner',op:'eq',value:people[1]});
    if(stage)filters.push({field:'stage',op:'eq',value:stage});
    return {...base,table:'all_games',operation:'aggregate',group_by:['result'],metric:{op:'count'}};
  }
  if(/\b(score|scored|points|pf|margin|differential|closest)\b/.test(q)&&/\b(game|week|single|matchup|win|victory)\b/.test(q)){
    if(stage)filters.push({field:'stage',op:'eq',value:stage});
    const margin=/margin|differential|closest/.test(q);
    if(margin||/\b(win|wins|victory)\b/.test(q))filters.push({field:'result',op:'eq',value:'W'});
    if(/\bloss(?:es)?\b/.test(q))filters.push({field:'result',op:'eq',value:'L'});
    return {...base,table:'all_games',operation:'rank',sort_field:margin?'margin':'points_for'};
  }
  return null;
}
function enforceScope(plan,scope,data){
  validatePlan(plan);
  const p=structuredClone(plan),{year,stage,people}=scope;
  function force(field,value){
    validateField(p.table,field);
    if(p.filters.some(f=>f.field===field&&(f.op!=='eq'||cmp(f.value,value)!==0)))throw Error('The interpretation conflicts with the requested scope. Please rephrase.');
    if(!p.filters.some(f=>f.field===field))p.filters.push({field,op:'eq',value});
  }
  if(year!==null)force('year',year);
  if(p.table==='current_standings'&&year!==null&&year!==data.year)throw Error('Current standings cannot answer a historical-season question.');
  if(stage){
    if(p.table==='regular_games'&&stage==='Regular Season'){}
    else if(p.table==='all_games'||p.table==='combined_games')force('stage',stage);
    else throw Error('That table cannot apply the requested regular-season/postseason restriction.');
  }
  if(people.length===1)force(/\b(against|versus|vs|beat)\b/.test(scope.q)?'opponent_owner':'owner',people[0]);
  if(people.length>1){
    if(people.length!==2||!['all_games','regular_games','combined_games'].includes(p.table))throw Error('Please ask about one owner or a two-owner matchup.');
    force('owner',people[0]);force('opponent_owner',people[1]);
  }
  if(/\b(lowest|fewest|worst|smallest|closest|unluckiest|least)\b/.test(scope.q)&&p.direction!=='asc')throw Error('The interpretation did not preserve lowest/worst. Please rephrase.');
  if(['owner_seasons','league_seasons'].includes(p.table)&&!p.filters.some(f=>f.field==='season_status'))p.filters.push({field:'season_status',op:'eq',value:year===data.year?'Current':'Complete'});
  validatePlan(p);return p;
}
async function makePlan(question,env,data){
  if(env.AI_ENABLED==='false'||!env.AI)throw Error('Open-ended interpretation is unavailable. Try a scoring stretch, championships, current standings, or two-owner head-to-head question.');
  const tables=Object.entries(TABLES).map(([k,v])=>k+': '+v.label+'; fields: '+v.fields).join('\n');
  const instructions=`Translate the question into ONE read-only JSON calculation plan, never an answer. Return valid JSON with double-quoted keys and strings, no slash notation. Example of a rank plan (adapt every field to the actual question): {"table":"owner_seasons","operation":"rank","filters":[{"field":"year","op":"eq","value":2024}],"sort_field":"points_for","direction":"desc","limit":5}. Operations: rank sorts rows by sort_field; aggregate uses group_by plus metric; window uses window.length, window.field and window.op across consecutive weeks. For questions asking WHICH OWNER had the most/least of a published season measure, use rank, not an ungrouped max/min aggregation which loses owner identity. Use only the tables and fields below. Ascending means lowest/worst/unluckiest; descending means highest/best/luckiest. Preserve all requested restrictions. All games tables have one row per TEAM, not matchup. Count distinct game_id for league matchup counts. Completed-season comparisons must filter season_status Complete; current season ${data.year} uses Current. Historical luck is actual wins minus expected wins; specify whether total or per-season average. Cannot join tables. Unsupported or ambiguous questions: {"table":"unsupported"}. Exact owner names: ${data.owner_careers.map(r=>r.owner_name).join(', ')}.\n${tables}`;
  const model=await runAI(env,{messages:[{role:'system',content:instructions},{role:'user',content:question}],response_format:{type:'json_schema',json_schema:PLAN_SCHEMA},max_tokens:650,temperature:0});
  try{return normalizePlan(parseModelResponse(model.response),question);}catch(error){
    if(env.AI_DEBUG==='true'){
      const raw=model?.response;
      throw Error(error.message+' Diagnostic: '+JSON.stringify({keys:Object.keys(model||{}),response_type:typeof raw,response_length:typeof raw==='string'?raw.length:null,finish_reason:model?.finish_reason??null,response_preview:typeof raw==='string'?raw.slice(0,300):null}));
    }
    throw error;
  }
}
// Small, bounded isolate-local caches and controls: no new paid services.
let snapshot=null,snapshotUntil=0,loading=null,aiBusy=0,day='',aiCalls=0;
const answers=new Map(),clients=new Map();
async function getSnapshot(){
  if(snapshot&&Date.now()<snapshotUntil)return snapshot;
  if(!loading)loading=fetchSnapshot().then(d=>{snapshot=d;snapshotUntil=Date.now()+60000;return d;}).finally(()=>{loading=null;});
  return loading;
}
function rateLimit(ip,now=Date.now()){
  const minute=Math.floor(now/60000);
  for(const [k,v] of clients)if(v.minute!==minute)clients.delete(k);
  const old=clients.get(ip);
  if(!old&&clients.size>=2048)return false;
  const v=old||{minute,count:0};v.count++;clients.set(ip,v);return v.count<=6;
}
async function runAI(env,payload){
  const today=new Date().toISOString().slice(0,10);if(day!==today){day=today;aiCalls=0;}
  if(aiBusy>=2||aiCalls>=100)throw new ServiceError('AI interpretation is temporarily at capacity. Try a supported preset question.',429);
  aiCalls++;aiBusy++;
  // A timed-out binding call can continue at the provider; retain its slot until it settles.
  const task=Promise.resolve().then(()=>env.AI.run(env.AI_MODEL||MODEL,payload)).finally(()=>{aiBusy--;});
  return deadline(task,12000,'AI interpretation timed out. Try again shortly.');
}
class ServiceError extends Error{constructor(message,status){super(message);this.status=status;}}
async function deadline(task,ms,message){let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ServiceError(message,503)),ms);})]);}finally{clearTimeout(timer);}}
async function readQuestion(request){
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new ServiceError('Use a JSON question request.',415);
  if(Number(request.headers.get('content-length'))>1000)throw new ServiceError('The question is too long.',413);
  const reader=request.body?.getReader();if(!reader)throw new ServiceError('Enter a question.',400);
  const chunks=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1000){await reader.cancel();throw new ServiceError('The question is too long.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const buf=new Uint8Array(bytes);let offset=0;for(const c of chunks){buf.set(c,offset);offset+=c.length;}
  let body;try{body=JSON.parse(new TextDecoder().decode(buf));}catch{throw new ServiceError('Send a valid JSON question.',400);}
  const question=typeof body?.question==='string'?body.question.trim():'';
  if(question.length<6||question.length>180)throw new ServiceError('Enter a question of 6–180 characters.',400);
  return question;
}
async function handle(request,env){
  const url=new URL(request.url),origin=request.headers.get('origin');
  if(origin&&origin!==SITE_ORIGIN&&origin!==url.origin)return reply({error:'Use the question form on Sparty On.'},403);
  if(!['GET','POST'].includes(request.method))return reply({error:'Use GET or POST.'},405);
  if(request.method==='GET'&&!url.searchParams.has('check'))return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
  if(!rateLimit(request.headers.get('cf-connecting-ip')||'unknown'))return reply({error:'Too many requests. Please wait a minute.'},429);
  try{
    if(request.method==='GET'){
      const d=await getSnapshot();return reply({status:'PASS',release:RELEASE,game_rows:d.games.length,current_season:d.year,current_season_through_week:d.cutoff});
    }
    const question=await deadline(readQuestion(request),3000,'Question upload timed out.');
    let data;try{data=await getSnapshot();}catch{throw new ServiceError('Published league data could not be verified. Please try again shortly.',503);}
    if(zeroTitleQuestion(question))return reply(zeroTitleAnswer(question,data));
    const scope=questionScope(question,data);
    const key=JSON.stringify([RELEASE,data.version,env.AI_MODEL||MODEL,env.AI_ENABLED,question.toLowerCase().replace(/\s+/g,' ')]);
    if(answers.has(key))return reply(answers.get(key));
    const direct=deterministicPlan(scope),plan=enforceScope(direct||await makePlan(question,env,data),scope,data);
    let result;
    // A named manager with no titles is a verified zero, not a failed query.
    if(plan.table==='championships'&&scope.people.length===1&&!applyFilters(rowsFor(data,plan.table),plan.table,plan.filters).length){
      result={title:'League championships',answer:scope.people[0]+' has no recorded championships'+(scope.year?' in '+scope.year:'')+'.',scope:'Completed championship records',columns:[],rows:[],cutoff:data.year+' Week '+data.cutoff,source:'Verified data: championships.json',snapshot:data.version,query:plan};
    }else result=executePlan(data,plan,question);
    if(scope.people.length===2&&plan.table==='all_games'&&plan.operation==='aggregate'&&plan.group_by.length===1&&plan.group_by[0]==='result'){
      const totals=Object.fromEntries(result.rows.map(r=>[r[0],Number(r[1])]));
      result.title=scope.people.join(' vs ');result.answer=scope.people[0]+' is '+(totals.W||0)+'–'+(totals.L||0)+'–'+(totals.T||0)+' against '+scope.people[1]+(scope.year?' in '+scope.year:' across the published history')+(scope.stage?' ('+scope.stage.toLowerCase()+')':'')+'.';
    }
    result.scope+=' · filters: '+(plan.filters.map(f=>f.field+' '+f.op+' '+JSON.stringify(f.value)).join('; ')||'all published records');
    if(answers.size>=128)answers.delete(answers.keys().next().value);answers.set(key,result);
    return reply(result);
  }catch(e){return reply({error:e.message||'The question could not be checked.'},e.status||400);}
}
export default {async fetch(request,env){
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS'){
    if(origin!==SITE_ORIGIN||request.headers.get('access-control-request-method')!=='POST')return reply({error:'Origin not allowed.'},403);
    return new Response(null,{status:204,headers:{'access-control-allow-origin':SITE_ORIGIN,'access-control-allow-methods':'POST','access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'Origin'}});
  }
  let responseBodyOverride;
  const response=await deadline(handle(request,env),25000,'The question service timed out.').catch(e=>reply({error:e.message},e.status||503));
  if(response.status>=400){
    const body=await response.json();
    const detail=body.error||'The question service temporarily failed.';
    const technical=response.status>=500||response.status===429||/AI|interpretation|unreadable plan|invalid|validation|wrong type|must be|plan |service|timed out|unavailable/i.test(detail);
    responseBodyOverride={...body,error:(technical?'A Wolverine got in the way. Try again.':"Don't ask stupid questions, try something different.")+' '+detail};
  }
  const headers=new Headers(response.headers);if(origin===SITE_ORIGIN){headers.set('access-control-allow-origin',SITE_ORIGIN);headers.set('vary','Origin');}
  if(response.status===429)headers.set('retry-after','60');return new Response(responseBodyOverride?JSON.stringify(responseBodyOverride):response.body,{status:response.status,headers});
}};
export {fetchSnapshot,getSnapshot,executePlan,validatePlan,questionScope,deterministicPlan,enforceScope,rateLimit,readQuestion,deadline};

// Accept JSON wrapped in a markdown fence or prose; never evaluate model text.
// The resulting plan still passes validatePlan and enforceScope before execution.
function parseModelResponse(raw){
  if(raw&&typeof raw==='object'&&!Array.isArray(raw))return raw;
  if(typeof raw==='string'&&raw.length<=20000){
    const text=raw.trim();
    try{return JSON.parse(text);}catch{}
    const first=text.indexOf('{'),last=text.lastIndexOf('}');
    if(first>=0&&last>first){try{return JSON.parse(text.slice(first,last+1));}catch{}}
  }
  throw Error('I could not interpret that calculation. Please try again. The AI returned an incomplete or unreadable plan.');
}
export {parseModelResponse};

const PLAN_SCHEMA={type:'object',properties:{
 table:{type:'string',enum:[...Object.keys(TABLES),'unsupported']},
 operation:{type:'string',enum:['rank','aggregate','window']},
 filters:{type:'array',maxItems:8,items:{type:'object',properties:{field:{type:'string'},op:{type:'string',enum:['eq','ne','gt','gte','lt','lte','in']},value:{anyOf:[{type:'string'},{type:'number'},{type:'array',maxItems:12,items:{anyOf:[{type:'string'},{type:'number'}]}}]}},required:['field','op','value'],additionalProperties:false}},
 sort_field:{type:['string','null']},group_by:{type:'array',maxItems:2,items:{type:'string'}},
 metric:{type:'object',properties:{op:{type:'string',enum:['sum','avg','min','max','count','count_distinct']},field:{type:['string','null']}},required:['op'],additionalProperties:false},
 window:{type:'object',properties:{length:{type:'integer',minimum:2,maximum:14},field:{type:'string'},op:{type:'string',enum:['sum','avg']},start_week:{type:['integer','null']}},required:['length','field','op'],additionalProperties:false},
 direction:{type:'string',enum:['asc','desc']},limit:{type:'integer',minimum:1,maximum:15}
},required:['table','operation','filters','direction','limit'],additionalProperties:false};

// These defaults affect result ordering/size only; calculation and scope remain validated.
function normalizePlan(plan,question){
 if(!plan||typeof plan!=='object'||Array.isArray(plan))return plan;
 const p=structuredClone(plan);
 const numericText=v=>typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v.trim())&&Number.isFinite(Number(v))?Number(v):v;
 const strings=new Set(['team','owner','opponent','opponent_owner','stage','round','result','era','season_status','game_id','runner_up']);
 if(Array.isArray(p.filters)&&Object.hasOwn(TABLES,p.table))p.filters=p.filters.map(f=>{
   if(!f||typeof f!=='object'||strings.has(f.field)||!TABLES[p.table].fields.split(' ').includes(f.field))return f;
   return {...f,value:f.op==='in'&&Array.isArray(f.value)?f.value.map(numericText):numericText(f.value)};
 });
 p.limit=numericText(p.limit);
 if(p.window&&typeof p.window==='object'){p.window.length=numericText(p.window.length);p.window.start_week=numericText(p.window.start_week);}
 if(p.limit==null)p.limit=5;
 if(p.direction==null)p.direction=/\b(lowest|fewest|worst|smallest|closest|unluckiest|least)\b/i.test(question)?'asc':'desc';
 if(p.filters==null)p.filters=[];
 return p;
}
export {normalizePlan};

const LABELS={points_for:'points scored',points_against:'points allowed',expected_wins:'expected wins',luck:'luck',wins:'wins',losses:'losses',win_percentage:'win percentage',average_points_for:'average points per game',average_opponent_score:'average opponent score',average_margin:'average margin',margin:'point differential',weekly_rank:'weekly scoring rank',score_std_dev:'scoring standard deviation',top_half:'top-half finishes',bottom_half:'bottom-half finishes',games_played:'games played',seasons:'seasons',champion_score:'championship winning score',runner_up_score:'championship runner-up score',rank:'standings position',average_score:'average team score',matchup_total:'combined matchup points'};
const label=f=>LABELS[f]||f.replaceAll('_',' ');
const spoken=(value,field)=>field==='win_percentage'||field?.startsWith('percent_')||field?.endsWith('_percentage')?(Number(value)*100).toFixed(1)+'%':format(value);
function tieSentence(tied,unit){return tied>1?' Tied leader: '+tied+' '+unit+' share this value.':'';}
function rankSentence(row,field,p,tied,data,count){
 const who=row.owner||row.team||(row.year?String(row.year):'The leading record');
 const when=row.year?' in '+row.year:'';
 const game=p.table==='all_games'||p.table==='regular_games'||p.table==='combined_games';
 const where=game?(row.week?' Week '+row.week:row.week_or_round?' '+row.week_or_round:row.round?' '+row.round:'')+(row.opponent?' against '+row.opponent:''):'';
 const value=spoken(row[field],field),single=count===1;
 let sentence=who+(single?' recorded ':' had the '+(p.direction==='asc'?'lowest':'highest')+' '+label(field)+' among the matching records: ')+(single?value+' '+(field==='win_percentage'?'win percentage':label(field)):value)+when+where+'.';
 if(field==='expected_wins'&&single)sentence=who+"’s weekly scores translated to "+value+' expected wins'+(row.year===data.year?' through Week '+data.cutoff+' of '+row.year:when)+'.';
 if(field==='rank')sentence=who+' '+(row.year===data.year?'is':'was')+' ranked '+row[field]+' in the published '+row.year+' standings through Week '+data.cutoff+'.';
 if(field==='expected_wins')sentence+=' Expected wins reflect how weekly scores compared with the rest of the league.';
 if(field==='luck')sentence+=' Luck is actual wins minus expected wins; lower values mean results fell further below scoring-based expectations.';
 return sentence+tieSentence(tied,'records');
}
function aggregateSentence(top,groups,metric,p,tied,data){
 const who=top.names.length?top.names.map(format).join(', '):'The matching records';
 const year=p.filters.find(f=>f.field==='year'&&f.op==='eq')?.value;
 const when=year?' in '+year:'';
 if(p.table==='championships')return who+' '+(p.filters.some(f=>f.field==='owner')?'has':p.direction==='asc'?'has the fewest recorded titles among matching winners, with':'leads the matching championship records with')+' '+format(top.value)+' recorded championship'+(top.value===1?'':'s')+when+'.'+tieSentence(tied,'managers');
 if(metric.field==='expected_wins'&&metric.op==='sum')return who+"’s weekly scores translated to "+format(top.value)+' expected wins'+when+'.'+tieSentence(tied,'groups');
 const operation={sum:'a total of',avg:'an average of',min:'a minimum of',max:'a maximum of',count:'a count of',count_distinct:'a distinct count of'}[metric.op];
 const measure=metric.op==='count'?'matching records':metric.op==='count_distinct'?'distinct '+label(metric.field)+' values':label(metric.field);
 return who+' recorded '+operation+' '+spoken(top.value,metric.field)+' '+measure+when+'.'+tieSentence(tied,'groups');
}
function windowSentence(top,w,p,tied){
 const a=top.items[0],b=top.items.at(-1),value=spoken(top.value,w.field);
 if(w.field==='points_for'&&w.op==='sum')return a.owner+' had the '+(p.direction==='asc'?'lowest':'highest')+'-scoring '+w.length+'-game stretch'+(p.filters.length?' among the records matching your question':' in published league history')+': '+value+' points across Weeks '+a.week+'–'+b.week+' of '+a.year+'.'+tieSentence(tied,'stretches');
 return a.owner+' had the '+(p.direction==='asc'?'lowest':'highest')+' '+(w.op==='avg'?'average':'total')+' '+label(w.field)+' across '+w.length+' consecutive regular-season weeks among the matching records: '+value+'. That stretch ran from Week '+a.week+' through Week '+b.week+' in '+a.year+'.'+tieSentence(tied,'stretches');
}
function questionTitle(p){return p.operation==='window'?'Consecutive-week record':p.table==='championships'?'League championships':p.table==='current_standings'?'Current standings':label(p.sort_field||p.metric?.field||'league records').replace(/^./,c=>c.toUpperCase());}
