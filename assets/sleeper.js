/* Sleeper display data never changes the verified league archive. */
(() => {
  'use strict';
  const sample=window.SPARTY_SLEEPER_SAMPLE;
  if (!sample || sample.league_id!=='1386532723459362816') return;
  const base=`https://api.sleeper.app/v1/league/${sample.league_id}`;
  const rosterFor=owner=>sample.owner_roster[owner];
  const ownerFor=roster=>Object.keys(sample.owner_roster).find(id=>sample.owner_roster[id]===roster);
  const player=id=>sample.players[String(id)]||{name:`Player ${id}`,position:'—',team:''};
  async function request(path){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(`${base}${path}`,{signal:controller.signal,cache:'no-store'});
      if(!response.ok)throw Error('Sleeper request failed');
      return await response.json();
    }finally{clearTimeout(timer);}
  }
  function validateWeek(rows,teamCount){
    if(!Array.isArray(rows)||rows.length!==teamCount)throw Error('Matchup count');
    const ids=new Set(),pairs=new Map();
    for(const row of rows){
      if(!ownerFor(row.roster_id)||ids.has(row.roster_id)||!Number.isInteger(row.matchup_id)||!Number.isFinite(Number(row.points))||!Array.isArray(row.starters)||!Array.isArray(row.starters_points)||row.starters.length!==row.starters_points.length)throw Error('Matchup fields');
      ids.add(row.roster_id);pairs.set(row.matchup_id,[...(pairs.get(row.matchup_id)||[]),row]);
    }
    if(pairs.size!==teamCount/2||[...pairs.values()].some(pair=>pair.length!==2))throw Error('Matchup pairs');
    return [...pairs.values()].sort((a,b)=>a[0].matchup_id-b[0].matchup_id);
  }
  function topScorers(row,limit=3){
    return row.starters.map((id,i)=>({id:String(id),...player(id),points:Number(row.starters_points[i])})).filter(p=>p.id!=='0'&&Number.isFinite(p.points)).sort((a,b)=>b.points-a.points).slice(0,limit);
  }
  async function completedWeek(year,week,gameRows){
    if(year!==sample.season)return null;
    try{
      const rows=sample.weeks[String(week)]||await request(`/matchups/${week}`);
      validateWeek(rows,gameRows.length);
      if(rows.some(row=>{const owner=ownerFor(row.roster_id),official=gameRows.find(g=>g.owner_id===owner);return !official||Math.abs(Number(row.custom_points??row.points)-official.points_for)>.011;}))return null;
      return new Map(rows.map(row=>[ownerFor(row.roster_id),row]));
    }catch(_){return null;}
  }
  async function liveWeek(year,verifiedWeek,teamCount,regularWeeks){
    if(year!==sample.season||verifiedWeek>=regularWeeks)return null;
    const fallback=()=>{
      const week=verifiedWeek+1;
      if(week!==5||!sample.weeks[String(week)])return {unavailable:true};
      return {week,pairs:validateWeek(sample.weeks[String(week)],teamCount),rosters:sample.rosters,source:'sample',saved_date:sample.saved_date};
    };
    if(navigator.onLine===false)return fallback();
    try{
      const [league,rosters]=await Promise.all([request(''),request('/rosters')]);
      if(league.league_id!==sample.league_id||Number(league.season)!==year||!Array.isArray(rosters)||rosters.length!==teamCount||sample.rosters.some(old=>!rosters.some(row=>row.roster_id===old.roster_id&&row.owner_id===old.owner_id)))throw Error('League roster changed');
      const week=Math.max(verifiedWeek+1,Number(league.settings?.leg)||0);
      if(week>regularWeeks)return {unavailable:true};
      const pairs=validateWeek(await request(`/matchups/${week}`),teamCount);
      return {week,pairs,rosters,source:'api',complete:Number(league.settings?.last_scored_leg)>=week,updated:new Date()};
    }catch(_){return fallback();}
  }
  window.SPARTY_SLEEPER={sample,player,rosterFor,ownerFor,topScorers,completedWeek,liveWeek};
})();
