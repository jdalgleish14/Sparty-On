/* Week-by-week regular-season rank chart. Reads the verified offline bundle. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const colors=['#18453b','#a36a31','#295caa','#aa4b55','#7253a7','#007f88','#a65a26','#537121','#ad427a','#476d86','#8d6833','#5762ba','#bb5c39','#45665c'];
  const SVG='http://www.w3.org/2000/svg';
  const data=window.SPARTY_ON_DATA;
  if(!data||data.validation_report?.status!=='PASS'||!$('race-section')||!$('year-select'))return;
  const seasons=new Map(data.seasons.filter(s=>s.status==='Complete'||s.status==='Current').map(s=>[s.year,s]));
  const summaries=new Map(data.season_summaries.map(row=>[`${row.year}:${row.owner_id}`,row]));
  const sort=(a,b)=>b.wins-a.wins||a.losses-b.losses||b.points_for-a.points_for||a.owner_id.localeCompare(b.owner_id);
  const fmt=value=>Number(value).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  let series,focus='',week=1,timer=null;
  function build(year){
    const season=seasons.get(year);
    if(!season)throw Error('Season unavailable');
    const weeks=season.status==='Current'?data.league.current_season_through_week:season.regular_season_weeks;
    const ids=season.roster_owner_ids;
    if(!Number.isInteger(weeks)||weeks<1||ids.length!==season.team_count||new Set(ids).size!==ids.length)throw Error('Season roster mismatch');
    const totals=new Map(ids.map(owner_id=>[owner_id,{owner_id,wins:0,losses:0,ties:0,points_for:0}]));
    const all=data.games.filter(game=>game.year===year&&game.stage==='Regular Season'&&game.week<=weeks);
    const frames=[];
    for(let w=1;w<=weeks;w++){
      const games=all.filter(game=>game.week===w);
      if(games.length!==ids.length||new Set(games.map(g=>g.owner_id)).size!==ids.length)throw Error('Weekly roster mismatch');
      for(const game of games){
        const item=totals.get(game.owner_id);
        if(!item||!Number.isFinite(game.points_for)||!Number.isFinite(game.points_against))throw Error('Invalid game');
        item.wins+=game.result==='W'?1:0;
        item.losses+=game.result==='L'?1:0;
        item.ties+=game.result==='T'?1:0;
        item.points_for+=game.points_for;
      }
      frames.push([...totals.values()].sort(sort).map((row,index)=>({...row,rank:index+1,week:w})));
    }
    const last=new Map(frames[frames.length-1].map(row=>[row.owner_id,row]));
    for(const id of ids){
      const stored=summaries.get(`${year}:${id}`),calculated=last.get(id);
      if(!stored||stored.games_played!==weeks||stored.wins!==calculated.wins||stored.losses!==calculated.losses||stored.ties!==calculated.ties||Math.abs(stored.points_for-calculated.points_for)>.011)throw Error('Final standings disagree');
    }
    return {season,weeks,ids,frames};
  }
  function pause(){if(timer){clearInterval(timer);timer=null;}$('race-play').textContent='Play';$('race-play').setAttribute('aria-pressed','false');}
  function render(){
    const frame=series.frames[week-1],count=series.ids.length;
    $('race-week').value=String(week);
    $('race-week-label').textContent=`Week ${week} of ${series.weeks}`;
    $('race-context').textContent=`${series.season.year} · ${count} teams · after Week ${week}`;
    $('race-week-summary').textContent=`Week ${week}: ${frame[0].owner_id===focus?'Selected team leads. ':''}${summaries.get(`${series.season.year}:${frame[0].owner_id}`).team} ranks first at ${frame[0].wins}–${frame[0].losses}${frame[0].ties?`–${frame[0].ties}`:''}.`;
    const x=w=>65+(w-1)*610/Math.max(1,series.weeks-1);
    const y=rank=>48+(rank-1)*308/Math.max(1,count-1);
    const ticks=[1,Math.ceil(count/2),count].filter((v,i,a)=>a.indexOf(v)===i);
    const grid=ticks.map(rank=>`<line x1="65" y1="${y(rank)}" x2="675" y2="${y(rank)}" stroke="#e5ebe5"/><text x="52" y="${y(rank)+4}" text-anchor="end" fill="#53675d" font-size="12">${rank}</text>`).join('');
    const xticks=Array.from({length:series.weeks},(_,i)=>i+1).filter(w=>w===1||w===series.weeks||w%2===0);
    const labels=xticks.map(w=>`<text x="${x(w)}" y="386" text-anchor="middle" fill="#53675d" font-size="11">${w}</text>`).join('');
    const ownerColor=id=>colors[series.ids.indexOf(id)%colors.length];
    const paths=series.ids.map(id=>{
      const points=series.frames.slice(0,week).map(rows=>rows.find(row=>row.owner_id===id));
      const selected=focus===id,dimmed=focus&& !selected;
      const path=points.map((p,i)=>`${i?'L':'M'}${x(i+1).toFixed(1)} ${y(p.rank).toFixed(1)}`).join(' ');
      const end=points[points.length-1],name=summaries.get(`${series.season.year}:${id}`).team;
      return `<g data-race-owner="${escape(id)}" opacity="${dimmed?'.15':selected?'1':'.78'}"><title>${escape(name)} · rank ${end.rank} after Week ${week}</title><path d="${path}" fill="none" stroke="${ownerColor(id)}" stroke-width="${selected?4:2.5}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(week)}" cy="${y(end.rank)}" r="${selected?6:4}" fill="${ownerColor(id)}" stroke="#fff" stroke-width="1"/></g>`;
    }).join('');
    $('race-chart').innerHTML=`<text x="65" y="23" fill="#53675d" font-size="12">Standing position · 1st at top</text>${grid}<line x1="${x(week)}" y1="40" x2="${x(week)}" y2="361" stroke="#b08d57" stroke-dasharray="4 5"/>${paths}${labels}<text x="370" y="410" fill="#53675d" font-size="11" text-anchor="middle">REGULAR-SEASON WEEK</text>`;
    $('race-table-body').innerHTML=frame.map(row=>{
      const name=summaries.get(`${series.season.year}:${row.owner_id}`).team;
      return `<tr class="${focus===row.owner_id?'race-focused':''}" data-race-owner="${escape(row.owner_id)}"><td><span class="race-swatch" style="background:${ownerColor(row.owner_id)}"></span>${row.rank}</td><td><button type="button" data-race-owner="${escape(row.owner_id)}" aria-label="Focus ${escape(name)}">${escape(name)}</button></td><td>${row.wins}–${row.losses}${row.ties?`–${row.ties}`:''}</td><td>${fmt(row.points_for)}</td></tr>`;
    }).join('');
  }
  function selectYear(year){
    pause();series=build(year);week=series.weeks;focus='';
    $('race-week').max=String(series.weeks);
    $('race-team').innerHTML='<option value="">All teams</option>'+series.ids.map(id=>`<option value="${escape(id)}">${escape(summaries.get(`${year}:${id}`).team)}</option>`).join('');
    $('race-team').value='';$('race-section').hidden=false;render();
  }
  try{selectYear(Number($('year-select').value));}
  catch(_){$('race-section').hidden=true;return;}
  $('year-select').addEventListener('change',event=>{try{selectYear(Number(event.target.value));}catch(_){pause();$('race-section').hidden=true;}});
  $('race-week').addEventListener('input',event=>{pause();week=Number(event.target.value);render();});
  $('race-team').addEventListener('change',event=>{focus=event.target.value;render();});
  $('race-play').addEventListener('click',()=>{
    if(timer){pause();return;}
    if(week===series.weeks){week=1;render();}
    $('race-play').textContent='Pause';$('race-play').setAttribute('aria-pressed','true');
    timer=setInterval(()=>{if(week>=series.weeks){pause();return;}week++;render();if(week===series.weeks)pause();},850);
  });
  const focusOwner=event=>{
    const target=event.target.closest('[data-race-owner]');if(!target)return;
    focus=target.dataset.raceOwner;$('race-team').value=focus;render();
  };
  $('race-chart').addEventListener('click',focusOwner);
  $('race-table-body').addEventListener('click',focusOwner);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  window.SPARTY_RACE_BUILD=build;
})();
